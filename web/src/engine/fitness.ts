import type { Genome } from './cppn.ts';
import { genomeVector, paramToUnit, unitToParam, applyParams, paramCount, cloneGenome, W_SCALE } from './cppn.ts';
import { HYPER } from './hyperparams.ts';
import type { Phenotype } from './substrate.ts';
import { buildPhenotype, substrateForward } from './substrate.ts';

// THE STRANGE LOOP — a genuine fixed point, not just a score.
//
//   T(g) = decode( render( g ) ):  DNA → brain → self-portrait → read density
//          back into a DNA′.  Iterate g → T(g) → T(T(g)) → … and a self-encoding
//          creature *settles* to a fixed point with T(g*) ≈ g* — a quine
//          reaching its fixed point. As NEAT complexifies the DNA, the loop has
//          MORE parameters to re-encode: there is one probe per DNA parameter
//          (connection weight or bias), placed on a Fibonacci sphere, so a
//          richer creature faces a harder loop. Closure is honest: evolved
//          self-encoders converge; random/over-complex ones only partially close.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const probeCache = new Map<number, Float32Array>();

/** `n` probe points on a Fibonacci sphere (radius 0.85), cached per dimension. */
function probesFor(n: number): Float32Array {
  const cached = probeCache.get(n);
  if (cached) return cached;
  const p = new Float32Array(Math.max(1, n) * 3);
  for (let k = 0; k < n; k++) {
    const y = n === 1 ? 0 : 1 - (k / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = k * GOLDEN_ANGLE;
    p[k * 3] = Math.cos(a) * r * 0.85;
    p[k * 3 + 1] = y * 0.85;
    p[k * 3 + 2] = Math.sin(a) * r * 0.85;
  }
  probeCache.set(n, p);
  return p;
}

const o2: [number, number] = [0, 0];

/** Density the phenotype paints at each of `n` probes (what the loop reads back). */
export function paintedAtProbes(p: Phenotype, n: number): Float32Array {
  const probes = probesFor(n);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = substrateForward(p, probes[k * 3]!, probes[k * 3 + 1]!, probes[k * 3 + 2]!, o2)[0];
  return out;
}

/** The DNA's own normalised values — the targets the read-back must match. */
export function targetAtProbes(g: Genome): Float32Array {
  const v = genomeVector(g);
  const out = new Float32Array(v.length);
  for (let k = 0; k < v.length; k++) out[k] = paramToUnit(v[k]!);
  return out;
}

/** Loop fidelity in [0,1]: 1 ⇒ the self-portrait perfectly re-encodes the DNA. */
export function loopFidelity(g: Genome, p: Phenotype): number {
  const v = genomeVector(g);
  const n = v.length;
  const probes = probesFor(n);
  let se = 0;
  for (let k = 0; k < n; k++) {
    const painted = substrateForward(p, probes[k * 3]!, probes[k * 3 + 1]!, probes[k * 3 + 2]!, o2)[0];
    const d = painted - paramToUnit(v[k]!);
    se += d * d;
  }
  const f = 1 - Math.sqrt(se / n);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// --- The fixed-point iteration (the loop literally closing) -----------------

/** Read the painted self-portrait back into a genome (DNA′): the density at each
 *  probe becomes the matching weight/bias; topology + activations carry over as
 *  the body plan. The *decode* half of T = decode∘render. */
export function readBackGenome(p: Phenotype, template: Genome): Genome {
  const n = paramCount(template);
  const painted = paintedAtProbes(p, n);
  const vec = new Float32Array(n);
  for (let k = 0; k < n; k++) vec[k] = unitToParam(painted[k]!);
  return applyParams(template, vec);
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
 *  g_{n+1} = g_n + α·(T(g_n) − g_n). Records drift→0 (closing) and per-step
 *  fidelity (climbing). Topology is fixed during the iteration, so the parameter
 *  vector keeps a stable length. */
export function iterateLoop(g0: Genome, steps = 24, alpha = HYPER.loopRelaxAlpha, tol = HYPER.loopTol): LoopTrajectory {
  let g = cloneGenome(g0);
  const drift: number[] = [];
  const fidelity: number[] = [];
  let converged = false;
  for (let s = 0; s < steps; s++) {
    const p = buildPhenotype(g);
    fidelity.push(loopFidelity(g, p));
    const cur = genomeVector(g);
    const n = cur.length;
    const painted = paintedAtProbes(p, n);
    const next = new Float32Array(n);
    let se = 0;
    for (let i = 0; i < n; i++) {
      const target = unitToParam(painted[i]!);
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
