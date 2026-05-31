// SharedArchive — the client half of the swap-able `Archive` seam, vendored into
// the web app from the coordinator's connector (coordinator/client/swarmClient.ts).
//
// Why vendored rather than cross-imported: the coordinator directory is deployed
// separately (Cloudflare) and is NOT part of the static-site build, so the site
// must build and run with it absent. The connector's own header sanctions exactly
// this ("you may instead import the engine types and delete the local copies —
// the shapes are identical"). So here the domain types are the ENGINE's real ones
// (Genome/Evaluation/LineageEntry), and only the small, stable v1 wire-message
// types are mirrored from coordinator/src/protocol.ts. The genome wire format
// (genomeBytes) is untouched — this module never serialises genomes.

import type { Genome } from '../engine/cppn.ts';
import type { Evaluation } from '../engine/fitness.ts';
import type { LineageEntry } from '../engine/lineage.ts';
import type { Archive, ArchiveBest, Cell } from '../engine/archive.ts';

// ── Wire protocol (mirror of coordinator/src/protocol.ts, v1) ────────────────

export interface WireElite {
  readonly genome: Genome;
  readonly evaluation: Evaluation;
  readonly lineage: LineageEntry;
}
export interface RoomInfo {
  readonly cols: number;
  readonly rows: number;
  readonly filled: number;
  readonly coverage: number;
  readonly cursor: number;
  readonly protocol: number;
}
type ClientMessage =
  | { type: 'hello'; client?: string }
  | { type: 'push'; elites: WireElite[] }
  | { type: 'pull'; since?: number; limit?: number }
  | { type: 'rate'; gps: number };
type ServerMessage =
  | { type: 'welcome'; peers: number; room: RoomInfo; you: string }
  | { type: 'peers'; peers: number }
  | { type: 'delta'; elites: WireElite[]; room: RoomInfo }
  | { type: 'elites'; elites: WireElite[]; room: RoomInfo }
  | { type: 'ack'; accepted: number; rejected: number; reasons: string[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'swarm'; peers: number; gps: number };

/** Produces a signed, content-addressed lineage entry for an outgoing elite
 *  (wraps the engine's `createEntry`). */
export interface EliteSigner {
  sign(genome: Genome, evaluation: Evaluation): Promise<LineageEntry>;
}

type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
};

export interface SharedArchiveOptions {
  url: string;
  mirror: Archive;
  signer: EliteSigner;
  room?: string;
  onPeers?: (peers: number) => void;
  /** The live collective: peer count + summed generations/second across the swarm. */
  onSwarm?: (peers: number, gps: number) => void;
  onError?: (code: string, message: string) => void;
  flushMs?: number;
}

const WS_OPEN = 1;

// Stay safely under the coordinator's LIMITS (maxElitesPerPush 64, maxMessageBytes
// 128 KiB). A burst of new niches (initial fill / turbo) can mint many elites in
// one flush window; without chunking, a single oversized `push` frame is dropped
// server-side ('too-large') and those shares are silently lost. Chunking sends
// several small frames instead — the wire format is unchanged.
const MAX_PUSH_ELITES = 48;
const MAX_PUSH_BYTES = 120 * 1024;

/** A networked `Archive` backed by the PartyServer coordinator. Reads delegate to
 *  a local mirror (synchronous, UI-unchanged); local inserts update the mirror
 *  AND are signed + pushed; inbound migrations merge via the same keep-best path.
 *  push = best-per-niche (only when `tryInsert` reports a new elite); pull on
 *  connect = migration of the shared archive. */
export class SharedArchive implements Archive {
  private readonly mirror: Archive;
  private readonly signer: EliteSigner;
  private readonly wsUrl: string;
  private readonly onPeers?: (peers: number) => void;
  private readonly onSwarm?: (peers: number, gps: number) => void;
  private readonly onError?: (code: string, message: string) => void;
  private readonly flushMs: number;
  private socket: WebSocketLike | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private peerCount = 0;
  private lastGen = 0;
  /** Set once the shared archive has been pulled into the mirror. Pushing is
   *  gated on it, so a fresh / RESET world syncs the good shared elites BEFORE it
   *  can push — its trivial early creatures never travel upward. */
  private synced = false;
  private readonly pending: { genome: Genome; evaluation: Evaluation }[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SharedArchiveOptions) {
    this.mirror = opts.mirror;
    this.signer = opts.signer;
    this.onPeers = opts.onPeers;
    this.onSwarm = opts.onSwarm;
    this.onError = opts.onError;
    this.flushMs = opts.flushMs ?? 200;
    // The shared world. Bumped with the genome wire format (v3 = intrinsic
    // self-quine, no reader weights): a fresh room name guarantees a clean slate
    // so stale v2 elites — which no longer verify — can never linger. Everyone
    // auto-joins this one Genesis archipelago.
    const room = opts.room ?? 'genesis-v3';
    this.wsUrl = `${opts.url.replace(/\/$/, '')}/parties/archive-room/${encodeURIComponent(room)}`;
    this.connect();
  }

  // reads → local mirror (UI unchanged)
  get cols(): number {
    return this.mirror.cols;
  }
  get rows(): number {
    return this.mirror.rows;
  }
  cellIndex(bd: readonly [number, number]): number {
    return this.mirror.cellIndex(bd);
  }
  get(index: number): Cell | null {
    return this.mirror.get(index);
  }
  count(): number {
    return this.mirror.count();
  }
  coverage(): number {
    return this.mirror.coverage();
  }
  best(): ArchiveBest | null {
    return this.mirror.best();
  }
  bestLively(minComplexity?: number, minVitality?: number): ArchiveBest | null {
    return this.mirror.bestLively(minComplexity, minVitality);
  }
  randomElite(rand: () => number): Cell | null {
    return this.mirror.randomElite(rand);
  }
  drainDirty(): number[] {
    return this.mirror.drainDirty();
  }
  forEach(fn: (cell: Cell | null, index: number) => void): void {
    this.mirror.forEach(fn);
  }

  /** Install locally; if it became a best-per-niche elite, sign + share it. */
  tryInsert(genome: Genome, evaluation: Evaluation, gen: number, gid = 0, parents: number[] = []): boolean {
    this.lastGen = gen;
    const became = this.mirror.tryInsert(genome, evaluation, gen, gid, parents);
    // Only queue a push once we've synced the shared archive: a creature that
    // beats our just-pulled mirror is a genuine improvement worth sharing; a
    // fresh/RESET world's early trivial elites (pre-sync) are never queued.
    if (became && this.synced) {
      this.pending.push({ genome, evaluation });
      this.scheduleFlush();
    }
    return became;
  }

  peers(): number {
    return this.peerCount;
  }
  /** Report this node's local generations/sec so the coordinator can sum the
   *  swarm total. No-op when not connected (the UI falls back to the local rate). */
  reportRate(gps: number): void {
    if (this.socket?.readyState === WS_OPEN) this.sendRaw({ type: 'rate', gps: Math.max(0, Math.round(gps)) });
  }
  connected(): boolean {
    return this.socket?.readyState === WS_OPEN;
  }
  close(): void {
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.socket?.close();
  }

  private connect(): void {
    if (this.closed) return;
    const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    if (!Ctor) {
      this.onError?.('no-websocket', 'no WebSocket available');
      return;
    }
    let sock: WebSocketLike;
    try {
      sock = new Ctor(this.wsUrl);
    } catch {
      this.onError?.('bad-url', 'could not open the coordinator URL');
      return;
    }
    this.socket = sock;
    sock.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.synced = false; // must re-pull the shared archive before we may push again
      this.sendRaw({ type: 'hello' });
      this.sendRaw({ type: 'pull' }); // migration: seed the mirror; pushing waits for the reply
    });
    sock.addEventListener('message', (event: unknown) => {
      const data = (event as { data?: unknown }).data;
      if (typeof data === 'string') this.onServerMessage(data);
    });
    sock.addEventListener('close', () => this.scheduleReconnect());
    sock.addEventListener('error', () => this.onError?.('socket', 'websocket error'));
  }

  private scheduleReconnect(): void {
    this.socket = null;
    this.synced = false; // re-pull before pushing once we're back
    this.setPeers(0);
    if (this.closed) return;
    const delay = Math.min(15000, 500 * 2 ** this.reconnectAttempts++);
    setTimeout(() => this.connect(), delay);
  }

  private onServerMessage(text: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.setPeers(msg.peers);
        break;
      case 'peers':
        this.setPeers(msg.peers);
        break;
      case 'swarm':
        this.setPeers(msg.peers);
        this.onSwarm?.(msg.peers, msg.gps);
        break;
      case 'delta':
        // Inbound migration: keep-best + vitality-gated merge (MapElites.tryInsert)
        // — a worse or trivial incoming elite can never overwrite a local cell.
        for (const wire of msg.elites) this.mirror.tryInsert(wire.genome, wire.evaluation, this.lastGen);
        break;
      case 'elites':
        // The pull reply: absorb the shared archive, THEN allow pushing.
        for (const wire of msg.elites) this.mirror.tryInsert(wire.genome, wire.evaluation, this.lastGen);
        this.synced = true;
        void this.flush();
        break;
      case 'error':
        this.onError?.(msg.code, msg.message);
        break;
      case 'ack':
        break;
    }
  }

  private setPeers(n: number): void {
    if (n !== this.peerCount) {
      this.peerCount = n;
      this.onPeers?.(n);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.pending.length === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushMs);
  }

  private async flush(): Promise<void> {
    if (!this.synced || this.pending.length === 0 || this.socket?.readyState !== WS_OPEN) return;
    const batch = this.pending.splice(0, this.pending.length);
    const elites: WireElite[] = [];
    for (const item of batch) {
      try {
        const lineage = await this.signer.sign(item.genome, item.evaluation);
        elites.push({ genome: item.genome, evaluation: item.evaluation, lineage });
      } catch {
        this.onError?.('sign-failed', 'could not sign an elite for sharing');
      }
    }
    // Fan out in frames that respect the coordinator's per-push count + size caps.
    for (let i = 0; i < elites.length; ) {
      const chunk: WireElite[] = [];
      let bytes = 24; // envelope: {"type":"push","elites":[…]}
      while (i < elites.length && chunk.length < MAX_PUSH_ELITES) {
        const size = JSON.stringify(elites[i]).length + 1;
        if (chunk.length > 0 && bytes + size > MAX_PUSH_BYTES) break;
        chunk.push(elites[i]!);
        bytes += size;
        i++;
      }
      if (this.socket?.readyState !== WS_OPEN) break; // dropped mid-flush → stop cleanly
      this.sendRaw({ type: 'push', elites: chunk });
    }
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.socket?.readyState === WS_OPEN) this.socket.send(JSON.stringify(msg));
  }
}
