import type { Genome } from './cppn.ts';
import type { Evaluation } from './fitness.ts';

// The storage seam.
//
// Every consumer in the engine (the `Garden` evolution loop) and the UI (the
// live demo) depends only on this `Archive` interface — never on a concrete
// class. That keeps the single-device archive that ships today swap-able for a
// shared, networked one with **no rewrite** of the engine or the UI.
//
//   Today:  LocalArchive (= MapElites, see mapelites.ts)
//           an in-memory, single-device MAP-Elites grid.
//
//   Later:  SharedArchive (roadmap — see docs/DEPLOY-coordinator.md)
//           the same interface backed by the PartyServer-on-Cloudflare-
//           Durable-Objects coordinator. It would keep a local mirror of the
//           global archive snapshot for synchronous reads, and forward inserts
//           + lineage to the coordinator over the network. Because the network
//           sync sits *behind* this seam, `Garden` and the UI are unaffected.
//           (If the coordinator round-trip must be awaited at the call site, an
//           async `Archive` variant is the documented next step in the runbook;
//           the surface below stays the source of truth either way.)

/** One occupied MAP-Elites cell: the elite genome of a behavioural "kind". */
export interface Cell {
  readonly genome: Genome;
  readonly evaluation: Evaluation;
  /** Generation at which this elite was installed (for "new!" cues). */
  bornAt: number;
}

/** A located elite, as returned by `best()` / `bestLively()`. */
export interface ArchiveBest {
  readonly index: number;
  readonly cell: Cell;
}

/** The swap-able archive contract. Implemented today by `LocalArchive`
 *  (in-memory); the documented `SharedArchive` seam (the PartyServer
 *  coordinator in docs/DEPLOY-coordinator.md) would implement the same surface. */
export interface Archive {
  readonly cols: number;
  readonly rows: number;
  /** Map a behaviour descriptor in [0,1]^2 to a cell index. */
  cellIndex(bd: readonly [number, number]): number;
  get(index: number): Cell | null;
  /** Install a creature; returns true if it became (or replaced) an elite. */
  tryInsert(genome: Genome, evaluation: Evaluation, gen: number): boolean;
  count(): number;
  coverage(): number;
  /** The single best self-encoder in the whole archive. */
  best(): ArchiveBest | null;
  /** The best self-encoder that is genuinely *alive* (structured, high-contrast). */
  bestLively(minComplexity?: number, minVitality?: number): ArchiveBest | null;
  randomElite(rand: () => number): Cell | null;
  /** Cell indices whose elite changed since the last call (for redraws). */
  drainDirty(): number[];
  forEach(fn: (cell: Cell | null, index: number) => void): void;
}
