import { CPPN_LAYERS } from '../engine/arch.ts';
import type { Genome } from '../engine/cppn.ts';
import { cppnEdges, nodeActivation } from '../engine/cppn.ts';
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
}
export interface NetLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  layers: number;
}

const CPPN_IN = ['x₁', 'y₁', 'z₁', 'x₂', 'y₂', 'z₂', 'b'];
const CPPN_OUT = ['weight', 'leo'];
const SUB_IN = ['x', 'y', 'z', 'r', 'b'];
const SUB_OUT = ['density', 'hue'];

function colX(layer: number, layers: number): number {
  return PAD_X + (layers <= 1 ? 0.5 : layer / (layers - 1)) * (W - 2 * PAD_X);
}
function rowY(i: number, n: number): number {
  return PAD_Y + ((i + 0.5) / n) * (H - 2 * PAD_Y);
}

/** Paint a layout into an SVG: column headers, weighted edges, role-shaped nodes. */
function paint(svg: SVGSVGElement, layout: NetLayout, onHover?: (text: string) => void): void {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();

  // column flow labels
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

  // edges
  const eg = el('g');
  for (const e of layout.edges) {
    const line = el('line');
    line.setAttribute('x1', e.x1.toFixed(1));
    line.setAttribute('y1', e.y1.toFixed(1));
    line.setAttribute('x2', e.x2.toFixed(1));
    line.setAttribute('y2', e.y2.toFixed(1));
    line.setAttribute('stroke', grey(e.excit ? 0.62 + 0.33 * e.mag : 0.4 + 0.16 * e.mag));
    line.setAttribute('stroke-width', (0.5 + e.mag * 2.4).toFixed(2));
    line.setAttribute('opacity', (0.16 + e.mag * 0.66).toFixed(2));
    if (!e.excit) line.setAttribute('stroke-dasharray', '3 2'); // inhibitory = dashed
    eg.appendChild(line);
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

/** The DNA — the connective CPPN — as a layered greyscale graph. */
export function drawCppnGraph(svg: SVGSVGElement, g: Genome, onHover?: (text: string) => void): NetLayout {
  const layers = CPPN_LAYERS;
  const nodes: LayoutNode[] = [];
  const pos: { x: number; y: number }[][] = [];
  for (let l = 0; l < layers.length; l++) {
    pos[l] = [];
    for (let i = 0; i < layers[l]!; i++) {
      const x = colX(l, layers.length);
      const y = rowY(i, layers[l]!);
      pos[l]![i] = { x, y };
      const last = l === layers.length - 1;
      const act = nodeActivation(g, l, i);
      nodes.push({
        x,
        y,
        layer: l,
        role: l === 0 ? 'in' : last ? 'out' : 'hidden',
        grey: l === 0 ? 0.55 : last ? 1.0 : 0.45 + (act / (ACTIVATIONS.length - 1)) * 0.5,
        r: l === 0 ? 4.5 : last ? 7 : 6,
        label: l === 0 ? CPPN_IN[i] : last ? CPPN_OUT[i] : undefined,
        title: l === 0 ? `INPUT ${CPPN_IN[i] ?? i}` : last ? `OUTPUT ${CPPN_OUT[i] ?? i}` : `HIDDEN · ${ACTIVATIONS[act] ?? '?'}`,
      });
    }
  }
  let maxAbs = 1e-4;
  const raw = cppnEdges(g);
  for (const e of raw) maxAbs = Math.max(maxAbs, Math.abs(e.weight));
  const edges: LayoutEdge[] = raw.map((e) => {
    const a = pos[e.fromLayer]![e.fromIdx]!;
    const b = pos[e.toLayer]![e.toIdx]!;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, mag: Math.abs(e.weight) / maxAbs, excit: e.weight >= 0 };
  });
  const layout: NetLayout = { nodes, edges, layers: layers.length };
  paint(svg, layout, onHover);
  return layout;
}

/** The phenotype substrate as a legible left→right layered graph (3 layers). */
export function drawSubstrateGraph(svg: SVGSVGElement, subNodes: SubNode[], conns: SubConn[], onHover?: (text: string) => void): NetLayout {
  const ins = subNodes.filter((n) => n.role === 'in');
  const hid = subNodes.filter((n) => n.role === 'hidden').slice().sort((a, b) => b.y - a.y || b.z - a.z);
  const outs = subNodes.filter((n) => n.role === 'out');
  const place = new Map<SubNode, LayoutNode>();
  const nodes: LayoutNode[] = [];
  const add = (arr: SubNode[], layer: number, layers: number): void => {
    arr.forEach((n, i) => {
      const x = colX(layer, layers);
      const y = rowY(i, arr.length);
      const ln: LayoutNode =
        n.role === 'in'
          ? { x, y, layer, role: 'in', grey: 0.55, r: 4.5, label: SUB_IN[i], title: `INPUT ${SUB_IN[i] ?? i}` }
          : n.role === 'out'
            ? { x, y, layer, role: 'out', grey: 1.0, r: 7, label: SUB_OUT[i], title: `OUTPUT ${SUB_OUT[i] ?? i}` }
            : {
                x,
                y,
                layer,
                role: 'hidden',
                grey: 0.45 + ((n.act ?? 0) / (ACTIVATIONS.length - 1)) * 0.5,
                r: 6,
                title: `HIDDEN · ${ACTIVATIONS[n.act ?? 0] ?? '?'} · ES-placed`,
              };
      place.set(n, ln);
      nodes.push(ln);
    });
  };
  add(ins, 0, 3);
  add(hid, 1, 3);
  add(outs, 2, 3);

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
  paint(svg, layout, onHover);
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
