import type { Genome } from './cppn.ts';
import { randomGenome, compatibility } from './cppn.ts';
import { evaluate, behaviourSignature, eliteQuality } from './fitness.ts';
import { buildPhenotype } from './substrate.ts';
import type { Rng } from './prng.ts';
import { makeRng, cyrb128 } from './prng.ts';
import { MapElites } from './mapelites.ts';
import type { Archive, Cell } from './archive.ts';
import { mutate, crossover, Innovations, DEFAULT_OPTIONS } from './mutate.ts';
import type { MutateOptions } from './mutate.ts';
import { HYPER } from './hyperparams.ts';

export interface GardenStats {
  generation: number;
  evaluations: number;
  coverage: number;
  filled: number;
  cells: number;
  bestFidelity: number;
  /** Number of NEAT species in the current population (protects new structure). */
  species: number;
  /** Largest CPPN seen (nodes / connections) — complexification, made visible. */
  maxNodes: number;
  maxConns: number;
  /** QD-score: Σ fidelity over filled cells — rises even after best-fidelity plateaus. */
  qdScore: number;
  /** Distinct behavioural niches ever discovered (Novelty Search archive) — the
   *  open-endedness metric: it keeps climbing long after fidelity flatlines. */
  novelty: number;
}

/** The crowd-of-one Garden: a real MAP-Elites loop over CPPNs evolved with NEAT
 *  augmenting topologies + Novelty Search. Speciation (compatibility distance)
 *  protects new structure; a behavioural-novelty archive keeps the search
 *  open-ended (always finding new *kinds*), not converged-and-static.
 *  The archive is injectable — pass a SharedArchive to join the swarm. */
export class Garden {
  readonly archive: Archive;
  private readonly rng: Rng;
  private readonly innov = new Innovations();
  private generation = 0;
  private evaluations = 0;
  private species: { rep: Genome; members: number[] }[] = [];
  private readonly speciesThreshold = HYPER.speciesThreshold;
  private noveltyOn = false;
  private options: MutateOptions = { ...DEFAULT_OPTIONS };

  // ── Genealogy (lightweight, in-engine; never on the wire) ──────────────────
  private nextGid = 1;
  private readonly phylo = new Map<number, number[]>(); // gid → genetic parent gids
  private phyloLow = 1;
  private readonly phyloCap = 50000;

  // ── Novelty archive (behavioural signatures; open-endedness) ───────────────
  private readonly noveltyArchive: Float32Array[] = [];
  private readonly noveltyCap = 1500;
  private readonly noveltyThreshold = 0.05;
  private noveltyFound = 0;

  setNovelty(on: boolean): void {
    this.noveltyOn = on;
  }
  setOptions(o: Partial<MutateOptions>): void {
    this.options = { ...this.options, ...o };
  }

  constructor(seed: string, cols = 14, rows = 14, archive?: Archive) {
    this.archive = archive ?? new MapElites(cols, rows);
    const [a, b, c, d] = cyrb128(`${seed}:garden`);
    this.rng = makeRng(a, b, c, d);
  }

  /** Genetic parent gids of a genealogy node (for the branching tree of life). */
  phyloParents(gid: number): number[] {
    return this.phylo.get(gid) ?? [];
  }

  /** Inoculate the archive with founder creatures (minimal NEAT genomes). */
  seedWith(founders: Genome[]): void {
    for (const g of founders) this.install(g, []);
    for (let i = 0; i < HYPER.founders; i++) this.install(randomGenome(this.rng), []);
  }

  /** Evaluate + insert a creature with a fresh genealogy id; record novelty. */
  private install(g: Genome, parents: number[]): boolean {
    const pheno = buildPhenotype(g);
    const ev = evaluate(g, pheno);
    const gid = this.nextGid++;
    this.phylo.set(gid, parents);
    if (this.phylo.size > this.phyloCap) this.phylo.delete(this.phyloLow++);
    this.considerNovelty(behaviourSignature(pheno));
    this.evaluations++;
    return this.archive.tryInsert(g, ev, this.generation, gid, parents);
  }

  /** Count a behaviour as novel if it's far from everything seen (Novelty
   *  Search). `noveltyFound` is monotonic — the open-endedness signal. */
  private considerNovelty(sig: Float32Array): void {
    let minD = Infinity;
    for (const s of this.noveltyArchive) {
      let d = 0;
      for (let i = 0; i < sig.length; i++) {
        const e = sig[i]! - s[i]!;
        d += e * e;
      }
      d = Math.sqrt(d / sig.length);
      if (d < minD) {
        minD = d;
        if (minD < this.noveltyThreshold) break;
      }
    }
    if (this.noveltyArchive.length === 0 || minD > this.noveltyThreshold) {
      this.noveltyFound++;
      if (this.noveltyArchive.length < this.noveltyCap) this.noveltyArchive.push(sig);
      else this.noveltyArchive[this.rng.int(this.noveltyCap)] = sig; // keep a moving reference set
    }
  }

  /** Produce and evaluate `budget` offspring; install the improvements. */
  step(budget: number): void {
    for (let i = 0; i < budget; i++) {
      const parentA = this.selectParent();
      if (!parentA) {
        this.install(randomGenome(this.rng), []);
        continue;
      }
      const paGid = parentA.gid ?? 0;
      if (this.rng.next() < HYPER.crossoverRate) {
        const parentB = this.selectParent();
        if (parentB) {
          // Proper NEAT: pass the FITTER parent first so its disjoint/excess genes
          // are the inherited ones (crossover() takes them from `a`).
          const qa = eliteQuality(parentA.evaluation.fidelity, parentA.evaluation.vitality);
          const qb = eliteQuality(parentB.evaluation.fidelity, parentB.evaluation.vitality);
          const [hi, lo] = qa >= qb ? [parentA, parentB] : [parentB, parentA];
          const child = mutate(crossover(hi.genome, lo.genome, this.rng), this.rng, this.innov, this.options);
          this.install(child, [hi.gid ?? 0, lo.gid ?? 0]); // BOTH crossover parents → a branch
        } else {
          this.install(mutate(parentA.genome, this.rng, this.innov, this.options), [paGid]);
        }
      } else {
        this.install(mutate(parentA.genome, this.rng, this.innov, this.options), [paGid]);
      }
    }
    this.generation++;
    if (this.generation % HYPER.respeciateEvery === 0) this.respeciate();
  }

  /** Parent selection — Novelty-dominant when on: mostly pick from the frontier
   *  of behaviour space (push into the unexplored), else a species (protect new
   *  structure), else a random elite. */
  private selectParent(): Cell | null {
    if (this.noveltyOn && this.rng.next() < HYPER.noveltyBias) {
      const f = this.frontierElite();
      if (f) return f;
    }
    if (this.species.length > 0 && this.rng.next() < 0.5) {
      const sp = this.species[this.rng.int(this.species.length)]!;
      for (let t = 0; t < 4 && sp.members.length > 0; t++) {
        const idx = sp.members[this.rng.int(sp.members.length)]!;
        const cell = this.archive.get(idx);
        if (cell) return cell;
      }
    }
    return this.archive.randomElite(() => this.rng.next());
  }

  /** Frontier of behaviour space: an elite bordering empty cells, weighted by how
   *  much empty space abuts it — rewards being different, expands coverage. */
  private frontierElite(): Cell | null {
    const cols = this.archive.cols;
    const rows = this.archive.rows;
    const cands: { cell: Cell; w: number }[] = [];
    let total = 0;
    this.archive.forEach((cell, idx) => {
      if (!cell) return;
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      let empty = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !this.archive.get(ny * cols + nx)) empty++;
        }
      }
      if (empty > 0) {
        cands.push({ cell, w: empty });
        total += empty;
      }
    });
    if (cands.length === 0) return null;
    let r = this.rng.next() * total;
    for (const c of cands) {
      r -= c.w;
      if (r <= 0) return c.cell;
    }
    return cands[cands.length - 1]!.cell;
  }

  private respeciate(): void {
    const sp: { rep: Genome; members: number[] }[] = [];
    this.archive.forEach((cell, idx) => {
      if (!cell) return;
      let placed = false;
      for (const s of sp) {
        if (compatibility(s.rep, cell.genome) < this.speciesThreshold) {
          s.members.push(idx);
          placed = true;
          break;
        }
      }
      if (!placed) sp.push({ rep: cell.genome, members: [idx] });
    });
    this.species = sp;
  }

  stats(): GardenStats {
    const best = this.archive.best();
    let maxNodes = 0;
    let maxConns = 0;
    let qdScore = 0;
    this.archive.forEach((cell) => {
      if (!cell) return;
      qdScore += cell.evaluation.fidelity;
      if (cell.genome.nodes.length > maxNodes) maxNodes = cell.genome.nodes.length;
      let live = 0;
      for (const c of cell.genome.conns) if (c.enabled) live++;
      if (live > maxConns) maxConns = live;
    });
    return {
      generation: this.generation,
      evaluations: this.evaluations,
      coverage: this.archive.coverage(),
      filled: this.archive.count(),
      cells: this.archive.cols * this.archive.rows,
      bestFidelity: best ? best.cell.evaluation.fidelity : 0,
      species: this.species.length,
      maxNodes,
      maxConns,
      qdScore,
      novelty: this.noveltyFound,
    };
  }
}
