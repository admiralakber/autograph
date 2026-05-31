import type { Compiled } from './cppn.ts';
import { evalCompiled } from './cppn.ts';

// GENUINE ES-HyperNEAT — Risi & Stanley, "An Enhanced Hypercube-Based Encoding
// for Evolving the Placement, Density, and Connectivity of Neurons" (2012;
// GECCO 2010). This is the real algorithm, not the old simplified placement:
// the CPPN encodes an infinite-resolution weight pattern over the substrate, and
// a QUADTREE decomposition of that pattern decides WHERE hidden neurons sit, how
// DENSE they are, and which connections express.
//
//   1. DivisionAndInitialization (Algorithm 1): recursively subdivide the unit
//      square, querying the CPPN at each quad centre; a quad keeps dividing while
//      its children's weight VARIANCE exceeds a division threshold (more neurons
//      where there is more information), bounded by initial/max depth.
//   2. PruningAndExtraction (Algorithm 2): traverse the tree; where variance is
//      low, apply BAND-PRUNING — express a connection only if the point sits in a
//      band (its weight differs from neighbours on at least one axis), measured
//      by max(min(dLeft,dRight), min(dTop,dBottom)) > bandThreshold.
//   3. ES-HyperNEAT (Algorithm 3): discover hidden neurons outward from the
//      inputs, iterate from the discovered hidden neurons (iterationLevel), tie
//      the substrate into the outputs by an inward search, then PRUNE any neuron
//      not on a path from an input to an output (cleanNet).
//
// Reference implementation cross-checked: ukuleleplayer/pureples es_hyperneat.py.
//
// Faithfulness + honest approximations (see hyperparams.ts):
//   • The quadtree explores a 2-D substrate sheet (the algorithm's native form);
//     the volumetric image is the resulting network's response swept over
//     3-D query space, so the picture is 3-D while placement is the real 2-D ES.
//   • A z "layer" coordinate (input −1, hidden 0, output +1) is fed to the CPPN
//     so it can distinguish layers — the standard layered-substrate convention.
//   • maxDepth / iterationLevel bound the quadtree resolution for browser real
//     time. The paper itself sets a maximum resolution rm; ours is just lower.
//   • maxHidden is a defensive cap (browser memory/throughput), not in the paper.

export interface EsParams {
  initialDepth: number;
  maxDepth: number;
  divisionThreshold: number;
  varianceThreshold: number;
  bandThreshold: number;
  iterationLevel: number;
  maxHidden: number;
  weightScale: number;
  /** v6: max magnitude of the per-connection Hebbian plasticity coefficient α
   *  (painted by the CPPN's 3rd output). Placement/expression are unchanged — they
   *  still follow the WEIGHT pattern; α is read at the same coordinate pair. */
  plasticityScale: number;
  /** v6 Phase 3: max magnitude of the per-connection neuromodulation gate g
   *  (painted by the CPPN's 5th output, read at the same coordinate pair as α/weight)
   *  — how much the brain's emitted signal m(t) gates this synapse's learning rate. */
  neuromodScale: number;
}

export type Vec3 = readonly [number, number, number];
export interface RawConn {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly weight: number;
  /** v6 Hebbian plasticity coefficient α (0 ⇒ a static synapse). */
  readonly alpha: number;
  /** v6 Phase 3 neuromodulation gate g (0 ⇒ this synapse's plasticity is ungated). */
  readonly modGate: number;
}
export interface SubstrateGraph {
  /** Discovered hidden-neuron coordinates (on the z = 0 sheet). */
  readonly hidden: Vec3[];
  /** Expressed connections (coordinate space), already pruned of dead ends. */
  readonly conns: RawConn[];
}

const HIDDEN_Z = 0;
const o2: [number, number] = [0, 0];

/** Stable key for a substrate coordinate — shared by the algorithm and by substrate.ts
 *  when it maps connection endpoints to node indices (no drift). PERF: a single packed
 *  EXACT integer (no `toFixed` string formatting — ~20% of build CPU) and a number key
 *  makes cleanNet's reachability sets number-sets (~12.5%). Equivalence is byte-identical
 *  to the old `toFixed(5)` key: substrate coordinates are ≫ 1e-5 apart (quadtree cells
 *  ≥ 1/2^maxDepth; fixed input/output positions), so `round(·×1e5)` groups them exactly
 *  as the 5-dp string did. round(coord×1e5) ∈ [-1e5,1e5] → +OFF ∈ [1, 2e5+1] < base;
 *  the packed value stays < 2^53 (exact). Behaviour is unchanged — perf only. */
const COORD_Q = 1e5;
const COORD_OFF = 100001;
const COORD_BASE = 200003;
export const coordKey = (x: number, y: number, z: number): number => {
  const ix = Math.round(x * COORD_Q) + COORD_OFF;
  const iy = Math.round(y * COORD_Q) + COORD_OFF;
  const iz = Math.round(z * COORD_Q) + COORD_OFF;
  return (ix * COORD_BASE + iy) * COORD_BASE + iz;
};

interface Quad {
  x: number;
  y: number;
  w: number;
  width: number;
  level: number;
  children: Quad[] | null;
}

const key = coordKey;

/** Collect the leaf weights beneath a quad (a fully-divided node recurses into
 *  its children; otherwise it contributes its own weight). Mirrors get_weights. */
function leafWeights(p: Quad, out: number[]): void {
  if (p.children) for (const c of p.children) leafWeights(c, out);
  else out.push(p.w);
}

function variance(p: Quad): number {
  const ws: number[] = [];
  leafWeights(p, ws);
  if (ws.length === 0) return 0;
  let mean = 0;
  for (const w of ws) mean += w;
  mean /= ws.length;
  let v = 0;
  for (const w of ws) v += (w - mean) ** 2;
  return v / ws.length;
}

/** A CPPN weight query for the candidate point (cx, cy, 0), relative to a fixed
 *  source/target node, scaled to the substrate's weight range. */
type WeightAt = (cx: number, cy: number) => number;

/** Algorithm 1 — DivisionAndInitialization: build the quadtree, subdividing
 *  where the CPPN weight pattern carries variance (information). */
function divisionInitialization(query: WeightAt, p: EsParams): Quad {
  const root: Quad = { x: 0, y: 0, w: 0, width: 1, level: 1, children: null };
  const queue: Quad[] = [root];
  while (queue.length > 0) {
    const q = queue.shift()!;
    const hw = q.width / 2;
    q.children = [
      { x: q.x - hw, y: q.y - hw, w: 0, width: hw, level: q.level + 1, children: null },
      { x: q.x - hw, y: q.y + hw, w: 0, width: hw, level: q.level + 1, children: null },
      { x: q.x + hw, y: q.y + hw, w: 0, width: hw, level: q.level + 1, children: null },
      { x: q.x + hw, y: q.y - hw, w: 0, width: hw, level: q.level + 1, children: null },
    ];
    for (const c of q.children) c.w = query(c.x, c.y);
    if (q.level < p.initialDepth || (q.level < p.maxDepth && variance(q) > p.divisionThreshold)) {
      for (const c of q.children) queue.push(c);
    }
  }
  return root;
}

/** Algorithm 2 — PruningAndExtraction with band-pruning. Emits the target points
 *  (and weights) of expressed connections. */
function pruningExtraction(query: WeightAt, p: Quad, params: EsParams, emit: (x: number, y: number, w: number) => void): void {
  if (!p.children) return;
  for (const c of p.children) {
    if (variance(c) > params.varianceThreshold) {
      pruningExtraction(query, c, params, emit);
    } else {
      // Band level: the connection is in a band if its weight differs from its
      // neighbours on at least one axis (min of the two opposite differences).
      const dLeft = Math.abs(c.w - query(c.x - p.width, c.y));
      const dRight = Math.abs(c.w - query(c.x + p.width, c.y));
      const dTop = Math.abs(c.w - query(c.x, c.y - p.width));
      const dBottom = Math.abs(c.w - query(c.x, c.y + p.width));
      const band = Math.max(Math.min(dTop, dBottom), Math.min(dLeft, dRight));
      if (band > params.bandThreshold && c.w !== 0) emit(c.x, c.y, c.w);
    }
  }
}

/** Keep only neurons (and their connections) that lie on a path from some input
 *  to some output — Algorithm 3's final cleanup. Forward reachability from the
 *  inputs ∩ backward reachability from the outputs. */
function cleanNet(inputs: Vec3[], outputs: Vec3[], conns: RawConn[]): SubstrateGraph {
  const toInputs = new Set<number>(inputs.map((c) => key(c[0], c[1], c[2])));
  const toOutputs = new Set<number>(outputs.map((c) => key(c[0], c[1], c[2])));

  let grew = true;
  while (grew) {
    grew = false;
    for (const c of conns) {
      const fk = key(c.from[0], c.from[1], c.from[2]);
      const tk = key(c.to[0], c.to[1], c.to[2]);
      if (toInputs.has(fk) && !toInputs.has(tk)) {
        toInputs.add(tk);
        grew = true;
      }
    }
  }
  grew = true;
  while (grew) {
    grew = false;
    for (const c of conns) {
      const fk = key(c.from[0], c.from[1], c.from[2]);
      const tk = key(c.to[0], c.to[1], c.to[2]);
      if (toOutputs.has(tk) && !toOutputs.has(fk)) {
        toOutputs.add(fk);
        grew = true;
      }
    }
  }

  const inputKeys = new Set<number>(inputs.map((c) => key(c[0], c[1], c[2])));
  const outputKeys = new Set<number>(outputs.map((c) => key(c[0], c[1], c[2])));
  const live = new Set<number>();
  const coordOf = new Map<number, Vec3>(); // recover the Vec3 by key — no string parsing
  const conns2: RawConn[] = [];
  for (const c of conns) {
    const fk = key(c.from[0], c.from[1], c.from[2]);
    const tk = key(c.to[0], c.to[1], c.to[2]);
    if (toInputs.has(fk) && toOutputs.has(fk) && toInputs.has(tk) && toOutputs.has(tk)) {
      conns2.push(c);
      if (!inputKeys.has(fk) && !outputKeys.has(fk)) { live.add(fk); coordOf.set(fk, c.from); }
      if (!inputKeys.has(tk) && !outputKeys.has(tk)) { live.add(tk); coordOf.set(tk, c.to); }
    }
  }
  const hidden: Vec3[] = [];
  for (const lk of live) hidden.push(coordOf.get(lk)!);
  return { hidden, conns: conns2 };
}

/** Grow an evolvable substrate from the CPPN by genuine ES-HyperNEAT: discover
 *  hidden placement/density/connectivity, then prune to functional topology. */
export function growSubstrate(cc: Compiled, inputs: Vec3[], outputs: Vec3[], params: EsParams): SubstrateGraph {
  const wAt = (a: Vec3, bx: number, by: number, bz: number): number => evalCompiled(cc, a[0], a[1], a[2], bx, by, bz, o2)[0] * params.weightScale;
  // v6: the per-connection temporal coefficients, painted by the CPPN at the SAME
  // coordinate pair as the weight, bounded by tanh × scale — α (plasticity, 3rd
  // output) and g (neuromodulation gate, 5th output). One eval fills both; returned
  // via a reused scratch read immediately at each call site.
  const oc: number[] = [0, 0, 0, 0, 0];
  const ag: [number, number] = [0, 0];
  const agAt = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number] => {
    evalCompiled(cc, ax, ay, az, bx, by, bz, oc);
    ag[0] = Math.tanh(oc[2]!) * params.plasticityScale; // α
    ag[1] = Math.tanh(oc[4]!) * params.neuromodScale; // g
    return ag;
  };
  const conns: RawConn[] = [];
  const hidden = new Map<number, Vec3>();

  // (a) Outward from each input neuron. Respect the hidden-neuron cap so the
  //     discovered count (and the read-back cost, which scales with it) is bounded.
  for (const inp of inputs) {
    const root = divisionInitialization((cx, cy) => wAt(inp, cx, cy, HIDDEN_Z), params);
    pruningExtraction((cx, cy) => wAt(inp, cx, cy, HIDDEN_Z), root, params, (x, y, w) => {
      const k = key(x, y, HIDDEN_Z);
      if (!hidden.has(k) && hidden.size >= params.maxHidden) return;
      const t: Vec3 = [x, y, HIDDEN_Z];
      const a = agAt(inp[0], inp[1], inp[2], x, y, HIDDEN_Z);
      conns.push({ from: inp, to: t, weight: w, alpha: a[0], modGate: a[1] });
      hidden.set(k, t);
    });
  }

  // (b) Iterate from discovered hidden neurons (hidden → hidden).
  let frontier = [...hidden.values()];
  for (let it = 0; it < params.iterationLevel && hidden.size < params.maxHidden; it++) {
    const next: Vec3[] = [];
    for (const h of frontier) {
      if (hidden.size >= params.maxHidden) break;
      const src: Vec3 = [h[0], h[1], HIDDEN_Z];
      const root = divisionInitialization((cx, cy) => wAt(src, cx, cy, HIDDEN_Z), params);
      pruningExtraction((cx, cy) => wAt(src, cx, cy, HIDDEN_Z), root, params, (x, y, w) => {
        if (x === src[0] && y === src[1]) return; // no self-loop
        const t: Vec3 = [x, y, HIDDEN_Z];
        const a = agAt(src[0], src[1], src[2], x, y, HIDDEN_Z);
        conns.push({ from: src, to: t, weight: w, alpha: a[0], modGate: a[1] });
        const k = key(x, y, HIDDEN_Z);
        if (!hidden.has(k)) {
          hidden.set(k, t);
          next.push(t);
        }
      });
    }
    frontier = next;
  }

  // (c) Inward to each output neuron (the candidate point is the SOURCE). Connect
  //     outputs only to ALREADY-discovered hidden neurons, so the output search
  //     ties the network together without minting fresh (uncapped) hidden nodes.
  for (const out of outputs) {
    const root = divisionInitialization((cx, cy) => evalCompiled(cc, cx, cy, HIDDEN_Z, out[0], out[1], out[2], o2)[0] * params.weightScale, params);
    pruningExtraction((cx, cy) => evalCompiled(cc, cx, cy, HIDDEN_Z, out[0], out[1], out[2], o2)[0] * params.weightScale, root, params, (x, y, w) => {
      if (!hidden.has(key(x, y, HIDDEN_Z))) return;
      const a = agAt(x, y, HIDDEN_Z, out[0], out[1], out[2]);
      conns.push({ from: [x, y, HIDDEN_Z], to: out, weight: w, alpha: a[0], modGate: a[1] });
    });
  }

  return cleanNet(inputs, outputs, conns);
}
