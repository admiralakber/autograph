// The authoritative shared MAP-Elites archive for one room (the "archipelago").
//
// Merge = keep-best-per-cell. This is a join-semilattice (a per-cell "max" by
// fidelity) with content-addressed de-duplication, which makes it:
//   • commutative + associative — the result is independent of the order pushes
//     arrive in (safe for an async island model where tabs sync sporadically);
//   • idempotent — re-submitting the same genome (same content hash) is a no-op.
// A deterministic tiebreak (lower genome hash wins an exact-fidelity tie) keeps
// the "max" well-defined so two rooms fed the same set converge to the same map.
//
// cellIndex() mirrors web/src/engine/mapelites.ts so the client's local mirror
// and this authoritative grid agree on which behaviour lands in which niche.

import type { RoomInfo, WireElite } from './protocol.ts';
import { LIMITS, PROTOCOL_VERSION } from './protocol.ts';

export interface StoredElite {
  readonly elite: WireElite;
  /** Grid cell index this elite occupies. */
  readonly cell: number;
  /** Bound, signed fidelity — the ranking key. */
  readonly fidelity: number;
  /** Content hash of the genome (dedup + tiebreak key). */
  readonly hash: string;
  /** Monotonic receive sequence (a `pull` cursor). */
  readonly seq: number;
}

export type MergeReason = 'duplicate' | 'worse' | 'tie';

export interface MergeResult {
  readonly accepted: boolean;
  readonly reason?: MergeReason;
}

export class ServerArchive {
  readonly cols: number;
  readonly rows: number;
  private readonly cells = new Map<number, StoredElite>();
  /** Every genome hash ever admitted — content-addressed idempotency. */
  private readonly seen = new Set<string>();
  private seq = 0;

  constructor(cols: number = LIMITS.cols, rows: number = LIMITS.rows) {
    this.cols = cols;
    this.rows = rows;
  }

  /** Map a behaviour descriptor in [0,1]^2 to a cell index (mirror of MapElites). */
  cellIndex(bd: readonly [number, number]): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(bd[0] * this.cols)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(bd[1] * this.rows)));
    return cy * this.cols + cx;
  }

  /**
   * Keep-best-per-cell merge of one (already cryptographically verified) elite.
   * Ranking uses the signed `lineage.fidelity`. Returns whether it was installed.
   */
  insert(elite: WireElite): MergeResult {
    const hash = elite.lineage.genomeHash;
    if (this.seen.has(hash)) return { accepted: false, reason: 'duplicate' };

    const fidelity = elite.lineage.fidelity;
    const cell = this.cellIndex(elite.evaluation.bd);
    const existing = this.cells.get(cell);

    if (existing) {
      if (fidelity < existing.fidelity) return { accepted: false, reason: 'worse' };
      // Exact tie → deterministic winner (lower hash) so merge stays commutative.
      if (fidelity === existing.fidelity && hash >= existing.hash) return { accepted: false, reason: 'tie' };
    }

    this.seen.add(hash);
    this.cells.set(cell, { elite, cell, fidelity, hash, seq: ++this.seq });
    return { accepted: true };
  }

  get(cell: number): StoredElite | undefined {
    return this.cells.get(cell);
  }

  count(): number {
    return this.cells.size;
  }

  coverage(): number {
    return this.cells.size / (this.cols * this.rows);
  }

  /** Current cursor; pass back as `pull.since` to fetch only newer elites. */
  cursor(): number {
    return this.seq;
  }

  /** Highest-fidelity elite overall (the champion), or null if empty. */
  champion(): StoredElite | null {
    let best: StoredElite | null = null;
    for (const s of this.cells.values()) {
      if (!best || s.fidelity > best.fidelity || (s.fidelity === best.fidelity && s.hash < best.hash)) best = s;
    }
    return best;
  }

  /**
   * The migration payload: elites with seq > `since`, newest-first, capped at
   * `limit`. `since = 0` returns the whole archive (cold pull / first sync).
   */
  snapshot(since = 0, limit: number = LIMITS.maxPullLimit): WireElite[] {
    const out: StoredElite[] = [];
    for (const s of this.cells.values()) if (s.seq > since) out.push(s);
    out.sort((a, b) => b.seq - a.seq);
    return out.slice(0, Math.max(0, Math.min(limit, LIMITS.maxPullLimit))).map((s) => s.elite);
  }

  /** Rehydrate from persisted/verified elites (used on Durable Object wake). */
  load(elites: WireElite[]): void {
    for (const e of elites) this.insert(e);
  }

  info(): RoomInfo {
    return {
      cols: this.cols,
      rows: this.rows,
      filled: this.count(),
      coverage: this.coverage(),
      cursor: this.seq,
      protocol: PROTOCOL_VERSION,
    };
  }
}
