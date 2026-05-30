import { GENOME_DIM } from './arch.ts';
import type { Genome } from './cppn.ts';
import { genomeVector, paramToUnit } from './cppn.ts';
import type { Phenotype } from './substrate.ts';
import { buildPhenotype, substrateForward } from './substrate.ts';

// THE STRANGE LOOP (measured live, never faked).
//
//   DNA (CPPN) → phenotype (substrate) → volumetric self-portrait
//             → read the density at known 3D probe points → DNA'
//
// The loop "closes" to the extent the drawn density at probe k re-states DNA
// param k. This is a genuine fixed-point search over genomes; closure is partial
// (the substrate field has finite expressivity, and exactness is impossible
// across devices anyway), so we report the achieved fidelity honestly.

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
