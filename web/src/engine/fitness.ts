import type { Genome } from './cppn.ts';
import { genomeVector, unitToParam, applyParams, cloneGenome, W_SCALE } from './cppn.ts';
import { HYPER } from './hyperparams.ts';
import type { Phenotype } from './substrate.ts';
import { buildPhenotype, substrateForward } from './substrate.ts';
import { quineReadback, dnaTargetUnits, selfConsistencySkill } from './quine.ts';

// THE STRANGE LOOP — a genuine self-reading QUINE, not a bolt-on regressor.
//
//   write:  DNA (CPPN) → brain (ES-HyperNEAT substrate) → self-portrait field.
//   read :  the SAME CPPN, read at each gene's canonical genome coordinate,
//           outputs that gene's value → DNA′ (quine.ts). No separate network.
//   close:  fidelity = how well DNA′ matches DNA — measured as baseline-corrected
//           SKILL (R²-style), so "predict the mean" scores 0, never ~97%.
//
//   Both halves are the same function: queried over space it paints the brain;
//   queried at genome coordinates it reports its own recipe. The only perfect
//   fixed point is the trivial/empty creature (constant function → ~0 skill AND
//   ~0 vitality), which the vitality gate refuses — so honesty holds by
//   construction. There is nothing external to over-fit or cheat with.

const o2: [number, number] = [0, 0];

/** The DNA's own values in unit space — the targets the read-back must match.
 *  (Re-exported from quine.ts under the loop's familiar name for the UI.) */
export function targetAtProbes(g: Genome): Float32Array {
  return dnaTargetUnits(g);
}

/** The intrinsic read-back: the creature's OWN CPPN, sampled at its genome
 *  coordinates, reporting DNA′ in [0,1]. The phenotype argument is accepted for
 *  call-site compatibility but unused — the readout is purely the DNA reading
 *  itself, not a function of the rendered portrait. */
export function readBackUnits(g: Genome, _p?: Phenotype): Float32Array {
  return quineReadback(g);
}

/** Self-encoding SKILL in [0,1] — baseline-corrected (1 − MSE/Var, clamped).
 *  This IS the ranked + signed fidelity: a constant/trivial creature scores ~0. */
export function loopFidelity(g: Genome, _p?: Phenotype): number {
  return selfConsistencySkill(g);
}

// --- The fixed-point iteration (the loop literally closing) -----------------

/** Decode via the quine: each reconstructed gene becomes the matching
 *  weight/bias; topology + activations carry over as the body plan. */
export function readBackGenome(g: Genome): Genome {
  const dna = quineReadback(g);
  const vec = new Float32Array(dna.length);
  for (let k = 0; k < dna.length; k++) vec[k] = unitToParam(dna[k]!);
  return applyParams(g, vec);
}

export interface LoopTrajectory {
  readonly drift: number[];
  readonly fidelity: number[];
  readonly final: Genome;
  readonly converged: boolean;
  readonly residual: number;
}

const DRIFT_NORM = 1 / (2 * W_SCALE);

/** Iterate T under under-relaxation so the creature settles to a fixed point:
 *  g_{n+1} = g_n + α·(T(g_n) − g_n), where T replaces each gene with the CPPN's
 *  self-readout of it. Records drift→0 (closing) and per-step skill. Topology is
 *  fixed during the iteration, so the gene vector keeps a stable length. */
export function iterateLoop(g0: Genome, steps = 24, alpha = HYPER.loopRelaxAlpha, tol = HYPER.loopTol): LoopTrajectory {
  let g = cloneGenome(g0);
  const drift: number[] = [];
  const fidelity: number[] = [];
  let converged = false;
  for (let s = 0; s < steps; s++) {
    fidelity.push(selfConsistencySkill(g));
    const cur = genomeVector(g);
    const n = cur.length;
    const dna = quineReadback(g);
    const next = new Float32Array(n);
    let se = 0;
    for (let i = 0; i < n; i++) {
      const target = unitToParam(dna[i]!);
      const nv = cur[i]! + alpha * (target - cur[i]!);
      se += (nv - cur[i]!) ** 2;
      next[i] = nv;
    }
    const d = Math.sqrt(se / n) * DRIFT_NORM;
    drift.push(d);
    g = applyParams(g, next);
    if (d < tol) converged = true;
  }
  return { drift, fidelity, final: g, converged, residual: drift[drift.length - 1] ?? 1 };
}

export interface Evaluation {
  /** Behaviour descriptor in [0,1]^2: [structural complexity, mirror symmetry]. */
  readonly bd: readonly [number, number];
  /** Self-encoding loop SKILL in [0,1] (baseline-corrected; measured, never faked). */
  readonly fidelity: number;
  /** Vitality in [0,1] — volumetric contrast; ~0 for trivial empty creatures. */
  readonly vitality: number;
  /** Count of expressed phenotype connections (a "size" readout). */
  readonly liveConns: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Liveness reference for the elite-quality metric. At/above this vitality a
 *  creature ranks purely by its self-encoding fidelity; below it the score is
 *  discounted toward 0 — so a near-flat *zero-quine* (high fidelity, ~0 vitality)
 *  can never out-rank a lively self-encoder. Mirrored in the coordinator's
 *  `ServerArchive` so the local mirror and the shared grid keep-best identically. */
export const VITALITY_REF = 0.5;

/** Vitality-gated quality used to rank elites within a MAP-Elites cell — the one
 *  key both the local archive and the shared coordinator merge on. **Not** raw
 *  fidelity: it folds in vitality, so a cell's champion can only be displaced by a
 *  genuinely better-*and*-alive creature, and the shared archive only ever improves. */
export function eliteQuality(fidelity: number, vitality: number): number {
  return fidelity * clamp01(vitality / VITALITY_REF);
}

/** A G×G silhouette of the volume (mean density along z), for the QD descriptors. */
function projection(p: Phenotype, g: number): Float32Array {
  const field = new Float32Array(g * g);
  const zs = [-0.55, -0.18, 0.18, 0.55];
  const inv = 2 / (g - 1);
  for (let yi = 0; yi < g; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < g; xi++) {
      const x = xi * inv - 1;
      let acc = 0;
      for (const z of zs) acc += substrateForward(p, x, y, z, o2)[0];
      field[yi * g + xi] = acc / zs.length;
    }
  }
  return field;
}

/** A higher-dimensional behaviour *signature* (n×n mean-density silhouette,
 *  default 5×5 = 25-D) for Novelty Search. Deliberately richer than the 2-D
 *  MAP-Elites descriptor so the behaviour space does not saturate — there is
 *  always a new silhouette to find, which is what keeps the search open-ended.
 *  NOT part of the wire `Evaluation`. */
export function behaviourSignature(p: Phenotype, n = 5): Float32Array {
  const sig = new Float32Array(n * n);
  const zs = [-0.5, 0, 0.5];
  const inv = 2 / (n - 1);
  for (let yi = 0; yi < n; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < n; xi++) {
      const x = xi * inv - 1;
      let acc = 0;
      for (const z of zs) acc += substrateForward(p, x, y, z, o2)[0];
      sig[yi * n + xi] = acc / zs.length;
    }
  }
  return sig;
}

/** Evaluate a genome's loop fidelity + behaviour from its phenotype. */
export function evaluate(g: Genome, pheno?: Phenotype): Evaluation {
  const p = pheno ?? buildPhenotype(g);
  const G = 12;
  const f = projection(p, G);

  let mean = 0;
  for (let i = 0; i < f.length; i++) mean += f[i]!;
  mean /= f.length;
  let varSum = 0;
  for (let i = 0; i < f.length; i++) {
    const d = f[i]! - mean;
    varSum += d * d;
  }
  const vitality = clamp01(Math.sqrt(varSum / f.length) * 3.4);

  let grad = 0;
  let gn = 0;
  for (let yi = 0; yi < G; yi++) {
    for (let xi = 0; xi < G; xi++) {
      const v = f[yi * G + xi]!;
      if (xi + 1 < G) {
        grad += Math.abs(v - f[yi * G + xi + 1]!);
        gn++;
      }
      if (yi + 1 < G) {
        grad += Math.abs(v - f[(yi + 1) * G + xi]!);
        gn++;
      }
    }
  }
  const complexity = clamp01((grad / gn) * 6.0);

  let mdiff = 0;
  let mn = 0;
  for (let yi = 0; yi < G; yi++) {
    for (let xi = 0; xi < G >> 1; xi++) {
      mdiff += Math.abs(f[yi * G + xi]! - f[yi * G + (G - 1 - xi)]!);
      mn++;
    }
  }
  const symmetry = clamp01(1 - (mdiff / mn) * 2.4);

  return { bd: [complexity, symmetry], fidelity: loopFidelity(g, p), vitality, liveConns: p.liveConns };
}
