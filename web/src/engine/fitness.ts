import { GENOME_DIM } from './arch.ts';
import type { Genome } from './cppn.ts';
import { evalInk, genomeVector, paramToInk } from './cppn.ts';

// --- The self-encoding loop (the "quine") -----------------------------------
//
// Each genome parameter k is assigned a fixed probe coordinate in the image
// plane (a golden-angle phyllotaxis spiral, for even, pretty coverage). The
// creature "encodes itself" when the ink it paints *at* probe k equals param
// k's normalised value. This is the continuous, evolvable, single-device cousin
// of Chang & Lipson's neural-network quine (the HyperNEAT coordinate->weight
// trick): the picture, read at known spots, re-states the network that painted
// it. It closes only to a tolerance — never bit-exactly — which is the honest
// story (cross-device float non-determinism makes exactness impossible anyway).

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Probe coordinates, interleaved [x0,y0,x1,y1,...], one per genome param. */
export const PROBES: Float32Array = (() => {
  const p = new Float32Array(GENOME_DIM * 2);
  for (let k = 0; k < GENOME_DIM; k++) {
    const r = Math.sqrt((k + 0.5) / GENOME_DIM) * 0.92;
    const a = k * GOLDEN_ANGLE;
    p[k * 2] = r * Math.cos(a);
    p[k * 2 + 1] = r * Math.sin(a);
  }
  return p;
})();

/** The painted ink at every probe coordinate, for visualising the loop. */
export function paintedAtProbes(g: Genome): Float32Array {
  const out = new Float32Array(GENOME_DIM);
  for (let k = 0; k < GENOME_DIM; k++) {
    out[k] = evalInk(g, PROBES[k * 2]!, PROBES[k * 2 + 1]!);
  }
  return out;
}

/** The target ink at every probe coordinate (the genome's own normalised values). */
export function targetAtProbes(g: Genome): Float32Array {
  const v = genomeVector(g);
  const out = new Float32Array(GENOME_DIM);
  for (let k = 0; k < GENOME_DIM; k++) out[k] = paramToInk(v[k]!);
  return out;
}

/** Loop fidelity in [0,1]: 1 means the picture perfectly re-encodes the genome. */
export function loopFidelity(g: Genome): number {
  const v = genomeVector(g);
  let se = 0;
  for (let k = 0; k < GENOME_DIM; k++) {
    const painted = evalInk(g, PROBES[k * 2]!, PROBES[k * 2 + 1]!);
    const target = paramToInk(v[k]!);
    const d = painted - target;
    se += d * d;
  }
  const rmse = Math.sqrt(se / GENOME_DIM);
  const f = 1 - rmse;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// --- Behaviour descriptors (the MAP-Elites axes) ----------------------------

export interface Evaluation {
  /** Behaviour descriptor in [0,1]^2: [structural complexity, mirror symmetry]. */
  readonly bd: readonly [number, number];
  /** Self-encoding loop fidelity in [0,1]. */
  readonly fidelity: number;
  /** Vitality in [0,1] — image contrast; ~0 for trivial flat creatures. */
  readonly vitality: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Sample the ink field on a size×size grid (coordinates in [-1,1]). */
export function sampleField(g: Genome, size: number): Float32Array {
  const out = new Float32Array(size * size);
  const inv = 2 / (size - 1);
  for (let yi = 0; yi < size; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < size; xi++) {
      out[yi * size + xi] = evalInk(g, xi * inv - 1, y);
    }
  }
  return out;
}

/** Evaluate a genome's behaviour, fidelity and vitality from one low-res render. */
export function evaluate(g: Genome, size = 24): Evaluation {
  const f = sampleField(g, size);

  // Mean + variance -> vitality (contrast).
  let mean = 0;
  for (let i = 0; i < f.length; i++) mean += f[i]!;
  mean /= f.length;
  let varSum = 0;
  for (let i = 0; i < f.length; i++) {
    const d = f[i]! - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / f.length);
  const vitality = clamp01(std * 3.0);

  // Structural complexity: mean absolute gradient between neighbours.
  let grad = 0;
  let gn = 0;
  for (let yi = 0; yi < size; yi++) {
    for (let xi = 0; xi < size; xi++) {
      const v = f[yi * size + xi]!;
      if (xi + 1 < size) {
        grad += Math.abs(v - f[yi * size + xi + 1]!);
        gn++;
      }
      if (yi + 1 < size) {
        grad += Math.abs(v - f[(yi + 1) * size + xi]!);
        gn++;
      }
    }
  }
  const complexity = clamp01((grad / gn) * 4.5);

  // Mirror symmetry across the vertical axis.
  let mdiff = 0;
  let mn = 0;
  for (let yi = 0; yi < size; yi++) {
    for (let xi = 0; xi < size >> 1; xi++) {
      const a = f[yi * size + xi]!;
      const b = f[yi * size + (size - 1 - xi)]!;
      mdiff += Math.abs(a - b);
      mn++;
    }
  }
  const symmetry = clamp01(1 - (mdiff / mn) * 2.2);

  return {
    bd: [complexity, symmetry],
    fidelity: loopFidelity(g),
    vitality,
  };
}
