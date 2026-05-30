import type { Genome } from '../engine/cppn.ts';
import { seededGenome } from '../engine/cppn.ts';
import { GENESIS_SEED } from '../engine/genesis.ts';
import type { Evaluation } from '../engine/fitness.ts';
import { evaluate, targetAtProbes, paintedAtProbes } from '../engine/fitness.ts';
import type { Phenotype } from '../engine/substrate.ts';
import { buildPhenotype, phenotypeNodes, phenotypeConns } from '../engine/substrate.ts';
import { Garden } from '../engine/evolution.ts';
import { volumeCloud, paintProjection, paintSlice } from '../engine/render/volume.ts';
import { CreatureScene } from '../engine/render/scene3d.ts';
import type { Identity, LineageEntry, LineageFile } from '../engine/lineage.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile, hashGenome, fingerprint } from '../engine/lineage.ts';
import { loadLineage, saveEntry } from '../engine/storage.ts';
import type { NetLayout } from './netdraw.ts';
import { drawCppnGraph, drawSubstrateGraph, NetworkPulse } from './netdraw.ts';
import { renderGenealogy } from './genealogy.ts';
import { need } from './dom.ts';

const COLS = 12;
const ROWS = 12;
const CELL = 34;
const FOLLOW_EVERY = 48;

type Mode = 'stacked' | 'render' | 'net' | 'dna';

const CAPTIONS: Record<Mode, string> = {
  stacked: 'STACKED · one creature, three ways at once — self-portrait (the output), the brain that draws it, the DNA that grows the brain. Tap any panel to open it full-screen.',
  render:
    'SELF-PORTRAIT · what the brain draws — its density+hue field over 3-D space. These glowing points are the picture, not the wiring.',
  net: 'PHENOTYPE · the brain the DNA painted, with neurons ES-placed. Signal flows input→output; queried over space, it draws the self-portrait above.',
  dna: 'DNA · the NEAT genotype, a CPPN that grows by add-node / add-connection. Given two points it returns one connection — it paints every weight and places every neuron of the brain.',
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
  private mode: Mode = 'stacked';
  private portraitDim: '3d' | '2d' = '3d';
  private running = true;
  private follow = true;
  private budget = 20;
  private frame = 0;
  private lastGenAt = 0;
  private lastGenValue = 0;
  private champRecording = false;
  private lastChampFid = 0;
  private lastChampAt = 0;

  private readonly pulse = new NetworkPulse();
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
    if (!this.webgl) this.portraitDim = '2d';
    this.setText('#ag-backend', this.webgl ? '3D · WEBGL' : '2D · CANVAS');
    this.setText('#ag-genesis-seed', GENESIS_SEED);
    this.wire();
    this.paintEmptyGrid();

    this.garden.seedWith([seededGenome(GENESIS_SEED)]);
    await this.bootGenealogy();
    this.syncDirty();
    this.refreshFocused(seededGenome(GENESIS_SEED));
    this.setText('#ag-focus-note', 'GROWN FROM GENESIS · the canonical world');
    this.setMode('stacked');
    requestAnimationFrame(() => this.tick());
  }

  private async bootGenealogy(): Promise<void> {
    const stored = await loadLineage();
    for (const e of stored) this.lineage.push(e);
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
    follow.addEventListener('change', () => (this.follow = follow.checked));
    const turbo = need<HTMLInputElement>(this.root, '#ag-turbo');
    turbo.addEventListener('change', () => (this.budget = turbo.checked ? 60 : 20));

    for (const m of ['stacked', 'render', 'net', 'dna'] as const) {
      need(this.root, `#ag-mode-${m}`).addEventListener('click', () => this.setMode(m));
    }
    need(this.root, '#ag-dim-3d').addEventListener('click', () => this.setDim('3d'));
    need(this.root, '#ag-dim-2d').addEventListener('click', () => this.setDim('2d'));
    // in STACKED, tapping a panel opens it full-screen
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
    this.paintEmptyGrid();
    this.syncDirty();
    this.follow = true;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = true;
    this.refreshFocused(seededGenome(seedStr));
    this.setText(
      '#ag-focus-note',
      seedStr === GENESIS_SEED
        ? 'GROWN FROM GENESIS · the canonical world'
        : 'YOUR OWN WORLD · in the swarm, creatures you KEEP migrate into the one genealogy from Genesis',
    );
  }

  /** A keypair is your *signature* on creatures you keep — it does not change the
   *  world you are exploring (Genesis or your own seed). */
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
        if (best) this.refreshFocused(best.cell.genome, best.index);
      }
      if (this.frame % 30 === 0) void this.maybeRecordChampion();
    }
    this.frame++;
    requestAnimationFrame(() => this.tick());
  }

  private updateReadouts(): void {
    const s = this.garden.stats();
    this.setText('#ag-gen', s.generation.toLocaleString('en-GB'));
    this.setText('#ag-pop', `${s.filled}/${s.cells}`);
    this.setText('#ag-cov', `${Math.round(s.coverage * 100)}%`);
    this.setText('#ag-species', String(s.species));
    const now = performance.now();
    if (this.lastGenAt === 0) {
      this.lastGenAt = now;
      this.lastGenValue = s.generation;
    } else if (now - this.lastGenAt > 600) {
      const gps = ((s.generation - this.lastGenValue) * 1000) / (now - this.lastGenAt);
      this.setText('#ag-gens', gps.toFixed(gps < 10 ? 1 : 0));
      this.lastGenAt = now;
      this.lastGenValue = s.generation;
    }
    if (this.focused) {
      this.setText('#ag-fid', `${(this.focused.evaluation.fidelity * 100).toFixed(1)}%`);
      this.setText('#ag-edges', String(this.focused.evaluation.liveConns));
      let live = 0;
      for (const c of this.focused.genome.conns) if (c.enabled) live++;
      this.setText('#ag-dna-size', `${this.focused.genome.nodes.length}·${live}`);
    }
  }

  // --- The focused individual (three equivalent views) ----------------------

  private refreshFocused(genome: Genome, index: number | null = null): void {
    const pheno = buildPhenotype(genome);
    const evaluation = evaluate(genome, pheno);
    let cloudCount = 0;
    if (this.webgl && this.scene) {
      const cloud = volumeCloud(pheno);
      cloudCount = cloud.count;
      this.scene.setCloud(cloud);
    }
    const hover = (t: string): void => this.setText('#ag-hover', t);
    const subNodes = phenotypeNodes(pheno);
    const net = drawSubstrateGraph(need(this.root, '#ag-net-svg') as unknown as SVGSVGElement, subNodes, phenotypeConns(pheno, subNodes), hover);
    const dna = drawCppnGraph(need(this.root, '#ag-dna-svg') as unknown as SVGSVGElement, genome, hover);
    this.focused = { genome, pheno, evaluation, net, dna, cloudCount };

    this.renderPortrait();
    this.attachPulse();
    this.drawLoop(genome, pheno);
    this.updateViewStat();
    this.moveHighlight(index);
    void this.updateFingerprint(genome);
    this.setText('#ag-fid', `${(evaluation.fidelity * 100).toFixed(1)}%`);
    this.setText('#ag-edges', String(evaluation.liveConns));
  }

  /** Move the bright selection border onto the focused cell (follow or click). */
  private moveHighlight(index: number | null): void {
    if (index === null) {
      this.highlight.style.opacity = '0';
      return;
    }
    const cx = index % COLS;
    const cy = Math.floor(index / COLS);
    this.highlight.style.opacity = '1';
    this.highlight.style.left = `${(cx / COLS) * 100}%`;
    this.highlight.style.top = `${(cy / ROWS) * 100}%`;
    this.highlight.style.width = `${(1 / COLS) * 100}%`;
    this.highlight.style.height = `${(1 / ROWS) * 100}%`;
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
    if (this.mode === 'render') this.applyMode();
  }

  private applyMode(): void {
    const stage = need(this.root, '#ag-stage');
    const dna = need(this.root, '#ag-dna-svg');
    const net = need(this.root, '#ag-net-svg');
    const c2d = need(this.root, '#ag-stage-2d');
    const stacked = this.mode === 'stacked';
    stage.classList.toggle('stacked', stacked);
    const want3d = this.mode === 'render' && this.portraitDim === '3d' && this.webgl;

    // in STACKED all three layers show at once (output · brain · DNA)
    dna.classList.toggle('hidden', !(stacked || this.mode === 'dna'));
    net.classList.toggle('hidden', !(stacked || this.mode === 'net'));
    c2d.classList.toggle('hidden', !(stacked || (this.mode === 'render' && (this.portraitDim === '2d' || !this.webgl))));
    this.scene?.setCanvasVisible(want3d);
    // the 2D/3D toggle is only meaningful for the full self-portrait
    need(this.root, '#ag-dim').classList.toggle('hidden', this.mode !== 'render' || !this.webgl);

    this.renderPortrait();
    this.setText('#ag-mode-caption', CAPTIONS[this.mode]);
    this.attachPulse();
    this.updateViewStat();
  }

  /** Paint the 2-D output: the colourful projection in STACKED (the actual
   *  self-portrait, lower-detail), or the flat z=0 slice in the full 2-D mode. */
  private renderPortrait(): void {
    if (!this.focused) return;
    const c2d = need<HTMLCanvasElement>(this.root, '#ag-stage-2d');
    if (this.mode === 'stacked') paintProjection(this.focused.pheno, c2d, 300);
    else if (this.mode === 'render' && (this.portraitDim === '2d' || !this.webgl)) paintSlice(this.focused.pheno, c2d, 420, 0);
  }

  /** Run the activation pulse on whichever network view is showing. */
  private attachPulse(): void {
    if (!this.focused) return;
    if ((this.mode === 'net' || this.mode === 'stacked') && this.focused.net) {
      this.pulse.attach(need(this.root, '#ag-net-svg') as unknown as SVGSVGElement, this.focused.net);
    } else if (this.mode === 'dna' && this.focused.dna) {
      this.pulse.attach(need(this.root, '#ag-dna-svg') as unknown as SVGSVGElement, this.focused.dna);
    } else {
      this.pulse.stop();
    }
  }

  private updateViewStat(): void {
    if (!this.focused) return;
    let s = '';
    if (this.mode === 'stacked') s = 'self-portrait · brain · DNA — tap one to open';
    else if (this.mode === 'render') s = this.webgl && this.portraitDim === '3d' ? `≈ ${this.focused.cloudCount.toLocaleString('en-GB')} living points` : '2-D slice · z = 0';
    else if (this.mode === 'net') s = `${this.focused.net?.nodes.length ?? 0} nodes · ${this.focused.net?.edges.length ?? 0} edges`;
    else s = `${this.focused.dna?.nodes.length ?? 0} nodes · ${this.focused.dna?.edges.length ?? 0} edges`;
    this.setText('#ag-viewstat', s);
  }

  private drawLoop(genome: Genome, pheno: Phenotype): void {
    const target = targetAtProbes(genome);
    const n = target.length; // = paramCount(genome): grows as the DNA complexifies
    const painted = paintedAtProbes(pheno, n);
    const ctx = this.loopCtx;
    const Wd = (this.loop.width = Math.max(120, n * 5));
    const Hd = (this.loop.height = 54);
    const sw = Wd / n;
    const rh = 22;
    ctx.clearRect(0, 0, Wd, Hd);
    for (let k = 0; k < n; k++) {
      const tg = Math.round(target[k]! * 255);
      ctx.fillStyle = `rgb(${tg},${tg},${tg})`;
      ctx.fillRect(k * sw, 0, Math.ceil(sw), rh);
      const pg = Math.round(painted[k]! * 255);
      ctx.fillStyle = `rgb(${pg},${pg},${pg})`;
      ctx.fillRect(k * sw, Hd - rh, Math.ceil(sw), rh);
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
    let budget = 8;
    for (const idx of this.garden.archive.drainDirty()) {
      if (budget-- <= 0) break;
      const cell = this.garden.archive.get(idx);
      if (!cell) continue;
      const cx = (idx % COLS) * CELL;
      const cy = Math.floor(idx / COLS) * CELL;
      paintProjection(buildPhenotype(cell.genome), this.thumb, CELL);
      this.gridCtx.drawImage(this.thumb, cx, cy);
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
    const idx = cy * COLS + cx;
    const cell = this.garden.archive.get(idx);
    if (!cell) return;
    this.follow = false;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = false;
    this.refreshFocused(cell.genome, idx);
    this.setText('#ag-focus-note', 'PINNED · a creature you chose from the diversity map');
  }

  /** Auto-record the champion lineage: when a new, more-faithful lively elite
   *  appears, sign it into the tree of life with the previous champion as parent.
   *  Throttled + capped so swarm-speed evolution can't blow the genealogy out. */
  private async maybeRecordChampion(): Promise<void> {
    if (this.champRecording) return;
    const best = this.garden.archive.bestLively(0.3, 0.2) ?? this.garden.archive.best();
    if (!best) return;
    const fid = best.cell.evaluation.fidelity;
    const now = performance.now();
    if (fid <= this.lastChampFid + 0.004) return; // must be a real improvement
    if (now - this.lastChampAt < 3500) return; // throttle (swarm-speed safe)
    this.champRecording = true;
    try {
      if (!this.identity) this.identity = await generateIdentity();
      const parents = this.lineage.length > 0 ? [this.lineage[this.lineage.length - 1]!.id] : [];
      const entry = await createEntry({ genome: best.cell.genome, parents, seed: null, fidelity: fid, identity: this.identity });
      this.lineage.push(entry);
      await saveEntry(entry);
      this.lastChampFid = fid;
      this.lastChampAt = now;
      if (this.lineage.length > 140) this.lineage.splice(1, this.lineage.length - 140); // keep Genesis + recent
      renderGenealogy(need(this.root, '#ag-tree'), this.lineage);
      this.setText('#ag-tree-count', String(this.lineage.length));
    } finally {
      this.champRecording = false;
    }
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
