import { ACTIVATION_COUNT } from './activations.ts';
import { W_SCALE } from './cppn.ts';
import type { Genome } from './cppn.ts';
import { cloneGenome } from './cppn.ts';
import type { Rng } from './prng.ts';

const clampW = (x: number): number => (x < -W_SCALE ? -W_SCALE : x > W_SCALE ? W_SCALE : x);

/** Mutate a genome: polynomial-ish weight/bias jitter plus occasional activation
 *  swaps. Gradient-free variation sidesteps the "zero-quine" gradient trap that
 *  Chang & Lipson had to engineer around. */
export function mutate(g: Genome, rng: Rng): Genome {
  const child = cloneGenome(g);
  const wRate = 0.18;
  const wSigma = 0.35;
  for (let i = 0; i < child.weights.length; i++) {
    if (rng.next() < wRate) child.weights[i] = clampW(child.weights[i]! + rng.normal() * wSigma);
  }
  for (let i = 0; i < child.biases.length; i++) {
    if (rng.next() < wRate) child.biases[i] = clampW(child.biases[i]! + rng.normal() * wSigma);
    if (rng.next() < 0.04) child.acts[i] = rng.int(ACTIVATION_COUNT);
  }
  return child;
}

/** Uniform crossover — a child genome drawing each gene from one of two parents. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const child = cloneGenome(a);
  for (let i = 0; i < child.weights.length; i++) {
    if (rng.next() < 0.5) child.weights[i] = b.weights[i]!;
  }
  for (let i = 0; i < child.biases.length; i++) {
    if (rng.next() < 0.5) child.biases[i] = b.biases[i]!;
    if (rng.next() < 0.5) child.acts[i] = b.acts[i]!;
  }
  return child;
}
