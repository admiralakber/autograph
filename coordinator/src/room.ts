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
  /** Per-connection last-reported rate (creatures evaluated/sec — the wire field is
   *  historically named `gps`) + when it arrived; summed for the swarm total, with
   *  stale reports expired so a peer that stops reporting (but lingers connected)
   *  cannot inflate the collective rate forever. The room is unit-agnostic — it sums
   *  whatever rate clients send; clients now report throughput, so the sum is too. */
  private readonly gpsByConn = new Map<string, { gps: number; at: number }>();

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

  /** A peer's rate is "fresh" for this long; older reports are not summed. */
  private static readonly GPS_TTL_MS = 12_000;

  /** Record a peer's reported rate (creatures/sec; clamped) and broadcast the new swarm total. */
  private handleRate(id: string, msg: { gps?: unknown }): void {
    const gps =
      typeof msg.gps === 'number' && Number.isFinite(msg.gps) && msg.gps >= 0 ? Math.min(msg.gps, LIMITS.maxGpsPerPeer) : 0;
    this.gpsByConn.set(id, { gps, at: this.now() });
    this.transport.broadcast({ type: 'swarm', peers: this.transport.peerCount(), gps: this.totalGps() });
  }

  /** Collective rate (creatures/sec) across all peers whose report is still fresh
   *  (rounded). Stale entries are dropped so the total decays honestly. */
  private totalGps(): number {
    const now = this.now();
    let sum = 0;
    for (const [id, r] of this.gpsByConn) {
      if (now - r.at > RoomCore.GPS_TTL_MS) this.gpsByConn.delete(id);
      else sum += r.gps;
    }
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
