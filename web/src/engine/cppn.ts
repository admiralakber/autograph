import { CPPN_INPUTS, CPPN_OUTPUTS, INPUT_IDS, OUTPUT_IDS, DEFERRED_OUTPUT_IDS } from './arch.ts';
import { activate, ACTIVATION_COUNT, IDENTITY_ACT } from './activations.ts';
import type { Rng } from './prng.ts';
import { rngFromSeed } from './prng.ts';

// The DNA: a *connective* CPPN evolved with NEAT (augmenting topologies). The
// genome is a graph — node genes + connection genes with innovation numbers —
// so structure GROWS over evolution (add-node / add-connection). Connections may
// be recurrent; the compiled evaluator runs a few propagation passes. Given two
// 3-D coordinates it emits [weight, bias]; ES-HyperNEAT uses the weight pattern
// to grow the brain (substrate.ts), and the SAME CPPN read at canonical genome
// coordinates reconstructs its own genes — the self-quine (quine.ts).
//
// The genome shape is faithful to neataptic's clean encoding (wagenaartje):
//   node       → { id, kind:type, act:squash, bias }
//   connection → { from, to, weight, enabled, gater }   (gain = gater's activation)
// There is NO separate read-back network: the loop's decode half is intrinsic
// to this CPPN (a neural-network quine, Chang & Lipson 2018), so a creature can
// only score by genuinely being self-consistent — nothing external can cheat.

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
  // Outputs: [weight(7), bias(8), plasticity α(9)]. The α output starts at ~0 — a
  // zero bias + tiny incoming weights — so a fresh creature is effectively
  // NON-plastic (a v5-like static brain) and evolution grows plasticity up via
  // ordinary weight/structure mutation: a gentle on-ramp, not the full space at once.
  OUTPUT_IDS.forEach((id, o) => nodes.push({ id, kind: 2, act: IDENTITY_ACT, bias: o === 2 ? 0 : rng.normal() * 0.5 }));
  const conns: ConnGene[] = [];
  for (let i = 0; i < CPPN_INPUTS; i++) {
    for (let o = 0; o < CPPN_OUTPUTS; o++) {
      const weight = o === 2 ? 0 : rng.normal() * 1.4; // α channel starts OFF (α≈0); plasticity arises by mutation
      conns.push({ innov: i * CPPN_OUTPUTS + o, from: INPUT_IDS[i]!, to: OUTPUT_IDS[o]!, weight, enabled: true });
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

/** Evaluate a compiled CPPN at a pair of 3-D points -> [weight, bias, plasticity].
 *  `out` may be any length ≥ 1; channels beyond its length are simply not written
 *  (so legacy length-2 scratch keeps working — they ignore the plasticity channel). */
export function evalCompiled(c: Compiled, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, out: number[] = [0, 0, 0]): number[] {
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
  for (let j = 0; j < oi.length; j++) out[j] = val[oi[j]!]!; // [weight, bias, plasticity α]
  return out;
}

/** Convenience: compile + evaluate once (not for hot loops). */
export function evalCPPN(g: Genome, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, out: number[] = [0, 0, 0]): number[] {
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

// --- v6 (B): the RECONSTRUCTION TARGET — only what the static image encodes ---
//
// During Phases 2–4 the self-encoding loop must reconstruct ONLY the genes the
// static density/hue field can physically carry: the weight (output 0) and bias
// (output 1) channels. The α-plasticity channel (output 2) and the neuromod
// channels Phase 3 adds paint the TEMPORAL dynamics, invisible to the static
// image, so including them would measure an impossible subtask (a meaningless
// drag, not genuine difficulty). We exclude exactly the genes that feed those
// deferred output nodes — the direct conns into them + their own biases — which is
// the minimal, clean cut (genes that also touch the visible channels via shared
// hidden nodes stay in the target, because they DO affect the image). These
// channels rejoin the target at Phase 5. With DEFERRED_OUTPUT_IDS empty this is
// byte-for-byte the full genome again, so v5 / Phase-5 behaviour is recovered for
// free. The full genome (genomeVector / paramCount / genomeBytes) is untouched —
// serialisation, lineage and complexity-of-the-whole-creature still see everything.

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
/** Write a TARGET-aligned vector back into a clone — the deferred channels (α /
 *  neuromod) are left exactly as evolution painted them; only the image-encoded
 *  genes are updated by the loop. Same canonical order as `targetVector`. */
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
