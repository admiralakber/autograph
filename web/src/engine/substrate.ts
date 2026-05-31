import { SUB_INPUTS, SUB_OUTPUTS } from './arch.ts';
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
  /** v6: per-node cumulative incoming-edge offset into the flat plastic trace,
   *  and the total edge count (the trace scratch size). */
  readonly edgeBase: Int32Array;
  readonly edgeTotal: number;
  /** v6: true if any |α| is meaningfully nonzero — gates the plastic rollout so a
   *  non-plastic creature pays nothing for machinery it doesn't use (the v5 path). */
  readonly hasPlastic: boolean;
  /** Flat expressed-edge list (for the network visualisation). */
  readonly edges: ReadonlyArray<{ readonly from: number; readonly to: number; readonly weight: number }>;
  /** Count of expressed connections — the phenotype's edge count for readouts. */
  readonly liveConns: number;
  /** True if any wired edge is recurrent/lateral (source index ≥ target). Only such
   *  creatures need the full T-step temporal rollout; feed-forward-only ones settle
   *  in 2 steps exactly as in v5 (a perf-aware, behaviour-identical fast path). */
  readonly hasRecurrent: boolean;
}

const o2: [number, number] = [0, 0];
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
  const idOf = new Map<string, number>();

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
    // The CPPN chooses each hidden neuron's activation + bias at its own coordinate.
    const r = evalCompiled(cc, c[0], c[1], c[2], c[0], c[1], c[2], o2);
    const t = r[0] * 0.5 + 0.5;
    act[idx] = Math.max(0, Math.min(ACTIVATION_COUNT - 1, Math.floor((((t % 1) + 1) % 1) * ACTIVATION_COUNT)));
    bias[idx] = r[1];
    idx++;
  }
  for (const c of outputs) {
    place(c, idx);
    act[idx] = HUE_ACT;
    bias[idx] = evalCompiled(cc, c[0], c[1], c[2], c[0], c[1], c[2], o2)[1];
    idx++;
  }

  // Wire incoming lists from the expressed connections (skip any unmapped end).
  const inSrc: number[][] = Array.from({ length: N }, () => []);
  const inWt: number[][] = Array.from({ length: N }, () => []);
  const inAl: number[][] = Array.from({ length: N }, () => []);
  const edges: { from: number; to: number; weight: number }[] = [];
  for (const c of grown.conns) {
    const a = idOf.get(coordKey(c.from[0], c.from[1], c.from[2]));
    const b = idOf.get(coordKey(c.to[0], c.to[1], c.to[2]));
    if (a === undefined || b === undefined || a === b) continue;
    inSrc[b]!.push(a);
    inWt[b]!.push(c.weight);
    inAl[b]!.push(c.alpha);
    edges.push({ from: a, to: b, weight: c.weight });
  }

  const inFrom = inSrc.map((s) => Int32Array.from(s));
  const inW = inWt.map((w) => Float32Array.from(w));
  const inAlpha = inAl.map((a) => Float32Array.from(a));
  // Recurrent/lateral = a wired source whose index is ≥ the target's: it reads the
  // previous step, so it only does real work once the rollout runs > 1 step.
  // Per-node edge offsets (for the flat plastic trace) + the plastic gate.
  const edgeBase = new Int32Array(N);
  let edgeTotal = 0;
  let hasRecurrent = false;
  let hasPlastic = false;
  for (let i = 0; i < N; i++) {
    edgeBase[i] = edgeTotal;
    const f = inFrom[i]!;
    const al = inAlpha[i]!;
    edgeTotal += f.length;
    for (let k = 0; k < f.length; k++) {
      if (f[k]! >= i) hasRecurrent = true;
      if (al[k]! > 1e-3 || al[k]! < -1e-3) hasPlastic = true;
    }
  }
  return { pos, hiddenCount: H, act, bias, inFrom, inW, inAlpha, edgeBase, edgeTotal, edges, liveConns: edges.length, hasRecurrent, hasPlastic };
}

// Reusable evaluation scratch (grows as needed) — substrateForward is hot.
let val = new Float32Array(64);
let prev = new Float32Array(64);
/** v6 per-edge Hebbian trace scratch (one rollout's worth; reset per query). */
let hebb = new Float32Array(256);
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
 *  the α coefficients are EVOLVED, painted by the CPPN, not back-propagated). */
function stepSubstrate(p: Phenotype, N: number, outStart: number, plastic: boolean): void {
  prev.set(val.subarray(0, N));
  const eta = HYPER.hebbianRate;
  for (let i = SUB_INPUTS; i < N; i++) {
    const from = p.inFrom[i]!;
    const w = p.inW[i]!;
    let s = p.bias[i]!;
    if (plastic) {
      const al = p.inAlpha[i]!;
      const base = p.edgeBase[i]!;
      for (let k = 0; k < from.length; k++) {
        const src = from[k]!;
        const pre = src >= i ? prev[src]! : val[src]!;
        s += pre * (w[k]! + al[k]! * hebb[base + k]!);
      }
      const post = i >= outStart ? s : activate(p.act[i]!, s);
      val[i] = post;
      for (let k = 0; k < from.length; k++) {
        const src = from[k]!;
        const pre = src >= i ? prev[src]! : val[src]!;
        const t = base + k;
        hebb[t] = (1 - eta) * hebb[t]! + eta * pre * post;
      }
    } else {
      for (let k = 0; k < from.length; k++) {
        const src = from[k]!;
        s += (src >= i ? prev[src]! : val[src]!) * w[k]!;
      }
      val[i] = i >= outStart ? s : activate(p.act[i]!, s);
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
 *  initial-state field; gated by `hasPlastic` so a non-plastic creature pays nothing. */
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
  if (runPlastic) {
    if (hebb.length < p.edgeTotal) hebb = new Float32Array(p.edgeTotal);
    hebb.fill(0, 0, p.edgeTotal); // each query is its own lifetime — start unlearned
  }
  const steps = p.hasRecurrent || runPlastic ? rolloutSteps() : FF_STEPS;
  for (let step = 0; step < steps; step++) stepSubstrate(p, N, outStart, runPlastic);
  let d = 0;
  let h = 0;
  if (outStart < N) d = val[outStart]!;
  if (outStart + 1 < N) h = val[outStart + 1]!;
  out[0] = 1 / (1 + Math.exp(-1.3 * d)); // density (alpha)
  out[1] = (Math.sin(h * 1.4) + 1) * 0.5; // hue
  return out;
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
