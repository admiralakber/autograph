import { SUB_INPUTS, SUB_OUTPUTS, CPPN_OUTPUTS } from './arch.ts';
import type { Genome } from './cppn.ts';
import type { Compiled } from './cppn.ts';
import { compileCPPN, evalCompiled } from './cppn.ts';
import { activate, ACTIVATION_COUNT } from './activations.ts';
import { growSubstrate, coordKey } from './eshyperneat.ts';
import type { Vec3 } from './eshyperneat.ts';
import { HYPER } from './hyperparams.ts';

// The PHENOTYPE: a HyperNEAT substrate whose hidden neurons are PLACED, made
// DENSE, and WIRED by genuine ES-HyperNEAT (eshyperneat.ts) from the CPPN's WEIGHT
// pattern — no fixed/uniform grid. The CPPN paints every connection weight from the
// two endpoints' 3-D coordinates and supplies each HIDDEN neuron's bias + activation.
//
// What the brain does is the loop's READ + WRITE — NOT painting the image:
//   • its INPUT neurons are fed a foveated GLIMPSE of the self-portrait (the CPPN-art
//     IMAGE — paintCppnArt below) at the brain's own chosen fixation;
//   • its OUTPUT neurons ARE the writer — emit value, end, next-look (x, y, scale),
//     halt, and its own neuromodulator m — produced by RUNNING the recurrent / plastic
//     / neuromodulated rollout, then read off the output neurons. A behaviour is a real
//     substrate neuron's activation, never a CPPN channel.
//
// THE IMAGE is the DNA's APPEARANCE, painted directly by the CPPN's density/hue channels
// (paintCppnArt) — CPPN-art, à la Picbreeder. It is what the brain READS; it is NEVER a
// brain output. That is the Stanley-grade genotype↔phenotype boundary.

// SUB_INPUTS input *sensor* neurons on a ring at the z = −1 layer.
const INPUT_POS: Vec3[] = (() => {
  const p: Vec3[] = [];
  for (let i = 0; i < SUB_INPUTS; i++) {
    const a = (i / SUB_INPUTS) * Math.PI * 2;
    p.push([Math.cos(a) * 0.7, Math.sin(a) * 0.7, -1]);
  }
  return p;
})();

// SUB_OUTPUTS writer output neurons on a ring at the z = +1 layer, in canonical order
// [emitVal, emitEnd, fixX, fixY, fixScale, halt, m].
const OUTPUT_POS: Vec3[] = (() => {
  const p: Vec3[] = [];
  for (let i = 0; i < SUB_OUTPUTS; i++) {
    const a = (i / SUB_OUTPUTS) * Math.PI * 2;
    p.push([Math.cos(a) * 0.45, Math.sin(a) * 0.45, 1]);
  }
  return p;
})();

// Canonical writer-output offsets from the first output neuron (outStart).
const O_EMITVAL = 0;
const O_EMITEND = 1;
const O_FIXX = 2;
const O_FIXY = 3;
const O_FIXSCALE = 4;
const O_HALT = 5;
const O_M = 6;

const esParams = () => ({
  initialDepth: HYPER.esInitialDepth,
  maxDepth: HYPER.esMaxDepth,
  divisionThreshold: HYPER.esDivisionThreshold,
  varianceThreshold: HYPER.esVarianceThreshold,
  bandThreshold: HYPER.esBandThreshold,
  iterationLevel: HYPER.esIterationLevel,
  maxHidden: HYPER.esMaxHidden,
  weightScale: HYPER.substrateWeight,
  plasticityScale: HYPER.plasticityScale,
  neuromodScale: HYPER.neuromodScale,
});

export interface Phenotype {
  /** The compiled CPPN — kept so the brain can READ its own appearance (the CPPN-art
   *  IMAGE, paintCppnArt) and the ablation overlay can silence a CPPN node + re-render. */
  readonly cc: Compiled;
  /** The genome — kept for the CPPN-node ablation demo (receptive fields). */
  readonly g: Genome;
  /** Node coordinates, laid out [inputs(SUB_INPUTS)] ++ [hidden(H)] ++ [outputs(SUB_OUTPUTS)]. */
  readonly pos: Float32Array; // nodeCount * 3
  readonly hiddenCount: number;
  /** Activation id per node (inputs/outputs linear; hidden heterogeneous, painted). */
  readonly act: Uint8Array;
  /** Per-node bias (inputs 0; hidden painted by the CPPN; WRITER output neurons 0 —
   *  their bias arises via wired incoming from the bias input, the structural on-ramp). */
  readonly bias: Float32Array;
  /** Per-node incoming source indices + weights (the wired ES-HyperNEAT graph). */
  readonly inFrom: Int32Array[];
  readonly inW: Float32Array[];
  /** Per-node incoming Hebbian plasticity coefficients α (parallel to inW). The
   *  effective weight during a plastic rollout is w + α·trace. */
  readonly inAlpha: Float32Array[];
  /** Per-node incoming neuromodulation gates g (parallel to inAlpha) — how much the
   *  brain's own m(t) gates each synapse's Hebbian learning rate. m(t) is the m OUTPUT
   *  NEURON's previous-step activation: trace ← (1−η)·trace + η·(1 + g·m(t))·(pre·post). */
  readonly inModGate: Float32Array[];
  /** Per-node cumulative incoming-edge offset into the flat plastic trace, and the
   *  total edge count (the trace scratch size). */
  readonly edgeBase: Int32Array;
  readonly edgeTotal: number;
  /** True if any |α| is meaningfully nonzero — gates the plastic rollout so a
   *  non-plastic creature pays nothing for machinery it doesn't use (the v5 path). */
  readonly hasPlastic: boolean;
  /** True if plasticity is present AND the m output neuron is wired AND some synapse is
   *  gated — only then does m(t) do real work, so a non-neuromodulated creature skips it. */
  readonly hasNeuromod: boolean;
  /** True if any attention output neuron (fixX/fixY/fixScale) is wired — i.e. the brain
   *  genuinely CHOOSES its fixation. Off at birth (a fixed centred scan); arises when the
   *  weight pattern expresses connections to those output neurons (the structural on-ramp). */
  readonly hasAttention: boolean;
  /** True if the halt output neuron is wired — i.e. the brain can choose to stop pondering
   *  early. Off at birth (ponders to the hard cap); arises by the same structural on-ramp. */
  readonly hasHalt: boolean;
  /** Per-writer-output readout scale = 1/max(1, fan-in) (length SUB_OUTPUTS). The behaviour
   *  read off each output neuron is `squash(value · outScale)` — a MEAN-pooled readout, so
   *  the signal stays in the squash's sensitive range regardless of how many connections the
   *  weight pattern expresses into it (a raw sum saturates → bang-bang, un-tunable behaviours
   *  → no bootstrap; the fan-in mean keeps emit/halt/look/m smoothly evolvable). */
  readonly outScale: Float32Array;
  /** Flat expressed-edge list (for the network visualisation). */
  readonly edges: ReadonlyArray<{ readonly from: number; readonly to: number; readonly weight: number }>;
  /** Count of expressed connections — the phenotype's edge count for readouts. */
  readonly liveConns: number;
  /** True if any wired edge is recurrent/lateral (source index ≥ target). Only such
   *  creatures need the full T-step temporal rollout; feed-forward-only ones settle
   *  in 2 steps exactly as in v5 (a perf-aware, behaviour-identical fast path). */
  readonly hasRecurrent: boolean;
}

const o2: number[] = new Array(CPPN_OUTPUTS).fill(0); // scratch for all CPPN output channels
const HUE_ACT = ACTIVATION_COUNT - 1; // sensors/outputs run linear (clamped identity)

/** Build the phenotype from the DNA via genuine ES-HyperNEAT: grow the substrate from
 *  the weight pattern, then paint per-HIDDEN-neuron biases + heterogeneous activations
 *  from the CPPN. The writer OUTPUT neurons get NO painted bias — they read 0 until the
 *  weight pattern wires them (the gentle structural on-ramp for every behaviour). */
export function buildPhenotype(g: Genome): Phenotype {
  const cc = compileCPPN(g);
  const grown = growSubstrate(cc, INPUT_POS, OUTPUT_POS, esParams());

  const inputs = INPUT_POS;
  const hidden = grown.hidden;
  const outputs = OUTPUT_POS;
  const H = hidden.length;
  const N = inputs.length + H + outputs.length;

  const pos = new Float32Array(N * 3);
  const act = new Uint8Array(N);
  const bias = new Float32Array(N);
  const idOf = new Map<number, number>(); // coordKey (packed int) → node index

  const place = (c: Vec3, idx: number): void => {
    pos[idx * 3] = c[0];
    pos[idx * 3 + 1] = c[1];
    pos[idx * 3 + 2] = c[2];
    idOf.set(coordKey(c[0], c[1], c[2]), idx);
  };

  let idx = 0;
  for (const c of inputs) {
    place(c, idx);
    act[idx] = HUE_ACT; // sensors pass their feature through (clamped identity)
    idx++;
  }
  for (const c of hidden) {
    place(c, idx);
    // The CPPN chooses each hidden neuron's activation + bias at its own coordinate
    // (one (p,p) query): weight channel → activation, bias channel → bias.
    const r = evalCompiled(cc, c[0], c[1], c[2], c[0], c[1], c[2], o2);
    const t = r[0]! * 0.5 + 0.5;
    act[idx] = Math.max(0, Math.min(ACTIVATION_COUNT - 1, Math.floor((((t % 1) + 1) % 1) * ACTIVATION_COUNT)));
    bias[idx] = r[1]!;
    idx++;
  }
  for (const c of outputs) {
    place(c, idx);
    act[idx] = HUE_ACT; // writer neurons run linear; bias stays 0 (the structural on-ramp)
    idx++;
  }

  // Wire incoming lists from the expressed connections (skip any unmapped end).
  const inSrc: number[][] = Array.from({ length: N }, () => []);
  const inWt: number[][] = Array.from({ length: N }, () => []);
  const inAl: number[][] = Array.from({ length: N }, () => []);
  const inMg: number[][] = Array.from({ length: N }, () => []);
  const edges: { from: number; to: number; weight: number }[] = [];
  for (const c of grown.conns) {
    const a = idOf.get(coordKey(c.from[0], c.from[1], c.from[2]));
    const b = idOf.get(coordKey(c.to[0], c.to[1], c.to[2]));
    if (a === undefined || b === undefined || a === b) continue;
    inSrc[b]!.push(a);
    inWt[b]!.push(c.weight);
    inAl[b]!.push(c.alpha);
    inMg[b]!.push(c.modGate);
    edges.push({ from: a, to: b, weight: c.weight });
  }

  const inFrom = inSrc.map((s) => Int32Array.from(s));
  const inW = inWt.map((w) => Float32Array.from(w));
  const inAlpha = inAl.map((a) => Float32Array.from(a));
  const inModGate = inMg.map((m) => Float32Array.from(m));
  // Per-node edge offsets (for the flat plastic trace) + the plastic / recurrent gates.
  const edgeBase = new Int32Array(N);
  let edgeTotal = 0;
  let hasRecurrent = false;
  let hasPlastic = false;
  let anyModGate = false;
  for (let i = 0; i < N; i++) {
    edgeBase[i] = edgeTotal;
    const f = inFrom[i]!;
    const al = inAlpha[i]!;
    const mg = inModGate[i]!;
    edgeTotal += f.length;
    for (let k = 0; k < f.length; k++) {
      if (f[k]! >= i) hasRecurrent = true;
      if (al[k]! > 1e-3 || al[k]! < -1e-3) hasPlastic = true;
      if (mg[k]! > 1e-3 || mg[k]! < -1e-3) anyModGate = true;
    }
  }
  const outStart = N - SUB_OUTPUTS;
  // Behaviours arise STRUCTURALLY: a writer output neuron does real work only once the
  // weight pattern expresses connections to it. Off at birth ⇒ it reads 0 (a constant
  // write that never halts, no roam, m≡0) until ES-HyperNEAT wires it.
  const wired = (off: number): boolean => inFrom[outStart + off]!.length > 0;
  // Neuromodulation does real work only with plasticity, a wired m output neuron (so m(t)
  // can be nonzero), and a gated synapse — else the update reduces to the plastic one.
  const hasNeuromod = hasPlastic && wired(O_M) && anyModGate;
  const hasAttention = wired(O_FIXX) || wired(O_FIXY) || wired(O_FIXSCALE);
  const hasHalt = wired(O_HALT);
  // Mean-pool each writer output: read = squash(sum · 1/fan-in), so the behaviour signal
  // stays in the squash's sensitive range however richly the pattern wires it.
  const outScale = new Float32Array(SUB_OUTPUTS);
  for (let k = 0; k < SUB_OUTPUTS; k++) outScale[k] = 1 / Math.max(1, inFrom[outStart + k]!.length);
  return { cc, g, pos, hiddenCount: H, act, bias, inFrom, inW, inAlpha, inModGate, edgeBase, edgeTotal, edges, liveConns: edges.length, hasRecurrent, hasPlastic, hasNeuromod, hasAttention, hasHalt, outScale };
}

// --- The CPPN-art IMAGE — the DNA's appearance the brain READS ---------------
//
// The self-portrait is painted DIRECTLY by the CPPN's density + hue channels (CPPN-art,
// Picbreeder/Stanley) — query the genome at a coordinate, read its appearance. The brain
// is NOT involved; the image is the genotype's expression, the brain's read target.

const cppnArtScratch: number[] = new Array(CPPN_OUTPUTS).fill(0);
/** Query the CPPN-art image at a 3-D point -> [density in [0,1], hue in [0,1]] from the
 *  CPPN's density (channel 2) + hue (channel 3) channels. The genome's appearance. */
export function paintCppnArt(cc: Compiled, px: number, py: number, pz: number, out: [number, number] = [0, 0]): [number, number] {
  const r = evalCompiled(cc, px, py, pz, px, py, pz, cppnArtScratch);
  out[0] = 1 / (1 + Math.exp(-1.3 * r[2]!)); // density (alpha)
  out[1] = (Math.sin(r[3]! * 1.4) + 1) * 0.5; // hue
  return out;
}

// Reusable evaluation scratch (grows as needed) — the rollout is hot.
let val = new Float32Array(64);
let prev = new Float32Array(64);
/** Per-edge Hebbian trace scratch (one rollout's worth; reset per query). */
let hebb = new Float32Array(256);
/** Stability fix — BOUND the recurrent state to a finite range each step. The brain has
 *  unbounded activations (relu/identity/abs/bent) + LINEAR outputs, recurrent/self edges,
 *  and a Hebbian term (w + α·trace) that can amplify; over the long autoregressive WRITE
 *  (up to `emitMaxLen` steps) this can diverge to ±Infinity, and `out·Infinity` then yields
 *  NaN. Bounding the state is the ROOT fix: it makes the dynamical system BIBO-stable so no
 *  Infinity/NaN can arise. The clamp is generous (healthy creatures never approach it, so
 *  their numbers are unchanged); any NaN that somehow appears collapses to 0. */
const STATE_BOUND = 1e6;
const bounded = (x: number): number => (x > STATE_BOUND ? STATE_BOUND : x < -STATE_BOUND ? -STATE_BOUND : x === x ? x : 0);

/** ONE synchronous propagation step — the reusable temporal-pass primitive. Each
 *  non-input node recomputes from its forward edges (`src < i`, this step's values) and
 *  its recurrent / self / lateral edges (`src ≥ i`, the PREVIOUS step's values, via
 *  `prev`). Inputs are held in `val[0..SUB_INPUTS)` and never overwritten, so the read /
 *  write phases vary them per step while the recurrent state carries forward.
 *
 *  When `plastic`, the effective weight is `w + α·trace` and each edge's Hebbian trace
 *  self-modifies — a bounded decaying EMA of pre·post — so the brain LEARNS toward
 *  self-knowledge across the rollout (differentiable-plasticity form; α is EVOLVED).
 *
 *  When `neuromod`, each synapse's learning rate is gated by (1 + g·m(t)) — the
 *  Backpropamine form. m(t) is the m OUTPUT NEURON's previous-step activation (a genuine
 *  substrate neuron, not a CPPN channel), tanh-bounded; one-step lag ⇒ a stable retroactive
 *  modulator. g=0 or m=0 ⇒ the plastic update exactly, so a non-neuromodulated brain is
 *  unaffected. */
function stepSubstrate(p: Phenotype, N: number, outStart: number, plastic: boolean, neuromod: boolean): void {
  prev.set(val.subarray(0, N));
  const eta = HYPER.hebbianRate;
  // The brain's own neuromodulator m(t): the m output neuron's (fan-in-mean) value last step.
  const m = neuromod ? Math.tanh(prev[outStart + O_M]! * p.outScale[O_M]!) : 0;
  for (let i = SUB_INPUTS; i < N; i++) {
    const from = p.inFrom[i]!;
    const w = p.inW[i]!;
    let s = p.bias[i]!;
    if (plastic) {
      const al = p.inAlpha[i]!;
      const mg = p.inModGate[i]!;
      const base = p.edgeBase[i]!;
      for (let k = 0; k < from.length; k++) {
        const src = from[k]!;
        const pre = src >= i ? prev[src]! : val[src]!;
        s += pre * (w[k]! + al[k]! * hebb[base + k]!);
      }
      const post = bounded(i >= outStart ? s : activate(p.act[i]!, s));
      val[i] = post;
      for (let k = 0; k < from.length; k++) {
        const src = from[k]!;
        const pre = src >= i ? prev[src]! : val[src]!;
        const t = base + k;
        // Neuromodulated learning rate: (1 + g·m). g=0 or m=0 ⇒ the plastic update.
        hebb[t] = bounded((1 - eta) * hebb[t]! + eta * (1 + mg[k]! * m) * pre * post);
      }
    } else {
      for (let k = 0; k < from.length; k++) {
        const src = from[k]!;
        s += (src >= i ? prev[src]! : val[src]!) * w[k]!;
      }
      val[i] = bounded(i >= outStart ? s : activate(p.act[i]!, s));
    }
  }
}

// --- ATTENTION / GLIMPSE (RAM, evolved hard attention) ----------------------
//
// Each READ step the brain emits a FIXATION (location + scale) from its OWN output
// neurons (fixX/fixY/fixScale) and takes a FOVEATED glimpse — a fine fovea + a coarse
// periphery — of the CPPN-art IMAGE at that fixation. The glimpse feeds the recurrent
// state and the brain chooses where to look next. Evolution handles the non-differentiable
// location choice natively (no REINFORCE); attention is INTRINSIC (no separate net) and
// OFF at birth (the fix output neurons unwired ⇒ a fixed centred scan), arising by mutation.
//
// The image is rendered to a grid ONCE (the CPPN-art density + hue fields); the glimpses
// then only interpolate it — so the brain reads a FIXED image, never a moving target.

/** A foveated glimpse's unit offsets: centre + an 8-point ring, scaled by radius. */
const GLIMPSE_RING: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [0.71, 0.71], [0, 1], [-0.71, 0.71], [-1, 0], [-0.71, -0.71], [0, -1], [0.71, -0.71],
];
let gridD = new Float32Array(0); // reused CPPN-art density grid
let gridH = new Float32Array(0); // reused CPPN-art hue grid
// Reused glimpse-path scratch (grown to the ponder cap) — no per-step allocation.
let gxBuf = new Float32Array(0), gyBuf = new Float32Array(0), gvalBuf = new Float32Array(0);
/** Reused autoregressive-write scratch (grown to the emit cap). */
let emitBuf = new Float32Array(0);
const sig = (x: number): number => 1 / (1 + Math.exp(-x));

/** Render the CPPN-art density + hue images to a res×res grid on the z=0 sheet — the
 *  fields the attention glimpses read (the genome's appearance, paintCppnArt). */
function renderImageGrid(p: Phenotype, res: number): void {
  if (gridD.length < res * res) { gridD = new Float32Array(res * res); gridH = new Float32Array(res * res); }
  const gout: [number, number] = [0, 0];
  const inv = 2 / (res - 1);
  for (let yi = 0; yi < res; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < res; xi++) {
      paintCppnArt(p.cc, xi * inv - 1, y, 0, gout);
      gridD[yi * res + xi] = gout[0];
      gridH[yi * res + xi] = gout[1];
    }
  }
}

/** Bilinear sample of a grid at (x,y) ∈ [-1,1]² (clamped to the border). */
function sampleGrid(grid: Float32Array, res: number, x: number, y: number): number {
  const gx = ((x < -1 ? -1 : x > 1 ? 1 : x) + 1) * 0.5 * (res - 1);
  const gy = ((y < -1 ? -1 : y > 1 ? 1 : y) + 1) * 0.5 * (res - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = x0 + 1 < res ? x0 + 1 : res - 1;
  const y1 = y0 + 1 < res ? y0 + 1 : res - 1;
  const tx = gx - x0, ty = gy - y0;
  const top = grid[y0 * res + x0]! * (1 - tx) + grid[y0 * res + x1]! * tx;
  const bot = grid[y1 * res + x0]! * (1 - tx) + grid[y1 * res + x1]! * tx;
  return top * (1 - ty) + bot * ty;
}

/** A foveated glimpse at (fx,fy) with zoom from `scale` of the CPPN-art image: mean
 *  density + hue over a fine fovea ring, and mean density over a coarse periphery ring
 *  (RAM's multi-resolution glimpse). Writes [foveaDensity, foveaHue, peripheryDensity]. */
function glimpse(res: number, fx: number, fy: number, scale: number, out: [number, number, number]): void {
  const zoom = 1 + 0.5 * scale; // scale ∈ [-1,1] (tanh) ⇒ zoom in (0.5×) or out (1.5×)
  const rFov = HYPER.glimpseFovea * zoom;
  const rPer = HYPER.glimpsePeriphery * zoom;
  let fovD = 0, fovH = 0, per = 0;
  for (const [ox, oy] of GLIMPSE_RING) {
    fovD += sampleGrid(gridD, res, fx + ox * rFov, fy + oy * rFov);
    fovH += sampleGrid(gridH, res, fx + ox * rFov, fy + oy * rFov);
    per += sampleGrid(gridD, res, fx + ox * rPer, fy + oy * rPer);
  }
  const inv = 1 / GLIMPSE_RING.length;
  out[0] = fovD * inv;
  out[1] = fovH * inv;
  out[2] = per * inv;
}

export interface ReadResult {
  /** The fixation coordinates (z=0) the brain actually GLIMPSED, one per READ step. */
  readonly gx: Float32Array;
  readonly gy: Float32Array;
  /** The foveal density the brain saw at each fixation. */
  readonly gval: Float32Array;
  /** READ/ponder steps actually used (1..ponderMaxSteps) — variable, halt-controlled. */
  readonly ponder: number;
  /** Largest CHOSEN deviation from the default scan (0 ⇒ attention off — pure scan). */
  readonly deviation: number;
  /** True if the brain chose to halt before the hard cap (vs ran out the cap). */
  readonly halted: boolean;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The DEFAULT scan fixation for read step t of T — a Fibonacci sweep of the image disc.
 *  With attention OFF this is what the brain reads (an informative default, so the loop
 *  bootstraps); attention adds a learned DEVIATION on top. */
function scanFixation(t: number, T: number, out: [number, number]): void {
  const r = Math.sqrt((t + 0.5) / T) * 0.72;
  const a = t * GOLDEN;
  out[0] = Math.cos(a) * r;
  out[1] = Math.sin(a) * r;
}
const clampUnit = (x: number): number => (x < -1 ? -1 : x > 1 ? 1 : x);

/** The READ / PONDER phase (RAM-style evolved attention). The brain reads its CPPN-art
 *  image by taking up to `ponderMaxSteps` foveated GLIMPSES, building its recurrent +
 *  Hebbian state WITHOUT emitting — the WRITE is `selfWrite`'s separate, decoupled phase.
 *  Each step:
 *    • fixation = a default Fibonacci SCAN position + a learned DEVIATION read off the
 *      brain's fixX/fixY/fixScale OUTPUT NEURONS (off at birth ⇒ a pure informative scan);
 *    • a FOVEATED glimpse [fovea density, fovea hue, periphery density] of the image at
 *      that fixation is fed to the input neurons (READ mode);
 *    • one recurrent step runs (plasticity + neuromodulation active);
 *    • the halt OUTPUT NEURON accumulates a halt signal — when it crosses 1.0 the brain
 *      has "seen enough" and stops, else the hard cap (Adaptive Computation Time).
 *  So `ponder` = the number of glimpse steps (each a look AND a think — ingest, never emit).
 *  `noDeviation` clamps the gaze to the pure scan (the attention ablation control). The
 *  recurrent state the read built (left in `val`) is what `selfWrite` then writes from. */
export function readPonderEmit(p: Phenotype, noDeviation = false): ReadResult {
  const N = p.inFrom.length;
  if (val.length < N) { val = new Float32Array(N); prev = new Float32Array(N); }
  const res = Math.max(2, Math.round(HYPER.glimpseRes));
  renderImageGrid(p, res); // the CPPN-art fields — done BEFORE the rollout
  const outStart = N - SUB_OUTPUTS;
  const runPlastic = p.hasPlastic;
  const runNeuromod = runPlastic && p.hasNeuromod;
  if (runPlastic) {
    if (hebb.length < p.edgeTotal) hebb = new Float32Array(p.edgeTotal);
    hebb.fill(0, 0, p.edgeTotal);
  }
  val.fill(0, 0, N); // a fresh recurrent state for the read
  const cap = Math.max(1, Math.round(HYPER.ponderMaxSteps));
  if (gxBuf.length < cap) { gxBuf = new Float32Array(cap); gyBuf = new Float32Array(cap); gvalBuf = new Float32Array(cap); }
  const gx = gxBuf, gy = gyBuf, gval = gvalBuf;
  const gv: [number, number, number] = [0, 0, 0];
  const sc: [number, number] = [0, 0];
  let devX = 0, devY = 0, devScale = 0; // chosen deviation from the scan (0 ⇒ attention off)
  let deviation = 0, cumHalt = 0, ponder = 0, halted = false;
  for (let t = 0; t < cap; t++) {
    scanFixation(t, cap, sc);
    const fx = clampUnit(sc[0]! + devX), fy = clampUnit(sc[1]! + devY);
    glimpse(res, fx, fy, devScale, gv);
    gx[t] = fx; gy[t] = fy; gval[t] = gv[0]!;
    // READ-mode inputs: the glimpse (fovea density, fovea hue, periphery density), no prev
    // value, READ mode (0), bias (1). The glimpse IS the input.
    val[0] = gv[0]!; val[1] = gv[1]!; val[2] = gv[2]!; val[3] = 0; val[4] = 0; val[5] = 1;
    stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
    if (!noDeviation && p.hasAttention) {
      devX = Math.tanh(val[outStart + O_FIXX]! * p.outScale[O_FIXX]!);
      devY = Math.tanh(val[outStart + O_FIXY]! * p.outScale[O_FIXY]!);
      devScale = Math.tanh(val[outStart + O_FIXSCALE]! * p.outScale[O_FIXSCALE]!);
    }
    const d = Math.sqrt(devX * devX + devY * devY);
    if (d > deviation) deviation = d;
    ponder = t + 1;
    if (p.hasHalt) {
      const haltSig = Math.tanh(val[outStart + O_HALT]! * p.outScale[O_HALT]!); // rectified ⇒ 0 when halt is off
      if (haltSig > 0) cumHalt += haltSig;
      if (cumHalt >= 1) { halted = true; break; }
    }
  }
  return { gx: gx.slice(0, ponder), gy: gy.slice(0, ponder), gval: gval.slice(0, ponder), ponder, deviation, halted };
}

// --- The AUTOREGRESSIVE WRITER (the clean self-loop) ------------------------
//
// After the READ (readPonderEmit builds the recurrent state by glimpsing the image), the
// brain WRITES its DNA element by element FROM ITS OWN OUTPUT NEURONS: each step it is fed
// its own previous output (autoregressive, WRITE mode), steps once (plasticity/neuromod
// stay active — it keeps learning as it writes), and reads `value = σ(emitVal neuron)` (the
// next gene) + `end` from the emitEnd neuron (the halting signal). When `end` fires the
// creature has DECIDED its own length. No CPPN re-projection, no per-gene coordinate lookup,
// no length given. We run a bounded number of steps (`min(emitMaxLen, 2·G)`, ≥ G) and record
// where the end-signal first fired (`selfLen`), so one rollout yields both the curriculum's
// teacher-length read (first G values) and the honest self-length read. Off at birth ⇒ a
// fresh creature writes a constant σ(0)=0.5 and never halts — predict-the-mean ⇒ skill 0.

export interface WriteResult {
  /** Emitted DNA′ values in [0,1] — the raw sequence, length `runLen`. */
  readonly values: Float32Array;
  /** Steps actually emitted = min(emitMaxLen, 2·G), always ≥ G (the teacher length). */
  readonly runLen: number;
  /** L — the step at which the brain's end-signal first fired (else `runLen`): the
   *  creature's OWN decided DNA′ length. */
  readonly selfLen: number;
  /** True if the writer chose to halt before the cap (vs ran out the cap). */
  readonly halted: boolean;
  /** READ/ponder steps used (from the read phase) — the "thinking". */
  readonly ponder: number;
  /** Largest attention deviation in the read (0 ⇒ attention off — the ablation control). */
  readonly deviation: number;
}

/** The brain READS its image then AUTOREGRESSIVELY WRITES its DNA, deciding its own length.
 *  `G` is the genome's gene count (sets the teacher length + the run bound). `noDeviation`
 *  clamps the read to the pure scan (attention ablation control). */
export function selfWrite(p: Phenotype, G: number, noDeviation = false): WriteResult {
  const r = readPonderEmit(p, noDeviation); // READ — leaves the recurrent state in `val`
  const N = p.inFrom.length;
  const outStart = N - SUB_OUTPUTS;
  const runPlastic = p.hasPlastic;
  const runNeuromod = runPlastic && p.hasNeuromod;
  const cap = Math.max(1, Math.round(HYPER.emitMaxLen));
  const runLen = Math.min(cap, Math.max(1, 2 * G)); // ≥ G (teacher) + room to see over-length
  if (emitBuf.length < runLen) emitBuf = new Float32Array(runLen);
  const invLen = 1 / Math.max(1, runLen);
  let prevVal = 0;
  let cumEnd = 0;
  let selfLen = runLen, halted = false;
  for (let t = 0; t < runLen; t++) {
    // WRITE-mode inputs: own previous output (autoregressive), WRITE mode, bias + position.
    val[0] = 0; val[1] = 0; val[2] = t * invLen; val[3] = prevVal; val[4] = 1; val[5] = 1;
    stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
    const value = sig(val[outStart + O_EMITVAL]! * p.outScale[O_EMITVAL]!);
    emitBuf[t] = value;
    prevVal = value;
    // The creature DECIDES its length by Adaptive Computation Time (Graves) on the emitEnd
    // OUTPUT NEURON — the SAME accumulation the read-ponder halt uses: a rectified end signal
    // accrues until it crosses 1.0, so length L ≈ 1/(mean end-rate) is a SMOOTH, evolvable
    // control (not a brittle single-step threshold that snaps to halt-at-1 or never). Off at
    // birth (emitEnd unwired ⇒ 0) ⇒ the signal never accrues ⇒ it writes to the cap.
    if (!halted) {
      const endSig = Math.tanh(val[outStart + O_EMITEND]! * p.outScale[O_EMITEND]!);
      if (endSig > 0) cumEnd += endSig;
      if (cumEnd >= 1) { selfLen = t + 1; halted = true; }
    }
  }
  return { values: emitBuf.slice(0, runLen), runLen, selfLen, halted, ponder: r.ponder, deviation: r.deviation };
}

// --- Accessors for visualisation --------------------------------------------

export interface SubNode {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly role: 'in' | 'hidden' | 'out';
  /** Activation id for hidden nodes (undefined for inputs/outputs). */
  readonly act?: number;
}
export interface SubConn {
  readonly a: SubNode;
  readonly b: SubNode;
  readonly weight: number;
}

export function phenotypeNodes(p: Phenotype): SubNode[] {
  const N = p.inFrom.length;
  const hidEnd = N - SUB_OUTPUTS;
  const nodes: SubNode[] = [];
  for (let i = 0; i < N; i++) {
    const role: SubNode['role'] = i < SUB_INPUTS ? 'in' : i < hidEnd ? 'hidden' : 'out';
    nodes.push({
      x: p.pos[i * 3]!,
      y: p.pos[i * 3 + 1]!,
      z: p.pos[i * 3 + 2]!,
      role,
      act: role === 'hidden' ? p.act[i]! : undefined,
    });
  }
  return nodes;
}

export function phenotypeConns(p: Phenotype, nodes: SubNode[] = phenotypeNodes(p)): SubConn[] {
  const conns: SubConn[] = [];
  for (const e of p.edges) {
    const a = nodes[e.from];
    const b = nodes[e.to];
    if (a && b) conns.push({ a, b, weight: e.weight });
  }
  return conns;
}
