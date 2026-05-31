import type { Genome } from '../engine/cppn.ts';
import { ACTIVATIONS } from '../engine/activations.ts';
import type { SubNode, SubConn } from '../engine/substrate.ts';
import { lifeRgb } from '../engine/palette.ts';

// Network diagrams. The instrument chrome stays greyscale — but a network is a
// LIVING thing, so the colour policy extends here exactly as it does on the
// renders: the fixed input/output frame is grey CHROME, while the evolved hidden
// neurons (the computation, the life) carry the SUNRISE palette, hued by their
// activation function. So you can read, at a glance:
//   role        → shape + size  (input ▢ small grey · hidden ● sunrise · output ◎ large white-ringed)
//   activation  → sunrise HUE on hidden nodes (sin/gauss/tanh/… each its own colour; legend + hover)
//   weight sign → solid (excitatory) vs dashed (inhibitory) + light/dark grey
//   weight mag  → stroke width + opacity
//   recurrent   → a bowed back-edge arc;  self-connection → a loop on the node
//   gate        → a dotted tendril from the gater node to the connection it modulates
// A travelling activation pulse propagates ALONG THE REAL WIRING (input → hidden →
// output, following each edge, including recurrent/self) — see NetworkPulse.

const SVG = 'http://www.w3.org/2000/svg';
const W = 360;
const H = 286;
const PAD_X = 46;
const PAD_Y = 28;
const LEGEND_Y = 250; // legend band below the graph

const grey = (v: number): string => {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${g},${g},${g})`;
};
/** Sunrise colour for an activation index (hidden-neuron "life" colour). */
const actColour = (act: number): string => {
  const [r, g, b] = lifeRgb(act / Math.max(1, ACTIVATIONS.length - 1));
  return `rgb(${r},${g},${b})`;
};
const IN_GREY = 0.5; // input frame — chrome
const el = <K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG, name);

export type Role = 'in' | 'hidden' | 'out';
export interface LayoutNode {
  x: number;
  y: number;
  layer: number;
  role: Role;
  /** Resolved fill colour (grey chrome for in/out, sunrise for hidden). */
  fill: string;
  r: number;
  /** Activation index (hidden nodes) — drives colour + legend + tooltip. */
  act?: number;
  /** Normalised graph order [0,1] (inputs→0, outputs→1) for the topology pulse. */
  order: number;
  /** Self-connection on this node (a loop) — magnitude in [0,1], sign. */
  selfMag?: number;
  selfExcit?: boolean;
  /** This node gates at least one connection. */
  isGater?: boolean;
  label?: string;
  title: string;
}
export interface LayoutEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mag: number;
  excit: boolean;
  /** A back/lateral edge (recurrent loop) — drawn as an arc, not a straight line. */
  recurrent?: boolean;
  /** Quadratic control point for the recurrent arc (shared by paint + pulse). */
  cx?: number;
  cy?: number;
  /** Source/target graph order [0,1] — the pulse travels source→target. */
  fromOrder: number;
  toOrder: number;
  /** If gated: the gater node's position — draw a tendril to this edge's midpoint. */
  gx?: number;
  gy?: number;
}
export interface NetLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  layers: number;
  /** Activation indices present among hidden nodes (for the legend). */
  acts: number[];
}

const CPPN_IN = ['x₁', 'y₁', 'z₁', 'x₂', 'y₂', 'z₂', 'b'];
// The CPPN (DNA) paints 11 channels: the IMAGE (weight, bias) + the v6 temporal faculties
// (α, emit, modGate, fixX/fixY/fixScale, halt) + the v7 WRITER (emitVal, emitEnd).
const CPPN_OUT = ['weight', 'bias', 'α', 'emit', 'modGate', 'fixX', 'fixY', 'fixScale', 'halt', 'emitVal', 'emitEnd'];
// v7 — the phenotype is READ and WRITTEN, not just painted. Its 5 input ports are
// TIME-MULTIPLEXED across the substrate's uses; we label them by the READ glimpse (the
// headline) and the titles carry the full truth (painter coord · write feedback). The 2
// output neurons are the PAINTER's density/hue; the read/write OUTPUTS (the real-valued gene, the
// end-signal, the next glimpse) are CPPN-painted READOUTS distributed across the neurons,
// NOT these two nodes — surfaced in the legend + the graph note, not as fake output ports.
const SUB_IN = ['fix x', 'fix y', 'fovea', 'periph', 'b'];
const SUB_OUT = ['density', 'hue'];
const SUB_IN_DESC: Record<string, string> = {
  'fix x': 'fix x — WHERE the brain looks (glimpse fixation x, the READ). Same port: the painter’s x-coord; in the WRITE it carries the brain’s previous emitted value (autoregressive feedback).',
  'fix y': 'fix y — WHERE the brain looks (glimpse fixation y, the READ). Same port: the painter’s y-coord; in the WRITE it carries the emit-mode flag.',
  fovea: 'fovea — the FINE central density the brain sees at its fixation (the READ glimpse). Same port: the painter’s z-coord; in the WRITE it carries the emit position.',
  periph: 'periph — the COARSE surrounding density at its fixation (the READ glimpse). Same port: the painter’s r = radius.',
  b: 'b — bias: a constant 1 (lets neurons shift), in every phase.',
};
const SUB_OUT_DESC: Record<string, string> = {
  density: 'density — the PAINTER output: “is there substance here?” (the glow that makes the image the brain reads). NOT a read/write output.',
  hue: 'hue — the PAINTER output: the colour painted at this point. The DNA the brain WRITES is read out across its neurons (real-valued gene · halt · next-glimpse), not from this node.',
};
const CPPN_OUT_DESC: Record<string, string> = {
  weight: 'weight — the connection strength painted between two coordinates (paints the image)',
  bias: 'bias — a neuron’s bias, read at its own coordinate (p,p) (paints the image)',
  'α': 'α — per-connection Hebbian plasticity coefficient (the synapse self-modifies as the brain reads)',
  emit: 'emit — per-neuron neuromodulator emission (the brain’s own signal m(t) gates its plasticity)',
  modGate: 'modGate — how much m(t) gates each synapse’s learning rate (Backpropamine form)',
  fixX: 'fixX — attention readout: where to look next, x (the brain chooses its glimpse)',
  fixY: 'fixY — attention readout: where to look next, y',
  fixScale: 'fixScale — attention readout: glimpse zoom',
  halt: 'halt — the READ’s halt signal (Adaptive Computation Time): “I’ve seen enough”',
  emitVal: 'emitVal — the WRITER readout: the next DNA element the brain emits (autoregressive)',
  emitEnd: 'emitEnd — the WRITER readout: the end-of-sequence signal — the brain DECIDES its own length',
};

function colX(layer: number, layers: number): number {
  return PAD_X + (layers <= 1 ? 0.5 : layer / (layers - 1)) * (W - 2 * PAD_X);
}
function rowY(i: number, n: number): number {
  return PAD_Y + ((i + 0.5) / n) * (LEGEND_Y - 8 - PAD_Y);
}

/** Quadratic-Bézier point (for tracing the recurrent arc with the pulse spark). */
function quad(t: number, p0: number, c: number, p2: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * c + t * t * p2;
}

/** A compact legend so a non-specialist can read the diagram: role shapes + the
 *  fact that hidden colour = activation, plus swatches for the activations present. */
function drawLegend(svg: SVGSVGElement, acts: number[], spatial = false): void {
  const g = el('g');
  g.setAttribute('class', 'ag-legend');
  const item = (x: number, y: number, draw: (cx: number, cy: number) => void, text: string): number => {
    draw(x + 5, y);
    const t = el('text');
    t.setAttribute('x', String(x + 13));
    t.setAttribute('y', String(y + 2.6));
    t.setAttribute('class', 'ag-legend-t');
    t.textContent = text;
    g.appendChild(t);
    return x + 18 + text.length * 4.3;
  };
  const square = (cx: number, cy: number): void => {
    const r = el('rect');
    r.setAttribute('x', String(cx - 3));
    r.setAttribute('y', String(cy - 3));
    r.setAttribute('width', '6');
    r.setAttribute('height', '6');
    r.setAttribute('fill', grey(IN_GREY));
    g.appendChild(r);
  };
  const circle = (cx: number, cy: number, fill: string, ring = false): void => {
    const c = el('circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', ring ? '3.4' : '3.4');
    c.setAttribute('fill', fill);
    g.appendChild(c);
    if (ring) {
      const o = el('circle');
      o.setAttribute('cx', String(cx));
      o.setAttribute('cy', String(cy));
      o.setAttribute('r', '5');
      o.setAttribute('fill', 'none');
      o.setAttribute('stroke', grey(0.85));
      o.setAttribute('stroke-width', '0.7');
      g.appendChild(o);
    }
  };
  let x = PAD_X - 6;
  x = item(x, LEGEND_Y, (cx, cy) => square(cx, cy), 'input');
  x = item(x, LEGEND_Y, (cx, cy) => circle(cx, cy, actColour(0)), 'hidden');
  x = item(x, LEGEND_Y, (cx, cy) => circle(cx, cy, 'rgb(250,250,250)', true), 'output');

  // second row: hidden colour = activation, with the activations present
  const note = el('text');
  note.setAttribute('x', String(PAD_X - 1));
  note.setAttribute('y', String(LEGEND_Y + 12));
  note.setAttribute('class', 'ag-legend-t');
  note.textContent = 'hue = activation:';
  g.appendChild(note);
  let ax = PAD_X + 64;
  for (const a of acts.slice(0, 7)) {
    const sw = el('circle');
    sw.setAttribute('cx', String(ax));
    sw.setAttribute('cy', String(LEGEND_Y + 9.4));
    sw.setAttribute('r', '3');
    sw.setAttribute('fill', actColour(a));
    const tt = el('title');
    tt.textContent = ACTIVATIONS[a] ?? String(a);
    sw.appendChild(tt);
    g.appendChild(sw);
    const lab = el('text');
    lab.setAttribute('x', String(ax + 5));
    lab.setAttribute('y', String(LEGEND_Y + 12));
    lab.setAttribute('class', 'ag-legend-t');
    lab.textContent = (ACTIVATIONS[a] ?? '').slice(0, 4);
    g.appendChild(lab);
    ax += 11 + ((ACTIVATIONS[a] ?? '').slice(0, 4).length) * 4.3;
  }

  // third row: the v7 pathway note — the brain (substrate) reads + writes; the DNA paints.
  const path = el('text');
  path.setAttribute('x', String(PAD_X - 1));
  path.setAttribute('y', String(LEGEND_Y + 24));
  path.setAttribute('class', 'ag-legend-t');
  path.textContent = spatial
    ? 'plastic · neuromodulated · attentive brain'
    : 'outputs paint the image (weight·bias) + the faculties + the writer';
  g.appendChild(path);

  svg.appendChild(g);
}

/** Paint a layout into an SVG: optional flow header, weighted edges (straight /
 *  recurrent arcs), gate tendrils, self-loops, role-shaped + activation-coloured
 *  nodes, and a legend. `spatial` = the substrate's true top-down (x,y) placement. */
function paint(svg: SVGSVGElement, layout: NetLayout, onHover?: (text: string) => void, spatial = false): void {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();

  if (spatial) {
    const mk = (y: number, txt: string): void => {
      const note = el('text');
      note.setAttribute('x', String(W / 2));
      note.setAttribute('y', String(y));
      note.setAttribute('class', 'ag-axis ag-axis-dim');
      note.setAttribute('text-anchor', 'middle');
      note.textContent = txt;
      svg.append(note);
    };
    mk(11, 'reads its image (glimpses) → writes its DNA');
    mk(21, 'writes value·halt·next-look · density·hue = painter');
  } else {
    const headIn = el('text');
    headIn.setAttribute('x', String(PAD_X));
    headIn.setAttribute('y', '13');
    headIn.setAttribute('class', 'ag-axis');
    headIn.setAttribute('text-anchor', 'middle');
    headIn.textContent = 'INPUT';
    const headOut = el('text');
    headOut.setAttribute('x', String(W - PAD_X));
    headOut.setAttribute('y', '13');
    headOut.setAttribute('class', 'ag-axis');
    headOut.setAttribute('text-anchor', 'middle');
    headOut.textContent = 'OUTPUT';
    const flow = el('text');
    flow.setAttribute('x', String(W / 2));
    flow.setAttribute('y', '13');
    flow.setAttribute('class', 'ag-axis ag-axis-dim');
    flow.setAttribute('text-anchor', 'middle');
    flow.textContent = 'by depth →';
    svg.append(headIn, flow, headOut);
  }

  // edges (+ gate tendrils)
  const eg = el('g');
  for (const e of layout.edges) {
    const stroke = grey(e.excit ? 0.62 + 0.33 * e.mag : 0.4 + 0.16 * e.mag);
    const width = (0.5 + e.mag * 2.4).toFixed(2);
    const opacity = (0.16 + e.mag * 0.66).toFixed(2);
    if (e.recurrent && e.cx !== undefined && e.cy !== undefined) {
      const path = el('path');
      path.setAttribute('d', `M ${e.x1.toFixed(1)} ${e.y1.toFixed(1)} Q ${e.cx.toFixed(1)} ${e.cy.toFixed(1)} ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', width);
      path.setAttribute('opacity', opacity);
      path.setAttribute('stroke-dasharray', e.excit ? '5 3' : '2 3');
      eg.appendChild(path);
    } else {
      const line = el('line');
      line.setAttribute('x1', e.x1.toFixed(1));
      line.setAttribute('y1', e.y1.toFixed(1));
      line.setAttribute('x2', e.x2.toFixed(1));
      line.setAttribute('y2', e.y2.toFixed(1));
      line.setAttribute('stroke', stroke);
      line.setAttribute('stroke-width', width);
      line.setAttribute('opacity', opacity);
      if (!e.excit) line.setAttribute('stroke-dasharray', '3 2');
      eg.appendChild(line);
    }
    // gate tendril: gater node → this connection's midpoint (a neuron modulating a wire)
    if (e.gx !== undefined && e.gy !== undefined) {
      const mx = e.recurrent && e.cx !== undefined ? quad(0.5, e.x1, e.cx, e.x2) : (e.x1 + e.x2) / 2;
      const my = e.recurrent && e.cy !== undefined ? quad(0.5, e.y1, e.cy, e.y2) : (e.y1 + e.y2) / 2;
      const tendril = el('line');
      tendril.setAttribute('x1', e.gx.toFixed(1));
      tendril.setAttribute('y1', e.gy.toFixed(1));
      tendril.setAttribute('x2', mx.toFixed(1));
      tendril.setAttribute('y2', my.toFixed(1));
      tendril.setAttribute('stroke', actColour(2));
      tendril.setAttribute('stroke-width', '0.7');
      tendril.setAttribute('opacity', '0.5');
      tendril.setAttribute('stroke-dasharray', '1 2');
      eg.appendChild(tendril);
      const dot = el('circle');
      dot.setAttribute('cx', mx.toFixed(1));
      dot.setAttribute('cy', my.toFixed(1));
      dot.setAttribute('r', '1.5');
      dot.setAttribute('fill', actColour(2));
      dot.setAttribute('opacity', '0.7');
      eg.appendChild(dot);
    }
  }
  svg.appendChild(eg);

  // nodes
  for (const n of layout.nodes) {
    // self-loop ring (a node feeding itself)
    if (n.selfMag !== undefined) {
      const loop = el('circle');
      loop.setAttribute('cx', n.x.toFixed(1));
      loop.setAttribute('cy', (n.y - n.r - 4).toFixed(1));
      loop.setAttribute('r', (n.r * 0.62 + 1).toFixed(1));
      loop.setAttribute('fill', 'none');
      loop.setAttribute('stroke', grey(n.selfExcit ? 0.8 : 0.5));
      loop.setAttribute('stroke-width', (0.6 + n.selfMag * 1.4).toFixed(2));
      loop.setAttribute('opacity', '0.7');
      if (!n.selfExcit) loop.setAttribute('stroke-dasharray', '2 1.5');
      svg.appendChild(loop);
    }

    let shape: SVGElement;
    if (n.role === 'in') {
      const s = n.r * 1.7;
      const rect = el('rect');
      rect.setAttribute('x', (n.x - s / 2).toFixed(1));
      rect.setAttribute('y', (n.y - s / 2).toFixed(1));
      rect.setAttribute('width', s.toFixed(1));
      rect.setAttribute('height', s.toFixed(1));
      rect.setAttribute('rx', '0.5');
      shape = rect;
    } else {
      const c = el('circle');
      c.setAttribute('cx', n.x.toFixed(1));
      c.setAttribute('cy', n.y.toFixed(1));
      c.setAttribute('r', String(n.r));
      shape = c;
    }
    shape.setAttribute('fill', n.fill);
    shape.setAttribute('stroke', grey(n.role === 'hidden' ? 0.12 : 0.7));
    shape.setAttribute('stroke-width', n.role === 'hidden' ? '0.6' : '0.8');
    if (onHover) {
      (shape as SVGElement & { style: CSSStyleDeclaration }).style.cursor = 'crosshair';
      shape.addEventListener('mouseenter', () => onHover(n.title));
    }
    const t = el('title');
    t.textContent = n.title;
    shape.appendChild(t);
    svg.appendChild(shape);

    // a gater wears a small open diamond so it reads as "this neuron modulates"
    if (n.isGater) {
      const dia = el('rect');
      const s = 3.2;
      dia.setAttribute('x', (n.x - s).toFixed(1));
      dia.setAttribute('y', (n.y - s).toFixed(1));
      dia.setAttribute('width', String(s * 2));
      dia.setAttribute('height', String(s * 2));
      dia.setAttribute('fill', 'none');
      dia.setAttribute('stroke', actColour(2));
      dia.setAttribute('stroke-width', '0.8');
      dia.setAttribute('transform', `rotate(45 ${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
      dia.setAttribute('opacity', '0.85');
      svg.appendChild(dia);
    }

    if (n.role === 'out') {
      const ring = el('circle');
      ring.setAttribute('cx', n.x.toFixed(1));
      ring.setAttribute('cy', n.y.toFixed(1));
      ring.setAttribute('r', String(n.r + 3));
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', grey(0.85));
      ring.setAttribute('stroke-width', '0.9');
      svg.appendChild(ring);
    }
    if (n.label) {
      const lab = el('text');
      const left = n.role === 'in';
      lab.setAttribute('x', (n.x + (left ? -(n.r + 6) : n.r + 6)).toFixed(1));
      lab.setAttribute('y', (n.y + 3).toFixed(1));
      lab.setAttribute('text-anchor', left ? 'end' : 'start');
      lab.setAttribute('class', 'ag-nlabel');
      lab.textContent = n.label;
      svg.appendChild(lab);
    }
  }

  drawLegend(svg, layout.acts, spatial);
}

/** The DNA — the NEAT CPPN graph — laid out left→right by longest-path depth, so
 *  augmenting topology (added nodes, depth, recurrent/self connections, gates) is
 *  legible. Hidden neurons are coloured by their activation function. */
export function drawCppnGraph(svg: SVGSVGElement, g: Genome, onHover?: (text: string) => void): NetLayout {
  // longest-path depth over enabled, non-self edges (inputs at 0)
  const depth = new Map<number, number>();
  for (const n of g.nodes) depth.set(n.id, 0);
  for (let it = 0; it < g.nodes.length; it++) {
    let changed = false;
    for (const c of g.conns) {
      if (!c.enabled || c.from === c.to) continue;
      const nd = (depth.get(c.from) ?? 0) + 1;
      if (nd > (depth.get(c.to) ?? 0)) {
        depth.set(c.to, nd);
        changed = true;
      }
    }
    if (!changed) break;
  }
  let maxDepth = 1;
  for (const n of g.nodes) if (n.kind !== 0) maxDepth = Math.max(maxDepth, depth.get(n.id) ?? 0);
  const outCol = Math.max(1, maxDepth);
  const layersCount = outCol + 1;
  const colOf = (n: { id: number; kind: number }): number => (n.kind === 0 ? 0 : n.kind === 2 ? outCol : Math.min(Math.max(depth.get(n.id) ?? 1, 1), Math.max(1, outCol - 1)));
  const orderOf = (col: number): number => (layersCount <= 1 ? 0 : col / (layersCount - 1));

  // group by column to spread vertically
  const cols = new Map<number, number>();
  const indexInCol = new Map<number, number>();
  for (const n of g.nodes) {
    const c = colOf(n);
    indexInCol.set(n.id, cols.get(c) ?? 0);
    cols.set(c, (cols.get(c) ?? 0) + 1);
  }

  const gaterIds = new Set<number>();
  for (const c of g.conns) if (c.enabled && c.gater !== undefined) gaterIds.add(c.gater);

  const idToNode = new Map<number, LayoutNode>();
  const nodes: LayoutNode[] = [];
  const actsPresent = new Set<number>();
  for (const n of g.nodes) {
    const c = colOf(n);
    const count = cols.get(c) ?? 1;
    const x = colX(c, layersCount);
    const y = rowY(indexInCol.get(n.id) ?? 0, count);
    const inLbl = n.kind === 0 ? CPPN_IN[n.id] : undefined;
    const outLbl = n.kind === 2 ? CPPN_OUT[n.id - 7] : undefined;
    if (n.kind === 1) actsPresent.add(n.act);
    const ln: LayoutNode = {
      x,
      y,
      layer: c,
      order: orderOf(c),
      role: n.kind === 0 ? 'in' : n.kind === 2 ? 'out' : 'hidden',
      fill: n.kind === 0 ? grey(IN_GREY) : n.kind === 2 ? 'rgb(250,250,250)' : actColour(n.act),
      r: n.kind === 0 ? 4.2 : n.kind === 2 ? 7 : 5.5,
      act: n.kind === 1 ? n.act : undefined,
      isGater: gaterIds.has(n.id),
      label: inLbl ?? outLbl,
      title:
        n.kind === 0
          ? `INPUT ${inLbl ?? n.id}`
          : n.kind === 2
            ? (CPPN_OUT_DESC[outLbl ?? ''] ?? `OUTPUT ${outLbl ?? n.id}`)
            : `HIDDEN #${n.id} · ${ACTIVATIONS[n.act] ?? '?'}${gaterIds.has(n.id) ? ' · gates a connection' : ''}`,
    };
    idToNode.set(n.id, ln);
    nodes.push(ln);
  }

  let maxAbs = 1e-4;
  for (const c of g.conns) if (c.enabled) maxAbs = Math.max(maxAbs, Math.abs(c.weight));
  const edges: LayoutEdge[] = [];
  for (const c of g.conns) {
    if (!c.enabled) continue;
    const a = idToNode.get(c.from);
    const b = idToNode.get(c.to);
    if (!a || !b) continue;
    const mag = Math.abs(c.weight) / maxAbs;
    if (c.from === c.to) {
      // self-connection → a loop decoration on the node (not a zero-length edge)
      a.selfMag = mag;
      a.selfExcit = c.weight >= 0;
      continue;
    }
    const recurrent = (depth.get(c.from) ?? 0) >= (depth.get(c.to) ?? 0);
    const gater = c.gater !== undefined ? idToNode.get(c.gater) : undefined;
    const edge: LayoutEdge = {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      mag,
      excit: c.weight >= 0,
      recurrent,
      fromOrder: a.order,
      toOrder: b.order,
    };
    if (recurrent) {
      edge.cx = (a.x + b.x) / 2;
      edge.cy = (a.y + b.y) / 2 - 26 - mag * 14;
    }
    if (gater) {
      edge.gx = gater.x;
      edge.gy = gater.y;
    }
    edges.push(edge);
  }
  const layout: NetLayout = { nodes, edges, layers: layersCount, acts: [...actsPresent].sort((p, q) => p - q) };
  paint(svg, layout, onHover);
  return layout;
}

/** The phenotype substrate drawn at its TRUE top-down (x,y) placement — the
 *  coordinates ES-HyperNEAT's quadtree chose. Because the quadtree places neurons
 *  where the CPPN pattern carries information, this view spatially mirrors the
 *  image: the neurons sit where the picture has structure. Hidden neurons are
 *  coloured by activation; a topology pulse flows input→hidden→output. */
export function drawSubstrateGraph(svg: SVGSVGElement, subNodes: SubNode[], conns: SubConn[], onHover?: (text: string) => void): NetLayout {
  const S = Math.min(W - 2 * PAD_X, LEGEND_Y - 8 - PAD_Y);
  const mapX = (sx: number): number => W / 2 + sx * (S / 2);
  const mapY = (sy: number): number => (PAD_Y + LEGEND_Y - 8) / 2 + sy * (S / 2);

  // BFS order from inputs over the substrate wiring, so the pulse follows the real
  // connectivity (input → hidden → output), not a left→right sweep.
  const idx = new Map<SubNode, number>();
  subNodes.forEach((n, i) => idx.set(n, i));
  const ord = new Array<number>(subNodes.length).fill(-1);
  subNodes.forEach((n, i) => { if (n.role === 'in') ord[i] = 0; });
  for (let it = 0; it < subNodes.length; it++) {
    let changed = false;
    for (const c of conns) {
      const ai = idx.get(c.a);
      const bi = idx.get(c.b);
      if (ai === undefined || bi === undefined) continue;
      if (ord[ai]! >= 0 && ord[bi]! < ord[ai]! + 1) { ord[bi] = ord[ai]! + 1; changed = true; }
    }
    if (!changed) break;
  }
  let maxOrd = 1;
  for (const o of ord) maxOrd = Math.max(maxOrd, o);
  const norm = (i: number): number => (ord[i]! < 0 ? 0.5 : ord[i]! / maxOrd);

  const place = new Map<SubNode, LayoutNode>();
  const nodes: LayoutNode[] = [];
  const actsPresent = new Set<number>();
  let inI = 0;
  let outI = 0;
  subNodes.forEach((n, i) => {
    const x = mapX(n.x);
    const y = mapY(n.y);
    let ln: LayoutNode;
    if (n.role === 'in') {
      ln = { x, y, layer: 0, order: 0, role: 'in', fill: grey(IN_GREY), r: 4.2, label: SUB_IN[inI], title: SUB_IN_DESC[SUB_IN[inI] ?? ''] ?? `INPUT ${SUB_IN[inI] ?? inI}` };
      inI++;
    } else if (n.role === 'out') {
      ln = { x, y, layer: 2, order: 1, role: 'out', fill: 'rgb(250,250,250)', r: 7, label: SUB_OUT[outI], title: SUB_OUT_DESC[SUB_OUT[outI] ?? ''] ?? `OUTPUT ${SUB_OUT[outI] ?? outI}` };
      outI++;
    } else {
      const act = n.act ?? 0;
      actsPresent.add(act);
      ln = { x, y, layer: 1, order: norm(i), role: 'hidden', fill: actColour(act), r: 5, act, title: `HIDDEN · ${ACTIVATIONS[act] ?? '?'} · ES-placed at (${n.x.toFixed(2)}, ${n.y.toFixed(2)})` };
    }
    place.set(n, ln);
    nodes.push(ln);
  });

  let maxAbs = 1e-4;
  for (const c of conns) maxAbs = Math.max(maxAbs, Math.abs(c.weight));
  const edges: LayoutEdge[] = [];
  for (const c of conns) {
    const a = place.get(c.a);
    const b = place.get(c.b);
    if (!a || !b) continue;
    const mag = Math.abs(c.weight) / maxAbs;
    if (c.a === c.b) {
      a.selfMag = mag;
      a.selfExcit = c.weight >= 0;
      continue;
    }
    const recurrent = b.order <= a.order && a.role !== 'in';
    const edge: LayoutEdge = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, mag, excit: c.weight >= 0, recurrent, fromOrder: a.order, toOrder: b.order };
    if (recurrent) {
      edge.cx = (a.x + b.x) / 2;
      edge.cy = (a.y + b.y) / 2 - 22 - mag * 12;
    }
    edges.push(edge);
  }
  const layout: NetLayout = { nodes, edges, layers: 3, acts: [...actsPresent].sort((p, q) => p - q) };
  paint(svg, layout, onHover, true);
  return layout;
}

// --- The activation pulse: a wavefront propagating ALONG THE REAL WIRING --------

const reduceMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animates a travelling "signal" that propagates by GRAPH ORDER (inputs first,
 *  then their downstream neurons, …) rather than by raw x-position: a node halo
 *  glows as the front reaches its order, and a spark runs along each edge from its
 *  source to its target — forward edges flow downstream, recurrent/self edges fire
 *  back along their arc — so the animation reads as signal actually flowing through
 *  the wiring. Works for both the spatial substrate and the layered CPPN. */
export class NetworkPulse {
  private raf = 0;
  private overlay: SVGGElement | null = null;
  private halos: SVGCircleElement[] = [];
  private sparks: SVGCircleElement[] = [];
  private layout: NetLayout | null = null;
  private readonly period = 2600; // ms for a full propagation + rest

  attach(svg: SVGSVGElement, layout: NetLayout): void {
    this.layout = layout;
    this.overlay?.remove();
    const g = el('g');
    g.setAttribute('class', 'ag-pulse');
    this.overlay = g;
    this.halos = layout.nodes.map((n) => {
      const c = el('circle');
      c.setAttribute('cx', n.x.toFixed(1));
      c.setAttribute('cy', n.y.toFixed(1));
      c.setAttribute('r', String(n.r + 4));
      c.setAttribute('fill', n.role === 'hidden' ? n.fill : 'rgb(250,250,250)');
      c.setAttribute('opacity', '0');
      g.appendChild(c);
      return c;
    });
    this.sparks = layout.edges.map((e) => {
      const c = el('circle');
      c.setAttribute('r', '1.8');
      // spark carries the source node's life-colour where it has one
      c.setAttribute('fill', 'rgb(252,252,252)');
      c.setAttribute('opacity', '0');
      void e;
      g.appendChild(c);
      return c;
    });
    svg.appendChild(g);
    if (!this.raf && !reduceMotion()) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const layout = this.layout;
    if (!layout) return;
    const phase = (now % this.period) / this.period; // 0..1
    // front sweeps over normalised order [−0.1 .. 1.2] in the first 80% of the period
    const sweep = Math.min(1, phase / 0.8);
    const front = -0.1 + sweep * 1.3;
    const active = phase < 0.84 ? 1 : 0;
    const sigma = 0.12;

    for (let i = 0; i < layout.nodes.length; i++) {
      const n = layout.nodes[i]!;
      const d = (front - n.order) / sigma;
      const glow = Math.exp(-d * d) * active;
      this.halos[i]!.setAttribute('opacity', (glow * 0.55).toFixed(3));
      this.halos[i]!.setAttribute('r', (n.r + 4 + glow * 5).toFixed(2));
    }
    for (let i = 0; i < layout.edges.length; i++) {
      const e = layout.edges[i]!;
      const s = this.sparks[i]!;
      const span = Math.max(0.14, Math.abs(e.toOrder - e.fromOrder));
      const localT = (front - e.fromOrder) / span; // travels source→target once the front reaches the source
      if (active && localT >= 0 && localT <= 1) {
        let px: number;
        let py: number;
        if (e.recurrent && e.cx !== undefined && e.cy !== undefined) {
          px = quad(localT, e.x1, e.cx, e.x2);
          py = quad(localT, e.y1, e.cy, e.y2);
        } else {
          px = e.x1 + (e.x2 - e.x1) * localT;
          py = e.y1 + (e.y2 - e.y1) * localT;
        }
        s.setAttribute('cx', px.toFixed(1));
        s.setAttribute('cy', py.toFixed(1));
        s.setAttribute('opacity', (0.25 + e.mag * 0.65).toFixed(2));
        s.setAttribute('r', (1.3 + e.mag * 1.6).toFixed(2));
      } else {
        s.setAttribute('opacity', '0');
      }
    }
  };

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.overlay?.remove();
    this.overlay = null;
    this.layout = null;
  }
}
