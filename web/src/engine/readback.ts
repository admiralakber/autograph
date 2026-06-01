import type { Genome } from './cppn.ts';
import { paramCount, genomeVector, sortedConns, biasNodes, paramToUnit } from './cppn.ts';
import type { Phenotype } from './substrate.ts';
import { selfWriteStructural } from './substrate.ts';
import { structTarget, scoreStruct } from './structural.ts';
import type { StructSkill } from './structural.ts';

// THE STRUCTURAL SELF-WRITER. The decode is now full von Neumann self-reproduction: the brain
// reads a true picture of its own wiring (the substrate-encoded self-portrait) and WRITES its
// EXACT DNA back — the genome GRAPH: node activation types + biases, and connection topology
// + weights + enabled bits. DNA′ is a reconstructed graph, scored gene-for-gene against DNA
// (NEAT-innovation-aligned, graded partial credit; structural.ts), measured live, never faked.
//
// Honesty holds by construction: a blank / fresh creature emits a constant graph (no wired
// writer) → predict-the-mean values + chance topology/activations → skill ≈ 0, and is
// vitality-gated. Only a brain whose graph-write genuinely reconstructs its DNA scores above 0.

// Diagnostics from the most recent skill/readback call — set as a side effect, read in the
// same synchronous chain (skill → readback, or drawLoop → readBackUnits).
let last: StructSkill | null = null;

/** The structural-write diagnostics from the most recent skill call: the sizes the creature
 *  DECIDED (nodes/conns) vs its genome, and the honest component scores. */
export function lastWrite(): { nodeLen: number; connLen: number; tgtNodes: number; tgtConns: number; selfLen: number; geneCount: number; ponder: number } {
  const s = last;
  if (!s) return { nodeLen: 0, connLen: 0, tgtNodes: 0, tgtConns: 0, selfLen: 0, geneCount: 0, ponder: 0 };
  return { nodeLen: s.nodeLen, connLen: s.connLen, tgtNodes: s.tgtNodes, tgtConns: s.tgtConns, selfLen: s.nodeLen + s.connLen, geneCount: s.tgtNodes + s.tgtConns, ponder: s.ponder };
}

/** The DNA's own values in unit space — the FULL genome vector (conn weights ++ node biases),
 *  kept for diagnostics + the iterate-loop fixed-point check. */
export function dnaTargetUnits(g: Genome): Float32Array {
  const v = genomeVector(g);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = paramToUnit(v[i]!);
  return out;
}

/** DNA′ — the VALUE part of the structural write (emitted weights ++ biases) in unit space, in
 *  canonical genomeVector order, at the genome's own lengths. For `iterateLoop`'s value
 *  fixed-point diagnostic (fitness.ts). Sets the diagnostics. */
export function selfReadback(g: Genome, p: Phenotype): Float32Array {
  const target = structTarget(g);
  const em = selfWriteStructural(p);
  last = scoreStruct(target, em);
  const nConn = target.connWeight.length;
  const nNode = target.nodeBias.length;
  const out = new Float32Array(nConn + nNode);
  for (let i = 0; i < nConn; i++) out[i] = i < em.weight.length ? em.weight[i]! : 0.5;
  for (let j = 0; j < nNode; j++) out[nConn + j] = j < em.bias.length ? em.bias[j]! : 0.5;
  return out;
}

export interface WriteSkill extends StructSkill {}

/** The structural self-writer skill — the brain reconstructs its EXACT DNA (graph). Returns
 *  the selection fitness PLUS the honest component breakdown (weight-R², bias-R², activation
 *  accuracy, topology match, enabled accuracy, node/conn size match). Sets the diagnostics. */
export function writeSkill(g: Genome, p: Phenotype): WriteSkill {
  const target = structTarget(g);
  const em = selfWriteStructural(p);
  const s = scoreStruct(target, em);
  last = s;
  return s;
}

/** Self-encoding SKILL in [0,1] — the structural selection fitness (drives evolution). A
 *  blank / fresh / random creature scores ~0; nothing is faked. */
export function selfConsistencySkill(g: Genome, p: Phenotype): number {
  return writeSkill(g, p).skill;
}

/** The HONEST weight-reconstruction R² — the value half of the structural self-write,
 *  exposed for diagnostics + the headline honest number. */
export function selfConsistencyR2(g: Genome, p: Phenotype): number {
  return writeSkill(g, p).weightR2;
}

export { paramCount, sortedConns, biasNodes };
