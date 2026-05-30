import { SUB_INPUTS, SUB_HIDDEN, SUB_OUTPUTS } from './arch.ts';
import type { Genome } from './cppn.ts';
import { evalCPPN } from './cppn.ts';

// The PHENOTYPE: a HyperNEAT substrate. Hidden neurons are *placed* by the CPPN
// (simplified ES-HyperNEAT — see below), and every connection weight is
// *painted* by the CPPN from the two nodes' 3D positions. Queried over space,
// the substrate outputs a density and a hue: the volumetric self-portrait.

const WEIGHT_GAIN = 3.0;

/** Fixed positions of the 5 input feature-nodes (x, y, z, r, bias) at z = -0.85. */
const INPUT_POS: Float32Array = (() => {
  const p = new Float32Array(SUB_INPUTS * 3);
  for (let i = 0; i < SUB_INPUTS; i++) {
    const a = (i / SUB_INPUTS) * Math.PI * 2;
    p[i * 3] = Math.cos(a) * 0.55;
    p[i * 3 + 1] = Math.sin(a) * 0.55;
    p[i * 3 + 2] = -0.85;
  }
  return p;
})();

/** Fixed positions of the 2 output nodes (density, hue) at z = +0.85. */
const OUTPUT_POS = new Float32Array([-0.3, 0, 0.85, 0.3, 0, 0.85]);

/** Deterministic candidate sites for hidden neurons (two Fibonacci shells). */
const CANDIDATES: Float32Array = (() => {
  const pts: number[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (const [n, rad] of [
    [20, 0.42],
    [20, 0.78],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * ga;
      pts.push(Math.cos(a) * r * rad, y * rad, Math.sin(a) * r * rad);
    }
  }
  return new Float32Array(pts);
})();

export interface Phenotype {
  readonly hidden: Float32Array; // SUB_HIDDEN * 3 positions
  readonly Wih: Float32Array; // SUB_INPUTS * SUB_HIDDEN
  readonly Who: Float32Array; // SUB_HIDDEN * SUB_OUTPUTS
  readonly liveIh: Uint8Array; // expressed (leo>0) input→hidden links
  readonly liveHo: Uint8Array; // expressed hidden→output links
  /** Count of expressed connections — a phenotype "size" for the readouts. */
  readonly liveConns: number;
}

const out2: [number, number] = [0, 0];

/** Build the phenotype deterministically from the DNA: ES-place hidden neurons,
 *  then paint every connection. */
export function buildPhenotype(g: Genome): Phenotype {
  // --- Simplified ES-HyperNEAT placement -----------------------------------
  // Score each candidate site by the *variance* of the incoming weight pattern
  // across the input nodes — ES-HyperNEAT's idea of "place neurons where the
  // connectivity carries information". Keep the top SUB_HIDDEN sites.
  const nCand = CANDIDATES.length / 3;
  const info = new Float32Array(nCand);
  for (let c = 0; c < nCand; c++) {
    const cx = CANDIDATES[c * 3]!;
    const cy = CANDIDATES[c * 3 + 1]!;
    const cz = CANDIDATES[c * 3 + 2]!;
    let mean = 0;
    const ws = new Float32Array(SUB_INPUTS);
    for (let i = 0; i < SUB_INPUTS; i++) {
      const w = evalCPPN(g, INPUT_POS[i * 3]!, INPUT_POS[i * 3 + 1]!, INPUT_POS[i * 3 + 2]!, cx, cy, cz, out2)[0];
      ws[i] = w;
      mean += w;
    }
    mean /= SUB_INPUTS;
    let v = 0;
    for (let i = 0; i < SUB_INPUTS; i++) {
      const d = ws[i]! - mean;
      v += d * d;
    }
    info[c] = v;
  }
  // top SUB_HIDDEN candidate indices by info
  const order = Array.from({ length: nCand }, (_, i) => i).sort((a, b) => info[b]! - info[a]!);
  const hidden = new Float32Array(SUB_HIDDEN * 3);
  for (let j = 0; j < SUB_HIDDEN; j++) {
    const c = order[j]!;
    hidden[j * 3] = CANDIDATES[c * 3]!;
    hidden[j * 3 + 1] = CANDIDATES[c * 3 + 1]!;
    hidden[j * 3 + 2] = CANDIDATES[c * 3 + 2]!;
  }

  // --- Paint connection weights (gated by link-expression leo) --------------
  const Wih = new Float32Array(SUB_INPUTS * SUB_HIDDEN);
  const liveIh = new Uint8Array(SUB_INPUTS * SUB_HIDDEN);
  let live = 0;
  for (let i = 0; i < SUB_INPUTS; i++) {
    for (let j = 0; j < SUB_HIDDEN; j++) {
      const r = evalCPPN(g, INPUT_POS[i * 3]!, INPUT_POS[i * 3 + 1]!, INPUT_POS[i * 3 + 2]!, hidden[j * 3]!, hidden[j * 3 + 1]!, hidden[j * 3 + 2]!, out2);
      const on = r[1] > 0 ? 1 : 0;
      liveIh[i * SUB_HIDDEN + j] = on;
      Wih[i * SUB_HIDDEN + j] = on ? r[0] * WEIGHT_GAIN : 0;
      live += on;
    }
  }
  const Who = new Float32Array(SUB_HIDDEN * SUB_OUTPUTS);
  const liveHo = new Uint8Array(SUB_HIDDEN * SUB_OUTPUTS);
  for (let j = 0; j < SUB_HIDDEN; j++) {
    for (let o = 0; o < SUB_OUTPUTS; o++) {
      const r = evalCPPN(g, hidden[j * 3]!, hidden[j * 3 + 1]!, hidden[j * 3 + 2]!, OUTPUT_POS[o * 3]!, OUTPUT_POS[o * 3 + 1]!, OUTPUT_POS[o * 3 + 2]!, out2);
      const on = r[1] > 0 ? 1 : 0;
      liveHo[j * SUB_OUTPUTS + o] = on;
      Who[j * SUB_OUTPUTS + o] = on ? r[0] * WEIGHT_GAIN : 0;
      live += on;
    }
  }
  return { hidden, Wih, Who, liveIh, liveHo, liveConns: live };
}

const hbuf = new Float32Array(SUB_HIDDEN);

/** Query the phenotype at a 3D point -> [density in [0,1], hue in [0,1]]. */
export function substrateForward(p: Phenotype, px: number, py: number, pz: number, out: [number, number] = [0, 0]): [number, number] {
  const inp = [px, py, pz, Math.sqrt(px * px + py * py + pz * pz), 1];
  for (let j = 0; j < SUB_HIDDEN; j++) {
    let s = 0;
    for (let i = 0; i < SUB_INPUTS; i++) s += inp[i]! * p.Wih[i * SUB_HIDDEN + j]!;
    hbuf[j] = Math.tanh(s);
  }
  let d = 0;
  let h = 0;
  for (let j = 0; j < SUB_HIDDEN; j++) {
    d += hbuf[j]! * p.Who[j * SUB_OUTPUTS]!;
    h += hbuf[j]! * p.Who[j * SUB_OUTPUTS + 1]!;
  }
  out[0] = 1 / (1 + Math.exp(-d)); // density
  out[1] = (Math.sin(h) + 1) * 0.5; // hue
  return out;
}

// --- Accessors for visualisation --------------------------------------------

export interface SubNode {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly role: 'in' | 'hidden' | 'out';
}
export interface SubConn {
  readonly a: SubNode;
  readonly b: SubNode;
  readonly weight: number;
}

export function phenotypeNodes(p: Phenotype): SubNode[] {
  const nodes: SubNode[] = [];
  for (let i = 0; i < SUB_INPUTS; i++) nodes.push({ x: INPUT_POS[i * 3]!, y: INPUT_POS[i * 3 + 1]!, z: INPUT_POS[i * 3 + 2]!, role: 'in' });
  for (let j = 0; j < SUB_HIDDEN; j++) nodes.push({ x: p.hidden[j * 3]!, y: p.hidden[j * 3 + 1]!, z: p.hidden[j * 3 + 2]!, role: 'hidden' });
  for (let o = 0; o < SUB_OUTPUTS; o++) nodes.push({ x: OUTPUT_POS[o * 3]!, y: OUTPUT_POS[o * 3 + 1]!, z: OUTPUT_POS[o * 3 + 2]!, role: 'out' });
  return nodes;
}

export function phenotypeConns(p: Phenotype): SubConn[] {
  const nodes = phenotypeNodes(p);
  const inOff = 0;
  const hidOff = SUB_INPUTS;
  const outOff = SUB_INPUTS + SUB_HIDDEN;
  const conns: SubConn[] = [];
  for (let i = 0; i < SUB_INPUTS; i++)
    for (let j = 0; j < SUB_HIDDEN; j++)
      if (p.liveIh[i * SUB_HIDDEN + j]) conns.push({ a: nodes[inOff + i]!, b: nodes[hidOff + j]!, weight: p.Wih[i * SUB_HIDDEN + j]! });
  for (let j = 0; j < SUB_HIDDEN; j++)
    for (let o = 0; o < SUB_OUTPUTS; o++)
      if (p.liveHo[j * SUB_OUTPUTS + o]) conns.push({ a: nodes[hidOff + j]!, b: nodes[outOff + o]!, weight: p.Who[j * SUB_OUTPUTS + o]! });
  return conns;
}
