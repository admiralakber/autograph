import type { Genome } from './cppn.ts';
import { randomGenome, compatibility } from './cppn.ts';
import { evaluate } from './fitness.ts';
import type { Rng } from './prng.ts';
import { makeRng, cyrb128 } from './prng.ts';
import { MapElites } from './mapelites.ts';
import type { Cell } from './archive.ts';
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
}

/** The crowd-of-one Garden: a real MAP-Elites loop over CPPNs evolved with NEAT
 *  augmenting topologies. Speciation (compatibility distance) gives novel
 *  structure a protected share of reproduction.
 *  (The multi-machine swarm is the roadmap — this runs entirely on your device.) */
export class Garden {
  readonly archive: MapElites;
  private readonly rng: Rng;
  private readonly innov = new Innovations();
  private generation = 0;
  private evaluations = 0;
  private species: { rep: Genome; members: number[] }[] = [];
  private readonly speciesThreshold = HYPER.speciesThreshold;
  private noveltyOn = false;
  private options: MutateOptions = { ...DEFAULT_OPTIONS };

  /** Toggle behavioural Novelty Search (Lehman & Stanley): bias reproduction
   *  toward the frontier of behaviour space rather than toward fidelity. */
  setNovelty(on: boolean): void {
    this.noveltyOn = on;
  }

  /** Set neataptic-style structural options (recurrent / self / gating). */
  setOptions(o: Partial<MutateOptions>): void {
    this.options = { ...this.options, ...o };
  }

  constructor(seed: string, cols = 14, rows = 14) {
    this.archive = new MapElites(cols, rows);
    const [a, b, c, d] = cyrb128(`${seed}:garden`);
    this.rng = makeRng(a, b, c, d);
  }

  /** Inoculate the archive with some founder creatures (minimal NEAT genomes). */
  seedWith(founders: Genome[]): void {
    for (const g of founders) {
      this.archive.tryInsert(g, evaluate(g), this.generation);
      this.evaluations++;
    }
    for (let i = 0; i < HYPER.founders; i++) {
      const g = randomGenome(this.rng);
      this.archive.tryInsert(g, evaluate(g), this.generation);
      this.evaluations++;
    }
  }

  /** Produce and evaluate `budget` offspring; install the improvements. */
  step(budget: number): void {
    for (let i = 0; i < budget; i++) {
      const parentA = this.selectParent();
      let child: Genome;
      if (!parentA) {
        child = randomGenome(this.rng);
      } else if (this.rng.next() < HYPER.crossoverRate) {
        const parentB = this.selectParent();
        child = parentB
          ? mutate(crossover(parentA.genome, parentB.genome, this.rng), this.rng, this.innov, this.options)
          : mutate(parentA.genome, this.rng, this.innov, this.options);
      } else {
        child = mutate(parentA.genome, this.rng, this.innov, this.options);
      }
      this.archive.tryInsert(child, evaluate(child), this.generation);
      this.evaluations++;
    }
    this.generation++;
    if (this.generation % HYPER.respeciateEvery === 0) this.respeciate();
  }

  /** Parent selection: half the time pick a random *species* then one of its
   *  members (so a small, novel-structure species gets an equal share to a big
   *  one — protecting innovation), else a random elite (diversity pressure). */
  private selectParent(): Cell | null {
    if (this.noveltyOn && this.rng.next() < 0.6) {
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

  /** Novelty Search proxy: pick an elite on the frontier of behaviour space —
   *  one with empty neighbouring cells — weighted by how much empty space abuts
   *  it. This rewards *being different*, expanding into unexplored behaviours. */
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

  /** Recompute species over the current elites by compatibility distance. */
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
    this.archive.forEach((cell) => {
      if (!cell) return;
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
    };
  }
}
