import type { Genome } from '../engine/cppn.ts';
import { ACTIVATIONS } from '../engine/activations.ts';
import type { SubNode, SubConn } from '../engine/substrate.ts';

// Greyscale network diagrams — the chrome is monochrome; only life gets colour.
// Encoding, held rigorously:
//   weight SIGN      → solid (excitatory) vs dashed (inhibitory), + light/dark grey
//   weight MAGNITUDE → stroke width + opacity
//   node ROLE        → shape (input square · hidden circle · output ringed) + size
//   node ACTIVATION  → greyscale fill
// Signal flows left → right; a travelling activation pulse makes it read as a
// thinking brain (see NetworkPulse).

const SVG = 'http://www.w3.org/2000/svg';
const W = 360;
const H = 260;
const PAD_X = 46;
const PAD_Y = 30;

const grey = (v: number): string => {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${g},${g},${g})`;
};
const el = <K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG, name);

export type Role = 'in' | 'hidden' | 'out';
export interface LayoutNode {
  x: number;
  y: number;
  layer: number;
  role: Role;
  grey: number;
  r: number;
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
}
export interface NetLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  layers: number;
}

const CPPN_IN = ['x₁', 'y₁', 'z₁', 'x₂', 'y₂', 'z₂', 'b'];
const CPPN_OUT = ['weight', 'bias'];
const SUB_IN = ['x', 'y', 'z', 'r', 'b'];
const SUB_OUT = ['density', 'hue'];
// Plain-language tooltips for a non-specialist (shown on hover).
const SUB_IN_DESC: Record<string, string> = {
  x: 'x — sample coordinate (left↔right)',
  y: 'y — sample coordinate (down↔up)',
  z: 'z — sample coordinate (back↔front)',
  r: 'r — radius: distance from centre (radial symmetry)',
  b: 'b — bias: a constant 1 (lets neurons shift)',
};
const SUB_OUT_DESC: Record<string, string> = {
  density: 'density — “is there substance here?” (the glow / alpha)',
  hue: 'hue — the colour painted at this point',
};
const CPPN_OUT_DESC: Record<string, string> = {
  weight: 'weight — the connection strength painted between two coordinates',
  bias: 'bias — a neuron’s bias, read at its own coordinate (p,p)',
};

function colX(layer: number, layers: number): number {
  return PAD_X + (layers <= 1 ? 0.5 : layer / (layers - 1)) * (W - 2 * PAD_X);
}
function rowY(i: number, n: number): number {
  return PAD_Y + ((i + 0.5) / n) * (H - 2 * PAD_Y);
}

/** Paint a layout into an SVG: column headers, weighted edges, role-shaped nodes.
 *  `spatial` = the substrate's true top-down (x,y) placement (no input→output
 *  column flow), so the picture-aligned layout reads honestly. */
function paint(svg: SVGSVGElement, layout: NetLayout, onHover?: (text: string) => void, spatial = false): void {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();

  if (spatial) {
    const note = el('text');
    note.setAttribute('x', String(W / 2));
    note.setAttribute('y', '14');
    note.setAttribute('class', 'ag-axis ag-axis-dim');
    note.setAttribute('text-anchor', 'middle');
    note.textContent = 'substrate · top-down (x,y) — neurons sit where the picture has structure';
    svg.append(note);
  }

  // column flow labels (layered views only)
  if (!spatial) {
  const headIn = el('text');
  headIn.setAttribute('x', String(PAD_X));
  headIn.setAttribute('y', '14');
  headIn.setAttribute('class', 'ag-axis');
  headIn.setAttribute('text-anchor', 'middle');
  headIn.textContent = 'INPUT';
  const headOut = el('text');
  headOut.setAttribute('x', String(W - PAD_X));
  headOut.setAttribute('y', '14');
  headOut.setAttribute('class', 'ag-axis');
  headOut.setAttribute('text-anchor', 'middle');
  headOut.textContent = 'OUTPUT';
  const flow = el('text');
  flow.setAttribute('x', String(W / 2));
  flow.setAttribute('y', '14');
  flow.setAttribute('class', 'ag-axis ag-axis-dim');
  flow.setAttribute('text-anchor', 'middle');
  flow.textContent = 'signal →';
  svg.append(headIn, flow, headOut);
  }

  // edges
  const eg = el('g');
  for (const e of layout.edges) {
    const stroke = grey(e.excit ? 0.62 + 0.33 * e.mag : 0.4 + 0.16 * e.mag);
    const width = (0.5 + e.mag * 2.4).toFixed(2);
    const opacity = (0.16 + e.mag * 0.66).toFixed(2);
    if (e.recurrent) {
      // a back-edge (recurrent loop) — bow it outward so the cycle is visible
      const path = el('path');
      const mx = (e.x1 + e.x2) / 2;
      const my = (e.y1 + e.y2) / 2 - 26 - e.mag * 14;
      path.setAttribute('d', `M ${e.x1.toFixed(1)} ${e.y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}`);
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
      if (!e.excit) line.setAttribute('stroke-dasharray', '3 2'); // inhibitory = dashed
      eg.appendChild(line);
    }
  }
  svg.appendChild(eg);

  // nodes
  for (const n of layout.nodes) {
    let shape: SVGElement;
    if (n.role === 'in') {
      const s = n.r * 1.7;
      const rect = el('rect');
      rect.setAttribute('x', (n.x - s / 2).toFixed(1));
      rect.setAttribute('y', (n.y - s / 2).toFixed(1));
      rect.setAttribute('width', s.toFixed(1));
      rect.setAttribute('height', s.toFixed(1));
      rect.setAttribute('rx', '1');
      shape = rect;
    } else {
      const c = el('circle');
      c.setAttribute('cx', n.x.toFixed(1));
      c.setAttribute('cy', n.y.toFixed(1));
      c.setAttribute('r', String(n.r));
      shape = c;
    }
    shape.setAttribute('fill', grey(n.grey));
    shape.setAttribute('stroke', grey(0.62));
    shape.setAttribute('stroke-width', '0.8');
    if (onHover) {
      (shape as SVGElement & { style: CSSStyleDeclaration }).style.cursor = 'crosshair';
      shape.addEventListener('mouseenter', () => onHover(n.title));
    }
    const t = el('title');
    t.textContent = n.title;
    shape.appendChild(t);
    svg.appendChild(shape);

    if (n.role === 'out') {
      const ring = el('circle');
      ring.setAttribute('cx', n.x.toFixed(1));
      ring.setAttribute('cy', n.y.toFixed(1));
      ring.setAttribute('r', String(n.r + 3));
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', grey(0.85));
      ring.setAttribute('stroke-width', '0.8');
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
}

/** The DNA — the NEAT CPPN graph — laid out left→right by longest-path depth, so
 *  augmenting topology (added nodes, added/recurrent connections) is legible. */
export function drawCppnGraph(svg: SVGSVGElement, g: Genome, onHover?: (text: string) => void): NetLayout {
  // longest-path depth over enabled edges (inputs at 0)
  const depth = new Map<number, number>();
  for (const n of g.nodes) depth.set(n.id, 0);
  for (let it = 0; it < g.nodes.length; it++) {
    let changed = false;
    for (const c of g.conns) {
      if (!c.enabled) continue;
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

  // group by column to spread vertically
  const cols = new Map<number, number>();
  const indexInCol = new Map<number, number>();
  for (const n of g.nodes) {
    const c = colOf(n);
    indexInCol.set(n.id, cols.get(c) ?? 0);
    cols.set(c, (cols.get(c) ?? 0) + 1);
  }

  const idToNode = new Map<number, LayoutNode>();
  const nodes: LayoutNode[] = [];
  for (const n of g.nodes) {
    const c = colOf(n);
    const count = cols.get(c) ?? 1;
    const x = colX(c, layersCount);
    const y = rowY(indexInCol.get(n.id) ?? 0, count);
    const inLbl = n.kind === 0 ? CPPN_IN[n.id] : undefined;
    const outLbl = n.kind === 2 ? CPPN_OUT[n.id - 7] : undefined;
    const ln: LayoutNode = {
      x,
      y,
      layer: c,
      role: n.kind === 0 ? 'in' : n.kind === 2 ? 'out' : 'hidden',
      grey: n.kind === 0 ? 0.55 : n.kind === 2 ? 1.0 : 0.45 + (n.act / (ACTIVATIONS.length - 1)) * 0.5,
      r: n.kind === 0 ? 4.5 : n.kind === 2 ? 7 : 5.5,
      label: inLbl ?? outLbl,
      title:
        n.kind === 0
          ? `INPUT ${inLbl ?? n.id}`
          : n.kind === 2
            ? (CPPN_OUT_DESC[outLbl ?? ''] ?? `OUTPUT ${outLbl ?? n.id}`)
            : `HIDDEN #${n.id} · ${ACTIVATIONS[n.act] ?? '?'}`,
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
    const recurrent = (depth.get(c.from) ?? 0) >= (depth.get(c.to) ?? 0);
    edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, mag: Math.abs(c.weight) / maxAbs, excit: c.weight >= 0, recurrent });
  }
  const layout: NetLayout = { nodes, edges, layers: layersCount };
  paint(svg, layout, onHover);
  return layout;
}

/** The phenotype substrate drawn at its TRUE top-down (x,y) placement — the
 *  coordinates ES-HyperNEAT's quadtree chose, NOT an arbitrary column. Because the
 *  quadtree places neurons where the CPPN pattern carries information, this view
 *  spatially mirrors the self-portrait: the neurons sit where the picture has
 *  structure. Inputs are the fixed sensor ring; outputs the density/hue pair. */
export function drawSubstrateGraph(svg: SVGSVGElement, subNodes: SubNode[], conns: SubConn[], onHover?: (text: string) => void): NetLayout {
  // Undistorted square mapping of substrate (x,y) ∈ [-1,1]² centred in the panel,
  // so relative positions match the (square) portrait frame.
  const S = Math.min(W - 2 * PAD_X, H - 2 * PAD_Y);
  const mapX = (sx: number): number => W / 2 + sx * (S / 2);
  const mapY = (sy: number): number => H / 2 + sy * (S / 2);
  const place = new Map<SubNode, LayoutNode>();
  const nodes: LayoutNode[] = [];
  let inI = 0;
  let outI = 0;
  for (const n of subNodes) {
    const x = mapX(n.x);
    const y = mapY(n.y);
    let ln: LayoutNode;
    if (n.role === 'in') {
      ln = { x, y, layer: 0, role: 'in', grey: 0.55, r: 4.5, label: SUB_IN[inI], title: SUB_IN_DESC[SUB_IN[inI] ?? ''] ?? `INPUT ${SUB_IN[inI] ?? inI}` };
      inI++;
    } else if (n.role === 'out') {
      ln = { x, y, layer: 2, role: 'out', grey: 1.0, r: 7, label: SUB_OUT[outI], title: SUB_OUT_DESC[SUB_OUT[outI] ?? ''] ?? `OUTPUT ${SUB_OUT[outI] ?? outI}` };
      outI++;
    } else {
      ln = { x, y, layer: 1, role: 'hidden', grey: 0.45 + ((n.act ?? 0) / (ACTIVATIONS.length - 1)) * 0.5, r: 5, title: `HIDDEN · ${ACTIVATIONS[n.act ?? 0] ?? '?'} · ES-placed at (${n.x.toFixed(2)}, ${n.y.toFixed(2)})` };
    }
    place.set(n, ln);
    nodes.push(ln);
  }

  let maxAbs = 1e-4;
  for (const c of conns) maxAbs = Math.max(maxAbs, Math.abs(c.weight));
  const edges: LayoutEdge[] = [];
  for (const c of conns) {
    const a = place.get(c.a);
    const b = place.get(c.b);
    if (!a || !b) continue;
    edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, mag: Math.abs(c.weight) / maxAbs, excit: c.weight >= 0 });
  }
  const layout: NetLayout = { nodes, edges, layers: 3 };
  paint(svg, layout, onHover, true);
  return layout;
}

// --- The activation pulse: a wavefront sweeping input→output ----------------

const reduceMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animates a travelling "signal" left→right across a NetLayout: node halos
 *  glow as the wavefront passes, and a bright spark runs along each edge. */
export class NetworkPulse {
  private raf = 0;
  private overlay: SVGGElement | null = null;
  private halos: SVGCircleElement[] = [];
  private sparks: SVGCircleElement[] = [];
  private layout: NetLayout | null = null;
  private readonly period = 2200; // ms for a full sweep + rest

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
      c.setAttribute('fill', 'rgb(250,250,250)');
      c.setAttribute('opacity', '0');
      g.appendChild(c);
      return c;
    });
    this.sparks = layout.edges.map(() => {
      const c = el('circle');
      c.setAttribute('r', '1.8');
      c.setAttribute('fill', 'rgb(252,252,252)');
      c.setAttribute('opacity', '0');
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
    // sweep across [0,1] in the first 78% of the period, then rest (gap)
    const sweep = Math.min(1, phase / 0.78);
    const xw = PAD_X - 12 + sweep * (W - 2 * PAD_X + 24);
    const active = phase < 0.82 ? 1 : 0;
    const sigma = 26;
    for (let i = 0; i < layout.nodes.length; i++) {
      const n = layout.nodes[i]!;
      const d = (xw - n.x) / sigma;
      const glow = Math.exp(-d * d) * active;
      this.halos[i]!.setAttribute('opacity', (glow * 0.5).toFixed(3));
      this.halos[i]!.setAttribute('r', (n.r + 4 + glow * 5).toFixed(2));
    }
    for (let i = 0; i < layout.edges.length; i++) {
      const e = layout.edges[i]!;
      const lo = Math.min(e.x1, e.x2);
      const hi = Math.max(e.x1, e.x2);
      const s = this.sparks[i]!;
      if (active && xw >= lo - 2 && xw <= hi + 2 && hi > lo) {
        const t = Math.max(0, Math.min(1, (xw - e.x1) / (e.x2 - e.x1)));
        s.setAttribute('cx', (e.x1 + (e.x2 - e.x1) * t).toFixed(1));
        s.setAttribute('cy', (e.y1 + (e.y2 - e.y1) * t).toFixed(1));
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
