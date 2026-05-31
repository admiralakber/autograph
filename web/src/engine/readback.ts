import type { Genome } from './cppn.ts';
import { compileCPPN, evalCompiled, paramToUnit, paramCount, targetConns, targetBiasNodes, targetVector, targetCount } from './cppn.ts';
import { SUB_INPUTS } from './arch.ts';
import { activate } from './activations.ts';
import { HYPER } from './hyperparams.ts';
import type { Phenotype } from './substrate.ts';
import { readPonderEmit } from './substrate.ts';

// THE READ → PONDER → EMIT LOOP — the decode half, flowing THROUGH THE IMAGE.
//
// The loop (Escher's Drawing Hands, literally):
//   DNA (CPPN) PAINTS AN IMAGE across space, and the BRAIN (ES-HyperNEAT substrate)
//     EMERGES WITHIN it — neurons placed where the pattern has structure
//             → the brain READS the IMAGE IT'S BORN IN over a plastic, attentional,
//               ponder-gated lifetime (readPonderEmit, substrate.ts): it takes
//               foveated GLIMPSES where it chooses to look (Phase 4), its weights
//               self-modify (Phase 2) under its own neuromodulation (Phase 3), it
//               PONDERS a variable number of steps then HALTS (ACT, Phase 5), and
//               EMITS — zero-fed — the recurrent state that now encodes what it saw
//             → DNA′ is read OUT of that state at the canonical genome coordinates,
//               trying to find its own beginning
//             → skill = how well DNA′ matches DNA (R², baseline-corrected,
//               complexity-weighted, ponder-penalised)
//
// v6 Phase 5 — the culmination. The read is genuinely TEMPORAL, so the temporal
// channels (α, neuromod, attention, halt) all SHAPE the decode → they are load-bearing
// and reconstructable → fork (B) ends and they rejoin the target (DEFERRED_OUTPUT_IDS
// is now empty; the loop reconstructs the FULL temporal genome). This is the genuinely
// harder, more honest task v6 was built to be — the skill it earns is humbler than
// v5's, and that is the point.
//
// Honesty holds by construction: a blank image (≈constant density) drives flat
// glimpses → a near-constant read-state → DNA′ ≈ the mean → R² ≈ 0, and such a
// creature is vitality-gated. Only a creature whose image genuinely carries its DNA,
// read back through its own temporal brain, scores above 0.

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

/** The READ/ponder steps the most recent `selfReadback` used (for the ACT ponder cost
 *  in `selfConsistencySkill`). Set as a side effect each call; read immediately after
 *  in the same synchronous chain (skill → R² → readback). */
let lastPonderSteps = 0;

/** Read the creature's DNA back OUT OF ITS IMAGE, through its own TEMPORAL brain
 *  (v6 Phase 5 — read → ponder → emit). Returns DNA′ in [0,1] unit space, in
 *  TARGET-vector order; fork (B) has ended, so the target is the FULL temporal genome.
 *  The decode reads each gene out of the brain's HIDDEN state after it has glimpsed,
 *  self-modified and pondered over its image — so plasticity, neuromodulation and
 *  attention all shape DNA′ (they are load-bearing here). */
export function selfReadback(g: Genome, p: Phenotype): Float32Array {
  const cc = compileCPPN(g);
  const r = readPonderEmit(p); // READ + PONDER (+ halt) — the brain chooses WHERE to glimpse
  lastPonderSteps = r.ponder;
  const H = p.hiddenCount;

  // EMIT — project the chosen glimpses INTO the brain's hidden layer through the SAME
  // CPPN weights (the self-quine round-trip), then read DNA′ out at the genome coords.
  // The probes are now ATTENTION-CHOSEN (r.gx/gy) over a ponder-gated read, not fixed,
  // so attention/plasticity/halt shape DNA′ — load-bearing — while the calibrated
  // projection keeps the decode closeable (a pure-scan creature reduces to the old loop).
  const hid = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const hj = SUB_INPUTS + j;
    const hx = p.pos[hj * 3]!, hy = p.pos[hj * 3 + 1]!, hz = p.pos[hj * 3 + 2]!;
    let s = p.bias[hj]!;
    for (let t = 0; t < r.ponder; t++) {
      s += r.gval[t]! * evalCompiled(cc, r.gx[t]!, r.gy[t]!, 0, hx, hy, hz, o2)[0];
    }
    hid[j] = activate(p.act[hj]!, s);
  }

  // Read each gene OUT of the hidden layer at its canonical genome coordinate (CPPN-
  // painted weights hidden→gene; gene-output bias from the CPPN bias channel at that
  // coordinate). conn gene ↦ midpoint of its endpoints' homes.
  const conns = targetConns(g);
  const biases = targetBiasNodes(g);
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

/** The DNA's own values in unit space — the targets the read-back must match.
 *  v6 Phase 5: fork (B) has ended — the target is the FULL temporal genome (the
 *  deferred channels rejoined, see arch.ts DEFERRED_OUTPUT_IDS). */
export function dnaTargetUnits(g: Genome): Float32Array {
  const v = targetVector(g);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = paramToUnit(v[i]!);
  return out;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** How much credit a genome of this size earns at full reconstruction — closing
 *  MORE of yourself is worth more, so a handful of easy genes is never a free
 *  win. clamp01(genes / ref): a creature at/above the reference earns full R². */
const complexityWeight = (genes: number): number => clamp01(genes / Math.max(1, HYPER.skillComplexityRef));

/** Baseline-corrected self-consistency SKILL in [0,1], HARDENED three ways so closure
 *  is genuinely earned: (1) DNA′ is read through the bounded, temporal read→ponder→emit
 *  decode, not a free look; (2) the R² is weighted by genome complexity, so genuinely
 *  reconstructing a richer self scores higher than nailing a dozen easy genes; (3) a
 *  gentle ACT PONDER COST penalises dithering (Graves 2016), so the brain is pressured
 *  to halt once it has seen enough. A blank/trivial creature still scores ~0; nothing
 *  is faked — and reconstructing the FULL temporal genome is humblingly harder than v5. */
export function selfConsistencySkill(g: Genome, p: Phenotype): number {
  const r2 = selfConsistencyR2(g, p); // runs the read; sets lastPonderSteps
  const cap = Math.max(1, Math.round(HYPER.ponderMaxSteps));
  const ponderFactor = clamp01(1 - HYPER.ponderCost * (lastPonderSteps / cap));
  return clamp01(r2) * complexityWeight(targetCount(g)) * ponderFactor;
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
