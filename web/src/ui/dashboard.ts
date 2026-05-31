import type { Genome } from '../engine/cppn.ts';
import { seededGenome } from '../engine/cppn.ts';
import { GENESIS_SEED } from '../engine/genesis.ts';
import type { Evaluation } from '../engine/fitness.ts';
import { evaluate, targetAtProbes, readBackUnits } from '../engine/fitness.ts';
import type { Phenotype } from '../engine/substrate.ts';
import { buildPhenotype, phenotypeNodes, phenotypeConns } from '../engine/substrate.ts';
import { Garden, type GardenStats } from '../engine/evolution.ts';
import { MapElites } from '../engine/mapelites.ts';
import { SharedArchive } from '../net/swarm.ts';
import { volumeCloud, paintProjection, paintSlice, drawSubstrateOverlay, substrateNodeMarkers, substratePipeSegments } from '../engine/render/volume.ts';
import { CreatureScene } from '../engine/render/scene3d.ts';
import type { Identity, LineageEntry, LineageFile } from '../engine/lineage.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile, hashGenome, fingerprint } from '../engine/lineage.ts';
import { loadLineage, saveEntry } from '../engine/storage.ts';
import type { Archive, Cell } from '../engine/archive.ts';
import type { NetLayout } from './netdraw.ts';
import { drawCppnGraph, drawSubstrateGraph, NetworkPulse } from './netdraw.ts';
import { renderGenealogy } from './genealogy.ts';
import { HYPER, PARAMS } from '../engine/hyperparams.ts';
import { need } from './dom.ts';

const COLS = HYPER.gridCols;
const ROWS = HYPER.gridRows;
const CELL = 34;
const FOLLOW_EVERY = HYPER.followEvery;

// The shared swarm a GENESIS visitor auto-joins. Opt out with `?swarm=off`,
// rejoin with `?swarm=on`, or point elsewhere with `?swarm=wss://…`.
const DEFAULT_COORDINATOR = 'wss://autograph-coordinator.usemeos.workers.dev';

type Mode = 'stacked' | 'render' | 'net' | 'dna';

const CAPTIONS: Record<Mode, string> = {
  stacked: 'STACKED · one creature, three ways at once — the image it’s born in (the output), the brain that emerges within it, and the DNA that paints it. Tap any panel to open it full-screen.',
  render:
    'THE IMAGE · the field the DNA paints across 3-D space — the image the brain emerges within. These glowing points are the image, not the wiring.',
  net: 'PHENOTYPE · the brain ES-HyperNEAT grew — shown at the neurons’ REAL (x,y), the coordinates the quadtree placed them at, NOT a tidy column. They sit where the image has structure: the network and the image are one and the same.',
  dna: 'DNA · the NEAT genotype, a CPPN that grows by add-node / add-connection. It paints the image and grows the brain within it; the brain then reads that image back to find its beginning — this DNA (THE LOOP).',
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
  private lite = false; // mobile / low-power: lighter volume + pixel ratio
  private identity: Identity | null = null;
  private focused: Focused | null = null;
  private mode: Mode = 'stacked';
  private portraitDim: '3d' | '2d' = '3d';
  private mapView: 'local' | 'world' = 'world'; // which archive the DIVERSITY MAP renders
  private running = true;
  private follow = true;
  private novelty = true; // Novelty Search on by default — keep discovering new kinds
  private coordinatorUrl = ''; // resolved in start() — defaults to the live swarm; '' = offline
  private shared: SharedArchive | null = null; // the live SharedArchive while joined to the swarm
  private readonly options = { recurrent: true, selfConn: true, gating: true };
  private budget = HYPER.baseBudget;
  private frame = 0;
  private lastSampleAt = 0; // when we last sampled this node's throughput
  private lastEvalCount = 0; // cumulative evaluations at the last sample
  private lastRateAt = 0; // throttle for reporting our rate upstream
  // The always-alive reframe: foreground YOUR climbing journey vs the (now-saturated)
  // shared frontier, and celebrate the rare moment a local creature beats the world.
  private yourBestShown = 0; // last YOUR-BEST skill rendered (drives the ✧ pulse)
  private peakWorld = 0; // highest WORLD-BEST skill seen this session (world-win gate)
  private sawWorldBaseline = false; // captured the synced world champion as the baseline yet
  private celebrateTimer: ReturnType<typeof setTimeout> | null = null;
  private treeRecording = false;
  private lastTreeAt = 0;
  private genesisId = '';
  /** in-engine genealogy gid → signed lineage id (for the branching tree). */
  private readonly signedByGid = new Map<number, string>();

  private readonly pulse = new NetworkPulse();
  private readonly lineage: LineageEntry[] = [];
  /** Cells awaiting a thumbnail redraw — a persistent, frame-budgeted queue.
   *  `drainDirty()` clears the whole dirty set each frame, but only `budget`
   *  cells are painted; keeping the overflow here (instead of dropping it) lets
   *  a large hydrate/swarm-pull burst paint fully over the next few frames
   *  rather than leaving populated cells black until something re-touches them. */
  private readonly paintQueue = new Set<number>();

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
    const nav = navigator as { hardwareConcurrency?: number; deviceMemory?: number };
    const deviceLite =
      (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches) ||
      (nav.hardwareConcurrency ?? 8) <= 4 ||
      (nav.deviceMemory ?? 8) <= 4;
    this.scene = new CreatureScene(stage, deviceLite);
    this.webgl = this.scene.ok;
    this.lite = deviceLite || !this.webgl;
    if (!this.webgl) this.portraitDim = '2d';
    this.setText('#ag-backend', this.webgl ? (this.lite ? '3D · WEBGL (lite)' : '3D · WEBGL') : '2D · CANVAS');
    this.setText('#ag-genesis-seed', GENESIS_SEED);
    this.wire();
    this.paintEmptyGrid();

    this.coordinatorUrl = this.readCoordinatorUrl();
    // PER-PEER DIVERGENT START: each node explores from its OWN line (tied to its
    // signing key on the swarm) instead of every tab hugging the one global
    // champion — this IS "your journey". The canonical Genesis founder is still
    // seeded below, so the shared world's lineage root is untouched; only the
    // exploration trajectory (RNG: founders, mutation, selection, novelty) diverges.
    let line = this.randomLine();
    if (this.coordinatorUrl) {
      try {
        const id = await this.ensureIdentity(); // ephemeral key so a fresh visitor can join
        line = `peer:${id.publicKeyHex}`;
        this.garden = new Garden(line, COLS, ROWS, this.makeShared());
        this.setText('#ag-swarm-label', 'connecting…');
      } catch {
        // couldn't mint a key / open the socket — run solo, but say so honestly.
        this.garden = new Garden(line, COLS, ROWS);
        this.indicateSwarmOff(false);
      }
    } else {
      // explicit per-visit opt-out (?swarm=off) — loudly flagged + one-click reversible.
      this.garden = new Garden(line, COLS, ROWS);
      this.indicateSwarmOff(true);
    }
    this.garden.setNovelty(this.novelty);
    this.garden.seedWith([seededGenome(GENESIS_SEED)]);
    // Diversity-map default: WORLD when on the swarm (today's view), LOCAL when solo.
    this.mapView = this.shared ? 'world' : 'local';
    this.updateMapViewAvailability();
    this.refreshMapViewUi();
    await this.bootGenealogy();
    this.syncDirty();
    this.refreshFocused(seededGenome(GENESIS_SEED));
    this.setText('#ag-focus-note', 'GROWN FROM GENESIS · the canonical world');
    this.setMode('stacked');
    this.maybeWelcome();
    requestAnimationFrame(() => this.tick());
  }

  private async bootGenealogy(): Promise<void> {
    const stored = await loadLineage();
    for (const e of stored) this.lineage.push(e);
    let genesis = this.lineage.find((e) => e.parents.length === 0);
    if (!genesis) {
      const id = await this.ensureIdentity();
      const g = seededGenome(GENESIS_SEED);
      genesis = await createEntry({ genome: g, parents: [], seed: GENESIS_SEED, fidelity: evaluate(g).fidelity, identity: id });
      this.lineage.unshift(genesis);
      await saveEntry(genesis);
    }
    this.genesisId = genesis.id;
    this.resetSignedRoot();
    renderGenealogy(need(this.root, '#ag-tree'), this.lineage);
    this.setText('#ag-tree-count', String(this.lineage.length));
  }

  /** Resolve the coordinator URL. The swarm is ON BY DEFAULT and that default is
   *  sticky to NOTHING — a plain refresh ALWAYS re-joins the live swarm. `?swarm=off`
   *  is a strictly per-VISIT opt-out: it does not persist (the old behaviour silently
   *  trapped opted-out visitors → a contribution leak), and whenever it's active the
   *  UI loudly says "not contributing" with a one-click JOIN. Behaviour:
   *  - no param                 → the live default (swarm ON)
   *  - `?swarm=off|0|false|` ('') → off for THIS visit only (not contributing)
   *  - `?swarm=on|1`            → the live default (explicit)
   *  - `?swarm=wss://…`         → a custom coordinator, this visit only */
  private readCoordinatorUrl(): string {
    // One-time cleanup: silently un-trap anyone the OLD sticky opt-out left off, so
    // a normal refresh brings them back to contributing without any action.
    try {
      localStorage.removeItem('ag-coordinator');
    } catch {
      /* storage blocked — nothing to clean */
    }
    try {
      const q = new URLSearchParams(location.search).get('swarm');
      if (q === null) return DEFAULT_COORDINATOR; // plain visit → join the swarm
      if (q === '' || q === 'off' || q === '0' || q === 'false') return ''; // per-visit opt-out (not persisted)
      if (q === 'on' || q === '1') return DEFAULT_COORDINATOR;
      return q; // a custom coordinator URL, this visit only
    } catch {
      return DEFAULT_COORDINATOR; // can't read the URL — still join the swarm
    }
  }

  /** The visitor's signing key — auto-created INVISIBLY the first time it's needed.
   *  Lineage is a signed Merkle-DAG, so every kept genome is still signed under the
   *  hood; the key just isn't a UI control anymore (KISS). One anonymous identity
   *  per visitor, minted on demand, persisted nowhere it needs announcing. */
  private async ensureIdentity(): Promise<Identity> {
    if (!this.identity) this.identity = await generateIdentity();
    return this.identity;
  }

  /** Build a swarm-backed archive: a local MapElites mirror (UI-unchanged) that
   *  pushes best-per-niche elites + pulls others' (migration) via the coordinator. */
  private makeShared(): SharedArchive {
    this.shared = new SharedArchive({
      url: this.coordinatorUrl,
      mirror: new MapElites(COLS, ROWS),
      // LOCAL-only view: records just THIS node's own creatures, so the diversity
      // map can show "your evolving archive" distinct from the shared (saturated) one.
      localMirror: new MapElites(COLS, ROWS),
      signer: { sign: async (g, e) => createEntry({ genome: g, parents: [], seed: null, fidelity: e.fidelity, identity: await this.ensureIdentity() }) },
      onPeers: (n) => this.setPeers(n),
      onSwarm: (_peers, gps) => this.setSwarmRate(gps),
      // Ignore 'unknown-type' so a not-yet-updated coordinator (additive messages)
      // never flips the UI to offline — it just falls back to the local rate.
      onError: (code) => {
        if (code !== 'unknown-type') this.setText('#ag-swarm-label', `offline · ${code}`);
      },
    });
    return this.shared;
  }

  /** Reflect the live island count in the SWARM line (present tense — it's live).
   *  GEN/S stays YOUR node's own pulse; the SWARM line carries the collective, so
   *  the two are no longer the same number (and when they coincide, the "just you"
   *  label makes plain WHY: you're the only island reporting right now). */
  private setPeers(n: number): void {
    this.setText('#ag-swarm-nodes', String(Math.max(1, n)));
    const swarm = this.root.querySelector('.swarm');
    const join = this.root.querySelector<HTMLButtonElement>('#ag-swarm-join');
    if (n === 0) {
      // Detached — the collective rate is unknown until we reconnect (GEN/S, your
      // own pulse, keeps running untouched).
      this.setText('#ag-swarm-label', 'reconnecting…');
      this.setText('#ag-swarm-gps', '—');
    } else {
      this.setText('#ag-swarm-label', n > 1 ? 'islands · live' : 'island · just you');
      if (join) join.hidden = true;
      swarm?.classList.remove('swarm-off');
    }
  }

  /** The collective throughput from the coordinator — creatures/sec summed across
   *  every connected island. Shown ONLY on the SWARM line; EVAL/S is this node's own. */
  private setSwarmRate(eps: number): void {
    this.setText('#ag-swarm-gps', this.formatRate(eps));
  }

  private formatRate(rate: number): string {
    return rate >= 10 ? Math.round(rate).toLocaleString('en-GB') : rate.toFixed(1);
  }

  private formatSkill(x: number): string {
    return x > 0 ? `${(x * 100).toFixed(1)}%` : '—';
  }

  /** A fresh, divergent exploration line for this session (when not keyed to an
   *  identity) — so two tabs don't evolve the identical trajectory. */
  private randomLine(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const tok = c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random()}`;
    return `peer:${tok}`;
  }

  /** YOUR journey: render YOUR BEST (your own climb) + WORLD BEST (the global
   *  champion, via the synced mirror), pulse ✧ on a new personal best, and throw a
   *  real celebration the rare time YOUR creature becomes the new world champion. */
  private updateJourney(s: GardenStats): void {
    const your = s.sessionBest; // the best lively self-encoder THIS node has made
    const world = s.bestFidelity; // the mirror champion = the global best once synced
    this.setText('#ag-your-best', this.formatSkill(your));
    this.setText('#ag-world-best', this.formatSkill(world));

    // ✧ quiet pulse whenever you beat your OWN previous best (skip the first paint).
    if (your > this.yourBestShown + 1e-4) {
      if (this.yourBestShown > 0) this.pulsePersonalBest();
      this.yourBestShown = your;
    }

    // ✦ the rare global win: a creature YOU evolved becomes the new world champion
    // (not merely pulling in everyone else's best on connect, and not a migration).
    if (this.shared?.isSynced()) {
      if (!this.sawWorldBaseline) {
        this.peakWorld = world; // baseline = the hydrated world champion; no false fanfare
        this.sawWorldBaseline = true;
      } else if (world > this.peakWorld + 1e-4) {
        const yoursWon = your >= world - 1e-6; // your own creature is the one that did it
        this.peakWorld = world;
        if (yoursWon) void this.celebrateWorldWin(world);
      }
    }
  }

  private pulsePersonalBest(): void {
    const el = this.root.querySelector('.ro-your');
    if (!el) return;
    el.classList.remove('pb-pulse');
    void (el as HTMLElement).offsetWidth; // reflow → restart the one-shot animation
    el.classList.add('pb-pulse');
  }

  /** A real, honest celebration: your creature advanced the SHARED frontier. We
   *  show the new world-best skill and YOUR signature (the key your shared elites
   *  are signed under) — the finder, on the lineage. */
  private async celebrateWorldWin(skill: number): Promise<void> {
    const el = this.root.querySelector('#ag-celebrate');
    if (!el) return;
    let sig = '—';
    try {
      const id = await this.ensureIdentity();
      sig = fingerprint(id.publicKeyHex);
    } catch {
      /* keep the dash — the win still stands */
    }
    el.replaceChildren();
    const mark = document.createElement('strong');
    mark.textContent = `✦ NEW WORLD BEST · ${(skill * 100).toFixed(1)}% LOOP SKILL`;
    const who = document.createElement('span');
    who.className = 'cel-sig';
    who.textContent = `you advanced the shared frontier · signed ${sig}`;
    el.append(mark, who);
    el.classList.add('show');
    if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
    this.celebrateTimer = setTimeout(() => el.classList.remove('show'), 9000);
  }

  /** Loudly + honestly show that this tab is NOT contributing, with a one-click
   *  way back in. No silent opt-out: if you're solo, you can see it and undo it. */
  private indicateSwarmOff(byChoice: boolean): void {
    this.setText('#ag-swarm-nodes', '0');
    this.setText('#ag-swarm-label', byChoice ? 'OFF — not contributing' : 'offline — not contributing');
    this.setText('#ag-swarm-gps', '—');
    this.setText('#ag-world-best', '—');
    this.setText('#ag-swarm-explored', '— (solo)');
    this.root.querySelector('.swarm')?.classList.add('swarm-off');
    const join = this.root.querySelector<HTMLButtonElement>('#ag-swarm-join');
    if (join) join.hidden = false;
  }

  /** Re-join the live swarm by reloading at the default (swarm ON) — drops any
   *  `?swarm=off` from the URL so a refresh contributes again. */
  private joinSwarm(): void {
    try {
      location.search = '';
    } catch {
      location.href = location.pathname;
    }
  }

  /** Re-root the gid→signed map on the canonical Genesis (gids reset per world). */
  private resetSignedRoot(): void {
    this.signedByGid.clear();
    if (this.genesisId) this.signedByGid.set(1, this.genesisId); // gid 1 = each world's founder ↦ Genesis node
  }

  // --- Controls -------------------------------------------------------------

  private wire(): void {
    const run = need<HTMLButtonElement>(this.root, '#ag-run');
    run.addEventListener('click', () => {
      this.running = !this.running;
      run.textContent = this.running ? 'PAUSE' : 'RESUME';
    });
    const follow = need<HTMLInputElement>(this.root, '#ag-follow');
    follow.addEventListener('change', () => {
      this.follow = follow.checked;
      this.updateSelBadge();
    });
    const turbo = need<HTMLInputElement>(this.root, '#ag-turbo');
    turbo.addEventListener('change', () => (this.budget = turbo.checked ? HYPER.turboBudget : HYPER.baseBudget));
    const novelty = need<HTMLInputElement>(this.root, '#ag-novelty');
    novelty.addEventListener('change', () => {
      this.novelty = novelty.checked;
      this.garden.setNovelty(novelty.checked);
    });

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

    // DIVERSITY MAP source: your own evolving map (LOCAL) vs the shared one (WORLD).
    this.root.querySelector<HTMLButtonElement>('#ag-map-local')?.addEventListener('click', () => this.setMapView('local'));
    this.root.querySelector<HTMLButtonElement>('#ag-map-world')?.addEventListener('click', () => this.setMapView('world'));

    // One-click re-join when this tab is opted out (no silent permanent opt-out).
    this.root.querySelector<HTMLButtonElement>('#ag-swarm-join')?.addEventListener('click', () => this.joinSwarm());

    need(this.root, '#ag-keep').addEventListener('click', () => void this.keep());
    need(this.root, '#ag-export').addEventListener('click', () => this.exportLineage());
    const imp = need<HTMLInputElement>(this.root, '#ag-import');
    imp.addEventListener('change', () => void this.importLineage(imp));

    need(this.root, '#ag-info-open').addEventListener('click', () => this.toggleInfo(true));
    need(this.root, '#ag-info-close').addEventListener('click', () => this.toggleInfo(false));
    need(this.root, '#ag-help-open').addEventListener('click', () => need(this.root, '#ag-help').classList.add('open'));
    need(this.root, '#ag-help-close').addEventListener('click', () => need(this.root, '#ag-help').classList.remove('open'));
    need(this.root, '#ag-welcome-begin').addEventListener('click', () => this.closeWelcome());
    need(this.root, '#ag-welcome-open').addEventListener('click', () => {
      need(this.root, '#ag-help').classList.remove('open');
      need(this.root, '#ag-welcome').classList.add('open');
    });

    need(this.root, '#ag-tuning-open').addEventListener('click', () => {
      this.renderParams();
      need(this.root, '#ag-tuning').classList.add('open');
    });
    need(this.root, '#ag-tuning-close').addEventListener('click', () => need(this.root, '#ag-tuning').classList.remove('open'));
    const optR = need<HTMLInputElement>(this.root, '#ag-opt-recurrent');
    const optS = need<HTMLInputElement>(this.root, '#ag-opt-self');
    const optG = need<HTMLInputElement>(this.root, '#ag-opt-gating');
    const applyOpts = (): void => {
      this.options.recurrent = optR.checked;
      this.options.selfConn = optS.checked;
      this.options.gating = optG.checked;
      this.garden.setOptions(this.options);
    };
    optR.addEventListener('change', applyOpts);
    optS.addEventListener('change', applyOpts);
    optG.addEventListener('change', applyOpts);
  }

  /** Render the read-only hyperparameter table from the single config source. */
  private renderParams(): void {
    const host = need(this.root, '#ag-params-table');
    host.replaceChildren();
    let lastGroup = '';
    for (const p of PARAMS) {
      if (p.group !== lastGroup) {
        const h = document.createElement('div');
        h.className = 'params-group';
        h.textContent = p.group;
        host.appendChild(h);
        lastGroup = p.group;
      }
      const row = document.createElement('div');
      row.className = 'params-row';
      const k = document.createElement('span');
      k.className = 'pk';
      k.textContent = p.label;
      const v = document.createElement('span');
      v.className = 'pv';
      v.textContent = p.unit ? `${p.value} ${p.unit}` : String(p.value);
      const note = document.createElement('span');
      note.className = 'pn';
      note.textContent = p.note + (p.selfTunes ? ' · self-tunes' : '');
      row.append(k, v, note);
      host.appendChild(row);
    }
  }

  /** Show the welcome on first visit only; re-openable from the “?” help. */
  private maybeWelcome(): void {
    let seen = false;
    try {
      seen = localStorage.getItem('ag-welcomed') === '1';
    } catch {
      /* storage off — show it, it just won't be remembered */
    }
    if (!seen) need(this.root, '#ag-welcome').classList.add('open');
  }

  private closeWelcome(): void {
    need(this.root, '#ag-welcome').classList.remove('open');
    try {
      localStorage.setItem('ag-welcomed', '1');
    } catch {
      /* ignore */
    }
  }

  private toggleInfo(open: boolean): void {
    need(this.root, '#ag-overlay').classList.toggle('open', open);
  }

  // --- Frame loop -----------------------------------------------------------

  private tick(): void {
    if (this.running) {
      this.garden.step(this.budget);
      this.syncDirty();
      this.updateReadouts();
      if (this.follow && this.frame % FOLLOW_EVERY === 0) {
        // Follow the best of whichever archive is on the map (LOCAL = your best, WORLD = champion).
        const a = this.mapArchive();
        const best = a.bestLively(0.32, 0.22) ?? a.bestLively(0.2, 0.12) ?? a.best();
        if (best) this.refreshFocused(best.cell.genome, best.index);
      }
      if (this.frame % 24 === 0) void this.maybeGrowTree();
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

    // YOUR journey (always moving) — your own climb + your open-ended exploration.
    this.setText('#ag-your-found', this.formatCount(s.novelty));
    this.updateJourney(s);

    // "explored" = the SHARED archive's cumulative, persisted best-per-niche
    // discoveries (monotonic across the whole swarm). It's honest that this nearly
    // flatlines once the 196-niche map fills with near-optimal champions — that is
    // convergence of the quality frontier, surfaced here, not a stuck counter. Solo
    // (or pre-sync) there is no shared frontier to report, so we show "—" rather
    // than silently swapping in a different (local) number that looks like a reset.
    // 'explored' is a WORLD metric only. Solo there's no shared frontier → "— (solo)";
    // connected-but-pre-sync → "—"; otherwise the shared persisted total. Never a
    // local value (the fast-climbing solo number is FOUND, clearly labelled as yours).
    const discovered = this.shared?.discovered() ?? null;
    this.setText('#ag-swarm-explored', !this.shared ? '— (solo)' : discovered === null ? '—' : this.formatCount(discovered));

    const now = performance.now();
    if (this.lastSampleAt === 0) {
      this.lastSampleAt = now;
      this.lastEvalCount = s.evaluations;
    } else if (now - this.lastSampleAt > 600) {
      // THROUGHPUT, not frames. Counting whole generations (one step per rAF frame)
      // made TURBO — a bigger per-FRAME offspring budget — look ~3x slower while real
      // throughput was flat (the ruler, not the engine). `evaluations` advances by the
      // budget every frame, so creatures/sec is TURBO-invariant: flat-or-higher, never a drop.
      const eps = ((s.evaluations - this.lastEvalCount) * 1000) / (now - this.lastSampleAt);
      // EVAL/S is ALWAYS this node's own pulse; the collective lives on the SWARM line.
      this.setText('#ag-gens', this.formatRate(eps));
      // Report this node's throughput upstream so the coordinator sums the swarm total —
      // SAME unit as the local readout, so local and collective stay consistent.
      if (this.shared && now - this.lastRateAt > 2400) {
        this.lastRateAt = now;
        this.shared.reportRate(eps);
      }
      this.lastSampleAt = now;
      this.lastEvalCount = s.evaluations;
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
      const cloud = volumeCloud(pheno, this.lite ? 28 : 42); // lighter volume on mobile/low-power
      cloudCount = cloud.count;
      this.scene.setCloud(cloud);
      const m = substrateNodeMarkers(pheno); // overlay the neurons at their real 3-D positions
      this.scene.setNodes(m.pos, m.sizes);
      const pipes = substratePipeSegments(pheno, this.lite ? 24 : 44); // glowing energy pipes along the strongest wiring
      this.scene.setPipes(pipes.a, pipes.b, pipes.col, pipes.mag);
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
    this.updateSelBadge();
    void this.updateFingerprint(genome);
    this.setText('#ag-fid', `${(evaluation.fidelity * 100).toFixed(1)}%`);
    this.setText('#ag-edges', String(evaluation.liveConns));
  }

  /** The unmistakable "which creature am I watching" badge on the main view. */
  private updateSelBadge(): void {
    this.setText('#ag-sel-badge', this.follow ? '● FOLLOWING · most enlightened' : '◆ PINNED · your pick');
  }

  private formatCount(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
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
    if (this.mode === 'render' || this.mode === 'stacked') this.applyMode();
  }

  private applyMode(): void {
    const stage = need(this.root, '#ag-stage');
    const dna = need(this.root, '#ag-dna-svg');
    const net = need(this.root, '#ag-net-svg');
    const c2d = need(this.root, '#ag-stage-2d');
    const stacked = this.mode === 'stacked';
    stage.classList.toggle('stacked', stacked);
    const portrait3d = this.portraitDim === '3d' && this.webgl;
    // the 3-D image fills the stage (render) or the top cell (stacked)
    const want3d = (this.mode === 'render' || stacked) && portrait3d;
    const sliceTop = stacked && !portrait3d; // stacked top falls back to the 2-D output

    // in STACKED all three layers show at once (output · brain · DNA)
    dna.classList.toggle('hidden', !(stacked || this.mode === 'dna'));
    net.classList.toggle('hidden', !(stacked || this.mode === 'net'));
    c2d.classList.toggle('hidden', !((this.mode === 'render' && !portrait3d) || sliceTop));
    this.scene?.setCanvasVisible(want3d);
    // the 2D/3D toggle is meaningful for the image — full or stacked-top
    need(this.root, '#ag-dim').classList.toggle('hidden', !((this.mode === 'render' || stacked) && this.webgl));

    this.renderPortrait();
    this.setText('#ag-mode-caption', CAPTIONS[this.mode]);
    this.attachPulse();
    this.updateViewStat();
  }

  /** Paint the 2-D output: the colourful projection in STACKED (the actual
   *  image, lower-detail), or the flat z=0 slice in the full 2-D mode. */
  private renderPortrait(): void {
    if (!this.focused) return;
    const c2d = need<HTMLCanvasElement>(this.root, '#ag-stage-2d');
    const portrait3d = this.portraitDim === '3d' && this.webgl;
    // only paint the 2-D canvas when it's the one showing (3-D uses the WebGL cell).
    // Then overlay the substrate network at its real (x,y) so the image reads as
    // a neural network whose neurons sit where the image has structure.
    if (this.mode === 'stacked' && !portrait3d) {
      paintProjection(this.focused.pheno, c2d, 300);
      drawSubstrateOverlay(this.focused.pheno, c2d, 22);
    } else if (this.mode === 'render' && !portrait3d) {
      paintSlice(this.focused.pheno, c2d, 420, 0);
      drawSubstrateOverlay(this.focused.pheno, c2d, 40);
    }
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
    if (this.mode === 'stacked') s = 'image · brain · DNA — tap one to open';
    else if (this.mode === 'render') s = this.webgl && this.portraitDim === '3d' ? `≈ ${this.focused.cloudCount.toLocaleString('en-GB')} living points` : '2-D slice · z = 0';
    else if (this.mode === 'net') s = `${this.focused.net?.nodes.length ?? 0} nodes · ${this.focused.net?.edges.length ?? 0} edges`;
    else s = `${this.focused.dna?.nodes.length ?? 0} nodes · ${this.focused.dna?.edges.length ?? 0} edges`;
    this.setText('#ag-viewstat', s);
  }

  private drawLoop(genome: Genome, pheno: Phenotype): void {
    const target = targetAtProbes(genome); // the original DNA (top row)
    const n = target.length; // = paramCount(genome): grows as the DNA complexifies
    const dna2 = readBackUnits(genome, pheno); // the read-back NETWORK's DNA′ (bottom row)
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
      const pg = Math.round((dna2[k] ?? 0) * 255);
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
    // Fold every freshly-changed cell into the persistent paint queue first, so a
    // hydrate/swarm-pull burst that marks far more than `budget` cells dirty in one
    // frame keeps its overflow queued instead of dropping it (drainDirty clears the
    // whole set). Then redraw a bounded number per frame — the map fills fully over
    // the next few frames rather than leaving populated cells black until a click.
    const arch = this.mapArchive();
    for (const idx of arch.drainDirty()) this.paintQueue.add(idx);
    let budget = 8;
    for (const idx of this.paintQueue) {
      if (budget-- <= 0) break;
      this.paintQueue.delete(idx);
      const cell = arch.get(idx);
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
    const cell = this.mapArchive().get(idx);
    if (!cell) return;
    this.follow = false;
    need<HTMLInputElement>(this.root, '#ag-follow').checked = false;
    this.refreshFocused(cell.genome, idx);
    this.setText('#ag-focus-note', this.mapView === 'local' ? 'PINNED · a creature from YOUR own map' : 'PINNED · a creature you chose from the diversity map');
  }

  // --- Diversity-map view (LOCAL ↔ WORLD) -----------------------------------

  /** The archive the DIVERSITY MAP renders: LOCAL = this node's OWN evolving map
   *  (dynamic, churning), WORLD = the shared/merged mirror (saturated near ~98%).
   *  Solo, only the local archive exists, so both resolve to it. No new compute —
   *  it just swaps which already-maintained archive feeds the existing grid render. */
  private mapArchive(): Archive {
    if (this.mapView === 'local' && this.shared) return this.shared.localArchive() ?? this.garden.archive;
    return this.garden.archive;
  }

  /** Switch the diversity-map source (LOCAL ↔ WORLD) and fully repaint the grid. */
  private setMapView(view: 'local' | 'world'): void {
    if (view === 'world' && !this.shared) view = 'local'; // no shared world when solo
    this.mapView = view;
    this.refreshMapViewUi();
    this.repaintMap();
  }

  /** Reflect the active view in the toggle buttons + the caption (no repaint). */
  private refreshMapViewUi(): void {
    this.root.querySelector('#ag-map-local')?.classList.toggle('active', this.mapView === 'local');
    this.root.querySelector('#ag-map-world')?.classList.toggle('active', this.mapView === 'world');
    const legend = 'complexity → · symmetry ↑ · brightness = skill · ⬚ = watched';
    this.setText(
      '#ag-map-caption',
      this.mapView === 'local'
        ? `LOCAL · the creatures THIS machine has evolved this session — your own map, dynamic & churning · ${legend}`
        : `WORLD · the shared archive (everyone's best per niche), saturated near the ~98% champion · ${legend}`,
    );
  }

  /** Enable/disable WORLD by whether a shared archive exists; force LOCAL when solo. */
  private updateMapViewAvailability(): void {
    const world = this.root.querySelector<HTMLButtonElement>('#ag-map-world');
    const available = this.shared != null;
    if (world) {
      world.disabled = !available;
      world.title = available
        ? "the SHARED archive — everyone's best per niche (saturated near the ~98% champion)"
        : '— (solo): no shared world to compare; join the swarm to see WORLD';
    }
    if (!available && this.mapView === 'world') this.setMapView('local');
  }

  /** Full repaint of the grid from the currently-viewed archive (used on toggle). */
  private repaintMap(): void {
    this.paintEmptyGrid();
    this.paintQueue.clear();
    const arch = this.mapArchive();
    arch.drainDirty(); // repainting everything — clear any stale dirty for this archive
    arch.forEach((cell, idx) => {
      if (cell) this.paintQueue.add(idx);
    });
    this.moveHighlight(null); // follow re-places it; a stale highlight could point at an empty cell
  }

  /** Grow a REAL branching phylogeny: periodically sign one lively elite into the
   *  tree, attaching it to its nearest already-signed *genetic* ancestor(s) — so
   *  crossover yields two-parent reticulations and divergent lineages branch.
   *  Throttled + capped so swarm-speed evolution can't blow the genealogy out. */
  private async maybeGrowTree(): Promise<void> {
    if (this.treeRecording) return;
    const now = performance.now();
    if (now - this.lastTreeAt < 1200) return; // steady, bounded growth
    let pick: Cell | null = null;
    this.garden.archive.forEach((cell) => {
      if (!cell || cell.gid === undefined || this.signedByGid.has(cell.gid)) return;
      if (cell.evaluation.vitality < 0.18) return; // only lively creatures join the tree
      if (!pick || cell.evaluation.fidelity > pick.evaluation.fidelity) pick = cell;
    });
    const chosen = pick as Cell | null;
    if (!chosen || chosen.gid === undefined) return;
    this.treeRecording = true;
    this.lastTreeAt = now;
    try {
      const id = await this.ensureIdentity();
      const ancestors = this.signedAncestors(chosen.parents ?? []);
      const parents = ancestors.length > 0 ? ancestors : this.genesisId ? [this.genesisId] : [];
      const entry = await createEntry({ genome: chosen.genome, parents, seed: null, fidelity: chosen.evaluation.fidelity, identity: id });
      this.signedByGid.set(chosen.gid, entry.id);
      this.lineage.push(entry);
      await saveEntry(entry);
      this.pruneTree();
      renderGenealogy(need(this.root, '#ag-tree'), this.lineage);
      this.setText('#ag-tree-count', String(this.lineage.length));
    } finally {
      this.treeRecording = false;
    }
  }

  /** Walk genetic parents up to the nearest already-signed ancestors (≤2 → a
   *  crossover reticulation in the tree). */
  private signedAncestors(parentGids: number[]): string[] {
    const out: string[] = [];
    for (const start of parentGids) {
      let g = start;
      for (let hops = 0; g && hops < 64; hops++) {
        const id = this.signedByGid.get(g);
        if (id) {
          if (!out.includes(id)) out.push(id);
          break;
        }
        g = this.garden.phyloParents(g)[0] ?? 0;
      }
      if (out.length >= 2) break;
    }
    return out;
  }

  /** Keep Genesis + the most recent ~200 nodes (drop oldest, prune their gid map). */
  private pruneTree(): void {
    const CAP = 200;
    if (this.lineage.length <= CAP) return;
    const drop = this.lineage.splice(1, this.lineage.length - CAP);
    const live = new Set(this.lineage.map((e) => e.id));
    for (const e of drop) for (const [gid, id] of this.signedByGid) if (id === e.id && !live.has(id)) this.signedByGid.delete(gid);
  }

  // --- Lineage --------------------------------------------------------------

  private async keep(): Promise<void> {
    if (!this.focused) return;
    const id = await this.ensureIdentity();
    const parent = this.lineage.length > 0 ? [this.lineage[this.lineage.length - 1]!.id] : [];
    const entry = await createEntry({
      genome: this.focused.genome,
      parents: parent,
      seed: null,
      fidelity: this.focused.evaluation.fidelity,
      identity: id,
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
