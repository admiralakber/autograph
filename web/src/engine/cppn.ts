import { CPPN_INPUTS, CPPN_OUTPUTS, BIRTH_OUTPUTS, INPUT_IDS, OUTPUT_IDS, DEFERRED_OUTPUT_IDS } from './arch.ts';
import { activate, ACTIVATION_COUNT, IDENTITY_ACT } from './activations.ts';
import type { Rng } from './prng.ts';
import { rngFromSeed } from './prng.ts';

// The DNA: a *connective* CPPN evolved with NEAT (augmenting topologies). The
// genome is a graph — node genes + connection genes with innovation numbers —
// so structure GROWS over evolution (add-node / add-connection). Connections may
// be recurrent; the compiled evaluator runs a few propagation passes. Given two
// 3-D coordinates it emits FOUR channels — structure + faculties:
//   [weight, bias]      STRUCTURE  — ES-HyperNEAT grows the brain from the weight pattern,
//                                    and weight also sets each neuron's activation.
//   [α, modGate]        FACULTIES  — Hebbian plasticity + neuromod gate (off at birth).
// There is NO density/hue channel: the self-portrait is rendered from the BUILT SUBSTRATE
// (a true depiction of the wiring — renderSubstrateImage in substrate.ts), not painted by
// the CPPN. And emit/halt/look/m are the BRAIN's OUTPUT NEURONS, produced by running the
// substrate, never read off the CPPN. The CPPN expresses the wiring; the brain behaves.
//
// The genome shape is faithful to neataptic's clean encoding (wagenaartje):
//   node       → { id, kind:type, act:squash, bias }
//   connection → { from, to, weight, enabled, gater }   (gain = gater's activation)

/** Half-range mapping DNA weights <-> the [0,1] interval used by the loop. */
export const W_SCALE = 4;

export type NodeKind = 0 | 1 | 2; // 0 = input, 1 = hidden, 2 = output

export interface NodeGene {
  readonly id: number;
  readonly kind: NodeKind;
  act: number; // activation id (index into ACTIVATIONS)
  bias: number;
}
export interface ConnGene {
  readonly innov: number; // historical marking
  readonly from: number; // source node id
  readonly to: number; // target node id
  weight: number;
  enabled: boolean;
  /** Optional gater node id (neataptic-style): its activation modulates this
   *  connection's signal. undefined = ungated. */
  gater?: number;
}
export interface Genome {
  nodes: NodeGene[];
  conns: ConnGene[];
}

const clampW = (x: number): number => (x < -W_SCALE ? -W_SCALE : x > W_SCALE ? W_SCALE : x);

/** The minimal genome NEAT starts from: every input wired straight to every
 *  output (a perceptron), seeded weights, no hidden nodes. Innovation numbers
 *  for these base connections are canonical (i*OUT + o). */
export function minimalGenome(rng: Rng): Genome {
  const nodes: NodeGene[] = [];
  for (const id of INPUT_IDS) nodes.push({ id, kind: 0, act: IDENTITY_ACT, bias: 0 });
  // Outputs [weight(7), bias(8) | α(9), modGate(10)]. The two STRUCTURE channels (weight,
  // bias) are wired + biased at birth, so a fresh creature has a grown brain (hence a
  // non-flat self-portrait — the substrate's own wiring); the two FACULTY channels (α
  // plasticity, modGate neuromod) start with NO incoming connections and a zero bias, so
  // they read exactly 0 and arise only when a structural mutation wires them — the gentle
  // on-ramp. (The brain's WRITER behaviours on-ramp separately + structurally — they are
  // substrate output NEURONS, unconnected at birth; see substrate.ts.)
  OUTPUT_IDS.forEach((id, o) => nodes.push({ id, kind: 2, act: IDENTITY_ACT, bias: o < BIRTH_OUTPUTS ? rng.normal() * 0.5 : 0 }));
  const conns: ConnGene[] = [];
  for (let i = 0; i < CPPN_INPUTS; i++) {
    for (let o = 0; o < BIRTH_OUTPUTS; o++) {
      conns.push({ innov: i * CPPN_OUTPUTS + o, from: INPUT_IDS[i]!, to: OUTPUT_IDS[o]!, weight: rng.normal() * 1.4, enabled: true });
    }
  }
  return { nodes, conns };
}

export function randomGenome(rng: Rng): Genome {
  return minimalGenome(rng);
}

/** Deterministically grow a creature's DNA from a seed string (Genesis included). */
export function seededGenome(seed: string): Genome {
  return minimalGenome(rngFromSeed(seed));
}

export function cloneGenome(g: Genome): Genome {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, kind: n.kind, act: n.act, bias: n.bias })),
    conns: g.conns.map((c) => ({ innov: c.innov, from: c.from, to: c.to, weight: c.weight, enabled: c.enabled, gater: c.gater })),
  };
}

// --- Compilation + evaluation (supports recurrence) -------------------------

export interface Compiled {
  readonly order: number[]; // node indices in evaluation order (inputs first)
  readonly nodeAct: Uint8Array;
  readonly nodeBias: Float32Array;
  readonly nodeKind: Uint8Array;
  /** Per node: incoming [srcIndex, weight, recurrent(0/1)] triples (flattened). */
  readonly incoming: Int32Array[];
  readonly incW: Float32Array[];
  readonly incRec: Uint8Array[];
  /** Per node: gater node index per incoming edge (-1 = ungated). */
  readonly incGater: Int32Array[];
  readonly inputIdx: number[]; // node index for each canonical input 0..6
  readonly outIdx: number[]; // node index for each output (weight, leo)
  readonly passes: number;
  readonly val: Float32Array;
  readonly prev: Float32Array;
}

/** Compile a genome into a fast evaluation plan. Computes a longest-path depth so
 *  feed-forward edges resolve in one pass; edges that go "backward" are marked
 *  recurrent and read the previous pass's value (a few passes settle them). */
export function compileCPPN(g: Genome): Compiled {
  const n = g.nodes.length;
  const idToIdx = new Map<number, number>();
  g.nodes.forEach((nd, i) => idToIdx.set(nd.id, i));

  const depth = new Int32Array(n); // inputs stay 0
  for (let iter = 0; iter < n; iter++) {
    let changed = false;
    for (const c of g.conns) {
      if (!c.enabled) continue;
      const a = idToIdx.get(c.from);
      const b = idToIdx.get(c.to);
      if (a === undefined || b === undefined) continue;
      if (depth[b]! < depth[a]! + 1) {
        depth[b] = depth[a]! + 1;
        changed = true;
      }
    }
    if (!changed) break; // converged → acyclic; otherwise capped at n iterations
  }

  const incoming: Int32Array[] = [];
  const incW: Float32Array[] = [];
  const incRec: Uint8Array[] = [];
  const incGater: Int32Array[] = [];
  let recurrent = false;
  for (let i = 0; i < n; i++) {
    const srcs: number[] = [];
    const ws: number[] = [];
    const rec: number[] = [];
    const gat: number[] = [];
    for (const c of g.conns) {
      if (!c.enabled) continue;
      const b = idToIdx.get(c.to);
      if (b !== i) continue;
      const a = idToIdx.get(c.from);
      if (a === undefined) continue;
      const isRec = depth[a]! >= depth[b]! ? 1 : 0; // back/lateral edge → recurrent
      if (isRec) recurrent = true;
      srcs.push(a);
      ws.push(c.weight);
      rec.push(isRec);
      gat.push(c.gater !== undefined ? (idToIdx.get(c.gater) ?? -1) : -1);
    }
    incoming.push(Int32Array.from(srcs));
    incW.push(Float32Array.from(ws));
    incRec.push(Uint8Array.from(rec));
    incGater.push(Int32Array.from(gat));
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[a]! - depth[b]! || g.nodes[a]!.id - g.nodes[b]!.id);
  const inputIdx = INPUT_IDS.map((id) => idToIdx.get(id) ?? 0);
  const outIdx = OUTPUT_IDS.map((id) => idToIdx.get(id) ?? 0);
  const nodeAct = Uint8Array.from(g.nodes.map((nd) => nd.act));
  const nodeBias = Float32Array.from(g.nodes.map((nd) => nd.bias));
  const nodeKind = Uint8Array.from(g.nodes.map((nd) => nd.kind));

  return {
    order,
    nodeAct,
    nodeBias,
    nodeKind,
    incoming,
    incW,
    incRec,
    incGater,
    inputIdx,
    outIdx,
    passes: recurrent ? 3 : 1,
    val: new Float32Array(n),
    prev: new Float32Array(n),
  };
}

const IN_BUF = new Float64Array(CPPN_INPUTS);

/** Evaluate a compiled CPPN at a pair of 3-D points -> all CPPN_OUTPUTS channels
 *  [weight, bias, α, modGate]. Writes `outIdx.length` channels into `out`, growing it if
 *  shorter (so a caller that only reads out[0]/out[1] may still pass a short scratch —
 *  extra channels are written, ignored). */
export function evalCompiled(c: Compiled, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, out: number[] = [0, 0, 0, 0]): number[] {
  IN_BUF[0] = x1;
  IN_BUF[1] = y1;
  IN_BUF[2] = z1;
  IN_BUF[3] = x2;
  IN_BUF[4] = y2;
  IN_BUF[5] = z2;
  IN_BUF[6] = 1; // bias input
  const { val, prev, order, incoming, incW, incRec, incGater, nodeAct, nodeBias, nodeKind, inputIdx } = c;
  for (let i = 0; i < CPPN_INPUTS; i++) val[inputIdx[i]!] = IN_BUF[i]!;
  for (let pass = 0; pass < c.passes; pass++) {
    if (c.passes > 1) prev.set(val);
    for (const i of order) {
      if (nodeKind[i] === 0) continue; // inputs already set
      const src = incoming[i]!;
      const ws = incW[i]!;
      const rec = incRec[i]!;
      const gat = incGater[i]!;
      let sum = nodeBias[i]!;
      for (let k = 0; k < src.length; k++) {
        let contrib = (rec[k] ? prev[src[k]!]! : val[src[k]!]!) * ws[k]!;
        const gi = gat[k]!;
        if (gi >= 0) contrib *= rec[k] ? prev[gi]! : val[gi]!; // gating: a neuron modulates the signal
        sum += contrib;
      }
      val[i] = activate(nodeAct[i]!, sum);
    }
  }
  const oi = c.outIdx;
  for (let j = 0; j < oi.length; j++) out[j] = val[oi[j]!]!; // [weight, bias, α, modGate]
  return out;
}

/** Convenience: compile + evaluate once (not for hot loops). */
export function evalCPPN(g: Genome, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, out: number[] = [0, 0, 0, 0]): number[] {
  return evalCompiled(compileCPPN(g), x1, y1, z1, x2, y2, z2, out);
}

// --- The real vector the image must re-encode (variable length) -----

/** Non-input nodes in canonical (id-sorted) order — they carry biases. The ONE
 *  ordering used by `genomeVector`, `applyParams`, and the self-quine readout, so
 *  the DNA vector and its reconstruction stay index-aligned by construction. */
export function biasNodes(g: Genome): NodeGene[] {
  return g.nodes.filter((n) => n.kind !== 0).slice().sort((a, b) => a.id - b.id);
}
/** Connections in canonical (innovation-sorted) order — they carry weights. */
export function sortedConns(g: Genome): ConnGene[] {
  return g.conns.slice().sort((a, b) => a.innov - b.innov);
}

/** The DNA's real dimension = #connections + #(non-input) biases. It GROWS as
 *  the topology complexifies — so a richer creature has a harder loop to close. */
export function paramCount(g: Genome): number {
  let bn = 0;
  for (const n of g.nodes) if (n.kind !== 0) bn++;
  return g.conns.length + bn;
}

/** DNA as a single real vector: connection weights (by innovation) ++ biases. */
export function genomeVector(g: Genome): Float32Array {
  const conns = sortedConns(g);
  const bns = biasNodes(g);
  const v = new Float32Array(conns.length + bns.length);
  let k = 0;
  for (const c of conns) v[k++] = c.weight;
  for (const n of bns) v[k++] = n.bias;
  return v;
}

/** Write a real vector back into a clone of the genome (same canonical order) —
 *  the decode half of the self-encoding loop. Topology/activations are kept. */
export function applyParams(g: Genome, vec: Float32Array): Genome {
  const child = cloneGenome(g);
  const conns = child.conns.slice().sort((a, b) => a.innov - b.innov);
  const bns = child.nodes.filter((n) => n.kind !== 0).slice().sort((a, b) => a.id - b.id);
  let k = 0;
  for (const c of conns) c.weight = clampW(vec[k++] ?? c.weight);
  for (const n of bns) n.bias = clampW(vec[k++] ?? n.bias);
  return child;
}

// --- The RECONSTRUCTION TARGET (the genes the writer must reproduce) ----------
//
// The self-writer is asked to reconstruct the WHOLE genome — every connection
// weight and every non-input bias. DEFERRED_OUTPUT_IDS is empty (the v6 fork-B
// "defer the channels a static image can't encode" is retired: the brain now READS
// the image over a plastic, attentional lifetime, so there is no impossible subtask
// to carve out). These targetConns / targetBiasNodes helpers therefore return the
// full canonical genome — kept as the single seam through which readback.ts reads the
// target, so re-introducing a deferral later would be a one-line change to arch.ts.

/** Target connections = expressed conns whose sink is NOT a deferred output node. */
export function targetConns(g: Genome): ConnGene[] {
  return g.conns.filter((c) => !DEFERRED_OUTPUT_IDS.has(c.to)).slice().sort((a, b) => a.innov - b.innov);
}
/** Target bias nodes = non-input nodes that are NOT deferred output nodes. */
export function targetBiasNodes(g: Genome): NodeGene[] {
  return g.nodes.filter((n) => n.kind !== 0 && !DEFERRED_OUTPUT_IDS.has(n.id)).slice().sort((a, b) => a.id - b.id);
}
/** Dimension of the reconstruction target (≤ paramCount; equal when nothing is deferred). */
export function targetCount(g: Genome): number {
  return targetConns(g).length + targetBiasNodes(g).length;
}
/** The reconstruction target as a real vector: target conn weights ++ target biases. */
export function targetVector(g: Genome): Float32Array {
  const conns = targetConns(g);
  const bns = targetBiasNodes(g);
  const v = new Float32Array(conns.length + bns.length);
  let k = 0;
  for (const c of conns) v[k++] = c.weight;
  for (const n of bns) v[k++] = n.bias;
  return v;
}
/** Write a TARGET-aligned vector back into a clone (with DEFERRED empty this is the
 *  full genome). Any deferred genes would be left exactly as evolution painted them.
 *  Same canonical order as `targetVector`. */
export function applyTargetParams(g: Genome, vec: Float32Array): Genome {
  const child = cloneGenome(g);
  const conns = child.conns.filter((c) => !DEFERRED_OUTPUT_IDS.has(c.to)).slice().sort((a, b) => a.innov - b.innov);
  const bns = child.nodes.filter((n) => n.kind !== 0 && !DEFERRED_OUTPUT_IDS.has(n.id)).slice().sort((a, b) => a.id - b.id);
  let k = 0;
  for (const c of conns) c.weight = clampW(vec[k++] ?? c.weight);
  for (const n of bns) n.bias = clampW(vec[k++] ?? n.bias);
  return child;
}

/** Normalise a raw DNA param into the [0,1] interval used by the loop. */
export function paramToUnit(p: number): number {
  const t = p / (2 * W_SCALE) + 0.5;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
/** Inverse of paramToUnit: a painted [0,1] density back into a DNA param. */
export function unitToParam(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return (c - 0.5) * 2 * W_SCALE;
}

/** Hidden CPPN nodes in canonical (id-sorted) order — the ablatable internal genes of the
 *  DNA. Silencing one changes the WEIGHT pattern, hence the grown substrate, hence the
 *  self-portrait (which is rendered from that substrate) — the genotype→network→image link
 *  made visible. */
export function hiddenCppnNodes(g: Genome): NodeGene[] {
  return g.nodes.filter((n) => n.kind === 1).slice().sort((a, b) => a.id - b.id);
}
/** A copy of the DNA with its j-th hidden node SILENCED — every connection into or out of
 *  it disabled and its bias zeroed. Re-GROWING the substrate from this genome and re-rendering
 *  the self-portrait shows the ablated node's contribution to the actual network. */
export function ablateHiddenGenome(g: Genome, j: number): Genome {
  const hidden = hiddenCppnNodes(g);
  const child = cloneGenome(g);
  const targetId = hidden[j]?.id;
  if (targetId === undefined) return child; // no such hidden node ⇒ unchanged
  for (const c of child.conns) if (c.from === targetId || c.to === targetId) c.enabled = false;
  const node = child.nodes.find((n) => n.id === targetId);
  if (node) node.bias = 0;
  return child;
}

/** Stable little-endian serialisation for content hashing — binds the whole
 *  genome (topology + node biases/activations + connection weights/gaters). The
 *  loop's decode half is now INTRINSIC (the CPPN self-quine, quine.ts), so there
 *  is no separate read-back network to serialise: the genome is just the graph.
 *  This is the v3 wire format (v2 appended reader weights; those are gone). */
export function genomeBytes(g: Genome): Uint8Array {
  const nodes = g.nodes.slice().sort((a, b) => a.id - b.id);
  const conns = sortedConns(g);
  const header = 8;
  const bytes = new Uint8Array(header + nodes.length * 12 + conns.length * 20);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, CPPN_INPUTS, true);
  dv.setUint16(2, CPPN_OUTPUTS, true);
  dv.setUint16(4, nodes.length, true);
  dv.setUint16(6, conns.length, true);
  let o = header;
  for (const n of nodes) {
    dv.setInt32(o, n.id, true);
    dv.setUint8(o + 4, n.kind);
    dv.setUint8(o + 5, n.act);
    dv.setFloat32(o + 8, n.bias, true);
    o += 12;
  }
  for (const c of conns) {
    dv.setInt32(o, c.innov, true);
    dv.setInt32(o + 4, c.from, true);
    dv.setInt32(o + 8, c.to, true);
    dv.setFloat32(o + 12, c.enabled ? c.weight : 0, true);
    dv.setInt32(o + 16, c.gater ?? -1, true); // gater node id (-1 = ungated)
    o += 20;
  }
  return bytes;
}

// --- Compatibility distance (for speciation) --------------------------------

/** NEAT compatibility distance: excess/disjoint genes + mean matching weight
 *  difference. Used to group creatures into species that protect new structure. */
export function compatibility(a: Genome, b: Genome, c1 = 1.4, c2 = 1.4, c3 = 0.3): number {
  const ma = new Map<number, number>();
  for (const c of a.conns) ma.set(c.innov, c.weight);
  const mb = new Map<number, number>();
  for (const c of b.conns) mb.set(c.innov, c.weight);
  let matching = 0;
  let wdiff = 0;
  let disjoint = 0;
  const maxA = a.conns.reduce((m, c) => Math.max(m, c.innov), 0);
  const maxB = b.conns.reduce((m, c) => Math.max(m, c.innov), 0);
  const lowMax = Math.min(maxA, maxB);
  let excess = 0;
  const all = new Set<number>([...ma.keys(), ...mb.keys()]);
  for (const innov of all) {
    const inA = ma.has(innov);
    const inB = mb.has(innov);
    if (inA && inB) {
      matching++;
      wdiff += Math.abs(ma.get(innov)! - mb.get(innov)!);
    } else if (innov > lowMax) {
      excess++;
    } else {
      disjoint++;
    }
  }
  const nrm = Math.max(1, Math.max(a.conns.length, b.conns.length));
  const meanW = matching > 0 ? wdiff / matching : 0;
  return (c1 * excess) / nrm + (c2 * disjoint) / nrm + c3 * meanW;
}

export { ACTIVATION_COUNT };
