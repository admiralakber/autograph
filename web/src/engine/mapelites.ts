import { cloneGenome } from './cppn.ts';
import type { Genome } from './cppn.ts';
import type { Evaluation } from './fitness.ts';
import type { Archive, ArchiveBest, Cell } from './archive.ts';

/** Reject near-flat creatures: a self-portrait of nothing is the trivial
 *  fixed point the briefing warns about. We keep self-reference load-bearing. */
const MIN_VITALITY = 0.05;

/** The **local, in-memory** implementation of the `Archive` seam (also exported
 *  as `LocalArchive`). A 2-D MAP-Elites grid: each cell keeps the highest-
 *  fidelity creature of its visual "kind", and the filled grid *is* the artwork.
 *  A networked `SharedArchive` (docs/DEPLOY-coordinator.md) can replace it
 *  wherever an `Archive` is expected — the engine never names this class. */
export class MapElites implements Archive {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: (Cell | null)[];
  /** Cells whose elite changed since the last `drainDirty()` (for redraws). */
  private readonly dirty = new Set<number>();

  constructor(cols = 14, rows = 14) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Array<Cell | null>(cols * rows).fill(null);
  }

  cellIndex(bd: readonly [number, number]): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(bd[0] * this.cols)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(bd[1] * this.rows)));
    return cy * this.cols + cx;
  }

  get(index: number): Cell | null {
    return this.cells[index] ?? null;
  }

  /** Quality used to rank within a cell: the self-encoding loop fidelity. */
  private static quality(e: Evaluation): number {
    return e.fidelity;
  }

  /** Attempt to install a creature. Returns true if it became (or replaced) an elite. */
  tryInsert(genome: Genome, evaluation: Evaluation, gen: number): boolean {
    if (evaluation.vitality < MIN_VITALITY) return false;
    const idx = this.cellIndex(evaluation.bd);
    const existing = this.cells[idx];
    if (existing && MapElites.quality(existing.evaluation) >= MapElites.quality(evaluation)) {
      return false;
    }
    this.cells[idx] = { genome: cloneGenome(genome), evaluation, bornAt: gen };
    this.dirty.add(idx);
    return true;
  }

  /** Number of filled cells. */
  count(): number {
    let n = 0;
    for (const c of this.cells) if (c) n++;
    return n;
  }

  coverage(): number {
    return this.count() / this.cells.length;
  }

  /** The single best self-encoder in the whole archive. */
  best(): ArchiveBest | null {
    let bestIdx = -1;
    let bestQ = -Infinity;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (c && MapElites.quality(c.evaluation) > bestQ) {
        bestQ = MapElites.quality(c.evaluation);
        bestIdx = i;
      }
    }
    return bestIdx < 0 ? null : { index: bestIdx, cell: this.cells[bestIdx]! };
  }

  /** The best self-encoder that is genuinely *alive* — structured and
   *  high-contrast, not the trivial near-flat fixed point. This is the creature
   *  worth showcasing: it re-encodes itself *and* has something to say. */
  bestLively(minComplexity = 0.28, minVitality = 0.18): ArchiveBest | null {
    let bestIdx = -1;
    let bestQ = -Infinity;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (!c) continue;
      if (c.evaluation.bd[0] < minComplexity || c.evaluation.vitality < minVitality) continue;
      const q = MapElites.quality(c.evaluation);
      if (q > bestQ) {
        bestQ = q;
        bestIdx = i;
      }
    }
    return bestIdx < 0 ? null : { index: bestIdx, cell: this.cells[bestIdx]! };
  }

  /** A random filled cell (for selection), or null if empty. */
  randomElite(rand: () => number): Cell | null {
    const filled: Cell[] = [];
    for (const c of this.cells) if (c) filled.push(c);
    if (filled.length === 0) return null;
    return filled[Math.floor(rand() * filled.length)] ?? null;
  }

  /** Collect and clear the set of cells changed since the last call. */
  drainDirty(): number[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  forEach(fn: (cell: Cell | null, index: number) => void): void {
    for (let i = 0; i < this.cells.length; i++) fn(this.cells[i] ?? null, i);
  }
}

// Descriptive alias: the in-memory archive is the "local" half of the seam.
// A future SharedArchive (docs/DEPLOY-coordinator.md) is the networked half.
export { MapElites as LocalArchive };
