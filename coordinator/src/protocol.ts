// The wire protocol + shared domain types for the Autograph swarm coordinator.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ These domain types MIRROR the engine shapes in                              │
// │   web/src/engine/cppn.ts     (Genome / NodeGene / ConnGene)                 │
// │   web/src/engine/fitness.ts  (Evaluation)                                   │
// │   web/src/engine/lineage.ts  (LineageEntry)                                 │
// │ They are re-declared here on purpose so the coordinator (a Cloudflare       │
// │ Worker) is FULLY SELF-CONTAINED and never imports the browser engine.       │
// │ The byte/JSON contract is pinned by a frozen, REAL-engine-signed fixture in │
// │ test/fixtures/genuine-elite.json — drift is caught by a test, not silently. │
// └───────────────────────────────────────────────────────────────────────────┘

/** Bumped when the wire format changes incompatibly.
 *  v2: the genome gained a per-creature read-back network (`reader` weights).
 *  v3: that bolt-on regressor is GONE — the loop's decode half is now intrinsic
 *      (the CPPN self-quine), so the genome is just the graph again and
 *      `genomeBytes` drops the reader weights. v2 elites no longer verify; the
 *      shared world rebuilds clean (clients also join a fresh v3 room).
 *  v4: the v6 TEMPORAL BRAIN — `CPPN_OUTPUTS` 2→9 (the temporal channels), so the
 *      `genomeBytes` header records OUTPUTS=9 and v3-format (v5-epoch) elites no
 *      longer verify. Byte layout unchanged; the world rotates to a fresh genesis-v6
 *      room (see web/src/engine/genesis.ts ARCHIVE_EPOCH). `verify.ts` mirrors this.
 *  v5: the v7 SELF-WRITER — `CPPN_OUTPUTS` 9→11 (the autoregressive writer channels
 *      emitVal/emitEnd), so the header records OUTPUTS=11 and v6 elites no longer verify.
 *      Byte layout unchanged; the world rotates to a fresh genesis-v7 room. The decode is
 *      now a clean autoregressive self-write (no quine). `verify.ts` mirrors this.
 *  v6: the CLEAN-ARCHITECTURE fix (Stanley-grade genotype↔phenotype boundary) — the brain's
 *      behaviours LEAVE the CPPN to become substrate OUTPUT NEURONS, and density/hue become
 *      genuine CPPN-art channels, so `CPPN_OUTPUTS` drops 11→6 (weight, bias, density, hue,
 *      α, modGate). The header records OUTPUTS=6 and v7 elites no longer verify. Byte layout
 *      unchanged; the world rotates to a fresh genesis-v9 room. `verify.ts` mirrors this. */
export const PROTOCOL_VERSION = 6 as const;

// ── Domain types (mirror of web/src/engine) ─────────────────────────────────

/** 0 = input, 1 = hidden, 2 = output (mirrors cppn.ts NodeKind). */
export type NodeKind = 0 | 1 | 2;

export interface NodeGene {
  readonly id: number;
  readonly kind: NodeKind;
  readonly act: number;
  readonly bias: number;
}

export interface ConnGene {
  readonly innov: number;
  readonly from: number;
  readonly to: number;
  readonly weight: number;
  readonly enabled: boolean;
  /** Optional gater node id (neataptic-style): its activation modulates this
   *  connection. Absent/undefined = ungated; serialised as -1 in genomeBytes. */
  readonly gater?: number;
}

/** The DNA: a connective CPPN graph (mirrors cppn.ts Genome). The loop's decode
 *  half is INTRINSIC — the same CPPN read at canonical genome coordinates is the
 *  self-quine (no separate read-back network) — so the genome is just the graph,
 *  signed + integrity-checked via `genomeBytes`. */
export interface Genome {
  readonly nodes: NodeGene[];
  readonly conns: ConnGene[];
}

/** Measured behaviour + fidelity (mirrors fitness.ts Evaluation). */
export interface Evaluation {
  /** Behaviour descriptor in [0,1]^2: [structural complexity, mirror symmetry]. */
  readonly bd: readonly [number, number];
  /** Self-encoding loop fidelity in [0,1]. */
  readonly fidelity: number;
  /** Volumetric contrast in [0,1] — the vitality gate. */
  readonly vitality: number;
  /** Count of expressed phenotype connections. */
  readonly liveConns: number;
}

/** A signed, content-addressed lineage entry (mirrors lineage.ts LineageEntry). */
export interface LineageEntry {
  /** Content hash (hex) — the tamper-evident id (SHA-256 of the canonical form). */
  readonly id: string;
  /** Parent ids (0 = founder, 1 = mutation, 2 = crossover). */
  readonly parents: string[];
  /** SHA-256 (hex) of the genome bytes — binds this entry to a specific DNA. */
  readonly genomeHash: string;
  /** Seed phrase, if grown from one. */
  readonly seed: string | null;
  /** Loop fidelity in [0,1] at the time it was kept. */
  readonly fidelity: number;
  /** Author's public key (hex, raw EC P-256 point). */
  readonly author: string;
  /** ISO timestamp. */
  readonly createdAt: string;
  /** ECDSA P-256 signature over `id` (hex). */
  readonly signature: string;
}

/** One elite as it crosses the wire: the DNA, its measured behaviour and its
 *  signed lineage entry. The lineage entry is the anti-forgery payload. */
export interface WireElite {
  readonly genome: Genome;
  readonly evaluation: Evaluation;
  readonly lineage: LineageEntry;
}

// ── Operational limits (single source of truth, shared by server + tests) ────

export const LIMITS = {
  /** Max bytes per inbound WebSocket frame. Oversize frames are rejected. */
  maxMessageBytes: 128 * 1024,
  /** Max elites accepted in a single `push`. */
  maxElitesPerPush: 64,
  /** Max elites returned by a single `pull`. */
  maxPullLimit: 512,
  /** Token-bucket burst capacity (messages) per connection. */
  bucketCapacity: 40,
  /** Token-bucket sustained refill (messages/second) per connection. */
  bucketRefillPerSec: 12,
  /** Max plausible rate (creatures evaluated/sec) one peer may report (anti-inflation
   *  clamp). Generous — far above any honest single-machine throughput. */
  maxGpsPerPeer: 100_000,
  /** Default archive grid (matches the engine's MapElites default 14×14). */
  cols: 14,
  rows: 14,
} as const;

// ── Client → Server messages ─────────────────────────────────────────────────

/** Optional handshake; the server answers with `welcome` on connect regardless. */
export interface HelloMsg {
  readonly type: 'hello';
  readonly client?: string;
}

/** Submit best-per-niche elites for keep-best merge into the shared archive. */
export interface PushMsg {
  readonly type: 'push';
  readonly elites: WireElite[];
}

/** Pull others' elites (migration). `since` is a cursor from a prior reply. */
export interface PullMsg {
  readonly type: 'pull';
  readonly since?: number;
  readonly limit?: number;
}

/** Periodic local THROUGHPUT report — creatures evaluated per second. The room sums
 *  these across all connected peers and broadcasts the collective total (see
 *  `SwarmMsg`). The field is historically named `gps`; it now carries creatures/sec
 *  (the client's EVAL/S), so local and collective share one unit. Additive in v1: a
 *  peer that never sends it simply contributes 0 to the swarm total. */
export interface RateMsg {
  readonly type: 'rate';
  /** Creatures evaluated per second (legacy field name). */
  readonly gps: number;
}

export type ClientMessage = HelloMsg | PushMsg | PullMsg | RateMsg;

// ── Server → Client messages ─────────────────────────────────────────────────

export interface RoomInfo {
  readonly cols: number;
  readonly rows: number;
  readonly filled: number;
  readonly coverage: number;
  readonly cursor: number;
  /** Cumulative elites ever accepted into the shared archive (monotonic,
   *  persisted) — the honest, non-resetting "explored" total. */
  readonly discovered: number;
  readonly protocol: number;
}

/** Sent to a client immediately on connect. */
export interface WelcomeMsg {
  readonly type: 'welcome';
  readonly peers: number;
  readonly room: RoomInfo;
  readonly you: string;
}

/** Live peer count; broadcast to everyone on join/leave. */
export interface PeersMsg {
  readonly type: 'peers';
  readonly peers: number;
}

/** Broadcast of newly-accepted elites (so peers migrate them in). Excludes the
 *  pusher. This is the live "a creature lit up the wall for everyone" event. */
export interface DeltaMsg {
  readonly type: 'delta';
  readonly elites: WireElite[];
  readonly room: RoomInfo;
}

/** Reply to `pull`: a snapshot (or window) of the shared archive. */
export interface ElitesMsg {
  readonly type: 'elites';
  readonly elites: WireElite[];
  readonly room: RoomInfo;
}

/** Reply to `push`: honest feedback on what stuck and why the rest did not. */
export interface AckMsg {
  readonly type: 'ack';
  readonly accepted: number;
  readonly rejected: number;
  /** Per-rejection reason codes (e.g. 'bad-signature', 'worse', 'duplicate'). */
  readonly reasons: string[];
}

export interface ErrorMsg {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

/** The live collective: peer count + summed THROUGHPUT (creatures evaluated/sec)
 *  across every connected peer. Broadcast whenever a peer reports a new rate or
 *  leaves, so the total visibly grows as machines join. (`gps` is a legacy name.) */
export interface SwarmMsg {
  readonly type: 'swarm';
  readonly peers: number;
  /** Summed creatures evaluated per second (legacy field name). */
  readonly gps: number;
}

export type ServerMessage = WelcomeMsg | PeersMsg | DeltaMsg | ElitesMsg | AckMsg | ErrorMsg | SwarmMsg;
