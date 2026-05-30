import { CPPN_LAYERS } from '../engine/arch.ts';
import type { Genome } from '../engine/cppn.ts';
import { cppnEdges, nodeActivation } from '../engine/cppn.ts';
import { ACTIVATIONS } from '../engine/activations.ts';
import type { SubNode, SubConn } from '../engine/substrate.ts';

// Greyscale network diagrams (the chrome is monochrome; only life gets colour).
// Encoding, held rigorously:
//   weight SIGN      → solid (excitatory) vs dashed (inhibitory)
//   weight MAGNITUDE → stroke width + opacity
//   node ROLE/ACT    → greyscale fill value + size

const SVG = 'http://www.w3.org/2000/svg';
const grey = (v: number): string => {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${g},${g},${g})`;
};
const el = <K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG, name);

const INPUT_LABELS = ['x₁', 'y₁', 'z₁', 'x₂', 'y₂', 'z₂', 'b'];
const OUTPUT_LABELS = ['w', 'leo'];

/** Draw the DNA — the connective CPPN — as a layered greyscale graph. */
export function drawCppnGraph(svg: SVGSVGElement, g: Genome, onHover?: (text: string) => void): void {
  const W = 320;
  const H = 240;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const padX = 34;
  const padY = 22;
  const layers = CPPN_LAYERS;
  const colX = (l: number): number => padX + (l / (layers.length - 1)) * (W - 2 * padX);
  const nodeY = (l: number, i: number): number => {
    const n = layers[l]!;
    return padY + ((i + 0.5) / n) * (H - 2 * padY);
  };

  const edges = cppnEdges(g);
  let maxAbs = 0.0001;
  for (const e of edges) maxAbs = Math.max(maxAbs, Math.abs(e.weight));
  const edgeLayer = el('g');
  for (const e of edges) {
    const mag = Math.abs(e.weight) / maxAbs;
    const line = el('line');
    line.setAttribute('x1', String(colX(e.fromLayer)));
    line.setAttribute('y1', String(nodeY(e.fromLayer, e.fromIdx)));
    line.setAttribute('x2', String(colX(e.toLayer)));
    line.setAttribute('y2', String(nodeY(e.toLayer, e.toIdx)));
    line.setAttribute('stroke', grey(0.85));
    line.setAttribute('stroke-width', (0.4 + mag * 2.1).toFixed(2));
    line.setAttribute('opacity', (0.12 + mag * 0.6).toFixed(2));
    if (e.weight < 0) line.setAttribute('stroke-dasharray', '2 2'); // inhibitory = dashed
    edgeLayer.appendChild(line);
  }
  svg.appendChild(edgeLayer);

  for (let l = 0; l < layers.length; l++) {
    for (let i = 0; i < layers[l]!; i++) {
      const cx = colX(l);
      const cy = nodeY(l, i);
      const act = nodeActivation(g, l, i);
      const c = el('circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', l === 0 ? '4.5' : '6');
      c.setAttribute('fill', l === 0 ? grey(0.3) : grey(0.45 + (act / (ACTIVATIONS.length - 1)) * 0.5));
      c.setAttribute('stroke', grey(0.6));
      c.setAttribute('stroke-width', '0.75');
      const label =
        l === 0
          ? `INPUT ${INPUT_LABELS[i] ?? i}`
          : l === layers.length - 1
            ? `OUTPUT ${OUTPUT_LABELS[i] ?? i}`
            : `HIDDEN · ${ACTIVATIONS[act] ?? '?'}`;
      if (onHover) {
        c.style.cursor = 'crosshair';
        c.addEventListener('mouseenter', () => onHover(label));
      }
      const t = el('title');
      t.textContent = label;
      c.appendChild(t);
      svg.appendChild(c);
    }
  }
}

/** Draw the phenotype substrate as a 2-D projection (no-WebGL fallback / inset). */
export function drawSubstrate2D(svg: SVGSVGElement, nodes: SubNode[], conns: SubConn[]): void {
  const W = 320;
  const H = 240;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  // project (x,y,z) → screen: x→x, y→y (z lifts/brightens)
  const sx = (n: SubNode): number => W / 2 + n.x * (W / 2 - 24);
  const sy = (n: SubNode): number => H / 2 - n.y * (H / 2 - 18);
  const edgeLayer = el('g');
  for (const c of conns) {
    const mag = Math.min(1, Math.abs(c.weight) / 3);
    const line = el('line');
    line.setAttribute('x1', String(sx(c.a)));
    line.setAttribute('y1', String(sy(c.a)));
    line.setAttribute('x2', String(sx(c.b)));
    line.setAttribute('y2', String(sy(c.b)));
    line.setAttribute('stroke', grey(0.85));
    line.setAttribute('stroke-width', (0.4 + mag * 2).toFixed(2));
    line.setAttribute('opacity', (0.12 + mag * 0.6).toFixed(2));
    if (c.weight < 0) line.setAttribute('stroke-dasharray', '2 2');
    edgeLayer.appendChild(line);
  }
  svg.appendChild(edgeLayer);
  for (const n of nodes) {
    const c = el('circle');
    c.setAttribute('cx', String(sx(n)));
    c.setAttribute('cy', String(sy(n)));
    c.setAttribute('r', n.role === 'out' ? '5.5' : n.role === 'in' ? '4' : '5');
    c.setAttribute('fill', grey(n.role === 'in' ? 0.5 : n.role === 'out' ? 0.98 : 0.78));
    c.setAttribute('stroke', grey(0.6));
    c.setAttribute('stroke-width', '0.6');
    c.setAttribute('opacity', (0.55 + ((n.z + 1) / 2) * 0.45).toFixed(2));
    svg.appendChild(c);
  }
}
