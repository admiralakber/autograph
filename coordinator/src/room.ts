// RoomCore — the runtime-agnostic logic of one shared world.
//
// It is deliberately PURE: it talks to the outside only through an injected
// `RoomTransport` (send / broadcast / peerCount) and an injected `verify`
// function. That means every required property — live peer count, push/pull
// migration, signature rejection, keep-best merge, rate-limiting — is unit-
// testable with fake connections and a fake clock, no WebSocket or Worker
// runtime needed. `src/server.ts` is the thin Durable Object adapter that wires
// this to PartyServer; the logic lives here so it can be proven in isolation.

import type { ClientMessage, ServerMessage, WireElite } from './protocol.ts';
import { LIMITS } from './protocol.ts';
import type { ServerArchive } from './archive.ts';
import { TokenBucket } from './ratelimit.ts';
import type { VerifyOutcome } from './verify.ts';

/** The I/O seam. PartyServer implements this in production; tests fake it. */
export interface RoomTransport {
  send(connId: string, msg: ServerMessage): void;
  broadcast(msg: ServerMessage, exclude?: string[]): void;
  /** Authoritative live peer count (PartyServer `getConnections()` in prod). */
  peerCount(): number;
}

export interface RoomHooks {
  /** Fired after a push installs new elites, so the host can persist them. */
  onAccept?(accepted: WireElite[]): void;
}

export interface RoomOptions {
  archive: ServerArchive;
  transport: RoomTransport;
  verify: (e: WireElite) => Promise<VerifyOutcome>;
  hooks?: RoomHooks;
  now?: () => number;
}

const errorMsg = (code: string, message: string): ServerMessage => ({ type: 'error', code, message });

export class RoomCore {
  private readonly archive: ServerArchive;
  private readonly transport: RoomTransport;
  private readonly verify: (e: WireElite) => Promise<VerifyOutcome>;
  private readonly hooks: RoomHooks;
  private readonly now: () => number;
  private readonly buckets = new Map<string, TokenBucket>();
  /** Per-connection last-reported generations/sec; summed for the swarm total. */
  private readonly gpsByConn = new Map<string, number>();

  constructor(o: RoomOptions) {
    this.archive = o.archive;
    this.transport = o.transport;
    this.verify = o.verify;
    this.hooks = o.hooks ?? {};
    this.now = o.now ?? (() => Date.now());
  }

  /** A peer joined: greet it, tell everyone the new count, and hand the newcomer
   *  the current collective gen/s so the swarm feels alive immediately. */
  onConnect(id: string): void {
    this.transport.send(id, {
      type: 'welcome',
      peers: this.transport.peerCount(),
      room: this.archive.info(),
      you: id,
    });
    this.transport.broadcast({ type: 'peers', peers: this.transport.peerCount() });
    this.transport.send(id, { type: 'swarm', peers: this.transport.peerCount(), gps: this.totalGps() });
  }

  /** A peer left: drop its bucket + rate, and tell everyone the new count and the
   *  reduced collective gen/s. */
  onClose(id: string): void {
    this.buckets.delete(id);
    this.gpsByConn.delete(id);
    this.transport.broadcast({ type: 'peers', peers: this.transport.peerCount() });
    this.transport.broadcast({ type: 'swarm', peers: this.transport.peerCount(), gps: this.totalGps() });
  }

  async onMessage(id: string, raw: string | ArrayBuffer): Promise<void> {
    const now = this.now();

    const size = typeof raw === 'string' ? raw.length : raw.byteLength;
    if (size > LIMITS.maxMessageBytes) {
      this.transport.send(id, errorMsg('too-large', 'message exceeds size cap'));
      return;
    }

    if (!this.bucketFor(id).take(now)) {
      this.transport.send(id, errorMsg('rate-limited', 'too many messages; slow down'));
      return;
    }

    let msg: ClientMessage;
    try {
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      this.transport.send(id, errorMsg('bad-json', 'could not parse message'));
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') {
      this.transport.send(id, errorMsg('bad-message', 'missing message type'));
      return;
    }

    switch (msg.type) {
      case 'hello':
        // Re-greet; `welcome` already carries room dims + the live peer count.
        this.transport.send(id, {
          type: 'welcome',
          peers: this.transport.peerCount(),
          room: this.archive.info(),
          you: id,
        });
        return;
      case 'pull':
        this.handlePull(id, msg);
        return;
      case 'push':
        await this.handlePush(id, msg);
        return;
      case 'rate':
        this.handleRate(id, msg);
        return;
      default:
        this.transport.send(id, errorMsg('unknown-type', `unknown message type`));
        return;
    }
  }

  /** Record a peer's local gen/s (clamped) and broadcast the new swarm total. */
  private handleRate(id: string, msg: { gps?: unknown }): void {
    const gps =
      typeof msg.gps === 'number' && Number.isFinite(msg.gps) && msg.gps >= 0 ? Math.min(msg.gps, LIMITS.maxGpsPerPeer) : 0;
    this.gpsByConn.set(id, gps);
    this.transport.broadcast({ type: 'swarm', peers: this.transport.peerCount(), gps: this.totalGps() });
  }

  /** Collective generations/second across all connected peers (rounded). */
  private totalGps(): number {
    let sum = 0;
    for (const v of this.gpsByConn.values()) sum += v;
    return Math.round(sum);
  }

  private bucketFor(id: string): TokenBucket {
    let b = this.buckets.get(id);
    if (!b) {
      b = new TokenBucket(LIMITS.bucketCapacity, LIMITS.bucketRefillPerSec, this.now());
      this.buckets.set(id, b);
    }
    return b;
  }

  private async handlePush(id: string, msg: { elites?: unknown }): Promise<void> {
    if (!Array.isArray(msg.elites)) {
      this.transport.send(id, errorMsg('bad-push', 'elites must be an array'));
      return;
    }
    const all = msg.elites as WireElite[];
    const incoming = all.slice(0, LIMITS.maxElitesPerPush);

    const accepted: WireElite[] = [];
    const reasons: string[] = [];
    let rejected = 0;

    for (const elite of incoming) {
      const verdict = await this.verify(elite);
      if (!verdict.ok) {
        rejected++;
        reasons.push(verdict.reason ?? 'invalid');
        continue;
      }
      const merge = this.archive.insert(elite);
      if (merge.accepted) {
        accepted.push(elite);
      } else {
        rejected++;
        reasons.push(merge.reason ?? 'rejected');
      }
    }
    if (all.length > incoming.length) {
      rejected += all.length - incoming.length;
      reasons.push('over-cap');
    }

    this.transport.send(id, {
      type: 'ack',
      accepted: accepted.length,
      rejected,
      reasons: reasons.slice(0, 16),
    });

    if (accepted.length > 0) {
      // Fan the new elites out to every OTHER peer so they migrate them in.
      this.transport.broadcast({ type: 'delta', elites: accepted, room: this.archive.info() }, [id]);
      this.hooks.onAccept?.(accepted);
    }
  }

  private handlePull(id: string, msg: { since?: unknown; limit?: unknown }): void {
    const since = typeof msg.since === 'number' && Number.isFinite(msg.since) && msg.since >= 0 ? msg.since : 0;
    const limit =
      typeof msg.limit === 'number' && Number.isFinite(msg.limit) && msg.limit > 0 ? Math.floor(msg.limit) : LIMITS.maxPullLimit;
    const elites = this.archive.snapshot(since, limit);
    this.transport.send(id, { type: 'elites', elites, room: this.archive.info() });
  }
}
