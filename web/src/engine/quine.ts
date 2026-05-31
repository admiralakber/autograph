import type { Genome } from './cppn.ts';
import { compileCPPN, evalCompiled, sortedConns, biasNodes, paramToUnit, paramCount, genomeVector } from './cppn.ts';

// THE SELF-QUINE — the loop's decode half, INTRINSIC to the creature's own DNA.
//
// A neural-network quine (Chang & Lipson, 2018) is a network whose output
// encodes its own weights. Here the DNA *is* a CPPN, and we close the loop by
// asking that same CPPN to report its own genes:
//
//   • paint half  — queried over SPACE (pairs of substrate coordinates) the CPPN
//                    paints the brain, whose field is the self-portrait.
//   • read  half  — queried at each gene's canonical GENOME COORDINATE the CPPN
//                    outputs that gene's value, DNA′ₖ.
//
// Both halves are the SAME function. There is no separate, free, RMSE-trained
// regression head (that was the hack that collapsed to "predict the mean" / flat
// grey). To score, a creature must genuinely BE (approximately) self-consistent:
// the function it encodes must reproduce its own recipe. The only perfect fixed
// point is the trivial/empty creature (constant function → ~0 skill AND ~0
// vitality), which the vitality gate refuses — so honesty holds by construction.
//
// Gene → coordinate mapping (canonical, stable, value-independent):
//   connection (from→to, weight) ↦ CPPN(coord(from), coord(to)).weight
//   node bias  (node n,   bias)  ↦ CPPN(coord(n),    coord(n)).bias
// i.e. the CPPN's two output channels ARE the two gene kinds. coord(id) is a
// fixed pseudo-random home in [-0.92,0.92]³ per node id — an intrinsic address
// derived from the gene's identity, never from its value, so nothing can cheat.

const COORD_RADIUS = 0.92;
const coordCache = new Map<number, [number, number, number]>();

/** Deterministic 32-bit avalanche hash → [0,1). */
function hashUnit(seed: number): number {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** The canonical genome coordinate of a CPPN node — a stable home in 3-space,
 *  derived only from the node's id (its identity), never from any gene value. */
export function nodeCoord(id: number): [number, number, number] {
  const hit = coordCache.get(id);
  if (hit) return hit;
  const c: [number, number, number] = [
    (hashUnit(id * 3 + 1) * 2 - 1) * COORD_RADIUS,
    (hashUnit(id * 3 + 2) * 2 - 1) * COORD_RADIUS,
    (hashUnit(id * 3 + 3) * 2 - 1) * COORD_RADIUS,
  ];
  coordCache.set(id, c);
  return c;
}

const o2: [number, number] = [0, 0];

/** Read the creature's DNA back out of its OWN CPPN, gene by gene, in [0,1] unit
 *  space — the genome-vector order of `genomeVector`/`applyParams` (conns by
 *  innovation, then non-input node biases by id). DNA′ₖ. No external state. */
export function quineReadback(g: Genome): Float32Array {
  const cc = compileCPPN(g);
  const conns = sortedConns(g);
  const biases = biasNodes(g);
  const out = new Float32Array(conns.length + biases.length);
  let k = 0;
  for (const c of conns) {
    const a = nodeCoord(c.from);
    const b = nodeCoord(c.to);
    out[k++] = paramToUnit(evalCompiled(cc, a[0], a[1], a[2], b[0], b[1], b[2], o2)[0]); // weight channel
  }
  for (const n of biases) {
    const p = nodeCoord(n.id);
    out[k++] = paramToUnit(evalCompiled(cc, p[0], p[1], p[2], p[0], p[1], p[2], o2)[1]); // bias channel
  }
  return out;
}

/** The DNA's own values in unit space — the targets the readback must match. */
export function dnaTargetUnits(g: Genome): Float32Array {
  const v = genomeVector(g);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = paramToUnit(v[i]!);
  return out;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Baseline-corrected self-consistency SKILL in [0,1] (display-clamped):
 *  skill = 1 − MSE(DNA′, DNA) / Var(DNA).  Honest by construction:
 *    • a constant readout (the old "predict the mean" cheat) → skill = 0;
 *    • a flat/trivial creature (Var ≈ 0, nothing to reconstruct) → skill = 0;
 *    • only genuine structure-reconstruction scores above 0.
 *  Raw (unclamped) R² is available via `selfConsistencyR2` for the smoke test. */
export function selfConsistencySkill(g: Genome): number {
  return clamp01(selfConsistencyR2(g));
}

/** Unclamped coefficient of determination — can go negative when the readout is
 *  worse than predicting the creature's own mean gene value. */
export function selfConsistencyR2(g: Genome): number {
  const target = dnaTargetUnits(g);
  const n = target.length;
  if (n === 0) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += target[i]!;
  mean /= n;
  let varr = 0;
  for (let i = 0; i < n; i++) varr += (target[i]! - mean) ** 2;
  varr /= n;
  if (varr < 1e-9) return 0; // no spread to reconstruct → no skill to claim
  const recon = quineReadback(g);
  let mse = 0;
  for (let i = 0; i < n; i++) mse += (recon[i]! - target[i]!) ** 2;
  mse /= n;
  return 1 - mse / varr;
}

/** Convenience used by the loop visualisation: how many genes (= paramCount). */
export function geneCount(g: Genome): number {
  return paramCount(g);
}
