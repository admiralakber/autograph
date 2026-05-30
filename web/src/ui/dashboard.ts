import { GENOME_DIM } from '../engine/arch.ts';
import type { Genome } from '../engine/cppn.ts';
import { seededGenome, cloneGenome, genomeVector, paramToUnit, W_SCALE } from '../engine/cppn.ts';
import { GENESIS_SEED } from '../engine/genesis.ts';
import type { Evaluation } from '../engine/fitness.ts';
import { evaluate, paintedAtProbes, loopFidelity, readBackGenome } from '../engine/fitness.ts';
import type { Phenotype } from '../engine/substrate.ts';
import { buildPhenotype, phenotypeNodes, phenotypeConns } from '../engine/substrate.ts';
import { Garden } from '../engine/evolution.ts';
import { volumeCloud, paintProjection, paintSlice, paintReceptiveField } from '../engine/render/volume.ts';
import { CreatureScene } from '../engine/render/scene3d.ts';
import type { Identity, LineageEntry, LineageFile } from '../engine/lineage.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile, hashGenome, fingerprint } from '../engine/lineage.ts';
import { loadLineage, saveEntry } from '../engine/storage.ts';
import type { NetLayout, LayoutNode } from './netdraw.ts';
import { drawCppnGraph, drawSubstrateGraph, NetworkPulse } from './netdraw.ts';
import { renderGenealogy } from './genealogy.ts';
import { need } from './dom.ts';

const COLS = 12;
const ROWS = 12;
const CELL = 34;
const FOLLOW_EVERY = 60;
const LOOP_EVERY = 5; // frames per fixed-point iteration step
const FLASH = 42; // frames a new elite stays lit

type Mode = 'stacked' | 'render' | 'net' | 'dna';

const CAPTIONS: Record<Mode, string> = {
  stacked: 'STACKED · the same creature as DNA → brain → self-portrait, all at once. Tap any panel to open it full-screen.',
  render: 'SELF-PORTRAIT · what the brain draws — its density+hue field over 3-D space. These glowing points are the picture, not the wiring.',
  net: 'PHENOTYPE · the brain the DNA painted, with neurons ES-placed. Signal flows input→output; hover a neuron to light the part of the picture it draws.',
  dna: 'DNA · the genotype, a tiny CPPN. Given two points it returns one connection — it paints every weight and places every neuron of the brain.',
};

interface Focused {
  genome: Genome;
  pheno: Phenotype;
  evaluation: Evaluation;
  net: NetLayout | null;
  dna: NetLayout | null;
  cloudCount: number;
}

export class AutographDashboard {
  private readonly root: HTMLElement;
  private garden: Garden;
  private scene: CreatureScene | null = null;
  private webgl = false;
  private identity: Identity | null = null;
  private focused: Focused | null = null;
  private focusedIndex: number | null = null;
  private followed = true;
  private mode: Mode = 'stacked';
  private portraitDim: '3d' | '2d' = '3d';
  private running = true;
  private follow = true;
  private budget = 20;
  private frame = 0;

  // fixed-point loop animation
  private loopG: Genome | null = null;
  private loopDrift: number[] = [];
  private loopConverged = false;
  private loopHold = 0;

  // alive grid: idx -> frame the elite was (re)born
  private readonly cellBorn = new Map<number, number>();
  private rfActive = false;

  private readonly pulse = new NetworkPulse();
  private readonly lineage: LineageEntry[] = [];

  private readonly grid: HTMLCanvasElement;
  private readonly gridCtx: CanvasRenderingContext2D;
  private readonly thumb: HTMLCanvasElement;
  private readonly loop: HTMLCanvasElement;
  private readonly loopCtx: CanvasRenderingContext2D;
  private readonly drift: HTMLCanvasElement;
  private readonly driftCtx: CanvasRenderingContext2D;
  private readonly highlight: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.garden = new Garden(GENESIS_SEED, COLS, ROWS);
    this.grid = need(root, '#ag-grid');
    this.loop = need(root, '#ag-loop');
    this.drift = need(root, '#ag-loop-drift');
    this.highlight = need(root, '#ag-grid-highlight');
    this.grid.width = COLS * CELL;
    this.grid.height = ROWS * CELL;
    const g = this.grid.getContext('2d');
    const l = this.loop.getContext('2d');
    const d = this.drift.getContext('2d');
    if (!g || !l || !d) throw new Error('2D canvas unavailable');
    this.gridCtx = g;
    this.loopCtx = l;
    this.driftCtx = d;
    this.thumb = document.createElement('canvas');
  }

  async start(): Promise<void> {
    this.scene = new CreatureScene(need(this.root, '#ag-stage'));
    this.webgl = this.scene.ok;
    if (!this.webgl) this.portraitDim = '2d';
    this.setText('#ag-backend', this.webgl ? '3D · WEBGL' : '2D · CANVAS');
    this.setText('#ag-genesis-seed', GENESIS_SEED);
    this.wire();
    this.paintEmptyGrid();

    this.garden.seedWith([seededGenome(GENESIS_SEED)]);
    await this.bootGenealogy();
    this.syncDirty();
    this.refreshFocused(seededGenome(GENESIS_SEED), null);
    this.setText('#ag-focus-note', 'GROWN FROM GENESIS · the canonical world');
    this.setMode('stacked');
    requestAnimationFrame(() => this.tick());
  }

  private async bootGenealogy(): Promise<void> {
    for (const e of await loadLineage()) this.lineage.push(e);
    if (!this.lineage.some((e) => e.parents.length === 0)) {
      const id = this.identity ?? (this.identity = await generateIdentity());
      const g = seededGenome(GENESIS_SEED);
      const entry = await createEntry({ genome: g, parents: [], seed: GENESIS_SEED, fidelity: evaluate(g).fidelity, identity: id });
      this.lineage.unshift(entry);
      await saveEntry(entry);
    }
    renderGenealogy(need(this.root, '#ag-tree'), this.lineage);
    this.setText('#ag-tree-count', String(this.lineage.length));
  }

  // --- Controls -------------------------------------------------------------

  private wire(): void {
    const seed = need<HTMLInputElement>(this.root, '#ag-seed');
    need(this.root, '#ag-grow').addEventListener('click', () => this.grow(seed.value.trim() || GENESIS_SEED));
    seed.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.grow(seed.value.trim() || GENESIS_SEED);
    });
    need(this.root, '#ag-key').addEventListener('click', () => void this.makeKey());

    const run = need<HTMLButtonElement>(this.root, '#ag-run');
    run.addEventListener('click', () => {
      this.running = !this.running;
      run.textContent = this.running ? 'PAUSE' : 'RESUME';
    });
    need(this.root, '#ag-reset').addEventListener('click', () => this.grow(GENESIS_SEED));
    const follow = need<HTMLInputElement>(this.root, '#ag-follow');
    follow.addEventListener('change', () => {
      this.follow = follow.checked;
      this.followed = follow.checked;
      this.moveSelection();
    });
    const turbo = need<HTMLInputElement>(this.root, '#ag-turbo');
    turbo.addEventListener('change', () => (this.budget = turbo.checked ? 60 : 20));

    for (const m of ['stacked', 'render', 'net', 'dna'] as const) need(this.root, `#ag-mode-${m}`).addEventListener('click', () => this.setMode(m));
    need(this.root, '#ag-dim-3d').addEventListener('click', () => this.setDim('3d'));
    need(this.root, '#ag-dim-2d').addEventListener('click', () => this.setDim('2d'));
    // tapping a layer in STACKED expands it full-screen
    need(this.root, '#ag-stage-2d').addEventListener('click', () => this.mode === 'stacked' && this.setMode('render'));
    need(this.root, '#ag-net-svg').addEventListener('click', () => this.mode === 'stacked' && this.setMode('net'));
    need(this.root, '#ag-dna-svg').addEventListener('click', () => this.mode === 'stacked' && this.setMode('dna'));

    this.grid.addEventListener('click', (e) => this.onGridClick(e));
    need(this.root, '#ag-keep').addEventListener('click', () => void this.keep());
    need(this.root, '#ag-export').addEventListener('click', () => this.exportLineage());
    const imp = need<HTMLInputElement>(this.root, '#ag-import');
    imp.addEventListener('change', () => void this.importLineage(imp));
    need(this.root, '#ag-info-open').addEventListener('click', () => this.toggleInfo(true));
    need(this.root, '#ag-info-close').addEventListener('click', () => this.toggleInfo(false));
  }

  private toggleInfo(open: boolean): void {
    need(this.root, '#ag-overlay').classList.toggle('open', open);
  }

  private grow(seedStr: string): void {
    this.garden = new Garden(seedStr, COLS, ROWS);
    this.garden.seedWith([seededGenome(seedStr)]);
    this.cellBorn.clear();
    this.paintEmptyGrid();
    this.syncDirty();
    this.follow = true;
    this.followed = true;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = true;
    this.refreshFocused(seededGenome(seedStr), null);
    this.setText('#ag-focus-note', seedStr === GENESIS_SEED ? 'GROWN FROM GENESIS · the canonical world' : 'YOUR OWN WORLD · in the swarm, creatures you KEEP migrate into the one genealogy from Genesis');
  }

  /** A keypair is your *signature* on creatures you keep — it does not change the
   *  world you are exploring. */
  private async makeKey(): Promise<void> {
    this.identity = await generateIdentity();
    this.setText('#ag-identity', `KEY ${fingerprint(this.identity.publicKeyHex).slice(0, 9)}`);
    this.setText('#ag-verify', 'SIGNATURE READY · creatures you KEEP are now signed by your key');
  }

  // --- Frame loop -----------------------------------------------------------

  private tick(): void {
    if (this.running) {
      this.garden.step(this.budget);
      this.syncDirty();
      this.updateReadouts();
      if (this.follow && this.frame % FOLLOW_EVERY === 0) {
        const best = this.garden.archive.bestLively(0.32, 0.22) ?? this.garden.archive.bestLively(0.2, 0.12) ?? this.garden.archive.best();
        if (best) {
          this.followed = true;
          this.refreshFocused(best.cell.genome, best.index);
        }
      }
    }
    this.flashCells();
    if (this.frame % LOOP_EVERY === 0) this.stepLoop();
    this.frame++;
    requestAnimationFrame(() => this.tick());
  }

  private updateReadouts(): void {
    const s = this.garden.stats();
    this.setText('#ag-gen', s.generation.toLocaleString('en-GB'));
    this.setText('#ag-pop', `${s.filled}/${s.cells}`);
    this.setText('#ag-cov', `${Math.round(s.coverage * 100)}%`);
    if (this.focused) this.setText('#ag-edges', String(this.focused.evaluation.liveConns));
  }

  // --- The focused individual -----------------------------------------------

  private refreshFocused(genome: Genome, cellIndex: number | null): void {
    const pheno = buildPhenotype(genome);
    const evaluation = evaluate(genome, pheno);
    let cloudCount = 0;
    if (this.webgl && this.scene) {
      const cloud = volumeCloud(pheno);
      cloudCount = cloud.count;
      this.scene.setCloud(cloud);
    }
    const onHover = (t: string): void => this.setText('#ag-hover', t);
    const onNode = (n: LayoutNode | null): void => this.onNetNode(n);
    const subNodes = phenotypeNodes(pheno);
    const net = drawSubstrateGraph(need(this.root, '#ag-net-svg') as unknown as SVGSVGElement, subNodes, phenotypeConns(pheno, subNodes), { onHover, onNode });
    const dna = drawCppnGraph(need(this.root, '#ag-dna-svg') as unknown as SVGSVGElement, genome, { onHover });
    this.focused = { genome, pheno, evaluation, net, dna, cloudCount };
    this.focusedIndex = cellIndex;

    this.setLoopSource(genome);
    this.renderPortrait();
    this.attachPulse();
    this.updateViewStat();
    this.moveSelection();
    this.setText('#ag-edges', String(evaluation.liveConns));
    void this.updateFingerprint(genome);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    for (const m of ['stacked', 'render', 'net', 'dna'] as const) need(this.root, `#ag-mode-${m}`).classList.toggle('active', m === mode);
    this.setText('#ag-mode-caption', CAPTIONS[mode]);
    this.applyMode();
  }

  private setDim(dim: '3d' | '2d'): void {
    this.portraitDim = dim;
    need(this.root, '#ag-dim-3d').classList.toggle('active', dim === '3d');
    need(this.root, '#ag-dim-2d').classList.toggle('active', dim === '2d');
    if (this.mode === 'render' || this.mode === 'stacked') this.applyMode();
  }

  private sliceVisible(): boolean {
    return this.mode === 'stacked' || (this.mode === 'render' && (this.portraitDim === '2d' || !this.webgl));
  }

  private applyMode(): void {
    const stage = need(this.root, '#ag-stage');
    stage.classList.toggle('stacked', this.mode === 'stacked');
    const dna = need(this.root, '#ag-dna-svg');
    const net = need(this.root, '#ag-net-svg');
    const c2d = need(this.root, '#ag-stage-2d');
    const showDna = this.mode === 'dna' || this.mode === 'stacked';
    const showNet = this.mode === 'net' || this.mode === 'stacked';
    const want3d = this.webgl && ((this.mode === 'render' && this.portraitDim === '3d'));
    dna.classList.toggle('hidden', !showDna);
    net.classList.toggle('hidden', !showNet);
    c2d.classList.toggle('hidden', !this.sliceVisible());
    this.scene?.setCanvasVisible(want3d);
    need(this.root, '#ag-dim').classList.toggle('hidden', this.mode !== 'render' || !this.webgl);

    this.renderPortrait();
    this.setText('#ag-mode-caption', CAPTIONS[this.mode]);
    this.attachPulse();
    this.updateViewStat();
    this.moveSelection();
  }

  private renderPortrait(): void {
    if (!this.focused || this.rfActive) return;
    const c = need<HTMLCanvasElement>(this.root, '#ag-stage-2d');
    // stacked overview → the full colourful silhouette (max beauty);
    // expanded 2-D → the z=0 slice (the "slice" feature).
    if (this.mode === 'stacked') paintProjection(this.focused.pheno, c, 240);
    else if (this.sliceVisible()) paintSlice(this.focused.pheno, c, 420, 0);
  }

  private attachPulse(): void {
    if (!this.focused) return this.pulse.stop();
    if ((this.mode === 'net' || this.mode === 'stacked') && this.focused.net) {
      this.pulse.attach(need(this.root, '#ag-net-svg') as unknown as SVGSVGElement, this.focused.net);
    } else if (this.mode === 'dna' && this.focused.dna) {
      this.pulse.attach(need(this.root, '#ag-dna-svg') as unknown as SVGSVGElement, this.focused.dna);
    } else {
      this.pulse.stop();
    }
  }

  /** Receptive-field link: hovering a hidden neuron lights the part of the
   *  self-portrait it draws (ablation diff), where the slice is visible. */
  private onNetNode(n: LayoutNode | null): void {
    if (!this.focused) return;
    const slice = need<HTMLCanvasElement>(this.root, '#ag-stage-2d');
    if (n && n.role === 'hidden' && n.hiddenIndex !== undefined && this.sliceVisible()) {
      paintReceptiveField(this.focused.pheno, n.hiddenIndex, slice, this.mode === 'stacked' ? 200 : 360, 0);
      this.rfActive = true;
      this.setText('#ag-hover', `${n.title} — lit: the region of the self-portrait this neuron draws (ablation)`);
    } else if (this.rfActive) {
      this.rfActive = false;
      this.renderPortrait();
    }
  }

  private updateViewStat(): void {
    if (!this.focused) return;
    let s = '';
    if (this.mode === 'stacked') s = 'DNA · brain · self-portrait — tap to open';
    else if (this.mode === 'render') s = this.webgl && this.portraitDim === '3d' ? `≈ ${this.focused.cloudCount.toLocaleString('en-GB')} living points` : '2-D slice · z = 0';
    else if (this.mode === 'net') s = `${this.focused.net?.nodes.length ?? 0} nodes · ${this.focused.net?.edges.length ?? 0} edges`;
    else s = `${this.focused.dna?.nodes.length ?? 0} nodes · ${this.focused.dna?.edges.length ?? 0} edges`;
    this.setText('#ag-viewstat', s);
  }

  // --- The fixed point, closing live ----------------------------------------

  private setLoopSource(g: Genome): void {
    this.loopG = cloneGenome(g);
    this.loopDrift = [];
    this.loopConverged = false;
    this.loopHold = 0;
  }

  private stepLoop(): void {
    if (!this.loopG) return;
    if (this.loopConverged) {
      if (--this.loopHold <= 0 && this.focused) this.setLoopSource(this.focused.genome); // re-settle (stays alive)
      return;
    }
    const g = this.loopG;
    const p = buildPhenotype(g);
    const painted = paintedAtProbes(p);
    const v = genomeVector(g);
    const fid = loopFidelity(g, p);

    // one under-relaxed step of T = decode∘render
    const t = readBackGenome(p, g);
    const next = cloneGenome(g);
    const alpha = 0.55;
    let se = 0;
    for (let i = 0; i < g.weights.length; i++) {
      const nv = g.weights[i]! + alpha * (t.weights[i]! - g.weights[i]!);
      se += (nv - g.weights[i]!) ** 2;
      next.weights[i] = nv;
    }
    for (let i = 0; i < g.biases.length; i++) {
      const nv = g.biases[i]! + alpha * (t.biases[i]! - g.biases[i]!);
      se += (nv - g.biases[i]!) ** 2;
      next.biases[i] = nv;
    }
    const d = Math.sqrt(se / GENOME_DIM) / (2 * W_SCALE);
    this.loopDrift.push(d);
    if (this.loopDrift.length > 48) this.loopDrift.shift();

    this.loopG = next;
    if (d < 0.012 || this.loopDrift.length >= 40) {
      this.loopConverged = true;
      this.loopHold = 110;
    }
    this.drawLoopFrame(v, painted, fid, d); // after the convergence flag, so the label can read FIXED POINT
  }

  private drawLoopFrame(genomeVec: Float32Array, painted: Float32Array, fid: number, d: number): void {
    const ctx = this.loopCtx;
    const Wd = (this.loop.width = GENOME_DIM * 5);
    const Hd = (this.loop.height = 50);
    const sw = Wd / GENOME_DIM;
    const rh = 21;
    ctx.clearRect(0, 0, Wd, Hd);
    for (let k = 0; k < GENOME_DIM; k++) {
      const tg = Math.round(paramToUnit(genomeVec[k]!) * 255);
      ctx.fillStyle = `rgb(${tg},${tg},${tg})`;
      ctx.fillRect(k * sw, 0, Math.ceil(sw), rh);
      const pg = Math.round(painted[k]! * 255);
      ctx.fillStyle = `rgb(${pg},${pg},${pg})`;
      ctx.fillRect(k * sw, Hd - rh, Math.ceil(sw), rh);
    }
    // drift sparkline
    const dc = this.driftCtx;
    const W2 = (this.drift.width = 220);
    const H2 = (this.drift.height = 26);
    dc.clearRect(0, 0, W2, H2);
    dc.strokeStyle = 'rgba(236,236,236,0.8)';
    dc.lineWidth = 1;
    dc.beginPath();
    const maxD = Math.max(0.04, ...this.loopDrift);
    this.loopDrift.forEach((dv, i) => {
      const x = (i / Math.max(1, this.loopDrift.length - 1)) * W2;
      const y = H2 - 2 - (dv / maxD) * (H2 - 4);
      i === 0 ? dc.moveTo(x, y) : dc.lineTo(x, y);
    });
    dc.stroke();

    const pct = (fid * 100).toFixed(1);
    need(this.root, '#ag-fid-bar').style.width = `${fid * 100}%`;
    this.setText('#ag-fid-label', `${pct}%`);
    this.setText('#ag-fid', `${pct}%`);
    this.setText('#ag-loop-state', this.loopConverged ? `✓ FIXED POINT · residual ${(d * 100).toFixed(1)}%` : `ITERATING · step ${this.loopDrift.length} · drift ${d.toFixed(3)}`);
  }

  // --- Population grid (alive) ----------------------------------------------

  private paintEmptyGrid(): void {
    this.gridCtx.fillStyle = '#070707';
    this.gridCtx.fillRect(0, 0, this.grid.width, this.grid.height);
    this.gridCtx.strokeStyle = 'rgba(236,236,236,0.06)';
    for (let i = 0; i <= COLS; i++) {
      this.gridCtx.beginPath();
      this.gridCtx.moveTo(i * CELL, 0);
      this.gridCtx.lineTo(i * CELL, ROWS * CELL);
      this.gridCtx.stroke();
    }
    for (let j = 0; j <= ROWS; j++) {
      this.gridCtx.beginPath();
      this.gridCtx.moveTo(0, j * CELL);
      this.gridCtx.lineTo(COLS * CELL, j * CELL);
      this.gridCtx.stroke();
    }
  }

  private cellBorder(idx: number, grey: number, alpha: number, width: number): void {
    const cx = (idx % COLS) * CELL;
    const cy = Math.floor(idx / COLS) * CELL;
    const v = Math.round(grey * 255);
    this.gridCtx.strokeStyle = `rgba(${v},${v},${v},${alpha})`;
    this.gridCtx.lineWidth = width;
    this.gridCtx.strokeRect(cx + width / 2, cy + width / 2, CELL - width, CELL - width);
  }

  private syncDirty(): void {
    let budget = 10;
    for (const idx of this.garden.archive.drainDirty()) {
      if (budget-- <= 0) break;
      const cell = this.garden.archive.get(idx);
      if (!cell) continue;
      const cx = (idx % COLS) * CELL;
      const cy = Math.floor(idx / COLS) * CELL;
      paintProjection(buildPhenotype(cell.genome), this.thumb, CELL);
      this.gridCtx.drawImage(this.thumb, cx, cy);
      this.cellBorn.set(idx, this.frame); // mark fresh → it will flash
    }
  }

  /** New elites flash bright white and fade — continuous, visible aliveness. */
  private flashCells(): void {
    for (const [idx, born] of this.cellBorn) {
      const age = this.frame - born;
      const cell = this.garden.archive.get(idx);
      if (age >= FLASH || !cell) {
        if (cell) this.cellBorder(idx, 0.35 + cell.evaluation.fidelity * 0.6, 0.9, 1.5); // settle to fitness border
        this.cellBorn.delete(idx);
        continue;
      }
      const t = 1 - age / FLASH;
      this.cellBorder(idx, 1, 0.25 + 0.7 * t, 1 + 1.5 * t); // bright, fading
    }
  }

  private onGridClick(e: MouseEvent): void {
    const rect = this.grid.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    const cy = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    const idx = cy * COLS + cx;
    const cell = this.garden.archive.get(idx);
    if (!cell) return;
    this.follow = false;
    this.followed = false;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = false;
    this.refreshFocused(cell.genome, idx);
    this.setText('#ag-focus-note', 'PINNED · a creature you chose from the population');
  }

  /** Selection highlight: grid cell + a badge on the main view. */
  private moveSelection(): void {
    if (this.focusedIndex === null) {
      this.highlight.style.opacity = '0';
    } else {
      const cx = this.focusedIndex % COLS;
      const cy = Math.floor(this.focusedIndex / COLS);
      this.highlight.style.opacity = '1';
      this.highlight.style.left = `${(cx / COLS) * 100}%`;
      this.highlight.style.top = `${(cy / ROWS) * 100}%`;
      this.highlight.style.width = `${(1 / COLS) * 100}%`;
      this.highlight.style.height = `${(1 / ROWS) * 100}%`;
    }
    this.setText('#ag-sel-badge', this.followed ? '● FOLLOWING · the most enlightened' : '◆ PINNED');
  }

  // --- Lineage --------------------------------------------------------------

  private async keep(): Promise<void> {
    if (!this.focused) return;
    if (!this.identity) this.identity = await generateIdentity();
    this.setText('#ag-identity', `KEY ${fingerprint(this.identity.publicKeyHex).slice(0, 9)}`);
    const parent = this.lineage.length > 0 ? [this.lineage[this.lineage.length - 1]!.id] : [];
    const entry = await createEntry({ genome: this.focused.genome, parents: parent, seed: null, fidelity: this.focused.evaluation.fidelity, identity: this.identity });
    this.lineage.push(entry);
    await saveEntry(entry);
    renderGenealogy(need(this.root, '#ag-tree'), this.lineage);
    this.setText('#ag-tree-count', String(this.lineage.length));
    this.setText('#ag-verify', `KEPT ${this.lineage.length} · SIGNED & PERSISTED`);
  }

  private exportLineage(): void {
    const blob = new Blob([JSON.stringify(makeLineageFile(this.lineage), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'autograph-genealogy.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importLineage(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as LineageFile;
      const result = await verifyLineage(parsed);
      this.setText('#ag-verify', result.valid ? `✓ VERIFIED ${result.checked} · EVERY HASH & SIGNATURE` : `✗ ${result.errors[0] ?? 'INVALID'}`);
    } catch {
      this.setText('#ag-verify', '✗ NOT AN AUTOGRAPH GENEALOGY');
    } finally {
      input.value = '';
    }
  }

  private async updateFingerprint(genome: Genome): Promise<void> {
    this.setText('#ag-fingerprint', fingerprint(await hashGenome(genome)));
  }

  private setText(sel: string, text: string): void {
    const el = this.root.querySelector(sel);
    if (el) el.textContent = text;
  }
}
