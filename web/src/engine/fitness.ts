import { GENOME_DIM, WEIGHT_COUNT } from './arch.ts';
import type { Genome } from './cppn.ts';
import { genomeVector, paramToUnit, unitToParam, cloneGenome, W_SCALE } from './cppn.ts';
import type { Phenotype } from './substrate.ts';
import { buildPhenotype, substrateForward } from './substrate.ts';

// THE STRANGE LOOP — a genuine fixed point, not just a score.
//
//   T(g) = decode( render( g ) ):  DNA → brain → self-portrait → read density
//          back into a DNA′.  Iterate g → T(g) → T(T(g)) → … and a self-encoding
//          creature *settles* to a fixed point g* with T(g*) ≈ g* — a quine
//          reaching its fixed point (Kleene/Banach). `loopFidelity` scores one
//          step (how close T(g) is to g); `iterateLoop` runs the map under
//          relaxation so you can watch it close. Closure is honest: it settles to
//          a residual floor (finite substrate expressivity), never faked, and the
//          vitality gate + MAP-Elites keep it off the trivial empty fixed point.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** GENOME_DIM probe points on a Fibonacci sphere (radius 0.85). */
export const PROBES3D: Float32Array = (() => {
  const p = new Float32Array(GENOME_DIM * 3);
  for (let k = 0; k < GENOME_DIM; k++) {
    const y = 1 - (k / (GENOME_DIM - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = k * GOLDEN_ANGLE;
    p[k * 3] = Math.cos(a) * r * 0.85;
    p[k * 3 + 1] = y * 0.85;
    p[k * 3 + 2] = Math.sin(a) * r * 0.85;
  }
  return p;
})();

const o2: [number, number] = [0, 0];

/** Density the phenotype paints at each probe (what the loop "reads back"). */
export function paintedAtProbes(p: Phenotype): Float32Array {
  const out = new Float32Array(GENOME_DIM);
  for (let k = 0; k < GENOME_DIM; k++) out[k] = substrateForward(p, PROBES3D[k * 3]!, PROBES3D[k * 3 + 1]!, PROBES3D[k * 3 + 2]!, o2)[0];
  return out;
}

/** The DNA's own normalised values — the targets the read-back must match. */
export function targetAtProbes(g: Genome): Float32Array {
  const v = genomeVector(g);
  const out = new Float32Array(GENOME_DIM);
  for (let k = 0; k < GENOME_DIM; k++) out[k] = paramToUnit(v[k]!);
  return out;
}

/** Loop fidelity in [0,1]: 1 ⇒ the self-portrait perfectly re-encodes the DNA. */
export function loopFidelity(g: Genome, p: Phenotype): number {
  const v = genomeVector(g);
  let se = 0;
  for (let k = 0; k < GENOME_DIM; k++) {
    const painted = substrateForward(p, PROBES3D[k * 3]!, PROBES3D[k * 3 + 1]!, PROBES3D[k * 3 + 2]!, o2)[0];
    const target = paramToUnit(v[k]!);
    const d = painted - target;
    se += d * d;
  }
  const f = 1 - Math.sqrt(se / GENOME_DIM);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// --- The fixed-point iteration (the loop literally closing) -----------------

/** Read the painted self-portrait back into a genome (DNA′): the density at each
 *  probe becomes the matching weight/bias; activations carry over as the body
 *  plan (a density field can't honestly encode the discrete activation choices).
 *  This is the *decode* half of T = decode∘render. */
export function readBackGenome(p: Phenotype, template: Genome): Genome {
  const painted = paintedAtProbes(p);
  const weights = new Float32Array(WEIGHT_COUNT);
  const biases = new Float32Array(GENOME_DIM - WEIGHT_COUNT);
  for (let k = 0; k < GENOME_DIM; k++) {
    const v = unitToParam(painted[k]!);
    if (k < WEIGHT_COUNT) weights[k] = v;
    else biases[k - WEIGHT_COUNT] = v;
  }
  return { weights, biases, acts: template.acts.slice() };
}

export interface LoopTrajectory {
  /** ‖g_{n+1} − g_n‖ per step, normalised to [0,1] → 0 at a fixed point. */
  readonly drift: number[];
  /** one-step loop fidelity of g_n (climbs toward 1 as it settles). */
  readonly fidelity: number[];
  readonly final: Genome;
  /** true if drift fell below the convergence tolerance. */
  readonly converged: boolean;
  /** the residual drift it settled to (the honest floor). */
  readonly residual: number;
}

const DRIFT_NORM = 1 / (2 * W_SCALE);

/** Iterate T under under-relaxation so the creature *settles* to a fixed point:
 *  g_{n+1} = g_n + α·(T(g_n) − g_n). Records drift→0 (closing) and the per-step
 *  fidelity (climbing). Same self-consistency condition as `loopFidelity`,
 *  approached gently so it can be watched. */
export function iterateLoop(g0: Genome, steps = 24, alpha = 0.55, tol = 0.012): LoopTrajectory {
  let g = cloneGenome(g0);
  const drift: number[] = [];
  const fidelity: number[] = [];
  let converged = false;
  for (let n = 0; n < steps; n++) {
    const p = buildPhenotype(g);
    fidelity.push(loopFidelity(g, p));
    const t = readBackGenome(p, g);
    const next = cloneGenome(g);
    let se = 0;
    for (let i = 0; i < g.weights.length; i++) {
      const nv = g.weights[i]! + alpha * (t.weights[i]! - g.weights[i]!);
      se += (nv - g.weights[i]!) ** 2;
      next.weights[i] = nv;
    }
    for (let i = 0; i < g.biases.length; i++) {
      const nv = g.biases[i]! + alpha * (t.biases[i]! - g.biases[i]!);
      se += (nv - g.biases[i]!) ** 2;
      next.biases[i] = nv;
    }
    const d = Math.sqrt(se / GENOME_DIM) * DRIFT_NORM;
    drift.push(d);
    g = next;
    if (d < tol) converged = true;
  }
  return { drift, fidelity, final: g, converged, residual: drift[drift.length - 1] ?? 1 };
}

export interface Evaluation {
  /** Behaviour descriptor in [0,1]^2: [structural complexity, mirror symmetry]. */
  readonly bd: readonly [number, number];
  /** Self-encoding loop fidelity in [0,1] (measured). */
  readonly fidelity: number;
  /** Vitality in [0,1] — volumetric contrast; ~0 for trivial empty creatures. */
  readonly vitality: number;
  /** Count of expressed phenotype connections (a "size" readout). */
  readonly liveConns: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

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
