// SharedArchive — the client half of the swap-able `Archive` seam.
//
// It implements the SAME `Archive` interface the engine already depends on
// (web/src/engine/archive.ts), so a tab joins the shared garden with a one-line
// swap and NO change to the evolution loop or the renderer:
//
//   const shared = new SharedArchive({
//     url: 'wss://autograph-coordinator.<subdomain>.workers.dev',
//     mirror: new LocalArchive(14, 14),         // the engine's MapElites
//     signer: makeEngineSigner(identity),        // wraps lineage.ts:createEntry
//   });
//   const garden = new Garden(seed, 14, 14, shared);   // (Garden taught to take an Archive)
//
// Design choices that keep this file decoupled from the concurrently-edited
// web/src (it imports NOTHING from the engine):
//   • the local read model is an INJECTED `mirror: Archive` — in the app that is
//     the engine's `LocalArchive` (MapElites). All synchronous reads (get/best/
//     forEach/coverage/drainDirty …) delegate straight to it, so the UI is
//     unchanged and stays in sync via the existing drainDirty() redraw path.
//   • signing is an INJECTED `signer: EliteSigner` — in the app that wraps the
//     engine's `createEntry`/`hashGenome` (the single source of truth for the
//     signed, content-addressed lineage). The coordinator dir never re-implements
//     client-side crypto.
//
// The seam types below MIRROR web/src/engine/archive.ts exactly. When wiring this
// into the app you may instead do
//   import type { Archive, Cell, ArchiveBest } from '../../web/src/engine/archive.ts';
// and delete the local copies — the shapes are identical (pinned by the contract
// test in the coordinator). They are duplicated here only so this module type-
// checks standalone without reaching into web/src.

import type { Evaluation, Genome, LineageEntry, WireElite } from '../src/protocol.ts';
import type { ServerMessage, ClientMessage, RoomInfo } from '../src/protocol.ts';

// ── The `Archive` seam (mirror of web/src/engine/archive.ts) ─────────────────

export interface Cell {
  readonly genome: Genome;
  readonly evaluation: Evaluation;
  bornAt: number;
}
export interface ArchiveBest {
  readonly index: number;
  readonly cell: Cell;
}
export interface Archive {
  readonly cols: number;
  readonly rows: number;
  cellIndex(bd: readonly [number, number]): number;
  get(index: number): Cell | null;
  tryInsert(genome: Genome, evaluation: Evaluation, gen: number): boolean;
  count(): number;
  coverage(): number;
  best(): ArchiveBest | null;
  bestLively(minComplexity?: number, minVitality?: number): ArchiveBest | null;
  randomElite(rand: () => number): Cell | null;
  drainDirty(): number[];
  forEach(fn: (cell: Cell | null, index: number) => void): void;
}

// ── Signing seam (wraps the engine's lineage.ts in the app) ──────────────────

/** Produces a signed, content-addressed lineage entry for an elite about to be
 *  shared. In the app: `{ sign: (g, e) => createEntry({ genome: g, parents: [],
 *  seed: null, fidelity: e.fidelity, identity }) }`. */
export interface EliteSigner {
  sign(genome: Genome, evaluation: Evaluation): Promise<LineageEntry>;
}

// ── Options ──────────────────────────────────────────────────────────────────

type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
};

export interface SharedArchiveOptions {
  /** Coordinator origin, e.g. `wss://autograph-coordinator.<subdomain>.workers.dev`. */
  url: string;
  /** Local read model — the engine's `LocalArchive` (MapElites) in the app. */
  mirror: Archive;
  /** Produces signed lineage for outgoing elites. */
  signer: EliteSigner;
  /** Room name = one shared world. Defaults to 'archipelago'. */
  room?: string;
  /** Notified whenever the live peer count changes. */
  onPeers?: (peers: number) => void;
  /** Notified on transport/protocol errors (non-fatal). */
  onError?: (code: string, message: string) => void;
  /** Override the WebSocket constructor (tests / Node). Defaults to global. */
  WebSocketImpl?: new (url: string) => WebSocketLike;
  /** Auto-connect on construction (default true). */
  autoConnect?: boolean;
  /** Coalescing window for outgoing pushes, ms (default 200). */
  flushMs?: number;
}

const WS_OPEN = 1;

/**
 * A networked `Archive` backed by the PartyServer coordinator. Reads delegate to
 * a local mirror (synchronous, UI-unchanged); inserts update the mirror AND are
 * signed + forwarded to the room, where keep-best merge fans them to peers.
 */
export class SharedArchive implements Archive {
  private readonly mirror: Archive;
  private readonly signer: EliteSigner;
  private readonly wsUrl: string;
  private readonly onPeers?: (peers: number) => void;
  private readonly onError?: (code: string, message: string) => void;
  private readonly WebSocketImpl: (new (url: string) => WebSocketLike) | undefined;
  private readonly flushMs: number;

  private socket: WebSocketLike | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private peerCount = 0;
  private lastGen = 0;
  private room: RoomInfo | null = null;
  private readonly pending: { genome: Genome; evaluation: Evaluation }[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SharedArchiveOptions) {
    this.mirror = opts.mirror;
    this.signer = opts.signer;
    this.onPeers = opts.onPeers;
    this.onError = opts.onError;
    this.WebSocketImpl = opts.WebSocketImpl;
    this.flushMs = opts.flushMs ?? 200;
    const room = opts.room ?? 'archipelago';
    this.wsUrl = `${opts.url.replace(/\/$/, '')}/parties/archive-room/${encodeURIComponent(room)}`;
    if (opts.autoConnect !== false) this.connect();
  }

  // ── Archive seam: reads delegate straight to the local mirror ──────────────

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

  /** Install locally; if it became an elite, sign + share it with the room. */
  tryInsert(genome: Genome, evaluation: Evaluation, gen: number): boolean {
    this.lastGen = gen;
    const became = this.mirror.tryInsert(genome, evaluation, gen);
    if (became) {
      this.pending.push({ genome, evaluation });
      this.scheduleFlush();
    }
    return became;
  }

  // ── Swarm extras (optional, for the UI) ────────────────────────────────────

  /** Current live peer count in the room. */
  peers(): number {
    return this.peerCount;
  }
  /** Latest room info from the coordinator (filled/coverage/cursor), or null. */
  roomInfo(): RoomInfo | null {
    return this.room;
  }
  connected(): boolean {
    return this.socket?.readyState === WS_OPEN;
  }
  /** Close the connection and stop reconnecting. */
  close(): void {
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.socket?.close();
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  private connect(): void {
    if (this.closed) return;
    const Ctor = this.WebSocketImpl ?? (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    if (!Ctor) {
      this.onError?.('no-websocket', 'no WebSocket implementation available');
      return;
    }
    const sock = new Ctor(this.wsUrl);
    this.socket = sock;
    sock.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.sendRaw({ type: 'hello' });
      this.sendRaw({ type: 'pull' }); // seed the mirror with the shared archive
      this.flush();
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
        this.room = msg.room;
        this.setPeers(msg.peers);
        break;
      case 'peers':
        this.setPeers(msg.peers);
        break;
      case 'delta':
      case 'elites':
        this.room = msg.room;
        for (const wire of msg.elites) this.applyInbound(wire);
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

  /** Migrate an inbound elite into the local mirror (keep-best applies locally
   *  too, so a worse remote elite is harmlessly ignored). drainDirty() then
   *  drives the existing redraw path — the UI lights up with no extra wiring. */
  private applyInbound(wire: WireElite): void {
    this.mirror.tryInsert(wire.genome, wire.evaluation, this.lastGen);
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.pending.length === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushMs);
  }

  /** Sign and send all pending elites as one `push`. */
  private async flush(): Promise<void> {
    if (this.pending.length === 0 || this.socket?.readyState !== WS_OPEN) return;
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
    if (elites.length > 0) this.sendRaw({ type: 'push', elites });
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.socket?.readyState === WS_OPEN) this.socket.send(JSON.stringify(msg));
  }
}
