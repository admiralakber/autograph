import type { Genome } from './cppn.ts';
import { biasNodes, sortedConns, paramToUnit } from './cppn.ts';
import { HYPER } from './hyperparams.ts';

// THE STRUCTURAL SELF-WRITE — the brain reconstructs its EXACT DNA (the CPPN genome GRAPH),
// not just a value vector. Von Neumann self-reproduction: the description, regrown.
//
// The target is the canonical genome, in NEAT order (the same ordering NEAT crossover aligns
// on, so DNA′ ↔ DNA align gene-for-gene):
//   • NODES  — the non-input nodes, id-sorted: each an ACTIVATION TYPE (categorical) + a bias.
//   • CONNS  — the connections, innovation-sorted: each a (from-slot, to-slot) topology + a
//              weight + an enabled bit. Slots index the full id-sorted node list.
// DNA′ is a reconstructed GRAPH (variable length, the creature decides its size), scored with
// GRADED PARTIAL credit so it is climbable: matched genes earn credit, length mismatch is
// penalised (Λ), and the parts are COUPLED (multiplicative) so half-solutions can't win — but
// FLOORED so partial structure still scores (a bootstrappable gradient, not all-or-nothing).

export interface StructTarget {
  /** Target activation id per non-input node (id-sorted). */
  readonly nodeAct: Uint8Array;
  /** Target bias (unit [0,1]) per non-input node. */
  readonly nodeBias: Float32Array;
  /** Target from/to SLOT (index into the full id-sorted node list) per conn (innov-sorted). */
  readonly connFrom: Int32Array;
  readonly connTo: Int32Array;
  /** Target weight (unit [0,1]) + enabled bit per conn. */
  readonly connWeight: Float32Array;
  readonly connEnabled: Uint8Array;
  /** Total node slots (inputs + non-input) — the from/to index space. */
  readonly totalNodes: number;
  /** Gene count (nodes + conns) — the complexity weight. */
  readonly G: number;
}

/** The exact DNA as a canonical token target (NEAT order). */
export function structTarget(g: Genome): StructTarget {
  const full = g.nodes.slice().sort((a, b) => a.id - b.id);
  const slotOf = new Map<number, number>();
  full.forEach((n, i) => slotOf.set(n.id, i));
  const bn = biasNodes(g); // non-input, id-sorted
  const sc = sortedConns(g); // innovation-sorted
  return {
    nodeAct: Uint8Array.from(bn.map((n) => n.act)),
    nodeBias: Float32Array.from(bn.map((n) => paramToUnit(n.bias))),
    connFrom: Int32Array.from(sc.map((c) => slotOf.get(c.from) ?? 0)),
    connTo: Int32Array.from(sc.map((c) => slotOf.get(c.to) ?? 0)),
    connWeight: Float32Array.from(sc.map((c) => paramToUnit(c.weight))),
    connEnabled: Uint8Array.from(sc.map((c) => (c.enabled ? 1 : 0))),
    totalNodes: full.length,
    G: bn.length + sc.length,
  };
}

/** The brain's emitted DNA′ (a reconstructed graph), padded to the run cap; `nodeLen`/`connLen`
 *  are where the creature's own end-signals fired (its DECIDED structure size). */
export interface EmittedGenome {
  readonly act: Uint8Array; // emitted activation id per node-step
  readonly bias: Float32Array; // emitted bias (unit) per node-step
  readonly from: Int32Array; // emitted from-slot per conn-step
  readonly to: Int32Array;
  readonly weight: Float32Array; // emitted weight (unit) per conn-step
  readonly enabled: Uint8Array;
  readonly nodeLen: number; // self-decided node count
  readonly connLen: number; // self-decided conn count
  readonly nodeRun: number; // node steps actually emitted (cap)
  readonly connRun: number;
  readonly ponder: number;
  readonly deviation: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const fin = (x: number): number => (Number.isFinite(x) ? x : 0);

/** Baseline-corrected R² of an emitted unit-value sequence vs the target over the target's
 *  full length: positions past `len` predicted as the target mean (so a short emit can't
 *  explain variance it never wrote). */
function r2Over(target: Float32Array, vals: Float32Array, len: number): number {
  const G = target.length;
  if (G === 0) return 1; // nothing to reconstruct ⇒ trivially satisfied
  let mean = 0;
  for (let i = 0; i < G; i++) mean += target[i]!;
  mean /= G;
  let varr = 0;
  for (let i = 0; i < G; i++) {
    const d = target[i]! - mean;
    varr += d * d;
  }
  varr /= G;
  if (varr < 1e-9) return 0;
  let mse = 0;
  for (let i = 0; i < G; i++) {
    const pred = i < len ? vals[i]! : mean;
    const d = pred - target[i]!;
    mse += d * d;
  }
  mse /= G;
  return fin(1 - mse / varr);
}

/** Fraction of matched positions (i < min(emitted-len, target-len)) where the discrete
 *  emitted value equals the target. (0 if no overlap.) */
function categoricalAcc(target: ArrayLike<number>, em: ArrayLike<number>, len: number): number {
  const m = Math.min(target.length, len);
  if (m === 0) return target.length === 0 ? 1 : 0;
  let hit = 0;
  for (let i = 0; i < m; i++) if (target[i] === em[i]) hit++;
  return hit / target.length; // over the TARGET length, so missing genes count against it
}

/** Topology match over matched conn positions: 1 where (from,to) both correct, graded
 *  partial otherwise by slot proximity (so a near-miss earns some credit — a gradient). */
function topoMatch(t: StructTarget, em: EmittedGenome, len: number): number {
  const G = t.connFrom.length;
  if (G === 0) return 1;
  const m = Math.min(G, len);
  let acc = 0;
  const span = Math.max(1, t.totalNodes - 1);
  for (let i = 0; i < m; i++) {
    const df = Math.abs(em.from[i]! - t.connFrom[i]!) / span;
    const dt = Math.abs(em.to[i]! - t.connTo[i]!) / span;
    acc += 0.5 * (1 - clamp01(df)) + 0.5 * (1 - clamp01(dt)); // graded, exact ⇒ 1
  }
  return acc / G; // over TARGET length
}

export interface StructSkill {
  readonly skill: number; // selection fitness in [0,1]
  readonly weightR2: number; // honest weight reconstruction
  readonly biasR2: number; // honest bias reconstruction
  readonly actAcc: number; // activation-type accuracy
  readonly topo: number; // topology (from/to) match
  readonly enAcc: number; // enabled-bit accuracy
  readonly lenN: number; // node-count match Λ
  readonly lenC: number; // conn-count match Λ
  readonly nodeLen: number;
  readonly connLen: number;
  readonly tgtNodes: number;
  readonly tgtConns: number;
}

/** Score DNA′ against DNA — GRADED, COUPLED (multiplicative, can't game one part), FLOORED
 *  (partial credit → a climbable gradient). The honest components are returned alongside the
 *  selection fitness. `a` (value competence) drives the length curriculum (teacher→self). */
export function scoreStruct(t: StructTarget, em: EmittedGenome): StructSkill {
  const tgtNodes = t.nodeAct.length;
  const tgtConns = t.connFrom.length;
  // VALUES — teacher-length (dense bootstrap) → self-length, annealed by value competence.
  const wR2teacher = r2Over(t.connWeight, em.weight, Math.min(tgtConns, em.connRun));
  const wR2self = r2Over(t.connWeight, em.weight, em.connLen);
  const bR2teacher = r2Over(t.nodeBias, em.bias, Math.min(tgtNodes, em.nodeRun));
  const bR2self = r2Over(t.nodeBias, em.bias, em.nodeLen);
  const lo = HYPER.curriculumLo, hi = HYPER.curriculumHi;
  const a = (() => { const x = clamp01((wR2teacher - lo) / Math.max(1e-6, hi - lo)); return x * x * (3 - 2 * x); })();
  const weightR2 = clamp01((1 - a) * wR2teacher + a * wR2self);
  const biasR2 = clamp01((1 - a) * bR2teacher + a * bR2self);
  // STRUCTURE — discrete reconstruction, scored at self-length.
  const actAcc = categoricalAcc(t.nodeAct, em.act, em.nodeLen);
  const enAcc = categoricalAcc(t.connEnabled, em.enabled, em.connLen);
  const topo = topoMatch(t, em, em.connLen);
  // SIZE — the creature decides its own structure size; Λ rewards the right counts.
  const lenN = clamp01(1 - Math.abs(em.nodeLen - tgtNodes) / Math.max(1, tgtNodes));
  const lenC = clamp01(1 - Math.abs(em.connLen - tgtConns) / Math.max(1, tgtConns));
  // COUPLED-BUT-GRADED selection fitness: a product of FLOORED factors so every part must be
  // good for full marks, yet partial structure still earns a climbable gradient.
  const AF = HYPER.actFloor, TF = HYPER.topoFloor, LF = HYPER.lengthShapeFloor;
  const value = weightR2 * (0.5 + 0.5 * biasR2); // weights dominate; bias a graded bonus
  const structure = (AF + (1 - AF) * actAcc) * (TF + (1 - TF) * topo) * (0.7 + 0.3 * enAcc);
  const sizeFactor = (LF + (1 - LF) * lenN) * (LF + (1 - LF) * lenC);
  const cw = clamp01(t.G / Math.max(1, HYPER.skillComplexityRef));
  const cap = Math.max(1, Math.round(HYPER.ponderMaxSteps));
  const ponderFactor = clamp01(1 - HYPER.ponderCost * (em.ponder / cap));
  const skill = clamp01(fin(cw * clamp01(value) * structure * sizeFactor * ponderFactor));
  return { skill, weightR2: fin(weightR2), biasR2: fin(biasR2), actAcc, topo, enAcc, lenN, lenC, nodeLen: em.nodeLen, connLen: em.connLen, tgtNodes, tgtConns };
}
