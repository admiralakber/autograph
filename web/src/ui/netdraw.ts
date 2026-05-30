import { CPPN_LAYERS } from '../engine/arch.ts';
import type { Genome } from '../engine/cppn.ts';
import { cppnEdges, nodeActivation } from '../engine/cppn.ts';
import { ACTIVATIONS } from '../engine/activations.ts';
import type { SubNode, SubConn } from '../engine/substrate.ts';

// Greyscale network diagrams — the chrome is monochrome; only life gets colour.
//   weight SIGN      → solid (excitatory) vs dashed (inhibitory) + light/dark grey
//   weight MAGNITUDE → stroke width + opacity (and spike brightness)
//   node ROLE        → shape (input square · hidden circle · output ringed) + size
//   node ACTIVATION  → greyscale fill
// Signal flows left→right; a spiking activation pulse (NetworkPulse) propagates
// volleys input→output with conduction delay, so it reads as neurons firing.

const SVG = 'http://www.w3.org/2000/svg';
const W = 360;
const H = 260;
const PAD_X = 46;
const PAD_Y = 30;

const grey = (v: number): string => {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${g},${g},${g})`;
};
const el = <K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] => document.createElementNS(SVG, name);

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
  /** index among the phenotype's hidden neurons (for receptive-field linking). */
  hiddenIndex?: number;
}
export interface LayoutEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mag: number;
  excit: boolean;
  from: number;
  to: number;
  fromLayer: number;
}
export interface NetLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  layers: number;
}

export interface DrawOpts {
  onHover?: (text: string) => void;
  /** Called when a node is hovered — the dashboard uses it to light the linked
   *  region of the self-portrait (a hidden neuron's receptive field). */
  onNode?: (node: LayoutNode | null) => void;
}

const CPPN_IN = ['x₁', 'y₁', 'z₁', 'x₂', 'y₂', 'z₂', 'b'];
const CPPN_OUT = ['weight', 'leo'];
const SUB_IN = ['x', 'y', 'z', 'r', 'b'];
const SUB_OUT = ['density', 'hue'];

const colX = (layer: number, layers: number): number => PAD_X + (layers <= 1 ? 0.5 : layer / (layers - 1)) * (W - 2 * PAD_X);
const rowY = (i: number, n: number): number => PAD_Y + ((i + 0.5) / n) * (H - 2 * PAD_Y);

function paint(svg: SVGSVGElement, layout: NetLayout, opts?: DrawOpts): void {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();

  for (const [x, txt, cls] of [
    [PAD_X, 'INPUT', 'ag-axis'],
    [W / 2, 'signal →', 'ag-axis ag-axis-dim'],
    [W - PAD_X, 'OUTPUT', 'ag-axis'],
  ] as const) {
    const t = el('text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', '14');
    t.setAttribute('class', cls);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = txt;
    svg.appendChild(t);
  }

  const eg = el('g');
  layout.edges.forEach((e, i) => {
    const line = el('line');
    line.setAttribute('x1', e.x1.toFixed(1));
    line.setAttribute('y1', e.y1.toFixed(1));
    line.setAttribute('x2', e.x2.toFixed(1));
    line.setAttribute('y2', e.y2.toFixed(1));
    line.setAttribute('stroke', grey(e.excit ? 0.62 + 0.33 * e.mag : 0.4 + 0.16 * e.mag));
    line.setAttribute('stroke-width', (0.5 + e.mag * 2.4).toFixed(2));
    line.setAttribute('opacity', (0.16 + e.mag * 0.66).toFixed(2));
    if (!e.excit) line.setAttribute('stroke-dasharray', '3 2');
    line.dataset.from = String(e.from);
    line.dataset.to = String(e.to);
    line.dataset.edge = String(i);
    eg.appendChild(line);
  });
  svg.appendChild(eg);

  layout.nodes.forEach((n, idx) => {
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
    shape.dataset.node = String(idx);
    (shape as SVGElement & { style: CSSStyleDeclaration }).style.cursor = 'crosshair';
    const enter = (): void => {
      opts?.onHover?.(n.title);
      opts?.onNode?.(n);
      eg.querySelectorAll(`[data-from="${idx}"],[data-to="${idx}"]`).forEach((l) => l.classList.add('hot'));
    };
    const leave = (): void => {
      opts?.onNode?.(null);
      eg.querySelectorAll('.hot').forEach((l) => l.classList.remove('hot'));
    };
    shape.addEventListener('mouseenter', enter);
    shape.addEventListener('mouseleave', leave);
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
  });
}

export function drawCppnGraph(svg: SVGSVGElement, g: Genome, opts?: DrawOpts): NetLayout {
  const layers = CPPN_LAYERS;
  const nodes: LayoutNode[] = [];
  const idAt: number[][] = [];
  for (let l = 0; l < layers.length; l++) {
    idAt[l] = [];
    for (let i = 0; i < layers[l]!; i++) {
      const last = l === layers.length - 1;
      const act = nodeActivation(g, l, i);
      idAt[l]![i] = nodes.length;
      nodes.push({
        x: colX(l, layers.length),
        y: rowY(i, layers[l]!),
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
    const from = idAt[e.fromLayer]![e.fromIdx]!;
    const to = idAt[e.toLayer]![e.toIdx]!;
    const a = nodes[from]!;
    const b = nodes[to]!;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, mag: Math.abs(e.weight) / maxAbs, excit: e.weight >= 0, from, to, fromLayer: e.fromLayer };
  });
  const layout: NetLayout = { nodes, edges, layers: layers.length };
  paint(svg, layout, opts);
  return layout;
}

export function drawSubstrateGraph(svg: SVGSVGElement, subNodes: SubNode[], conns: SubConn[], opts?: DrawOpts): NetLayout {
  const ins = subNodes.filter((n) => n.role === 'in');
  const hid = subNodes.filter((n) => n.role === 'hidden').slice().sort((a, b) => b.y - a.y || b.z - a.z);
  const outs = subNodes.filter((n) => n.role === 'out');
  const place = new Map<SubNode, number>();
  const nodes: LayoutNode[] = [];
  const add = (arr: SubNode[], layer: number): void => {
    arr.forEach((n, i) => {
      place.set(n, nodes.length);
      nodes.push(
        n.role === 'in'
          ? { x: colX(layer, 3), y: rowY(i, arr.length), layer, role: 'in', grey: 0.55, r: 4.5, label: SUB_IN[i], title: `INPUT ${SUB_IN[i] ?? i}` }
          : n.role === 'out'
            ? { x: colX(layer, 3), y: rowY(i, arr.length), layer, role: 'out', grey: 1.0, r: 7, label: SUB_OUT[i], title: `OUTPUT ${SUB_OUT[i] ?? i}` }
            : {
                x: colX(layer, 3),
                y: rowY(i, arr.length),
                layer,
                role: 'hidden',
                grey: 0.45 + ((n.act ?? 0) / (ACTIVATIONS.length - 1)) * 0.5,
                r: 6,
                title: `HIDDEN · ${ACTIVATIONS[n.act ?? 0] ?? '?'} · ES-placed`,
                hiddenIndex: i,
              },
      );
    });
  };
  add(ins, 0);
  add(hid, 1);
  add(outs, 2);

  let maxAbs = 1e-4;
  for (const c of conns) maxAbs = Math.max(maxAbs, Math.abs(c.weight));
  const edges: LayoutEdge[] = [];
  for (const c of conns) {
    const from = place.get(c.a);
    const to = place.get(c.b);
    if (from === undefined || to === undefined) continue;
    const a = nodes[from]!;
    const b = nodes[to]!;
    edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, mag: Math.abs(c.weight) / maxAbs, excit: c.weight >= 0, from, to, fromLayer: a.layer });
  }
  const layout: NetLayout = { nodes, edges, layers: 3 };
  paint(svg, layout, opts);
  return layout;
}

// --- The spiking activation pulse (neurons firing) --------------------------

const reduceMotion = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Propagates volleys of "spikes" input→output with conduction delay: each node
 *  charges and fires (a fast membrane glow), and a bright spike runs along each
 *  edge during its conduction window, its brightness set by the synaptic weight.
 *  Greyscale; reads as signal propagating through a brain. */
export class NetworkPulse {
  private raf = 0;
  private overlay: SVGGElement | null = null;
  private halos: SVGCircleElement[] = [];
  private sparks: SVGCircleElement[] = [];
  private layout: NetLayout | null = null;
  private readonly volley = 1500; // ms between volleys
  private readonly tau = 360; // ms conduction delay per layer

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
      c.setAttribute('r', String(n.r + 3));
      c.setAttribute('fill', 'rgb(252,252,252)');
      c.setAttribute('opacity', '0');
      g.appendChild(c);
      return c;
    });
    this.sparks = layout.edges.map(() => {
      const c = el('circle');
      c.setAttribute('r', '2');
      c.setAttribute('fill', 'rgb(255,255,255)');
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
    const sigma = 150; // ms membrane width
    // node membrane glow: sum spike kernels over the in-flight volleys
    for (let i = 0; i < layout.nodes.length; i++) {
      const n = layout.nodes[i]!;
      const fire = n.layer * this.tau; // time after a volley when this node fires
      let g = 0;
      for (let k = -1; k <= 1; k++) {
        const dt = ((now % this.volley) - k * this.volley) - fire;
        g += Math.exp(-(dt * dt) / (2 * sigma * sigma));
      }
      const glow = Math.min(1, g);
      this.halos[i]!.setAttribute('opacity', (glow * 0.55).toFixed(3));
      this.halos[i]!.setAttribute('r', (n.r + 3 + glow * 6).toFixed(2));
    }
    // edge spikes: a bright dot crossing during this edge's conduction window
    for (let i = 0; i < layout.edges.length; i++) {
      const e = layout.edges[i]!;
      const start = e.fromLayer * this.tau;
      let best = -1;
      let t = 0;
      for (let k = -1; k <= 1; k++) {
        const tt = ((now % this.volley) - k * this.volley - start) / this.tau;
        if (tt >= 0 && tt <= 1) {
          best = k;
          t = tt;
        }
      }
      const s = this.sparks[i]!;
      if (best === -1) {
        s.setAttribute('opacity', '0');
        continue;
      }
      const ease = Math.sin(t * Math.PI); // bright in the middle of the crossing
      s.setAttribute('cx', (e.x1 + (e.x2 - e.x1) * t).toFixed(1));
      s.setAttribute('cy', (e.y1 + (e.y2 - e.y1) * t).toFixed(1));
      s.setAttribute('opacity', ((0.2 + e.mag * 0.75) * ease * (e.excit ? 1 : 0.6)).toFixed(2));
      s.setAttribute('r', (1.2 + e.mag * 2).toFixed(2));
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
