import type { Genome } from './cppn.ts';
import { paramToUnit, paramCount, genomeVector } from './cppn.ts';
import { HYPER } from './hyperparams.ts';
import type { Phenotype } from './substrate.ts';
import { selfWrite } from './substrate.ts';

// THE SELF-WRITER — v7. The decode half is now a CLEAN self-loop, no quine.
//
//   DNA (CPPN) PAINTS AN IMAGE, the BRAIN (ES-HyperNEAT substrate) EMERGES WITHIN it
//     → the brain READS the image it's born in over a plastic, attentional, ponder-gated
//       lifetime (readPonderEmit) — RAM-style evolved glimpses, building a recurrent state
//     → the brain then AUTOREGRESSIVELY WRITES its DNA from its OWN neurons (selfWrite,
//       substrate.ts): each step fed its own previous output, it emits the next gene
//       (σ of an emitVal readout) and an end-signal (an emitEnd readout); when the end
//       fires, the creature has DECIDED its own length → a variable-length DNA′
//     → skill = how well DNA′ matches DNA, scored on BOTH the length and the values
//
// v6's emit was a QUINE: it re-projected the glimpses through the CPPN's own weights and
// read one value per existing gene at that gene's coordinate — the brain never wrote
// itself, and the length was given. v7 drops all of that: DNA′ is produced by the brain's
// own recurrent generation, and the creature decides how long its DNA is.
//
// THE HARD PART — length-discovery. A random creature emits wrong-length constant garbage
// → ~0 reward → no signal (sparse, unlike v6's dense per-gene reward). We bootstrap with a
// competence-scheduled CURRICULUM (Bengio scheduled sampling) + a LENGTH-SHAPING reward:
//   • a DENSE teacher-length value signal (read the first G emitted values, ignore the
//     end-signal, free-run input — NO leakage) gives a gradient on value-generation from
//     the start, regardless of the (on-ramping) end-signal;
//   • a separate LENGTH term Λ rewards selfLen → G, so there is a gradient toward the right
//     length even before the values are good;
//   • an ANNEAL hands the length decision over as value-competence rises — early creatures
//     are graded on the dense teacher read, mastered ones on their OWN self-length write.
//
// Honesty holds by construction: a blank / fresh creature writes a constant σ(0)=0.5 →
// predict-the-mean → R² ≈ 0 → skill ≈ 0, and is vitality-gated. Only a brain whose write
// genuinely reconstructs its DNA scores above 0.

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// Diagnostics from the most recent skill/readback call (the "thinking" + the length the
// creature CHOSE) — set as a side effect, read immediately after in the same synchronous
// chain (skill → readback, or drawLoop → readBackUnits).
let lastSelfLen = 0;
let lastPonderSteps = 0;
let lastGeneCount = 0;
let lastHalted = false;

/** The write diagnostics from the most recent skill/readback: the length the creature
 *  decided (`selfLen`) vs its genome size (`geneCount`), the read/ponder steps, and
 *  whether it chose to halt. Valid right after a `selfConsistencySkill` / `writeSkill` /
 *  `readBackUnits` call in the same synchronous chain. */
export function lastWrite(): { selfLen: number; ponder: number; geneCount: number; halted: boolean } {
  return { selfLen: lastSelfLen, ponder: lastPonderSteps, geneCount: lastGeneCount, halted: lastHalted };
}
/** The read/ponder steps of the most recent write — the creature's "thinking". */
export function lastPonder(): number {
  return lastPonderSteps;
}

/** The DNA's own values in unit space — the FULL genome, the target the writer must
 *  reproduce (v7: the whole DNA, no deferral; see arch.ts DEFERRED_OUTPUT_IDS). */
export function dnaTargetUnits(g: Genome): Float32Array {
  const v = genomeVector(g);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = paramToUnit(v[i]!);
  return out;
}

/** DNA′ — the brain's autoregressive write, in [0,1] unit space, at the creature's OWN
 *  decided length (`selfLen`). Sets the write diagnostics. */
export function selfReadback(g: Genome, p: Phenotype): Float32Array {
  const G = paramCount(g);
  const w = selfWrite(p, G);
  lastSelfLen = w.selfLen;
  lastPonderSteps = w.ponder;
  lastGeneCount = G;
  lastHalted = w.halted;
  return w.values.slice(0, w.selfLen);
}

/** How much credit a genome of this size earns at full reconstruction — closing MORE of
 *  yourself is worth more, so a handful of easy genes is never a free win. */
const complexityWeight = (genes: number): number => clamp01(genes / Math.max(1, HYPER.skillComplexityRef));

/** Smoothstep ramp in [0,1] over [lo,hi]. */
const smoothstep = (x: number, lo: number, hi: number): number => {
  const t = clamp01((x - lo) / Math.max(1e-6, hi - lo));
  return t * t * (3 - 2 * t);
};

/** Baseline-corrected R² of an emitted sequence vs the target over the target's G
 *  positions: positions past `len` are predicted as the target mean `μ` (the "no
 *  information" fallback for under-length, so a short emit cannot explain variance it
 *  never wrote). 1 = exact, 0 = predict-the-mean, <0 = worse than the mean. */
function r2Over(target: Float32Array, mean: number, varr: number, values: Float32Array, len: number): number {
  const G = target.length;
  if (varr < 1e-9 || G === 0) return 0;
  let mse = 0;
  for (let i = 0; i < G; i++) {
    const pred = i < len ? values[i]! : mean;
    const d = pred - target[i]!;
    mse += d * d;
  }
  const r = 1 - mse / G / varr;
  return Number.isFinite(r) ? r : 0; // defensive: a diverged write can never poison the metric → honest 0
}

export interface WriteSkill {
  /** The curriculum SELECTION fitness in [0,1] (drives evolution + the archive). */
  readonly skill: number;
  /** HONEST self-length R² — the genuine reconstruction at the creature's OWN length. */
  readonly r2self: number;
  /** Teacher-length R² — the dense bootstrap signal (first G emitted values, 1:1). */
  readonly r2teacher: number;
  /** Λ — length similarity, selfLen vs G (the length-discovery gradient). */
  readonly lenSim: number;
  /** The length the creature decided. */
  readonly selfLen: number;
  /** The genome's gene count (the target length). */
  readonly geneCount: number;
  /** a — how far the curriculum has handed the length decision to the creature (0→1). */
  readonly anneal: number;
}

/** The v7 self-writer skill — read + autoregressive write, scored on BOTH length and
 *  values, with a competence-scheduled curriculum that bootstraps the length-discovery.
 *  Returns the full honest breakdown plus the selection fitness. Sets the diagnostics. */
export function writeSkill(g: Genome, p: Phenotype): WriteSkill {
  const G = paramCount(g);
  const target = dnaTargetUnits(g);
  let mean = 0;
  for (let i = 0; i < G; i++) mean += target[i]!;
  mean /= Math.max(1, G);
  let varr = 0;
  for (let i = 0; i < G; i++) {
    const d = target[i]! - mean;
    varr += d * d;
  }
  varr /= Math.max(1, G);

  const w = selfWrite(p, G);
  lastSelfLen = w.selfLen;
  lastPonderSteps = w.ponder;
  lastGeneCount = G;
  lastHalted = w.halted;

  if (varr < 1e-9) return { skill: 0, r2self: 0, r2teacher: 0, lenSim: 0, selfLen: w.selfLen, geneCount: G, anneal: 0 };

  const teacherLen = Math.min(G, w.runLen); // teacher-forced length (dense), free-run input
  const r2teacher = r2Over(target, mean, varr, w.values, teacherLen);
  const r2self = r2Over(target, mean, varr, w.values, w.selfLen); // the brain's OWN-length write
  const lenSim = clamp01(1 - Math.abs(w.selfLen - G) / Math.max(1, G));

  // Curriculum: hand the length decision over as value-competence rises.
  const a = smoothstep(r2teacher, HYPER.curriculumLo, HYPER.curriculumHi);
  const veff = (1 - a) * clamp01(r2teacher) + a * clamp01(r2self);
  // Length-shaping factor — floored so a good-values / wrong-length creature is still
  // rewarded (no valley) yet pressured to fix its length.
  const lenFactor = HYPER.lengthShapeFloor + (1 - HYPER.lengthShapeFloor) * lenSim;
  const cap = Math.max(1, Math.round(HYPER.ponderMaxSteps));
  const ponderFactor = clamp01(1 - HYPER.ponderCost * (w.ponder / cap)); // read-dithering cost (ACT)
  const skill = complexityWeight(G) * veff * lenFactor * ponderFactor;
  // Defensive (honesty): a non-finite skill is never honest — clamp to the floor 0.
  const fin = (x: number): number => (Number.isFinite(x) ? x : 0);
  return { skill: clamp01(fin(skill)), r2self: fin(r2self), r2teacher: fin(r2teacher), lenSim, selfLen: w.selfLen, geneCount: G, anneal: a };
}

/** Self-encoding SKILL in [0,1] — the v7 curriculum selection fitness (drives evolution).
 *  A blank / fresh / random creature scores ~0; nothing is faked. */
export function selfConsistencySkill(g: Genome, p: Phenotype): number {
  return writeSkill(g, p).skill;
}

/** The HONEST self-length R² — the genuine reconstruction quality at the creature's OWN
 *  decided length. Exposed for diagnostics + the headline honest number (the displayed
 *  champion skill is the curriculum fitness above, which ≈ this once the creature has
 *  mastered values and the anneal has handed it the length decision). */
export function selfConsistencyR2(g: Genome, p: Phenotype): number {
  return writeSkill(g, p).r2self;
}

export { paramCount };
