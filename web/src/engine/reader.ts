import { HYPER } from './hyperparams.ts';
import type { Rng } from './prng.ts';

// The per-creature READ-BACK network — the genuine other half of the strange loop.
//
// The self-portrait is sampled at F fixed Fibonacci-sphere probes: that is the
// reader's view of the rendered portrait (its global "shape"). Then, for each DNA
// parameter — placed at its own probe coordinate — this small MLP takes
//   [ that probe coordinate (x,y,z), the F portrait features ]
// and outputs the reconstructed parameter, DNA′ in [0,1]. The loop closes when
// DNA′ ≈ the original DNA.
//
// Crucially the reader's WEIGHTS live IN the genome and CO-EVOLVE with the writer
// CPPN, so each creature learns to read ITS OWN portrait. This is deliberately
// NOT a single shared "universal mirror" — that was already shown not to
// generalise (held-out R² ≈ 0). It is a real network, per creature, and the
// fidelity it reaches is whatever it honestly reaches.

/** The per-parameter probe coordinate fed to the reader (x, y, z). */
const READER_IN_COORD = 3;

/** Reader input width = probe coordinate (3) + global self-portrait features (F). */
export function readerInputDim(): number {
  return READER_IN_COORD + HYPER.readerFeatures;
}

/** Flat weight count for the fixed-topology MLP: Din → H (tanh) → 1 (sigmoid).
 *  Layout: W1[H×Din] ++ b1[H] ++ W2[H] ++ b2[1]. */
export function readerWeightCount(): number {
  const din = readerInputDim();
  const h = HYPER.readerHidden;
  return din * h + h + h + 1;
}

/** Fresh small random reader weights (drawn from the genome's own RNG, so a
 *  seeded creature is fully deterministic — reader included). */
export function seedReader(rng: Rng): number[] {
  const n = readerWeightCount();
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) w[i] = rng.normal() * 0.5;
  return w;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Forward pass: (probe coordinate, F portrait features) → reconstructed DNA
 *  parameter in [0,1]. Defensive against a short/missing weight array (missing
 *  weights read as 0 → a constant 0.5 read-back, never a crash). */
export function runReader(
  weights: readonly number[],
  feats: Float32Array | readonly number[],
  px: number,
  py: number,
  pz: number,
): number {
  const F = HYPER.readerFeatures;
  const H = HYPER.readerHidden;
  const din = READER_IN_COORD + F;
  const w2Off = din * H + H; // W2 begins after W1 (din·H) + b1 (H)
  let out = weights[w2Off + H] ?? 0; // b2
  for (let j = 0; j < H; j++) {
    const base = j * din;
    let s = weights[din * H + j] ?? 0; // b1[j]
    s += (weights[base] ?? 0) * px;
    s += (weights[base + 1] ?? 0) * py;
    s += (weights[base + 2] ?? 0) * pz;
    for (let f = 0; f < F; f++) s += (weights[base + READER_IN_COORD + f] ?? 0) * (feats[f] ?? 0);
    out += (weights[w2Off + j] ?? 0) * Math.tanh(s);
  }
  return sigmoid(out);
}
