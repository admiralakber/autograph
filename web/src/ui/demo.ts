import { GENOME_DIM } from '../engine/arch.ts';
import type { Genome } from '../engine/cppn.ts';
import { seededGenome } from '../engine/cppn.ts';
import { accentRgb, colourise } from '../engine/palette.ts';
import type { Evaluation } from '../engine/fitness.ts';
import { evaluate, paintedAtProbes, targetAtProbes } from '../engine/fitness.ts';
import { Garden } from '../engine/evolution.ts';
import { paintImageData } from '../engine/render/cpu.ts';
import { CanvasCreatureRenderer } from '../engine/render/cpu.ts';
import { createWebGPURenderer } from '../engine/render/webgpu.ts';
import type { CreatureRenderer } from '../engine/render/types.ts';
import {
  generateIdentity,
  createEntry,
  verifyLineage,
  makeLineageFile,
  hashGenome,
  fingerprint,
} from '../engine/lineage.ts';
import type { Identity, LineageEntry, LineageFile } from '../engine/lineage.ts';
import { need } from './dom.ts';

const CELL = 34;
const COLS = 14;
const ROWS = 14;
const DEFAULT_SEED = 'drawing hands';

interface Focused {
  genome: Genome;
  evaluation: Evaluation;
  parentId: string | null;
  cellIndex: number | null;
}

export class AutographDemo {
  private readonly root: HTMLElement;
  private garden: Garden;
  private seed = DEFAULT_SEED;
  private identity: Identity | null = null;
  private renderer: CreatureRenderer | null = null;

  private focused: Focused | null = null;
  private follow = true;
  private running = true;
  private budget = 30;

  private readonly kept: LineageEntry[] = [];

  // DOM handles
  private readonly creatureCanvas: HTMLCanvasElement;
  private readonly loopCanvas: HTMLCanvasElement;
  private readonly gridCanvas: HTMLCanvasElement;
  private readonly gridCtx: CanvasRenderingContext2D;
  private readonly loopCtx: CanvasRenderingContext2D;
  private readonly highlight: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.creatureCanvas = need(root, '#ag-canvas');
    this.loopCanvas = need(root, '#ag-loop');
    this.gridCanvas = need(root, '#ag-grid');
    this.highlight = need(root, '#ag-grid-highlight');

    this.gridCanvas.width = COLS * CELL;
    this.gridCanvas.height = ROWS * CELL;
    const gctx = this.gridCanvas.getContext('2d');
    const lctx = this.loopCanvas.getContext('2d');
    if (!gctx || !lctx) throw new Error('Autograph: 2D canvas unavailable');
    this.gridCtx = gctx;
    this.loopCtx = lctx;

    this.garden = new Garden(this.seed, COLS, ROWS);
  }

  async start(): Promise<void> {
    // Pick the best render backend, degrading gracefully.
    this.renderer =
      (await createWebGPURenderer(this.creatureCanvas)) ??
      new CanvasCreatureRenderer(this.creatureCanvas, 360);
    this.setText('#ag-backend', this.renderer.backend === 'webgpu' ? 'WebGPU' : 'Canvas 2D');

    this.wireControls();
    this.paintEmptyGrid();
    this.growFromSeed(this.seed);
    requestAnimationFrame(() => this.frame());
  }

  // --- Controls -------------------------------------------------------------

  private wireControls(): void {
    const seedInput = need<HTMLInputElement>(this.root, '#ag-seed');
    seedInput.value = this.seed;
    need(this.root, '#ag-grow').addEventListener('click', () => {
      const v = seedInput.value.trim() || DEFAULT_SEED;
      this.growFromSeed(v);
    });
    seedInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.growFromSeed(seedInput.value.trim() || DEFAULT_SEED);
    });

    need(this.root, '#ag-key').addEventListener('click', () => void this.growFromKey(seedInput));

    const runBtn = need<HTMLButtonElement>(this.root, '#ag-run');
    runBtn.addEventListener('click', () => {
      this.running = !this.running;
      runBtn.textContent = this.running ? 'Pause' : 'Resume';
      runBtn.setAttribute('aria-pressed', String(this.running));
    });

    const turbo = need<HTMLInputElement>(this.root, '#ag-turbo');
    turbo.addEventListener('change', () => {
      this.budget = turbo.checked ? 110 : 30;
    });

    const followBox = need<HTMLInputElement>(this.root, '#ag-follow');
    followBox.checked = this.follow;
    followBox.addEventListener('change', () => {
      this.follow = followBox.checked;
    });

    need(this.root, '#ag-reset').addEventListener('click', () => this.growFromSeed(this.seed));

    this.gridCanvas.addEventListener('click', (e) => this.onGridClick(e));

    need(this.root, '#ag-keep').addEventListener('click', () => void this.keepCurrent());
    need(this.root, '#ag-export').addEventListener('click', () => this.exportLineage());
    const importInput = need<HTMLInputElement>(this.root, '#ag-import');
    importInput.addEventListener('change', () => void this.importLineage(importInput));
  }

  // --- Growing creatures ----------------------------------------------------

  private growFromSeed(seed: string): void {
    this.seed = seed;
    const seedInput = need<HTMLInputElement>(this.root, '#ag-seed');
    seedInput.value = seed;
    this.garden = new Garden(seed, COLS, ROWS);
    const founder = seededGenome(seed);
    this.garden.seedWith([founder]);
    this.paintEmptyGrid();
    this.syncDirtyCells();
    this.follow = true;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = true;
    this.setFocused(founder, null, null);
    this.setText('#ag-seed-note', `grown deterministically from “${seed}”`);
  }

  private async growFromKey(seedInput: HTMLInputElement): Promise<void> {
    this.identity = await generateIdentity();
    const short = fingerprint(this.identity.publicKeyHex);
    this.setText('#ag-identity', `key ${short}…`);
    // The public key *is* the seed — your key grows your creature.
    const keySeed = `key:${this.identity.publicKeyHex}`;
    this.growFromSeed(keySeed);
    seedInput.value = `key:${short.replace(/ /g, '')}…`;
    this.setText('#ag-seed-note', `grown from your public key — only your key could have authored it`);
  }

  private setFocused(genome: Genome, parentId: string | null, cellIndex: number | null): void {
    const evaluation = evaluate(genome);
    this.focused = { genome, evaluation, parentId, cellIndex };
    this.renderer?.render(genome);
    this.drawLoop(genome);
    this.updateFidelity(evaluation.fidelity);
    this.moveHighlight(cellIndex);
    void this.updateFingerprint(genome);
  }

  // --- The animation frame --------------------------------------------------

  private frame(): void {
    if (this.running) {
      this.garden.step(this.budget);
      this.syncDirtyCells();
      if (this.follow) {
        // Prefer a striking, lively self-encoder; degrade gracefully rather
        // than ever showcasing the trivial near-flat fixed point.
        const lively =
          this.garden.archive.bestLively(0.42, 0.3) ??
          this.garden.archive.bestLively(0.25, 0.16) ??
          this.garden.archive.best();
        if (lively) this.setFocused(lively.cell.genome, null, lively.index);
      }
      this.updateStats();
    }
    this.renderer?.render(this.focused?.genome ?? seededGenome(this.seed));
    requestAnimationFrame(() => this.frame());
  }

  private updateStats(): void {
    const s = this.garden.stats();
    this.setText('#ag-gen', s.generation.toLocaleString('en-GB'));
    this.setText('#ag-coverage', `${Math.round(s.coverage * 100)}%`);
    this.setText('#ag-evals', s.evaluations.toLocaleString('en-GB'));
  }

  // --- MAP-Elites grid ------------------------------------------------------

  private paintEmptyGrid(): void {
    this.gridCtx.fillStyle = '#0a0e1c';
    this.gridCtx.fillRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
    this.gridCtx.strokeStyle = 'rgba(255,255,255,0.04)';
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

  private syncDirtyCells(): void {
    for (const idx of this.garden.archive.drainDirty()) {
      const cell = this.garden.archive.get(idx);
      if (!cell) continue;
      const cx = (idx % COLS) * CELL;
      const cy = Math.floor(idx / COLS) * CELL;
      this.gridCtx.putImageData(paintImageData(cell.genome, CELL, CELL), cx, cy);
    }
  }

  private onGridClick(e: MouseEvent): void {
    const rect = this.gridCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * COLS;
    const y = ((e.clientY - rect.top) / rect.height) * ROWS;
    const idx = Math.floor(y) * COLS + Math.floor(x);
    const cell = this.garden.archive.get(idx);
    if (!cell) return;
    this.follow = false;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = false;
    this.setFocused(cell.genome, null, idx);
  }

  private moveHighlight(cellIndex: number | null): void {
    if (cellIndex === null) {
      this.highlight.style.opacity = '0';
      return;
    }
    const cx = cellIndex % COLS;
    const cy = Math.floor(cellIndex / COLS);
    this.highlight.style.opacity = '1';
    this.highlight.style.left = `${(cx / COLS) * 100}%`;
    this.highlight.style.top = `${(cy / ROWS) * 100}%`;
    this.highlight.style.width = `${(1 / COLS) * 100}%`;
    this.highlight.style.height = `${(1 / ROWS) * 100}%`;
  }

  // --- The self-encoding loop view -----------------------------------------

  private drawLoop(genome: Genome): void {
    const target = targetAtProbes(genome);
    const painted = paintedAtProbes(genome);
    const accent = accentRgb(genome);
    const ctx = this.loopCtx;
    const W = (this.loopCanvas.width = GENOME_DIM * 5);
    const H = (this.loopCanvas.height = 64);
    const sw = W / GENOME_DIM;
    const rowH = 24;
    const gap = H - rowH * 2;
    ctx.clearRect(0, 0, W, H);
    for (let k = 0; k < GENOME_DIM; k++) {
      const x = k * sw;
      const [tr, tg, tb] = colourise(target[k]!, accent);
      ctx.fillStyle = `rgb(${tr | 0},${tg | 0},${tb | 0})`;
      ctx.fillRect(x, 0, Math.ceil(sw), rowH);
      const [pr, pg, pb] = colourise(painted[k]!, accent);
      ctx.fillStyle = `rgb(${pr | 0},${pg | 0},${pb | 0})`;
      ctx.fillRect(x, rowH + gap, Math.ceil(sw), rowH);
    }
  }

  private updateFidelity(fidelity: number): void {
    const pct = Math.round(fidelity * 1000) / 10;
    const bar = need(this.root, '#ag-fidelity-bar');
    bar.style.width = `${pct}%`;
    this.setText('#ag-fidelity-label', `${pct.toFixed(1)}%`);
  }

  private async updateFingerprint(genome: Genome): Promise<void> {
    const hash = await hashGenome(genome);
    this.setText('#ag-fingerprint', fingerprint(hash));
  }

  // --- Lineage (the signed tree of life) ------------------------------------

  private async keepCurrent(): Promise<void> {
    if (!this.focused) return;
    if (!this.identity) this.identity = await generateIdentity();
    this.setText('#ag-identity', `key ${fingerprint(this.identity.publicKeyHex)}…`);
    const parents = this.kept.length > 0 ? [this.kept[this.kept.length - 1]!.id] : [];
    const entry = await createEntry({
      genome: this.focused.genome,
      parents,
      seed: this.kept.length === 0 ? this.seed : null,
      fidelity: this.focused.evaluation.fidelity,
      identity: this.identity,
    });
    this.kept.push(entry);
    this.renderTree();
    this.setText('#ag-verify-result', `kept ${this.kept.length} creature(s) · signed & hash-chained`);
  }

  private renderTree(): void {
    const tree = need(this.root, '#ag-tree');
    tree.innerHTML = '';
    this.kept.forEach((e, i) => {
      const li = document.createElement('li');
      const depth = e.parents.length === 0 ? 0 : 1;
      li.style.marginLeft = `${depth * 14}px`;
      li.innerHTML =
        `<span class="ag-node-dot"></span>` +
        `<code>${fingerprint(e.id)}</code> ` +
        `<span class="ag-node-meta">${i === 0 ? 'founder' : `child of ${fingerprint(e.parents[0] ?? '')}`} · ` +
        `loop ${(e.fidelity * 100).toFixed(0)}%</span>`;
      tree.appendChild(li);
    });
  }

  private exportLineage(): void {
    if (this.kept.length === 0) {
      this.setText('#ag-verify-result', 'keep a creature first, then export its signed lineage');
      return;
    }
    const file = makeLineageFile(this.kept);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'autograph-lineage.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importLineage(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as LineageFile;
      const result = await verifyLineage(parsed);
      if (result.valid) {
        this.setText('#ag-verify-result', `✓ verified ${result.checked} creature(s): every hash and signature checks out`);
      } else {
        this.setText('#ag-verify-result', `✗ verification failed: ${result.errors[0] ?? 'unknown error'}`);
      }
    } catch {
      this.setText('#ag-verify-result', '✗ could not parse that file as an Autograph lineage');
    } finally {
      input.value = '';
    }
  }

  // --- helpers --------------------------------------------------------------

  private setText(selector: string, text: string): void {
    const el = this.root.querySelector(selector);
    if (el) el.textContent = text;
  }
}
