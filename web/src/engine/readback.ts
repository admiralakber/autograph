import type { Genome } from './cppn.ts';
import { compileCPPN, evalCompiled, sortedConns, biasNodes, paramToUnit, genomeVector, paramCount } from './cppn.ts';
import { SUB_INPUTS } from './arch.ts';
import { activate } from './activations.ts';
import { HYPER } from './hyperparams.ts';
import type { Phenotype } from './substrate.ts';
import { substrateForward } from './substrate.ts';

// THE READ-BACK — the loop's decode half, flowing THROUGH THE PICTURE.
//
// The earlier "self-quine" bypassed the phenotype: it had the CPPN echo its own
// genes at abstract coordinates, so the rendered image was never in the read
// path. That is not a loop through the image. The owner was right.
//
// The loop (Escher's Drawing Hands, literally):
//   DNA (CPPN) PAINTS AN IMAGE across space, and the BRAIN (ES-HyperNEAT
//     substrate) EMERGES WITHIN it — neurons placed where the pattern has structure
//             → the brain, queried over space, renders the IMAGE (density field)
//             → the brain reads back THE IMAGE IT'S BORN IN, via its own neurons
//             → it outputs DNA′, trying to find its own beginning
//             → skill = how well DNA′ matches DNA (R², baseline-corrected,
//               complexity-weighted, read through a bounded per-gene view)
//
// The read pass is a *read-mode substrate* painted by the SAME CPPN and routed
// through the SAME hidden neurons the brain already evolved (same positions,
// activations, biases). Only the harness differs: the inputs are PICTURE SAMPLES
// (placed at the probe coordinates they were sampled from) and the outputs are
// DNA GENES (placed at canonical genome coordinates). The connection weights are
// the CPPN's own — queried at those coordinate pairs, exactly as HyperNEAT paints
// the forward brain. So the reader is the creature's OWN network reading its OWN
// picture; there is NO separate regressor and NO genome-wire change (the read
// weights are derived from the existing CPPN — genesis-v3 persists).
//
// Honesty holds by construction: a blank image (≈constant density) drives the
// hidden layer to a near-constant, so DNA′ ≈ a constant ≈ the mean → R² ≈ 0; and
// such a creature is volumetrically empty → vitality-gated. Only a creature whose
// image genuinely carries its DNA, read back by its own brain, scores above 0 —
// and that is a strictly harder, more honest loop than echoing genes directly.

/** Read-back bandwidth floor/ceiling: the brain may sample between MIN_PROBES and
 *  MAX_PROBES points of its own image, at HYPER.readbackBandwidth points per gene.
 *  Bounding the resolution PER GENE (not as a flat count) keeps reconstruction
 *  honestly hard at every scale — a richer genome gets proportionally more probes
 *  but has proportionally more to reconstruct, so it is no easier to close — which
 *  lets the complexity weight (below) genuinely reward richer self-knowers instead
 *  of a flat bottleneck collapsing them to R²≈0. Closure must be earned. */
const MIN_PROBES = 6;
const MAX_PROBES = 18;
const probeCount = (genes: number): number => {
  const n = Math.round(genes * HYPER.readbackBandwidth);
  return n < MIN_PROBES ? MIN_PROBES : n > MAX_PROBES ? MAX_PROBES : n;
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const probeCache = new Map<number, Float32Array>();
/** `n` probe points on a Fibonacci sphere (radius 0.85) — where the picture is read. */
function probesFor(n: number): Float32Array {
  const hit = probeCache.get(n);
  if (hit) return hit;
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

const COORD_RADIUS = 0.92;
const coordCache = new Map<number, [number, number, number]>();
function hashUnit(seed: number): number {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}
/** A stable home in 3-space for a CPPN node id — the address a gene's output sits
 *  at in the read-mode substrate (derived only from identity, never gene value). */
function nodeCoord(id: number): [number, number, number] {
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

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const o2: [number, number] = [0, 0];

/** Read the creature's DNA back OUT OF ITS PICTURE, through its own brain.
 *  Returns DNA′ in [0,1] unit space, in genome-vector order (conns by innovation,
 *  then non-input node biases by id) so it aligns with `genomeVector`. */
export function selfReadback(g: Genome, p: Phenotype): Float32Array {
  const cc = compileCPPN(g);
  const F = probeCount(paramCount(g));
  const probes = probesFor(F);
  const H = p.hiddenCount;

  // 1. The picture: the brain's density field at the F probe points — the STATIC
  //    initial-state field (the image the creature is born in, what it reconstructs
  //    FROM). v6 NOTE: sampling this picture via the PLASTIC rollout was tried and
  //    crashed skill (the runtime weight-change scrambles the picture↔genome
  //    relationship) — so plasticity stays out of the picture. It self-modifies the
  //    brain during the DECODE (the lifetime read), which Phase 5 (read-ponder-emit)
  //    makes temporal; that is where plasticity becomes load-bearing for skill.
  const pic = new Float32Array(F);
  for (let i = 0; i < F; i++) pic[i] = substrateForward(p, probes[i * 3]!, probes[i * 3 + 1]!, probes[i * 3 + 2]!, o2)[0];

  // 2. Feed the picture INTO the brain's own hidden neurons (CPPN-painted weights
  //    from each probe coordinate to each hidden-neuron coordinate).
  const hid = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const hj = SUB_INPUTS + j;
    const hx = p.pos[hj * 3]!;
    const hy = p.pos[hj * 3 + 1]!;
    const hz = p.pos[hj * 3 + 2]!;
    let s = p.bias[hj]!;
    for (let i = 0; i < F; i++) {
      s += pic[i]! * evalCompiled(cc, probes[i * 3]!, probes[i * 3 + 1]!, probes[i * 3 + 2]!, hx, hy, hz, o2)[0];
    }
    hid[j] = activate(p.act[hj]!, s);
  }

  // 3. Read each gene OUT of the hidden layer at its canonical genome coordinate
  //    (CPPN-painted weights hidden→gene; gene-output bias from the CPPN's bias
  //    channel at that coordinate). conn gene ↦ midpoint of its endpoints' homes.
  const conns = sortedConns(g);
  const biases = biasNodes(g);
  const out = new Float32Array(conns.length + biases.length);
  let k = 0;
  for (const c of conns) {
    const a = nodeCoord(c.from);
    const b = nodeCoord(c.to);
    out[k++] = readGene(cc, hid, p, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  }
  for (const n of biases) {
    const a = nodeCoord(n.id);
    out[k++] = readGene(cc, hid, p, a[0], a[1], a[2]);
  }
  return out;
}

/** One gene's read-out: hidden layer → gene-output (CPPN-painted), squashed to [0,1]. */
function readGene(cc: ReturnType<typeof compileCPPN>, hid: Float32Array, p: Phenotype, gx: number, gy: number, gz: number): number {
  let s = evalCompiled(cc, gx, gy, gz, gx, gy, gz, o2)[1]; // gene-output bias (CPPN bias channel)
  const H = p.hiddenCount;
  for (let j = 0; j < H; j++) {
    const hj = SUB_INPUTS + j;
    s += hid[j]! * evalCompiled(cc, p.pos[hj * 3]!, p.pos[hj * 3 + 1]!, p.pos[hj * 3 + 2]!, gx, gy, gz, o2)[0];
  }
  return sigmoid(s);
}

/** The DNA's own values in unit space — the targets the read-back must match. */
export function dnaTargetUnits(g: Genome): Float32Array {
  const v = genomeVector(g);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = paramToUnit(v[i]!);
  return out;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** How much credit a genome of this size earns at full reconstruction — closing
 *  MORE of yourself is worth more, so a handful of easy genes is never a free
 *  win. clamp01(genes / ref): a creature at/above the reference earns full R². */
const complexityWeight = (genes: number): number => clamp01(genes / Math.max(1, HYPER.skillComplexityRef));

/** Baseline-corrected self-consistency SKILL in [0,1], HARDENED two ways so
 *  closure is genuinely earned: (1) the read-back sees only a bounded, per-gene
 *  view of the image (HYPER.readbackBandwidth), so reconstruction is hard at every
 *  scale; (2) the R² is weighted by genome complexity, so genuinely
 *  reconstructing a richer self scores higher than nailing a dozen easy genes.
 *  A blank/trivial creature still scores ~0; nothing is faked. */
export function selfConsistencySkill(g: Genome, p: Phenotype): number {
  return clamp01(selfConsistencyR2(g, p)) * complexityWeight(paramCount(g));
}

/** Unclamped, UN-weighted R² — the raw reconstruction quality (negative when the
 *  read-back is worse than predicting the mean). The headline skill folds in the
 *  complexity weight (above); this is exposed for honest diagnostics. */
export function selfConsistencyR2(g: Genome, p: Phenotype): number {
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
  const recon = selfReadback(g, p);
  let mse = 0;
  for (let i = 0; i < n; i++) mse += (recon[i]! - target[i]!) ** 2;
  mse /= n;
  return 1 - mse / varr;
}

export { paramCount };
