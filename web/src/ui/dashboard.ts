import { GENOME_DIM } from '../engine/arch.ts';
import type { Genome } from '../engine/cppn.ts';
import { seededGenome } from '../engine/cppn.ts';
import { GENESIS_SEED } from '../engine/genesis.ts';
import type { Evaluation } from '../engine/fitness.ts';
import { evaluate, targetAtProbes, paintedAtProbes } from '../engine/fitness.ts';
import type { Phenotype } from '../engine/substrate.ts';
import { buildPhenotype, phenotypeNodes, phenotypeConns } from '../engine/substrate.ts';
import { Garden } from '../engine/evolution.ts';
import { volumeCloud, paintProjection } from '../engine/render/volume.ts';
import { CreatureScene } from '../engine/render/scene3d.ts';
import type { Identity, LineageEntry, LineageFile } from '../engine/lineage.ts';
import {
  generateIdentity,
  createEntry,
  verifyLineage,
  makeLineageFile,
  hashGenome,
  fingerprint,
} from '../engine/lineage.ts';
import { loadLineage, saveEntry } from '../engine/storage.ts';
import { drawCppnGraph, drawSubstrate2D } from './netdraw.ts';
import { renderGenealogy } from './genealogy.ts';
import { need } from './dom.ts';

const COLS = 12;
const ROWS = 12;
const CELL = 34;
const FOLLOW_EVERY = 48;

type Mode = 'render' | 'net' | 'dna';
interface Focused {
  genome: Genome;
  pheno: Phenotype;
  evaluation: Evaluation;
}

export class AutographDashboard {
  private readonly root: HTMLElement;
  private garden: Garden;
  private scene: CreatureScene | null = null;
  private webgl = false;
  private identity: Identity | null = null;
  private focused: Focused | null = null;
  private mode: Mode = 'render';
  private running = true;
  private follow = true;
  private budget = 20;
  private frame = 0;

  private readonly lineage: LineageEntry[] = [];

  private readonly grid: HTMLCanvasElement;
  private readonly gridCtx: CanvasRenderingContext2D;
  private readonly thumb: HTMLCanvasElement;
  private readonly loop: HTMLCanvasElement;
  private readonly loopCtx: CanvasRenderingContext2D;
  private readonly highlight: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.garden = new Garden(GENESIS_SEED, COLS, ROWS);
    this.grid = need(root, '#ag-grid');
    this.loop = need(root, '#ag-loop');
    this.highlight = need(root, '#ag-grid-highlight');
    this.grid.width = COLS * CELL;
    this.grid.height = ROWS * CELL;
    const gctx = this.grid.getContext('2d');
    const lctx = this.loop.getContext('2d');
    if (!gctx || !lctx) throw new Error('2D canvas unavailable');
    this.gridCtx = gctx;
    this.loopCtx = lctx;
    this.thumb = document.createElement('canvas');
  }

  async start(): Promise<void> {
    const stage = need(this.root, '#ag-stage');
    this.scene = new CreatureScene(stage);
    this.webgl = this.scene.ok;
    this.setText('#ag-backend', this.webgl ? '3D · WEBGL' : '2D · CANVAS');

    this.setText('#ag-genesis-seed', GENESIS_SEED);
    this.wire();
    this.paintEmptyGrid();

    // Inoculate the world from Genesis, then load any persisted genealogy.
    this.garden.seedWith([seededGenome(GENESIS_SEED)]);
    await this.bootGenealogy();
    this.syncDirty();
    this.refreshFocused(seededGenome(GENESIS_SEED));
    this.applyMode();
    requestAnimationFrame(() => this.tick());
  }

  // --- Genealogy persistence (IndexedDB) ------------------------------------

  private async bootGenealogy(): Promise<void> {
    const stored = await loadLineage();
    for (const e of stored) this.lineage.push(e);
    if (!this.lineage.some((e) => e.parents.length === 0)) {
      // Establish the Genesis root once (signed by an ephemeral world key).
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
    need(this.root, '#ag-key').addEventListener('click', () => void this.growFromKey(seed));

    const run = need<HTMLButtonElement>(this.root, '#ag-run');
    run.addEventListener('click', () => {
      this.running = !this.running;
      run.textContent = this.running ? 'PAUSE' : 'RESUME';
    });
    need(this.root, '#ag-reset').addEventListener('click', () => this.grow(GENESIS_SEED));
    const follow = need<HTMLInputElement>(this.root, '#ag-follow');
    follow.addEventListener('change', () => (this.follow = follow.checked));
    const turbo = need<HTMLInputElement>(this.root, '#ag-turbo');
    turbo.addEventListener('change', () => (this.budget = turbo.checked ? 60 : 20));

    for (const m of ['render', 'net', 'dna'] as const) {
      need(this.root, `#ag-mode-${m}`).addEventListener('click', () => this.setMode(m));
    }

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
    this.paintEmptyGrid();
    this.syncDirty();
    this.follow = true;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = true;
    this.refreshFocused(seededGenome(seedStr));
    this.setText('#ag-focus-note', seedStr === GENESIS_SEED ? 'GROWN FROM GENESIS' : 'GROWN FROM YOUR SEED');
  }

  private async growFromKey(seed: HTMLInputElement): Promise<void> {
    this.identity = await generateIdentity();
    this.setText('#ag-identity', `KEY ${fingerprint(this.identity.publicKeyHex).slice(0, 9)}`);
    const keySeed = `key:${this.identity.publicKeyHex}`;
    seed.value = `key:${fingerprint(this.identity.publicKeyHex).replace(/ /g, '').slice(0, 8)}…`;
    this.grow(keySeed);
    this.setText('#ag-focus-note', 'GROWN FROM YOUR PUBLIC KEY');
  }

  // --- Frame loop -----------------------------------------------------------

  private tick(): void {
    if (this.running) {
      this.garden.step(this.budget);
      this.syncDirty();
      this.updateReadouts();
      if (this.follow && this.frame % FOLLOW_EVERY === 0) {
        const best = this.garden.archive.bestLively(0.32, 0.22) ?? this.garden.archive.bestLively(0.2, 0.12) ?? this.garden.archive.best();
        if (best) this.refreshFocused(best.cell.genome);
      }
    }
    this.frame++;
    requestAnimationFrame(() => this.tick());
  }

  private updateReadouts(): void {
    const s = this.garden.stats();
    this.setText('#ag-gen', s.generation.toLocaleString('en-GB'));
    this.setText('#ag-pop', `${s.filled}/${s.cells}`);
    this.setText('#ag-cov', `${Math.round(s.coverage * 100)}%`);
    if (this.focused) {
      this.setText('#ag-fid', `${(this.focused.evaluation.fidelity * 100).toFixed(1)}%`);
      this.setText('#ag-conns', String(this.focused.evaluation.liveConns));
    }
  }

  // --- The focused individual (the three equivalent views) ------------------

  private refreshFocused(genome: Genome): void {
    const pheno = buildPhenotype(genome);
    const evaluation = evaluate(genome, pheno);
    this.focused = { genome, pheno, evaluation };

    if (this.webgl && this.scene) {
      this.scene.setCloud(volumeCloud(pheno));
      this.scene.setNet(phenotypeNodes(pheno), phenotypeConns(pheno));
    } else {
      const stage2d = need<HTMLCanvasElement>(this.root, '#ag-stage-2d');
      paintProjection(pheno, stage2d, 360);
      drawSubstrate2D(need(this.root, '#ag-net-svg') as unknown as SVGSVGElement, phenotypeNodes(pheno), phenotypeConns(pheno));
    }
    drawCppnGraph(need(this.root, '#ag-dna-svg') as unknown as SVGSVGElement, genome, (t) => this.setText('#ag-hover', t));
    this.drawLoop(genome, pheno);
    void this.updateFingerprint(genome);
    this.setText('#ag-fid', `${(evaluation.fidelity * 100).toFixed(1)}%`);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    for (const m of ['render', 'net', 'dna'] as const) {
      need(this.root, `#ag-mode-${m}`).classList.toggle('active', m === mode);
    }
    this.applyMode();
  }

  private applyMode(): void {
    const dna = need(this.root, '#ag-dna-svg');
    const net2d = need(this.root, '#ag-net-svg');
    const c2d = need(this.root, '#ag-stage-2d');
    dna.classList.toggle('hidden', this.mode !== 'dna');
    if (this.webgl && this.scene) {
      this.scene.setCanvasVisible(this.mode !== 'dna');
      if (this.mode === 'render') this.scene.setMode('cloud');
      if (this.mode === 'net') this.scene.setMode('net');
      net2d.classList.add('hidden');
      c2d.classList.add('hidden');
    } else {
      c2d.classList.toggle('hidden', this.mode !== 'render');
      net2d.classList.toggle('hidden', this.mode !== 'net');
    }
  }

  private drawLoop(genome: Genome, pheno: Phenotype): void {
    const target = targetAtProbes(genome);
    const painted = paintedAtProbes(pheno);
    const ctx = this.loopCtx;
    const W = (this.loop.width = GENOME_DIM * 5);
    const H = (this.loop.height = 54);
    const sw = W / GENOME_DIM;
    const rh = 22;
    ctx.clearRect(0, 0, W, H);
    for (let k = 0; k < GENOME_DIM; k++) {
      const tg = Math.round(target[k]! * 255);
      ctx.fillStyle = `rgb(${tg},${tg},${tg})`;
      ctx.fillRect(k * sw, 0, Math.ceil(sw), rh);
      const pg = Math.round(painted[k]! * 255);
      ctx.fillStyle = `rgb(${pg},${pg},${pg})`;
      ctx.fillRect(k * sw, H - rh, Math.ceil(sw), rh);
    }
    const pct = (this.focused?.evaluation.fidelity ?? 0) * 100;
    need(this.root, '#ag-fid-bar').style.width = `${pct}%`;
    this.setText('#ag-fid-label', `${pct.toFixed(1)}%`);
  }

  private async updateFingerprint(genome: Genome): Promise<void> {
    this.setText('#ag-fingerprint', fingerprint(await hashGenome(genome)));
  }

  // --- Population grid -------------------------------------------------------

  private paintEmptyGrid(): void {
    this.gridCtx.fillStyle = '#070707';
    this.gridCtx.fillRect(0, 0, this.grid.width, this.grid.height);
    this.gridCtx.strokeStyle = 'rgba(235,235,235,0.06)';
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

  private syncDirty(): void {
    let budget = 8; // cap thumbnail rebuilds per frame
    for (const idx of this.garden.archive.drainDirty()) {
      if (budget-- <= 0) break;
      const cell = this.garden.archive.get(idx);
      if (!cell) continue;
      const cx = (idx % COLS) * CELL;
      const cy = Math.floor(idx / COLS) * CELL;
      paintProjection(buildPhenotype(cell.genome), this.thumb, CELL);
      this.gridCtx.drawImage(this.thumb, cx, cy);
      // fitness (loop fidelity) → greyscale border; new elites flash bright.
      const fg = Math.round((0.35 + cell.evaluation.fidelity * 0.6) * 255);
      this.gridCtx.strokeStyle = `rgba(${fg},${fg},${fg},0.9)`;
      this.gridCtx.lineWidth = 1.5;
      this.gridCtx.strokeRect(cx + 0.75, cy + 0.75, CELL - 1.5, CELL - 1.5);
    }
  }

  private onGridClick(e: MouseEvent): void {
    const rect = this.grid.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    const cy = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    const cell = this.garden.archive.get(cy * COLS + cx);
    if (!cell) return;
    this.follow = false;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = false;
    this.refreshFocused(cell.genome);
    this.highlight.style.opacity = '1';
    this.highlight.style.left = `${(cx / COLS) * 100}%`;
    this.highlight.style.top = `${(cy / ROWS) * 100}%`;
    this.highlight.style.width = `${(1 / COLS) * 100}%`;
    this.highlight.style.height = `${(1 / ROWS) * 100}%`;
  }

  // --- Lineage --------------------------------------------------------------

  private async keep(): Promise<void> {
    if (!this.focused) return;
    if (!this.identity) this.identity = await generateIdentity();
    this.setText('#ag-identity', `KEY ${fingerprint(this.identity.publicKeyHex).slice(0, 9)}`);
    const parent = this.lineage.length > 0 ? [this.lineage[this.lineage.length - 1]!.id] : [];
    const entry = await createEntry({
      genome: this.focused.genome,
      parents: parent,
      seed: null,
      fidelity: this.focused.evaluation.fidelity,
      identity: this.identity,
    });
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

  private setText(sel: string, text: string): void {
    const el = this.root.querySelector(sel);
    if (el) el.textContent = text;
  }
}
