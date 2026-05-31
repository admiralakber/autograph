import { SUB_INPUTS, SUB_OUTPUTS, CPPN_INPUTS, CPPN_OUTPUTS } from './arch.ts';
import type { Genome } from './cppn.ts';
import { compileCPPN, evalCompiled } from './cppn.ts';
import type { EmittedGenome } from './structural.ts';
import { activate, ACTIVATION_COUNT } from './activations.ts';
import { growSubstrate, coordKey } from './eshyperneat.ts';
import type { Vec3 } from './eshyperneat.ts';
import { HYPER } from './hyperparams.ts';

// The PHENOTYPE: a HyperNEAT substrate whose hidden neurons are PLACED, made DENSE, and
// WIRED by genuine ES-HyperNEAT (eshyperneat.ts) from the CPPN's WEIGHT pattern — no
// fixed/uniform grid. The CPPN paints every connection weight from the two endpoints' 3-D
// coordinates and supplies each HIDDEN neuron's bias + activation.
//
// THE SELF-PORTRAIT (the image) is rendered FROM THIS BUILT SUBSTRATE — a true depiction
// of the wiring, NOT a separate CPPN channel (substrateFieldAt below): at any point in the
// volume, DENSITY ↔ the connection strength concentrated there (neuron Σ|incoming weight| +
// |bias|, plus the strongest wires) and HUE ↔ the local ACTIVATION TYPE. So "render =
// network = code" is literally true, and the loop is the genuine inverse problem.
//
// What the brain does is the loop's READ + WRITE (never painting the image):
//   • its INPUT neurons are fed a foveated 3-D GLIMPSE of that self-portrait at the brain's
//     own chosen fixation (it attends in depth, not just one slice);
//   • its OUTPUT neurons ARE the writer — emit value, end, next-look (x, y, z, scale), halt,
//     and its own neuromodulator m — produced by RUNNING the recurrent / plastic /
//     neuromodulated rollout, then read off the output neurons. A behaviour is a real
//     substrate neuron's activation, never a CPPN channel.

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
// [emitVal, emitEnd, fixX, fixY, fixZ, fixScale, halt, m].
const OUTPUT_POS: Vec3[] = (() => {
  const p: Vec3[] = [];
  for (let i = 0; i < SUB_OUTPUTS; i++) {
    const a = (i / SUB_OUTPUTS) * Math.PI * 2;
    p.push([Math.cos(a) * 0.45, Math.sin(a) * 0.45, 1]);
  }
  return p;
})();

// Canonical writer-output offsets from the first output neuron (outStart). READ head first
// (SPHERICAL fixation r, θ, φ — radius + direction into the volume), then the NODE head
// (end + bias + a categorical activation logit bank), then the CONN head (from, to, weight,
// enabled, end). The brain emits its DNA as a GRAPH; these are all real output neurons.
const O_FIXR = 0;
const O_FIXTHETA = 1;
const O_FIXPHI = 2;
const O_FIXSCALE = 3;
const O_HALT = 4;
const O_M = 5;
const O_NODE_END = 6;
const O_BIAS = 7;
const O_ACT0 = 8; // categorical activation logits span O_ACT0 .. O_ACT0+ACTIVATION_COUNT-1
const O_FROM = O_ACT0 + ACTIVATION_COUNT;
const O_TO = O_FROM + 1;
const O_WEIGHT = O_FROM + 2;
const O_ENABLED = O_FROM + 3;
const O_CONN_END = O_FROM + 4;

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
  /** The genome — kept for the CPPN-node ablation demo (re-grow + re-render). */
  readonly g: Genome;
  /** Node coordinates, laid out [inputs(SUB_INPUTS)] ++ [hidden(H)] ++ [outputs(SUB_OUTPUTS)]. */
  readonly pos: Float32Array; // nodeCount * 3
  readonly hiddenCount: number;
  /** Activation id per node (inputs/outputs linear; hidden heterogeneous, painted). It also
   *  colours the self-portrait — hue ↔ activation type. */
  readonly act: Uint8Array;
  /** Per-node bias (inputs 0; hidden painted by the CPPN; WRITER output neurons 0). */
  readonly bias: Float32Array;
  /** Per-node CONNECTION STRENGTH = Σ|incident weight| + |bias| — what the self-portrait's
   *  density depicts at each neuron (renderSubstrateImage / substrateFieldAt). */
  readonly strength: Float32Array;
  /** Indices (into `edges`) of the strongest connections — the wires the self-portrait
   *  draws (capped for cost; the strongest carry the signal). */
  readonly fieldEdges: Int32Array;
  /** Per-node incoming source indices + weights (the wired ES-HyperNEAT graph). */
  readonly inFrom: Int32Array[];
  readonly inW: Float32Array[];
  /** Per-node incoming Hebbian plasticity coefficients α (parallel to inW). */
  readonly inAlpha: Float32Array[];
  /** Per-node incoming neuromodulation gates g (parallel to inAlpha) — m(t) is the m OUTPUT
   *  NEURON's previous-step activation: trace ← (1−η)·trace + η·(1 + g·m(t))·(pre·post). */
  readonly inModGate: Float32Array[];
  /** Per-node cumulative incoming-edge offset into the flat plastic trace, + the total. */
  readonly edgeBase: Int32Array;
  readonly edgeTotal: number;
  readonly hasPlastic: boolean;
  readonly hasNeuromod: boolean;
  /** True if any attention output neuron (fixX/fixY/fixZ/fixScale) is wired. */
  readonly hasAttention: boolean;
  readonly hasHalt: boolean;
  /** Per-writer-output readout scale = 1/max(1, fan-in) (length SUB_OUTPUTS) — a mean-pooled
   *  readout so the behaviour signal stays in the squash's sensitive range. */
  readonly outScale: Float32Array;
  /** Flat expressed-edge list (for the network visualisation + the self-portrait wires). */
  readonly edges: ReadonlyArray<{ readonly from: number; readonly to: number; readonly weight: number }>;
  readonly liveConns: number;
  readonly hasRecurrent: boolean;
}

const o2: number[] = new Array(CPPN_OUTPUTS).fill(0); // scratch for all CPPN output channels
const HUE_ACT = ACTIVATION_COUNT - 1; // sensors/outputs run linear (clamped identity)
const INV_ACT_MAX = 1 / Math.max(1, ACTIVATION_COUNT - 1); // activation id → hue in [0,1]
/** How many of the strongest connections the self-portrait draws as wires (cost cap). */
const FIELD_EDGE_CAP = 64;

/** Build the phenotype from the DNA via genuine ES-HyperNEAT: grow the substrate from the
 *  weight pattern, paint per-HIDDEN-neuron biases + activations, then precompute the
 *  connection-strength field the self-portrait depicts. Writer OUTPUT neurons get NO painted
 *  bias — they read 0 until the weight pattern wires them (the gentle structural on-ramp). */
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
    act[idx] = HUE_ACT;
    idx++;
  }
  for (const c of hidden) {
    place(c, idx);
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

  // CONNECTION STRENGTH per neuron (degree-weighted) — the density the self-portrait depicts.
  const strength = new Float32Array(N);
  for (let i = 0; i < N; i++) strength[i] = Math.abs(bias[i]!);
  for (const e of edges) {
    const w = Math.abs(e.weight);
    strength[e.from]! += w;
    strength[e.to]! += w;
  }
  // The strongest connections become the drawn wires (capped).
  const order = edges.map((_, i) => i).sort((a, b) => Math.abs(edges[b]!.weight) - Math.abs(edges[a]!.weight));
  const fieldEdges = Int32Array.from(order.slice(0, FIELD_EDGE_CAP));

  const outStart = N - SUB_OUTPUTS;
  const wired = (off: number): boolean => inFrom[outStart + off]!.length > 0;
  const hasNeuromod = hasPlastic && wired(O_M) && anyModGate;
  const hasAttention = wired(O_FIXR) || wired(O_FIXTHETA) || wired(O_FIXPHI) || wired(O_FIXSCALE);
  const hasHalt = wired(O_HALT);
  const outScale = new Float32Array(SUB_OUTPUTS);
  for (let k = 0; k < SUB_OUTPUTS; k++) outScale[k] = 1 / Math.max(1, inFrom[outStart + k]!.length);
  return { g, pos, hiddenCount: H, act, bias, strength, fieldEdges, inFrom, inW, inAlpha, inModGate, edgeBase, edgeTotal, edges, liveConns: edges.length, hasRecurrent, hasPlastic, hasNeuromod, hasAttention, hasHalt, outScale };
}

// --- The SELF-PORTRAIT — a true depiction of the built network ---------------
//
// At any point in the volume: DENSITY = the connection strength concentrated there (a sum
// of neuron strength-splats + the strongest wires), HUE = the local ACTIVATION TYPE. This is
// the genome's network expressed as an image — what the brain reads. Gather-based (no grid):
// O(neurons + capped edges) per query, used by the glimpse, the render and the descriptors.

const SIG_N = 0.22; // neuron splat radius
const SIG_E = 0.12; // wire thickness
const INV2_N = 1 / (2 * SIG_N * SIG_N);
const INV2_E = 1 / (2 * SIG_E * SIG_E);

/** The self-portrait at a 3-D point -> [density in [0,1), hue in [0,1]] from the BUILT
 *  substrate's connection strengths (density) + activation types (hue). */
export function substrateFieldAt(p: Phenotype, x: number, y: number, z: number, out: [number, number] = [0, 0]): [number, number] {
  const pos = p.pos;
  const N = p.inFrom.length;
  let d = 0, h = 0, hw = 0;
  for (let i = 0; i < N; i++) {
    const s = p.strength[i]!;
    if (s <= 1e-9) continue;
    const ex = x - pos[i * 3]!, ey = y - pos[i * 3 + 1]!, ez = z - pos[i * 3 + 2]!;
    const g = s * Math.exp(-(ex * ex + ey * ey + ez * ez) * INV2_N);
    d += g;
    h += p.act[i]! * INV_ACT_MAX * g;
    hw += g;
  }
  const fe = p.fieldEdges;
  for (let k = 0; k < fe.length; k++) {
    const e = p.edges[fe[k]!]!;
    const ax = pos[e.from * 3]!, ay = pos[e.from * 3 + 1]!, az = pos[e.from * 3 + 2]!;
    const bx = pos[e.to * 3]!, by = pos[e.to * 3 + 1]!, bz = pos[e.to * 3 + 2]!;
    const vx = bx - ax, vy = by - ay, vz = bz - az;
    const wx = x - ax, wy = y - ay, wz = z - az;
    const vv = vx * vx + vy * vy + vz * vz + 1e-9;
    let t = (wx * vx + wy * vy + wz * vz) / vv;
    t = t < 0 ? 0 : t > 1 ? 1 : t; // nearest point on the segment
    const dx = wx - t * vx, dy = wy - t * vy, dz = wz - t * vz;
    const wmag = Math.abs(e.weight);
    const g = wmag * Math.exp(-(dx * dx + dy * dy + dz * dz) * INV2_E);
    d += g;
    h += 0.5 * (p.act[e.from]! + p.act[e.to]!) * INV_ACT_MAX * g;
    hw += g;
  }
  out[0] = 1 - Math.exp(-d); // density ∈ [0,1), saturating — robust to weight scale
  out[1] = hw > 1e-9 ? h / hw : 0.5; // hue ∈ [0,1] (activation character)
  return out;
}

// Reusable evaluation scratch (grows as needed) — the rollout is hot.
let val = new Float32Array(64);
let prev = new Float32Array(64);
/** Per-edge Hebbian trace scratch (one rollout's worth; reset per query). */
let hebb = new Float32Array(256);
/** Stability fix — BOUND the recurrent state to a finite range each step (BIBO-stable, so a
 *  long autoregressive write can't diverge to ±Infinity → NaN; healthy creatures never
 *  approach it). Any NaN collapses to 0. */
const STATE_BOUND = 1e6;
const bounded = (x: number): number => (x > STATE_BOUND ? STATE_BOUND : x < -STATE_BOUND ? -STATE_BOUND : x === x ? x : 0);

/** ONE synchronous propagation step — forward edges (`src < i`, this step) + recurrent /
 *  self / lateral edges (`src ≥ i`, the PREVIOUS step via `prev`). Inputs held in
 *  `val[0..SUB_INPUTS)`. When `plastic`, the effective weight is `w + α·trace` (a bounded
 *  decaying Hebbian EMA). When `neuromod`, each synapse's learning rate is gated by
 *  (1 + g·m(t)), where m(t) is the m OUTPUT NEURON's previous-step (fan-in-mean) activation. */
function stepSubstrate(p: Phenotype, N: number, outStart: number, plastic: boolean, neuromod: boolean): void {
  prev.set(val.subarray(0, N));
  const eta = HYPER.hebbianRate;
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

// --- ATTENTION / GLIMPSE (RAM, evolved hard attention — SPHERICAL / volumetric) ---
//
// Each READ step the brain emits a SPHERICAL FIXATION (radius r, polar θ, azimuth φ) + a
// scale from its own output neurons — it picks a radius + direction INTO the volume, the
// natural geometry for its roughly-spherical self-portrait — and takes a FOVEATED glimpse (a
// fine fovea + a coarse periphery 3-D neighbourhood) of the network-depiction at that point.
// The glimpse feeds the recurrent state and the brain chooses where to look next, attending
// in depth + direction. OFF at birth (the fix output neurons unwired ⇒ a fixed spherical
// scan), arising by mutation.

/** A foveated glimpse's 3-D unit offsets: centre + 6 axes + 8 cube-corners. */
const GLIMPSE_BALL: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [0.577, 0.577, 0.577], [-0.577, 0.577, 0.577], [0.577, -0.577, 0.577], [0.577, 0.577, -0.577],
  [-0.577, -0.577, 0.577], [-0.577, 0.577, -0.577], [0.577, -0.577, -0.577], [-0.577, -0.577, -0.577],
];
let gxBuf = new Float32Array(0), gyBuf = new Float32Array(0), gzBuf = new Float32Array(0), gvalBuf = new Float32Array(0);
// Structural-write scratch (grown to the caps): node (act, bias) + conn (from, to, weight, enabled).
let emActBuf = new Uint8Array(0), emBiasBuf = new Float32Array(0);
let emFromBuf = new Int32Array(0), emToBuf = new Int32Array(0), emWeightBuf = new Float32Array(0), emEnBuf = new Uint8Array(0);
const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const fieldScratch: [number, number] = [0, 0];

/** A foveated 3-D glimpse at (fx,fy,fz) with zoom from `scale`: mean density + hue over a fine
 *  fovea ball and mean density over a coarse periphery ball. Writes [foveaDensity, foveaHue,
 *  peripheryDensity]. */
function glimpse(p: Phenotype, fx: number, fy: number, fz: number, scale: number, out: [number, number, number]): void {
  const zoom = 1 + 0.5 * scale; // scale ∈ [-1,1] (tanh) ⇒ zoom in (0.5×) or out (1.5×)
  const rFov = HYPER.glimpseFovea * zoom;
  const rPer = HYPER.glimpsePeriphery * zoom;
  let fovD = 0, fovH = 0, per = 0;
  for (const [ox, oy, oz] of GLIMPSE_BALL) {
    substrateFieldAt(p, fx + ox * rFov, fy + oy * rFov, fz + oz * rFov, fieldScratch);
    fovD += fieldScratch[0];
    fovH += fieldScratch[1];
    substrateFieldAt(p, fx + ox * rPer, fy + oy * rPer, fz + oz * rPer, fieldScratch);
    per += fieldScratch[0];
  }
  const inv = 1 / GLIMPSE_BALL.length;
  out[0] = fovD * inv;
  out[1] = fovH * inv;
  out[2] = per * inv;
}

export interface ReadResult {
  readonly gx: Float32Array;
  readonly gy: Float32Array;
  readonly gz: Float32Array;
  readonly gval: Float32Array;
  readonly ponder: number;
  readonly deviation: number;
  readonly halted: boolean;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The DEFAULT scan fixation for read step t of T — a SPHERICAL Fibonacci sweep: an even
 *  spiral of directions (θ, φ) over the sphere at a mid radius, so the default scan covers
 *  the whole 3-D self-portrait. The brain's attention adds a learned spherical DEVIATION
 *  (Δr, Δθ, Δφ) on top. Writes the base [r, θ, φ]. */
function scanFixation(t: number, T: number, out: [number, number, number]): void {
  const frac = (t + 0.5) / T;
  out[0] = 0.7; // base radius (the brain's Δr probes inward/outward)
  out[1] = Math.acos(1 - 2 * frac); // polar θ ∈ [0,π], evenly swept
  out[2] = t * GOLDEN; // azimuth φ — the golden-angle spiral
}
const clampR = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The READ / PONDER phase (RAM-style evolved 3-D attention). The brain reads its self-portrait
 *  by taking up to `ponderMaxSteps` foveated GLIMPSES, building its recurrent + Hebbian state
 *  WITHOUT emitting. Each step: fixation = a default helical SCAN + a learned 3-D DEVIATION read
 *  off the brain's fixX/fixY/fixZ/fixScale OUTPUT NEURONS (off at birth ⇒ a pure scan); a
 *  foveated 3-D glimpse [fovea density, fovea hue, periphery density] is fed to the inputs; one
 *  recurrent step runs; the halt OUTPUT NEURON accumulates an ACT signal (stop when it crosses
 *  1.0, else the hard cap). `noDeviation` clamps the gaze to the pure scan (attention ablation). */
export function readPonderEmit(p: Phenotype, noDeviation = false): ReadResult {
  const N = p.inFrom.length;
  if (val.length < N) { val = new Float32Array(N); prev = new Float32Array(N); }
  const outStart = N - SUB_OUTPUTS;
  const runPlastic = p.hasPlastic;
  const runNeuromod = runPlastic && p.hasNeuromod;
  if (runPlastic) {
    if (hebb.length < p.edgeTotal) hebb = new Float32Array(p.edgeTotal);
    hebb.fill(0, 0, p.edgeTotal);
  }
  val.fill(0, 0, N);
  const cap = Math.max(1, Math.round(HYPER.ponderMaxSteps));
  if (gxBuf.length < cap) { gxBuf = new Float32Array(cap); gyBuf = new Float32Array(cap); gzBuf = new Float32Array(cap); gvalBuf = new Float32Array(cap); }
  const gx = gxBuf, gy = gyBuf, gz = gzBuf, gval = gvalBuf;
  const gv: [number, number, number] = [0, 0, 0];
  const sc: [number, number, number] = [0, 0, 0];
  let devR = 0, devTheta = 0, devPhi = 0, devScale = 0; // SPHERICAL deviation (0 ⇒ attention off)
  let deviation = 0, cumHalt = 0, ponder = 0, halted = false;
  for (let t = 0; t < cap; t++) {
    scanFixation(t, cap, sc); // sc = base [r, θ, φ]
    const r = clampR(sc[0]! + devR), th = sc[1]! + devTheta, ph = sc[2]! + devPhi;
    const st = Math.sin(th);
    const fx = r * st * Math.cos(ph), fy = r * st * Math.sin(ph), fz = r * Math.cos(th);
    glimpse(p, fx, fy, fz, devScale, gv);
    gx[t] = fx; gy[t] = fy; gz[t] = fz; gval[t] = gv[0]!;
    // READ-mode inputs: the 3-D glimpse (fovea density, fovea hue, periphery density), no prev
    // value, READ mode (0), bias (1).
    val[0] = gv[0]!; val[1] = gv[1]!; val[2] = gv[2]!; val[3] = 0; val[4] = 0; val[5] = 1;
    stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
    if (!noDeviation && p.hasAttention) {
      devR = Math.tanh(val[outStart + O_FIXR]! * p.outScale[O_FIXR]!) * 0.5; // ±0.5 radial
      devTheta = Math.tanh(val[outStart + O_FIXTHETA]! * p.outScale[O_FIXTHETA]!) * (Math.PI / 2);
      devPhi = Math.tanh(val[outStart + O_FIXPHI]! * p.outScale[O_FIXPHI]!) * Math.PI;
      devScale = Math.tanh(val[outStart + O_FIXSCALE]! * p.outScale[O_FIXSCALE]!);
    }
    const dv = Math.sqrt(devR * devR + devTheta * devTheta + devPhi * devPhi);
    if (dv > deviation) deviation = dv;
    ponder = t + 1;
    if (p.hasHalt) {
      const haltSig = Math.tanh(val[outStart + O_HALT]! * p.outScale[O_HALT]!);
      if (haltSig > 0) cumHalt += haltSig;
      if (cumHalt >= 1) { halted = true; break; }
    }
  }
  return { gx: gx.slice(0, ponder), gy: gy.slice(0, ponder), gz: gz.slice(0, ponder), gval: gval.slice(0, ponder), ponder, deviation, halted };
}

// --- The STRUCTURAL WRITER (von Neumann self-reproduction of the genome graph) ---
//
// After the READ, the brain WRITES its DNA as a GRAPH, from its own OUTPUT NEURONS, in two
// autoregressive phases. NODE phase: it emits node genes — a CATEGORICAL activation type
// (argmax of the logit bank) + a real bias — until its node-end signal (ACT) fires (deciding
// #nodes). CONN phase: it emits connection genes — from/to node-slot pointers (the TOPOLOGY)
// + a real weight + an enabled bit — until its conn-end fires (deciding #connections). Each
// step is fed its own previous real output (autoregressive). No CPPN re-projection, no length
// or structure given. Off at birth (the writer neurons unwired) ⇒ a constant graph that never
// halts ⇒ predict-the-mean ⇒ skill 0. DNA′ is then scored against DNA gene-for-gene (structural.ts).

/** The brain READS its self-portrait then AUTOREGRESSIVELY WRITES its DNA GRAPH, deciding its
 *  own structure size. `noDeviation` clamps the read to the pure spherical scan (ablation). */
export function selfWriteStructural(p: Phenotype, noDeviation = false): EmittedGenome {
  const r = readPonderEmit(p, noDeviation); // READ — leaves the recurrent state in `val`
  const N = p.inFrom.length;
  const outStart = N - SUB_OUTPUTS;
  const runPlastic = p.hasPlastic;
  const runNeuromod = runPlastic && p.hasNeuromod;
  const nodeCap = Math.max(1, Math.round(HYPER.nodeMaxLen));
  const connCap = Math.max(1, Math.round(HYPER.emitMaxLen));
  if (emActBuf.length < nodeCap) { emActBuf = new Uint8Array(nodeCap); emBiasBuf = new Float32Array(nodeCap); }
  if (emFromBuf.length < connCap) { emFromBuf = new Int32Array(connCap); emToBuf = new Int32Array(connCap); emWeightBuf = new Float32Array(connCap); emEnBuf = new Uint8Array(connCap); }

  // NODE PHASE — emit (activation type, bias) until node-end fires.
  const invN = 1 / nodeCap;
  let prevReal = 0, cumNodeEnd = 0, nodeLen = nodeCap, nodeHalted = false;
  for (let t = 0; t < nodeCap; t++) {
    val[0] = 0; val[1] = t * invN; val[2] = 0; val[3] = prevReal; val[4] = 1; val[5] = 1; // phase 0 = NODE
    stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
    let bestA = 0, bestV = -Infinity; // categorical activation: argmax of the (fan-in-scaled) logits
    for (let k = 0; k < ACTIVATION_COUNT; k++) {
      const off = O_ACT0 + k;
      const v = val[outStart + off]! * p.outScale[off]!;
      if (v > bestV) { bestV = v; bestA = k; }
    }
    emActBuf[t] = bestA;
    const bv = sig(val[outStart + O_BIAS]! * p.outScale[O_BIAS]!);
    emBiasBuf[t] = bv; prevReal = bv;
    if (!nodeHalted) {
      const ne = Math.tanh(val[outStart + O_NODE_END]! * p.outScale[O_NODE_END]!);
      if (ne > 0) cumNodeEnd += ne;
      if (cumNodeEnd >= 1) { nodeLen = t + 1; nodeHalted = true; }
    }
  }

  // CONN PHASE — slots index the full node list: inputs (CPPN_INPUTS) + the emitted nodes.
  const slotSpan = Math.max(1, CPPN_INPUTS + nodeLen - 1);
  const invC = 1 / connCap;
  prevReal = 0;
  let cumConnEnd = 0, connLen = connCap, connHalted = false;
  for (let t = 0; t < connCap; t++) {
    val[0] = 0; val[1] = t * invC; val[2] = 1; val[3] = prevReal; val[4] = 1; val[5] = 1; // phase 1 = CONN
    stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
    emFromBuf[t] = Math.round(sig(val[outStart + O_FROM]! * p.outScale[O_FROM]!) * slotSpan);
    emToBuf[t] = Math.round(sig(val[outStart + O_TO]! * p.outScale[O_TO]!) * slotSpan);
    const wv = sig(val[outStart + O_WEIGHT]! * p.outScale[O_WEIGHT]!);
    emWeightBuf[t] = wv; prevReal = wv;
    emEnBuf[t] = sig(val[outStart + O_ENABLED]! * p.outScale[O_ENABLED]!) > 0.5 ? 1 : 0;
    if (!connHalted) {
      const ce = Math.tanh(val[outStart + O_CONN_END]! * p.outScale[O_CONN_END]!);
      if (ce > 0) cumConnEnd += ce;
      if (cumConnEnd >= 1) { connLen = t + 1; connHalted = true; }
    }
  }

  return {
    act: emActBuf.slice(0, nodeCap), bias: emBiasBuf.slice(0, nodeCap),
    from: emFromBuf.slice(0, connCap), to: emToBuf.slice(0, connCap),
    weight: emWeightBuf.slice(0, connCap), enabled: emEnBuf.slice(0, connCap),
    nodeLen, connLen, nodeRun: nodeCap, connRun: connCap, ponder: r.ponder, deviation: r.deviation,
  };
}

// --- Accessors for visualisation --------------------------------------------

export interface SubNode {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly role: 'in' | 'hidden' | 'out';
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
