import { SUB_INPUTS, SUB_OUTPUTS, CPPN_OUTPUTS } from './arch.ts';
import type { Genome } from './cppn.ts';
import { compileCPPN, evalCompiled } from './cppn.ts';
import { activate, ACTIVATION_COUNT } from './activations.ts';
import { growSubstrate, coordKey } from './eshyperneat.ts';
import type { Vec3 } from './eshyperneat.ts';
import { HYPER } from './hyperparams.ts';

// The PHENOTYPE: a HyperNEAT substrate whose hidden neurons are PLACED, made
// DENSE, and WIRED by genuine ES-HyperNEAT (eshyperneat.ts) — no fixed/uniform
// grid. The CPPN paints every connection weight from the two endpoints' 3-D
// coordinates and supplies each neuron's bias (its second output channel, read
// at (p,p)) and each hidden neuron's activation (heterogeneous — an Autograph
// extension beyond standard ES-HyperNEAT, which keeps the fields beautiful).
// Queried over 3-D space the network outputs a density and a hue: the volumetric
// image the creature is born in. (Placement is the algorithm's native 2-D sheet at
// z = 0; the IMAGE is 3-D because the query coordinate sweeps the volume.)

// 5 fixed input *sensor* neurons (x, y, z, r, bias) on a ring at the z = −1 layer.
const INPUT_POS: Vec3[] = (() => {
  const p: Vec3[] = [];
  for (let i = 0; i < SUB_INPUTS; i++) {
    const a = (i / SUB_INPUTS) * Math.PI * 2;
    p.push([Math.cos(a) * 0.7, Math.sin(a) * 0.7, -1]);
  }
  return p;
})();

// 2 fixed output neurons (density, hue) at the z = +1 layer.
const OUTPUT_POS: Vec3[] = [
  [-0.35, 0, 1],
  [0.35, 0, 1],
];

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
  /** Node coordinates, laid out [inputs(5)] ++ [hidden(H)] ++ [outputs(2)]. */
  readonly pos: Float32Array; // nodeCount * 3
  readonly hiddenCount: number;
  /** Activation id per node (inputs/outputs linear; hidden heterogeneous). */
  readonly act: Uint8Array;
  /** Per-node bias (inputs 0; hidden + outputs painted by the CPPN). */
  readonly bias: Float32Array;
  /** Per-node incoming source indices + weights (the wired ES-HyperNEAT graph). */
  readonly inFrom: Int32Array[];
  readonly inW: Float32Array[];
  /** v6: per-node incoming Hebbian plasticity coefficients α (parallel to inW).
   *  The effective weight during a plastic rollout is w + α·trace. */
  readonly inAlpha: Float32Array[];
  /** v6 Phase 3: per-node neuromod emission weight (inputs 0; hidden + outputs
   *  painted by the CPPN's `emit` channel). The brain's own modulatory signal is
   *  m(t) = tanh(mean over neurons of emit·activity) — "who emits". */
  readonly emit: Float32Array;
  /** v6 Phase 3: per-node incoming neuromodulation gates g (parallel to inAlpha) —
   *  how much m(t) modulates each synapse's Hebbian learning rate ("what it gates").
   *  Gated update: trace ← (1−η)·trace + η·(1 + g·m(t))·(pre·post). */
  readonly inModGate: Float32Array[];
  /** v6 Phase 4: per-node ATTENTION readout weights (inputs 0; hidden + outputs
   *  painted by the CPPN's fixX/fixY/fixScale channels). Each rollout step the brain
   *  emits a fixation from its own activity: fixⱼ = tanh(mean over neurons of
   *  fixⱼ-readout·activity), giving WHERE (fixX,fixY) + zoom (fixScale) to glimpse next. */
  readonly fixX: Float32Array;
  readonly fixY: Float32Array;
  readonly fixScale: Float32Array;
  /** v6 Phase 5: per-node halt readout (Adaptive Computation Time). The brain's halt
   *  signal each READ step is the rectified mean of halt·activity; accumulated, it
   *  decides "I've seen enough" → switch to WRITE. Off at birth (ponders to the cap). */
  readonly halt: Float32Array;
  /** v7: per-node AUTOREGRESSIVE WRITER readouts (painted by the CPPN's emitVal/emitEnd
   *  channels, read at (p,p) like halt). After the read, each WRITE step the brain emits
   *  `value = σ(mean of emitVal·activity)` (the next DNA element) and
   *  `end = mean of emitEnd·activity` (the end-of-sequence signal — when it fires the
   *  creature has DECIDED its length). NOT a CPPN re-projection: these are linear readouts
   *  of the brain's OWN recurrent activity, painted once at build. Off at birth. */
  readonly emitVal: Float32Array;
  readonly emitEnd: Float32Array;
  /** v6: per-node cumulative incoming-edge offset into the flat plastic trace,
   *  and the total edge count (the trace scratch size). */
  readonly edgeBase: Int32Array;
  readonly edgeTotal: number;
  /** v6: true if any |α| is meaningfully nonzero — gates the plastic rollout so a
   *  non-plastic creature pays nothing for machinery it doesn't use (the v5 path). */
  readonly hasPlastic: boolean;
  /** v6 Phase 3: true if plasticity is present AND some neuron emits AND some
   *  synapse is gated — only then does m(t) do real work, so a non-neuromodulated
   *  creature skips the m(t) computation entirely (a perf-aware fast path). */
  readonly hasNeuromod: boolean;
  /** v6 Phase 4: true if any attention readout is nonzero — i.e. the brain genuinely
   *  CHOOSES its fixation. Off at birth (a fixed centred glimpse, no roam); arises by
   *  mutation. */
  readonly hasAttention: boolean;
  /** v6 Phase 5: true if any halt readout is nonzero — i.e. the brain can choose to
   *  stop pondering early. Off at birth (ponders to the hard cap); arises by mutation. */
  readonly hasHalt: boolean;
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
const HUE_ACT = ACTIVATION_COUNT - 1; // outputs run linear (clamped identity)

/** Build the phenotype from the DNA via genuine ES-HyperNEAT: grow the substrate,
 *  then paint per-neuron biases + heterogeneous hidden activations from the CPPN. */
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
  const emit = new Float32Array(N); // v6 Phase 3: per-node neuromod emission (inputs stay 0)
  const fixX = new Float32Array(N); // v6 Phase 4: per-node attention readouts (inputs stay 0)
  const fixY = new Float32Array(N);
  const fixScale = new Float32Array(N);
  const halt = new Float32Array(N); // v6 Phase 5: per-node halt (ACT) readout (inputs stay 0)
  const emitVal = new Float32Array(N); // v7: per-node autoregressive writer readouts (inputs stay 0)
  const emitEnd = new Float32Array(N);
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
    // The CPPN chooses each hidden neuron's activation + bias + neuromod emission at
    // its own coordinate (one (p,p) query fills every channel).
    const r = evalCompiled(cc, c[0], c[1], c[2], c[0], c[1], c[2], o2);
    const t = r[0]! * 0.5 + 0.5;
    act[idx] = Math.max(0, Math.min(ACTIVATION_COUNT - 1, Math.floor((((t % 1) + 1) % 1) * ACTIVATION_COUNT)));
    bias[idx] = r[1]!;
    emit[idx] = Math.tanh(r[3]!); // v6 Phase 3: "who emits" m(t) — bounded to [-1,1]
    fixX[idx] = Math.tanh(r[5]!); // v6 Phase 4: attention readouts (where + zoom to glimpse)
    fixY[idx] = Math.tanh(r[6]!);
    fixScale[idx] = Math.tanh(r[7]!);
    halt[idx] = Math.tanh(r[8]!); // v6 Phase 5: halt (ACT) readout
    emitVal[idx] = Math.tanh(r[9]!); // v7: autoregressive writer readouts (next value + end signal)
    emitEnd[idx] = Math.tanh(r[10]!);
    idx++;
  }
  for (const c of outputs) {
    place(c, idx);
    act[idx] = HUE_ACT;
    const r = evalCompiled(cc, c[0], c[1], c[2], c[0], c[1], c[2], o2);
    bias[idx] = r[1]!;
    emit[idx] = Math.tanh(r[3]!);
    fixX[idx] = Math.tanh(r[5]!);
    fixY[idx] = Math.tanh(r[6]!);
    fixScale[idx] = Math.tanh(r[7]!);
    halt[idx] = Math.tanh(r[8]!);
    emitVal[idx] = Math.tanh(r[9]!);
    emitEnd[idx] = Math.tanh(r[10]!);
    idx++;
  }

  // Wire incoming lists from the expressed connections (skip any unmapped end).
  const inSrc: number[][] = Array.from({ length: N }, () => []);
  const inWt: number[][] = Array.from({ length: N }, () => []);
  const inAl: number[][] = Array.from({ length: N }, () => []);
  const inMg: number[][] = Array.from({ length: N }, () => []); // v6 Phase 3 modGate
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
  // Recurrent/lateral = a wired source whose index is ≥ the target's: it reads the
  // previous step, so it only does real work once the rollout runs > 1 step.
  // Per-node edge offsets (for the flat plastic trace) + the plastic gate.
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
  // Neuromodulation does real work only if plasticity exists AND a neuron emits the
  // signal AND a synapse is gated — otherwise m(t)≡0 or the gate is closed and the
  // update reduces to Phase 2 exactly, so we can skip the m(t) computation.
  let anyEmit = false;
  for (let i = SUB_INPUTS; i < N; i++) if (emit[i]! > 1e-3 || emit[i]! < -1e-3) { anyEmit = true; break; }
  const hasNeuromod = hasPlastic && anyEmit && anyModGate;
  // v6 Phase 4: the brain genuinely CHOOSES its fixation only if some attention
  // readout is nonzero; otherwise every step glimpses the centre (attention off).
  let hasAttention = false;
  for (let i = SUB_INPUTS; i < N && !hasAttention; i++) {
    if (Math.abs(fixX[i]!) > 1e-3 || Math.abs(fixY[i]!) > 1e-3 || Math.abs(fixScale[i]!) > 1e-3) hasAttention = true;
  }
  let hasHalt = false;
  for (let i = SUB_INPUTS; i < N && !hasHalt; i++) if (Math.abs(halt[i]!) > 1e-3) hasHalt = true;
  return { pos, hiddenCount: H, act, bias, inFrom, inW, inAlpha, emit, inModGate, fixX, fixY, fixScale, halt, emitVal, emitEnd, edgeBase, edgeTotal, edges, liveConns: edges.length, hasRecurrent, hasPlastic, hasNeuromod, hasAttention, hasHalt };
}

// Reusable evaluation scratch (grows as needed) — substrateForward is hot.
let val = new Float32Array(64);
let prev = new Float32Array(64);
/** v6 per-edge Hebbian trace scratch (one rollout's worth; reset per query). */
let hebb = new Float32Array(256);
/** v7 stability fix — BOUND the recurrent state to a finite range each step. The brain
 *  has unbounded activations (relu/identity/abs/bent) + LINEAR outputs, recurrent/self
 *  edges, and a Hebbian term (w + α·trace) that can amplify; over the long autoregressive
 *  WRITE (up to `emitMaxLen` steps) this can diverge to ±Infinity, and `emitVal·Infinity`
 *  (or Infinity−Infinity) then yields NaN — which propagated through the read-out into a
 *  NaN skill. Bounding the state is the ROOT fix: it makes the dynamical system BIBO-stable
 *  so no Infinity/NaN can ever arise. The clamp is generous (it only bites genuine
 *  divergence — healthy creatures never approach it, so their numbers are unchanged); any
 *  NaN that somehow appears collapses to 0. The skill metric + UI also guard defensively. */
const STATE_BOUND = 1e6;
const bounded = (x: number): number => (x > STATE_BOUND ? STATE_BOUND : x < -STATE_BOUND ? -STATE_BOUND : x === x ? x : 0);
/** v5 settle depth — also the feed-forward fast path (a feed-forward-only network
 *  reaches its fixed point in one step; a second confirms it), kept identical so
 *  such creatures are byte-for-byte unchanged from v5. */
const FF_STEPS = 2;
/** T — the v6 temporal forward pass budget (recurrent / plastic creatures only). */
const rolloutSteps = (): number => Math.max(1, Math.round(HYPER.substrateSteps));

/** ONE synchronous propagation step — the reusable temporal-pass primitive. Each
 *  non-input node recomputes from its forward edges (`src < i`, this step's values,
 *  so a feed-forward chain settles within the step) and its recurrent / self /
 *  lateral edges (`src ≥ i`, the PREVIOUS step's values, via `prev`). Inputs are
 *  held in `val[0..SUB_INPUTS)` and never overwritten, so later phases can vary
 *  them per step (glimpse inputs) while the recurrent state carries forward.
 *
 *  When `plastic`, the effective weight is `w + α·trace` and each edge's Hebbian
 *  trace self-modifies — a bounded decaying EMA of pre·post — so the brain LEARNS
 *  toward self-knowledge across the rollout (differentiable-plasticity form, but
 *  the α coefficients are EVOLVED, painted by the CPPN, not back-propagated).
 *
 *  When `neuromod`, the brain ALSO emits its own signal m(t) = tanh(mean of
 *  emit·activity over the previous step) and gates each synapse's learning rate by
 *  (1 + g·m(t)) — the Backpropamine form (EVOLVED, intrinsic: no separate network,
 *  m is computed from the creature's own activity). g and m are 0 at birth, so this
 *  reduces to the Phase 2 update exactly until neuromodulation arises by mutation. */
function stepSubstrate(p: Phenotype, N: number, outStart: number, plastic: boolean, neuromod: boolean): void {
  prev.set(val.subarray(0, N));
  const eta = HYPER.hebbianRate;
  // The network-emitted neuromodulatory signal m(t), from the creature's OWN
  // activity last step (one-step lag ⇒ a stable, retroactive modulator). 0 unless
  // neuromodulation is active, so the gated update below collapses to Phase 2.
  let m = 0;
  if (neuromod) {
    const emit = p.emit;
    let acc = 0;
    for (let i = SUB_INPUTS; i < N; i++) acc += emit[i]! * prev[i]!;
    m = Math.tanh(acc / Math.max(1, N - SUB_INPUTS));
  }
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
        // Neuromodulated learning rate: (1 + g·m). g=0 or m=0 ⇒ the Phase 2 update.
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

/** Query the phenotype at a 3-D point -> [density in [0,1], hue in [0,1]] via the
 *  v6 TEMPORAL FORWARD PASS: roll the substrate out for T synchronous steps so the
 *  recurrent / self / lateral edges the genome already evolves do real work. A
 *  feed-forward-only, non-plastic creature converges in `FF_STEPS` and is unchanged
 *  from v5; only recurrent / plastic creatures pay the full T steps. Inputs are the
 *  sensor features [x, y, z, r=|p|, bias], held constant across the rollout in this
 *  phase. `plastic` enables Hebbian self-modification (the creature's lifetime read,
 *  e.g. the loop) — it is OFF for the displayed render, which stays the static
 *  initial-state field; gated by `hasPlastic` so a non-plastic creature pays nothing.
 *  When the creature also evolves neuromodulation (`hasNeuromod`), the brain's own
 *  emitted signal m(t) gates that self-modification (Phase 3); otherwise the m(t)
 *  computation is skipped entirely. */
export function substrateForward(p: Phenotype, px: number, py: number, pz: number, out: [number, number] = [0, 0], plastic = false): [number, number] {
  const N = p.inFrom.length;
  if (val.length < N) {
    val = new Float32Array(N);
    prev = new Float32Array(N);
  }
  val[0] = px;
  val[1] = py;
  val[2] = pz;
  val[3] = Math.sqrt(px * px + py * py + pz * pz);
  val[4] = 1;
  const outStart = N - SUB_OUTPUTS;
  for (let i = SUB_INPUTS; i < N; i++) val[i] = 0; // clear stale carryover from prior calls
  const runPlastic = plastic && p.hasPlastic;
  const runNeuromod = runPlastic && p.hasNeuromod; // m(t) only matters with plasticity to gate
  if (runPlastic) {
    if (hebb.length < p.edgeTotal) hebb = new Float32Array(p.edgeTotal);
    hebb.fill(0, 0, p.edgeTotal); // each query is its own lifetime — start unlearned
  }
  const steps = p.hasRecurrent || runPlastic ? rolloutSteps() : FF_STEPS;
  for (let step = 0; step < steps; step++) stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
  let d = 0;
  let h = 0;
  if (outStart < N) d = val[outStart]!;
  if (outStart + 1 < N) h = val[outStart + 1]!;
  out[0] = 1 / (1 + Math.exp(-1.3 * d)); // density (alpha)
  out[1] = (Math.sin(h * 1.4) + 1) * 0.5; // hue
  return out;
}

// --- v6 Phase 4: ATTENTION / GLIMPSE (RAM, evolved hard attention) ----------
//
// Each rollout step the brain emits a FIXATION (location + scale) from its OWN
// activity (the CPPN-painted fixX/fixY/fixScale readouts) and takes a FOVEATED
// glimpse — a fine fovea + a coarse periphery — of its STATIC image at that
// fixation. The glimpse feeds the recurrent state and the brain chooses where to
// look next. Evolution handles the non-differentiable location choice natively (no
// REINFORCE); attention is INTRINSIC (no separate net) and OFF at birth (readouts 0
// ⇒ a fixed centred glimpse, no roam), arising by mutation like α / neuromod.
//
// The image is rendered to a grid ONCE (the static initial-state field); the glimpses
// then only interpolate it — so the brain reads a FIXED image, never a moving target.
// These glimpses ARE the v7 read sensors: the recurrent state they build is what the
// autoregressive writer (selfWrite) writes the DNA from — so attention is load-bearing
// (a fixed-scan ablation measurably changes the result). (The one-off grid render is the
// heavy part — a future perf pass can cache / parallelise it.)

/** A foveated glimpse's unit offsets: centre + an 8-point ring, scaled by radius. */
const GLIMPSE_RING: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [0.71, 0.71], [0, 1], [-0.71, 0.71], [-1, 0], [-0.71, -0.71], [0, -1], [0.71, -0.71],
];
let gridBuf = new Float32Array(0); // reused static-image grid scratch
// PERF #3: reused glimpse-path scratch (grown to the ponder cap) — no per-step or
// per-eval cap-sized allocation; readPonderEmit returns small ponder-sized slices.
let gxBuf = new Float32Array(0), gyBuf = new Float32Array(0), gvalBuf = new Float32Array(0);
/** v7 reused autoregressive-write scratch (grown to the emit cap). */
let emitBuf = new Float32Array(0);
const sig = (x: number): number => 1 / (1 + Math.exp(-x));

/** Render the creature's STATIC density image to a res×res grid on the z=0 sheet —
 *  the field the attention glimpses read (plastic=false ⇒ the initial-state image). */
function renderImageGrid(p: Phenotype, res: number): Float32Array {
  if (gridBuf.length < res * res) gridBuf = new Float32Array(res * res);
  const gout: [number, number] = [0, 0];
  const inv = 2 / (res - 1);
  for (let yi = 0; yi < res; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < res; xi++) gridBuf[yi * res + xi] = substrateForward(p, xi * inv - 1, y, 0, gout, false)[0];
  }
  return gridBuf;
}

/** Bilinear sample of the image grid at (x,y) ∈ [-1,1]² (clamped to the border). */
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

/** A foveated glimpse at (fx,fy) with zoom from `scale`: mean density over a fine
 *  fovea ring and a coarse periphery ring (RAM's multi-resolution glimpse). */
function glimpse(grid: Float32Array, res: number, fx: number, fy: number, scale: number, out: [number, number]): void {
  const zoom = 1 + 0.5 * scale; // scale ∈ [-1,1] (tanh) ⇒ zoom in (0.5×) or out (1.5×)
  const rFov = HYPER.glimpseFovea * zoom;
  const rPer = HYPER.glimpsePeriphery * zoom;
  let fov = 0, per = 0;
  for (const [ox, oy] of GLIMPSE_RING) {
    fov += sampleGrid(grid, res, fx + ox * rFov, fy + oy * rFov);
    per += sampleGrid(grid, res, fx + ox * rPer, fy + oy * rPer);
  }
  out[0] = fov / GLIMPSE_RING.length;
  out[1] = per / GLIMPSE_RING.length;
}

export interface ReadResult {
  /** The fixation coordinates (z=0) the brain actually GLIMPSED, one per READ step
   *  (scan + the brain's chosen deviation). These are the attention-chosen "probes"
   *  the decode projects the image through — so attention is load-bearing. */
  readonly gx: Float32Array;
  readonly gy: Float32Array;
  /** The foveal density the brain saw at each fixation — what it projects to decode. */
  readonly gval: Float32Array;
  /** READ/ponder steps actually used (1..ponderMaxSteps) — variable, halt-controlled. */
  readonly ponder: number;
  /** Largest CHOSEN deviation from the default scan (0 ⇒ attention off — pure scan). */
  readonly deviation: number;
  /** True if the brain chose to halt before the hard cap (vs ran out the cap). */
  readonly halted: boolean;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The DEFAULT scan fixation for read step t of T — a Fibonacci sweep of the image
 *  disc. With attention OFF this is what the brain reads (an informative default, so
 *  the loop bootstraps); attention adds a learned DEVIATION on top (Phase 4). */
function scanFixation(t: number, T: number, out: [number, number]): void {
  const r = Math.sqrt((t + 0.5) / T) * 0.72;
  const a = t * GOLDEN;
  out[0] = Math.cos(a) * r;
  out[1] = Math.sin(a) * r;
}
const clampUnit = (x: number): number => (x < -1 ? -1 : x > 1 ? 1 : x);

/** v7 — the READ / PONDER phase (RAM-style evolved attention). The brain reads its own
 *  image by taking up to `ponderMaxSteps` foveated GLIMPSES, building its recurrent +
 *  Hebbian state WITHOUT emitting — the WRITE is `selfWrite`'s separate, decoupled phase.
 *  Each step:
 *    • fixation = a default Fibonacci SCAN position + a learned DEVIATION the brain emits
 *      from its own activity (attention — off at birth ⇒ a pure informative scan);
 *    • a FOVEATED glimpse (a fine fovea ring + a coarse periphery ring, not one pixel and
 *      not the whole image) of the static image at that fixation is fed in as the input;
 *    • one recurrent step runs (plasticity + neuromodulation active);
 *    • it reads WHERE to look next (fixX/fixY/fixScale) and accumulates a HALT signal —
 *      when that crosses 1.0 it has "seen enough" and stops, else the hard cap (ACT).
 *  So `ponder` = the number of glimpse steps (1..cap): in this architecture a glimpse step
 *  IS a ponder step — each is a look AND a think (ingest, never emit). `noDeviation` clamps
 *  the gaze to the pure scan (the attention ablation control). The glimpse coords/densities
 *  are returned for diagnostics; the recurrent state the read built (left in `val`) is what
 *  `selfWrite` then writes its DNA from. NO CPPN re-projection — v6's quine is gone. */
export function readPonderEmit(p: Phenotype, noDeviation = false): ReadResult {
  const N = p.inFrom.length;
  if (val.length < N) { val = new Float32Array(N); prev = new Float32Array(N); }
  const res = Math.max(2, Math.round(HYPER.glimpseRes));
  const grid = renderImageGrid(p, res); // uses val/prev internally — done BEFORE the rollout
  const outStart = N - SUB_OUTPUTS;
  const runPlastic = p.hasPlastic;
  const runNeuromod = runPlastic && p.hasNeuromod;
  if (runPlastic) {
    if (hebb.length < p.edgeTotal) hebb = new Float32Array(p.edgeTotal);
    hebb.fill(0, 0, p.edgeTotal);
  }
  val.fill(0, 0, N); // a fresh recurrent state for the read
  const cap = Math.max(1, Math.round(HYPER.ponderMaxSteps));
  const invD = 1 / Math.max(1, N - SUB_INPUTS);
  if (gxBuf.length < cap) { gxBuf = new Float32Array(cap); gyBuf = new Float32Array(cap); gvalBuf = new Float32Array(cap); }
  const gx = gxBuf, gy = gyBuf, gval = gvalBuf;
  const gv: [number, number] = [0, 0];
  const sc: [number, number] = [0, 0];
  let devX = 0, devY = 0, devScale = 0; // chosen deviation from the scan (0 ⇒ attention off)
  let deviation = 0, cumHalt = 0, ponder = 0, halted = false;
  for (let t = 0; t < cap; t++) {
    scanFixation(t, cap, sc);
    const fx = clampUnit(sc[0]! + devX), fy = clampUnit(sc[1]! + devY);
    glimpse(grid, res, fx, fy, devScale, gv);
    gx[t] = fx; gy[t] = fy; gval[t] = gv[0]!; // collect the chosen glimpse (coord + foveal density)
    val[0] = fx; val[1] = fy; val[2] = gv[0]!; val[3] = gv[1]!; val[4] = 1; // the glimpse IS the input
    stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
    let ax = 0, ay = 0, as = 0, hs = 0;
    for (let i = SUB_INPUTS; i < N; i++) { const a = val[i]!; ax += p.fixX[i]! * a; ay += p.fixY[i]! * a; as += p.fixScale[i]! * a; hs += p.halt[i]! * a; }
    if (!noDeviation) { devX = Math.tanh(ax * invD); devY = Math.tanh(ay * invD); devScale = Math.tanh(as * invD); }
    const d = Math.sqrt(devX * devX + devY * devY);
    if (d > deviation) deviation = d;
    ponder = t + 1;
    const haltSig = Math.tanh(hs * invD); // rectified ⇒ 0 when the halt channel is off
    if (haltSig > 0) cumHalt += haltSig;
    if (cumHalt >= 1) { halted = true; break; }
  }
  return { gx: gx.slice(0, ponder), gy: gy.slice(0, ponder), gval: gval.slice(0, ponder), ponder, deviation, halted };
}

// --- v7: the AUTOREGRESSIVE WRITER (the clean self-loop, no quine) -----------
//
// After the READ (readPonderEmit builds the recurrent state by glimpsing the image),
// the brain WRITES its DNA element by element FROM ITS OWN NEURONS: each step it is fed
// its own previous output (autoregressive), steps once (plasticity/neuromod stay active
// — it keeps learning as it writes), and reads `value = σ(mean emitVal·activity)` (the
// next gene) + `end = σ(mean emitEnd·activity)` (the halting signal). When `end` fires,
// the creature has DECIDED its own length. No CPPN re-projection, no per-gene coordinate
// lookup, no length given — v6's quine is gone. We run a bounded number of steps
// (`min(emitMaxLen, 2·G)`, ≥ G) and record where the end-signal first fired (`selfLen`),
// so a single rollout yields both the curriculum's teacher-length read (first G values)
// and the honest self-length read (first `selfLen`). Off at birth ⇒ a fresh creature
// writes a constant σ(0)=0.5 and never halts (runs to the cap) — predict-the-mean ⇒ skill 0.

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

/** v7 — the brain READS its image then AUTOREGRESSIVELY WRITES its DNA, deciding its own
 *  length. `G` is the genome's gene count (sets the teacher length + the run bound).
 *  `noDeviation` clamps the read to the pure scan (attention ablation control). */
export function selfWrite(p: Phenotype, G: number, noDeviation = false): WriteResult {
  const r = readPonderEmit(p, noDeviation); // READ — leaves the recurrent state in `val`
  const N = p.inFrom.length;
  const outStart = N - SUB_OUTPUTS;
  const runPlastic = p.hasPlastic;
  const runNeuromod = runPlastic && p.hasNeuromod;
  const cap = Math.max(1, Math.round(HYPER.emitMaxLen));
  const runLen = Math.min(cap, Math.max(1, 2 * G)); // ≥ G (teacher) + room to see over-length
  if (emitBuf.length < runLen) emitBuf = new Float32Array(runLen);
  const invD = 1 / Math.max(1, N - SUB_INPUTS);
  const invLen = 1 / Math.max(1, runLen);
  let prevVal = 0;
  let selfLen = runLen, halted = false;
  for (let t = 0; t < runLen; t++) {
    // WRITE-mode inputs: own previous output (autoregressive) + a mode flag + position.
    val[0] = prevVal; val[1] = 1; val[2] = t * invLen; val[3] = 0; val[4] = 1;
    stepSubstrate(p, N, outStart, runPlastic, runNeuromod);
    let ev = 0, ee = 0;
    for (let i = SUB_INPUTS; i < N; i++) { const a = val[i]!; ev += p.emitVal[i]! * a; ee += p.emitEnd[i]! * a; }
    const value = sig(ev * invD);
    emitBuf[t] = value;
    prevVal = value;
    if (!halted && sig(ee * invD) > 0.5) { selfLen = t + 1; halted = true; } // the creature DECIDES its length
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

/** A copy of the phenotype with hidden neuron `j` (0-based among hidden) silenced
 *  — its incoming and outgoing weights zeroed — for ablation receptive fields. */
export function ablateHidden(p: Phenotype, j: number): Phenotype {
  const target = SUB_INPUTS + j;
  const inFrom = p.inFrom.map((a) => a.slice());
  const inW = p.inW.map((a) => a.slice());
  // zero its incoming
  if (inW[target]) inW[target] = new Float32Array(inW[target]!.length);
  // zero its outgoing (it as a source in every other node's incoming list)
  for (let i = 0; i < inFrom.length; i++) {
    const f = inFrom[i]!;
    for (let k = 0; k < f.length; k++) if (f[k] === target) inW[i]![k] = 0;
  }
  return { ...p, inFrom, inW };
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
