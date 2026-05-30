import {
  INPUTS,
  LAYERS,
  TRANSITIONS,
  WEIGHT_COUNT,
  BIAS_COUNT,
  GENOME_DIM,
  MAX_WIDTH,
  WEIGHT_OFFSETS,
  NODE_OFFSETS,
} from './arch.ts';
import { activate, ACTIVATION_COUNT } from './activations.ts';
import type { Rng } from './prng.ts';
import { rngFromSeed } from './prng.ts';

// A creature's genome: dense weights, per-node biases, and per-node activation
// choices. `weights ++ biases` form the real-valued vector the creature tries
// to re-paint as its own self-portrait (see fitness.ts).
export interface Genome {
  readonly weights: Float32Array; // length WEIGHT_COUNT
  readonly biases: Float32Array; // length BIAS_COUNT
  readonly acts: Uint8Array; // length BIAS_COUNT (activation id per non-input node)
}

/** Half-range that maps genome params <-> the [0,1] ink scalar. A weight of
 *  ±W_SCALE paints pure black/white; the loop "closes" when the painted ink at
 *  a param's probe coordinate matches that param's normalised value. */
export const W_SCALE = 4;

// Flat-buffer index maths come from arch.ts (shared with the WGSL shader).
const WEIGHT_OFFSET = WEIGHT_OFFSETS;
const NODE_OFFSET = NODE_OFFSETS;

export function randomGenome(rng: Rng): Genome {
  const weights = new Float32Array(WEIGHT_COUNT);
  const biases = new Float32Array(BIAS_COUNT);
  const acts = new Uint8Array(BIAS_COUNT);
  for (let i = 0; i < WEIGHT_COUNT; i++) weights[i] = rng.normal() * 1.4;
  for (let i = 0; i < BIAS_COUNT; i++) {
    biases[i] = rng.normal() * 0.8;
    acts[i] = rng.int(ACTIVATION_COUNT);
  }
  return { weights, biases, acts };
}

/** Deterministically grow a creature from a seed string. */
export function seededGenome(seed: string): Genome {
  return randomGenome(rngFromSeed(seed));
}

export function cloneGenome(g: Genome): Genome {
  return {
    weights: g.weights.slice(),
    biases: g.biases.slice(),
    acts: g.acts.slice(),
  };
}

// Reusable scratch buffers for the forward pass (single-threaded, so safe).
const bufA = new Float32Array(MAX_WIDTH);
const bufB = new Float32Array(MAX_WIDTH);

/** Forward pass: coordinate (x,y) -> ink scalar in [0,1]. */
export function evalInk(g: Genome, x: number, y: number): number {
  let cur = bufA;
  let nxt = bufB;
  // Input layer: x, y, radius, bias.
  cur[0] = x;
  cur[1] = y;
  cur[2] = Math.sqrt(x * x + y * y);
  cur[3] = 1;

  for (let t = 0; t < TRANSITIONS; t++) {
    const inSize = LAYERS[t]!;
    const outSize = LAYERS[t + 1]!;
    const wOff = WEIGHT_OFFSET[t]!;
    const nOff = NODE_OFFSET[t]!;
    for (let j = 0; j < outSize; j++) {
      let sum = g.biases[nOff + j]!;
      for (let i = 0; i < inSize; i++) {
        sum += cur[i]! * g.weights[wOff + i * outSize + j]!;
      }
      nxt[j] = activate(g.acts[nOff + j]!, sum);
    }
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
  }
  // Map the single output node into [0,1].
  const out = cur[0]!;
  const ink = out * 0.5 + 0.5;
  return ink < 0 ? 0 : ink > 1 ? 1 : ink;
}

/** The genome as a single real vector (weights ++ biases) — the thing it tries
 *  to re-encode in its own picture. */
export function genomeVector(g: Genome): Float32Array {
  const v = new Float32Array(GENOME_DIM);
  v.set(g.weights, 0);
  v.set(g.biases, WEIGHT_COUNT);
  return v;
}

/** Normalise a raw genome param into the [0,1] ink target space. */
export function paramToInk(p: number): number {
  const t = p / (2 * W_SCALE) + 0.5;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Stable little-endian byte serialisation for content hashing. Includes a
 *  small header so the hash is bound to this exact topology. */
export function genomeBytes(g: Genome): Uint8Array {
  const header = 8;
  const bytes = new Uint8Array(
    header + g.weights.length * 4 + g.biases.length * 4 + g.acts.length,
  );
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, INPUTS, true);
  dv.setUint16(2, WEIGHT_COUNT, true);
  dv.setUint16(4, BIAS_COUNT, true);
  dv.setUint16(6, ACTIVATION_COUNT, true);
  let o = header;
  for (let i = 0; i < g.weights.length; i++, o += 4) dv.setFloat32(o, g.weights[i]!, true);
  for (let i = 0; i < g.biases.length; i++, o += 4) dv.setFloat32(o, g.biases[i]!, true);
  bytes.set(g.acts, o);
  return bytes;
}
