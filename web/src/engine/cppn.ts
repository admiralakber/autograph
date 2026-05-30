import {
  CPPN_INPUTS,
  CPPN_LAYERS,
  CPPN_TRANSITIONS,
  CPPN_MAX_WIDTH,
  WEIGHT_COUNT,
  BIAS_COUNT,
  GENOME_DIM,
  WEIGHT_OFFSETS,
  NODE_OFFSETS,
} from './arch.ts';
import { activate, ACTIVATION_COUNT } from './activations.ts';
import type { Rng } from './prng.ts';
import { rngFromSeed } from './prng.ts';

// The DNA: a connective CPPN. weights ++ biases form the real vector the
// self-portrait tries to re-encode; per-node activation choices are the
// discrete part of the genome.
export interface Genome {
  readonly weights: Float32Array; // length WEIGHT_COUNT
  readonly biases: Float32Array; // length BIAS_COUNT
  readonly acts: Uint8Array; // length BIAS_COUNT (activation id per non-input node)
}

/** Half-range mapping DNA params <-> the [0,1] unit interval used by the loop. */
export const W_SCALE = 4;

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

/** Deterministically grow a creature's DNA from a seed string (Genesis included). */
export function seededGenome(seed: string): Genome {
  return randomGenome(rngFromSeed(seed));
}

export function cloneGenome(g: Genome): Genome {
  return { weights: g.weights.slice(), biases: g.biases.slice(), acts: g.acts.slice() };
}

const bufA = new Float32Array(CPPN_MAX_WIDTH);
const bufB = new Float32Array(CPPN_MAX_WIDTH);

/** Forward pass of the connective CPPN: a pair of 3D node positions ->
 *  [weight, leo]. `leo` (link-expression) gates whether the connection exists. */
export function evalCPPN(
  g: Genome,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  out: [number, number] = [0, 0],
): [number, number] {
  let cur = bufA;
  let nxt = bufB;
  cur[0] = x1;
  cur[1] = y1;
  cur[2] = z1;
  cur[3] = x2;
  cur[4] = y2;
  cur[5] = z2;
  cur[6] = 1; // bias
  for (let t = 0; t < CPPN_TRANSITIONS; t++) {
    const inSize = CPPN_LAYERS[t]!;
    const outSize = CPPN_LAYERS[t + 1]!;
    const wOff = WEIGHT_OFFSETS[t]!;
    const nOff = NODE_OFFSETS[t]!;
    for (let j = 0; j < outSize; j++) {
      let sum = g.biases[nOff + j]!;
      for (let i = 0; i < inSize; i++) sum += cur[i]! * g.weights[wOff + i * outSize + j]!;
      nxt[j] = activate(g.acts[nOff + j]!, sum);
    }
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
  }
  out[0] = cur[0]!; // weight
  out[1] = cur[1]!; // leo
  return out;
}

/** DNA as a single real vector (weights ++ biases). */
export function genomeVector(g: Genome): Float32Array {
  const v = new Float32Array(GENOME_DIM);
  v.set(g.weights, 0);
  v.set(g.biases, WEIGHT_COUNT);
  return v;
}

/** Normalise a raw DNA param into the [0,1] interval used by the self-encoding loop. */
export function paramToUnit(p: number): number {
  const t = p / (2 * W_SCALE) + 0.5;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Stable little-endian serialisation for content hashing (binds the topology). */
export function genomeBytes(g: Genome): Uint8Array {
  const header = 8;
  const bytes = new Uint8Array(header + g.weights.length * 4 + g.biases.length * 4 + g.acts.length);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, CPPN_INPUTS, true);
  dv.setUint16(2, WEIGHT_COUNT, true);
  dv.setUint16(4, BIAS_COUNT, true);
  dv.setUint16(6, ACTIVATION_COUNT, true);
  let o = header;
  for (let i = 0; i < g.weights.length; i++, o += 4) dv.setFloat32(o, g.weights[i]!, true);
  for (let i = 0; i < g.biases.length; i++, o += 4) dv.setFloat32(o, g.biases[i]!, true);
  bytes.set(g.acts, o);
  return bytes;
}

// --- Graph accessors for the DNA visualisation ------------------------------

export interface CppnEdge {
  readonly fromLayer: number;
  readonly fromIdx: number;
  readonly toLayer: number;
  readonly toIdx: number;
  readonly weight: number;
}

/** All CPPN connections with their weights, for drawing the DNA graph. */
export function cppnEdges(g: Genome): CppnEdge[] {
  const edges: CppnEdge[] = [];
  for (let t = 0; t < CPPN_TRANSITIONS; t++) {
    const inSize = CPPN_LAYERS[t]!;
    const outSize = CPPN_LAYERS[t + 1]!;
    const wOff = WEIGHT_OFFSETS[t]!;
    for (let i = 0; i < inSize; i++) {
      for (let j = 0; j < outSize; j++) {
        edges.push({
          fromLayer: t,
          fromIdx: i,
          toLayer: t + 1,
          toIdx: j,
          weight: g.weights[wOff + i * outSize + j]!,
        });
      }
    }
  }
  return edges;
}

/** Activation id for a non-input node (layer>=1), for greyscale node fills. */
export function nodeActivation(g: Genome, layer: number, idx: number): number {
  if (layer < 1) return 5; // input nodes: identity
  return g.acts[NODE_OFFSETS[layer - 1]! + idx]!;
}
