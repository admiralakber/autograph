import { ACTIVATION_COUNT } from './activations.ts';
import { BASE_INNOV, FIRST_HIDDEN_ID } from './arch.ts';
import type { Genome, NodeGene, ConnGene } from './cppn.ts';
import { cloneGenome, W_SCALE } from './cppn.ts';
import type { Rng } from './prng.ts';

const clampW = (x: number): number => (x < -W_SCALE ? -W_SCALE : x > W_SCALE ? W_SCALE : x);

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

const RATES = {
  weight: 0.7, // fraction of weights jittered
  bias: 0.3,
  resetWeight: 0.06,
  activation: 0.08,
  addConn: 0.14,
  addNode: 0.08,
  toggle: 0.02,
  recurrent: 0.3, // chance an added connection is allowed to be a back-edge
};

/** Mutate a genome: weight/bias jitter, activation swaps, and the structural
 *  operators that make this real NEAT — add-connection and add-node — with
 *  recurrence allowed. Gradient-free, so it sidesteps the zero-quine trap. */
export function mutate(g: Genome, rng: Rng, innov: Innovations): Genome {
  const child = cloneGenome(g);
  for (const c of child.conns) {
    if (rng.next() < RATES.weight) c.weight = clampW(c.weight + rng.normal() * 0.4);
    if (rng.next() < RATES.resetWeight) c.weight = clampW(rng.normal() * 1.4);
  }
  for (const n of child.nodes) {
    if (n.kind === 0) continue;
    if (rng.next() < RATES.bias) n.bias = clampW(n.bias + rng.normal() * 0.3);
    if (rng.next() < RATES.activation) n.act = rng.int(ACTIVATION_COUNT);
  }
  if (rng.next() < RATES.toggle && child.conns.length > 0) {
    const c = child.conns[rng.int(child.conns.length)]!;
    c.enabled = !c.enabled;
  }
  if (rng.next() < RATES.addConn) addConnection(child, rng, innov);
  if (rng.next() < RATES.addNode) addNode(child, rng, innov);
  return child;
}

/** Depth of each node by longest path over enabled edges (for cycle-awareness). */
function depths(g: Genome): Map<number, number> {
  const d = new Map<number, number>();
  for (const n of g.nodes) d.set(n.id, 0);
  for (let i = 0; i < g.nodes.length; i++) {
    let changed = false;
    for (const c of g.conns) {
      if (!c.enabled) continue;
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

function addConnection(g: Genome, rng: Rng, innov: Innovations): void {
  const existing = new Set<string>();
  for (const c of g.conns) existing.add(`${c.from}>${c.to}`);
  const sources = g.nodes;
  const targets = g.nodes.filter((n) => n.kind !== 0); // not an input
  const d = depths(g);
  for (let attempt = 0; attempt < 12; attempt++) {
    const from = sources[rng.int(sources.length)]!;
    const to = targets[rng.int(targets.length)]!;
    if (from.id === to.id) continue;
    if (existing.has(`${from.id}>${to.id}`)) continue;
    const isBack = (d.get(from.id) ?? 0) >= (d.get(to.id) ?? 0);
    if (isBack && rng.next() >= RATES.recurrent) continue; // mostly keep it forward
    g.conns.push({ innov: innov.connInnov(from.id, to.id), from: from.id, to: to.id, weight: rng.normal() * 1.2, enabled: true });
    return;
  }
}

function addNode(g: Genome, rng: Rng, innov: Innovations): void {
  const enabled = g.conns.filter((c) => c.enabled);
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

/** Innovation-aligned crossover: matching genes inherited at random, disjoint and
 *  excess genes taken from the primary parent `a`. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const mb = new Map<number, ConnGene>();
  for (const c of b.conns) mb.set(c.innov, c);
  const conns: ConnGene[] = [];
  for (const ca of a.conns) {
    const cb = mb.get(ca.innov);
    const pick = cb && rng.next() < 0.5 ? cb : ca;
    conns.push({ innov: pick.innov, from: pick.from, to: pick.to, weight: pick.weight, enabled: ca.enabled && (cb ? cb.enabled || rng.next() < 0.75 : true) });
  }
  // Nodes: every id referenced, taking the gene from a when present, else b.
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
