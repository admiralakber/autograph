import type { LineageEntry } from '../engine/lineage.ts';
import { fingerprint } from '../engine/lineage.ts';

// The whole genealogy — the signed Merkle-DAG tree of life — drawn as a
// navigable greyscale tree. Persisted in IndexedDB, so it grows across visits.
// Fitness (loop fidelity) is encoded by node brightness; never by colour.

const SVG = 'http://www.w3.org/2000/svg';
const COL = 26;
const ROW = 20;

export function renderGenealogy(container: HTMLElement, entries: LineageEntry[]): void {
  container.replaceChildren();
  if (entries.length === 0) return;

  const byId = new Map<string, LineageEntry>();
  for (const e of entries) byId.set(e.id, e);
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const e of entries) {
    const parent = e.parents.find((p) => byId.has(p));
    if (parent) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(e.id);
    else roots.push(e.id);
  }

  const depth = new Map<string, number>();
  const setDepth = (id: string, d: number): void => {
    depth.set(id, d);
    for (const c of childrenOf.get(id) ?? []) setDepth(c, d + 1);
  };
  for (const r of roots) setDepth(r, 0);

  let row = 0;
  const rowOf = new Map<string, number>();
  const order: string[] = [];
  const visit = (id: string): void => {
    rowOf.set(id, row++);
    order.push(id);
    for (const c of childrenOf.get(id) ?? []) visit(c);
  };
  for (const r of roots) visit(r);

  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const W = (maxDepth + 1) * COL + 120;
  const H = row * ROW + 16;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));

  const x = (id: string): number => 16 + (depth.get(id) ?? 0) * COL;
  const y = (id: string): number => 12 + (rowOf.get(id) ?? 0) * ROW;

  for (const e of entries) {
    const known = e.parents.filter((p) => byId.has(p));
    // primary parent = tree edge; any further parent = a crossover cross-link (dashed)
    known.forEach((parent, i) => {
      const path = document.createElementNS(SVG, 'path');
      const x1 = x(parent);
      const y1 = y(parent);
      const x2 = x(e.id);
      const y2 = y(e.id);
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${y2}, ${x2 - 8} ${y2}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', i === 0 ? 'rgba(235,235,235,0.22)' : 'rgba(150,150,150,0.3)');
      path.setAttribute('stroke-width', i === 0 ? '1' : '0.8');
      if (i > 0) path.setAttribute('stroke-dasharray', '2 2'); // crossover (second parent)
      svg.appendChild(path);
    });
  }

  for (const id of order) {
    const e = byId.get(id)!;
    const isGenesis = e.parents.length === 0;
    const g = Math.round((0.4 + e.fidelity * 0.6) * 255);
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', String(x(id)));
    c.setAttribute('cy', String(y(id)));
    c.setAttribute('r', isGenesis ? '4.5' : '3.2');
    c.setAttribute('fill', `rgb(${g},${g},${g})`);
    c.setAttribute('stroke', isGenesis ? 'rgb(245,245,245)' : 'rgba(235,235,235,0.4)');
    c.setAttribute('stroke-width', isGenesis ? '1.2' : '0.6');
    const title = document.createElementNS(SVG, 'title');
    title.textContent = `${isGenesis ? 'GENESIS · ' : ''}${fingerprint(e.id)} · loop ${(e.fidelity * 100).toFixed(0)}%`;
    c.appendChild(title);
    svg.appendChild(c);

    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('x', String(x(id) + 9));
    label.setAttribute('y', String(y(id) + 3));
    label.setAttribute('fill', isGenesis ? 'rgb(245,245,245)' : 'rgba(235,235,235,0.55)');
    label.setAttribute('font-size', '8');
    label.setAttribute('font-family', 'ui-monospace, monospace');
    label.textContent = isGenesis ? 'GENESIS' : fingerprint(e.id).slice(0, 9);
    svg.appendChild(label);
  }

  container.appendChild(svg);
}
