import { ACTIVATION_COUNT } from './activations.ts';
import { BASE_INNOV, FIRST_HIDDEN_ID } from './arch.ts';
import { HYPER } from './hyperparams.ts';
import type { Genome, NodeGene, ConnGene } from './cppn.ts';
import { cloneGenome, W_SCALE } from './cppn.ts';
import type { Rng } from './prng.ts';

const clampW = (x: number): number => (x < -W_SCALE ? -W_SCALE : x > W_SCALE ? W_SCALE : x);

/** neataptic-inspired structural options, toggleable from the UI. */
export interface MutateOptions {
  /** allow back/lateral (recurrent) connections (ADD_BACK_CONN). */
  recurrent: boolean;
  /** allow a node to connect to itself (ADD_SELF_CONN). */
  selfConn: boolean;
  /** allow a neuron to gate a connection (ADD_GATE). */
  gating: boolean;
}
export const DEFAULT_OPTIONS: MutateOptions = { recurrent: true, selfConn: false, gating: true };

// NEAT historical markings. Identical structural mutations (a given from→to
// link, or a given connection split) get the SAME innovation number across the
// run, so crossover can align genes and speciation can measure real homology.
export class Innovations {
  private nextInnov = BASE_INNOV;
  private nextNodeId = FIRST_HIDDEN_ID;
  private readonly connKey = new Map<string, number>();
  private readonly splitKey = new Map<number, { node: number; inInnov: number; outInnov: number }>();

  connInnov(from: number, to: number): number {
    const key = `${from}>${to}`;
    const found = this.connKey.get(key);
    if (found !== undefined) return found;
    const innov = this.nextInnov++;
    this.connKey.set(key, innov);
    return innov;
  }

  splitNode(connInnov: number): { node: number; inInnov: number; outInnov: number } {
    const found = this.splitKey.get(connInnov);
    if (found) return found;
    const rec = { node: this.nextNodeId++, inInnov: this.nextInnov++, outInnov: this.nextInnov++ };
    this.splitKey.set(connInnov, rec);
    return rec;
  }
}

/** Mutate a genome: weight/bias jitter, activation swaps, and the structural
 *  operators that make this real NEAT — add-connection, add-node, and (optional,
 *  neataptic-style) gating and self/recurrent links. All rates live in HYPER. */
export function mutate(g: Genome, rng: Rng, innov: Innovations, opts: MutateOptions = DEFAULT_OPTIONS): Genome {
  const child = cloneGenome(g);
  for (const c of child.conns) {
    if (rng.next() < HYPER.weightMutRate) c.weight = clampW(c.weight + rng.normal() * HYPER.weightMutSigma);
    if (rng.next() < HYPER.weightResetRate) c.weight = clampW(rng.normal() * 1.4);
  }
  for (const n of child.nodes) {
    if (n.kind === 0) continue;
    if (rng.next() < HYPER.biasMutRate) n.bias = clampW(n.bias + rng.normal() * HYPER.biasMutSigma);
    if (rng.next() < HYPER.activationMutRate) n.act = rng.int(ACTIVATION_COUNT);
  }
  if (rng.next() < HYPER.toggleRate && child.conns.length > 0) {
    const c = child.conns[rng.int(child.conns.length)]!;
    c.enabled = !c.enabled;
  }
  if (rng.next() < HYPER.addConnRate) addConnection(child, rng, innov, opts);
  if (rng.next() < HYPER.addNodeRate) addNode(child, rng, innov);
  if (opts.gating && rng.next() < HYPER.addGateRate) addGate(child, rng);
  return child;
}

/** Depth of each node by longest path over enabled edges (for cycle-awareness). */
function depths(g: Genome): Map<number, number> {
  const d = new Map<number, number>();
  for (const n of g.nodes) d.set(n.id, 0);
  for (let i = 0; i < g.nodes.length; i++) {
    let changed = false;
    for (const c of g.conns) {
      if (!c.enabled || c.from === c.to) continue;
      const nd = (d.get(c.from) ?? 0) + 1;
      if (nd > (d.get(c.to) ?? 0)) {
        d.set(c.to, nd);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return d;
}

function addConnection(g: Genome, rng: Rng, innov: Innovations, opts: MutateOptions): void {
  const existing = new Set<string>();
  for (const c of g.conns) existing.add(`${c.from}>${c.to}`);
  const sources = g.nodes;
  const targets = g.nodes.filter((n) => n.kind !== 0); // not an input
  const d = depths(g);
  for (let attempt = 0; attempt < 12; attempt++) {
    const from = sources[rng.int(sources.length)]!;
    const to = targets[rng.int(targets.length)]!;
    const self = from.id === to.id;
    if (self && !opts.selfConn) continue;
    if (existing.has(`${from.id}>${to.id}`)) continue;
    if (self) {
      if (rng.next() >= HYPER.selfConnRate) continue;
    } else {
      const isBack = (d.get(from.id) ?? 0) >= (d.get(to.id) ?? 0);
      if (isBack && !opts.recurrent) continue;
      if (isBack && rng.next() >= HYPER.recurrentRate) continue; // mostly keep it forward
    }
    g.conns.push({ innov: innov.connInnov(from.id, to.id), from: from.id, to: to.id, weight: rng.normal() * 1.2, enabled: true });
    return;
  }
}

function addNode(g: Genome, rng: Rng, innov: Innovations): void {
  const enabled = g.conns.filter((c) => c.enabled && c.from !== c.to);
  if (enabled.length === 0) return;
  const c = enabled[rng.int(enabled.length)]!;
  c.enabled = false;
  const { node, inInnov, outInnov } = innov.splitNode(c.innov);
  if (g.nodes.some((n) => n.id === node)) return; // already split somewhere (shared innov)
  const newNode: NodeGene = { id: node, kind: 1, act: rng.int(ACTIVATION_COUNT), bias: 0 };
  g.nodes.push(newNode);
  // from → new (weight 1) preserves the signal; new → to carries the old weight.
  g.conns.push({ innov: inInnov, from: c.from, to: node, weight: 1, enabled: true });
  g.conns.push({ innov: outInnov, from: node, to: c.to, weight: c.weight, enabled: true });
}

/** neataptic ADD_GATE: a neuron's activation modulates an existing connection. */
function addGate(g: Genome, rng: Rng): void {
  const ungated = g.conns.filter((c) => c.enabled && c.gater === undefined);
  if (ungated.length === 0) return;
  const c = ungated[rng.int(ungated.length)]!;
  c.gater = g.nodes[rng.int(g.nodes.length)]!.id;
}

/** Textbook NEAT crossover (Stanley & Miikkulainen 2002). The FITTER parent must
 *  be passed as `a` (the caller orders them by quality):
 *   • genes are aligned by innovation number;
 *   • MATCHING genes inherit their attributes at random from either parent;
 *   • DISJOINT + EXCESS genes are taken from the fitter parent `a` (genes present
 *     only in the less-fit `b` are discarded);
 *   • the 75% disable rule: if a matching gene is disabled in either parent, the
 *     child gene is disabled with probability 0.75 (else enabled).
 *  Node genes follow the connections they serve, preferring the fitter parent. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const mb = new Map<number, ConnGene>();
  for (const c of b.conns) mb.set(c.innov, c);
  const conns: ConnGene[] = [];
  for (const ca of a.conns) {
    const cb = mb.get(ca.innov);
    if (cb) {
      // Matching gene: attributes random from either parent (from/to are equal).
      const src = rng.next() < 0.5 ? ca : cb;
      const enabled = ca.enabled && cb.enabled ? true : rng.next() < 0.75 ? false : true;
      conns.push({ innov: ca.innov, from: ca.from, to: ca.to, weight: src.weight, enabled, gater: src.gater });
    } else {
      // Disjoint / excess gene: inherited from the fitter parent `a`, unchanged.
      conns.push({ innov: ca.innov, from: ca.from, to: ca.to, weight: ca.weight, enabled: ca.enabled, gater: ca.gater });
    }
  }
  const need = new Set<number>();
  for (const c of conns) {
    need.add(c.from);
    need.add(c.to);
  }
  for (const n of a.nodes) need.add(n.id);
  const na = new Map<number, NodeGene>();
  for (const n of a.nodes) na.set(n.id, n);
  const nbm = new Map<number, NodeGene>();
  for (const n of b.nodes) nbm.set(n.id, n);
  const nodes: NodeGene[] = [];
  for (const id of need) {
    const src = na.get(id) ?? nbm.get(id);
    if (src) nodes.push({ id: src.id, kind: src.kind, act: src.act, bias: src.bias });
  }
  return { nodes, conns };
}
