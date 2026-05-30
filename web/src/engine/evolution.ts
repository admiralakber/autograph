import type { Genome } from './cppn.ts';
import { randomGenome } from './cppn.ts';
import { evaluate } from './fitness.ts';
import type { Rng } from './prng.ts';
import { makeRng, cyrb128 } from './prng.ts';
import { MapElites } from './mapelites.ts';
import { mutate, crossover } from './mutate.ts';

export interface GardenStats {
  generation: number;
  evaluations: number;
  coverage: number;
  filled: number;
  cells: number;
  bestFidelity: number;
}

/** The crowd-of-one Garden: a real MAP-Elites loop over evolving CPPNs.
 *  (The multi-machine swarm is the roadmap — this runs entirely on your device.) */
export class Garden {
  readonly archive: MapElites;
  private readonly rng: Rng;
  private generation = 0;
  private evaluations = 0;

  constructor(seed: string, cols = 14, rows = 14) {
    this.archive = new MapElites(cols, rows);
    const [a, b, c, d] = cyrb128(`${seed}:garden`);
    this.rng = makeRng(a, b, c, d);
  }

  /** Inoculate the archive with some founder creatures. */
  seedWith(founders: Genome[]): void {
    for (const g of founders) {
      this.archive.tryInsert(g, evaluate(g), this.generation);
      this.evaluations++;
    }
    // A handful of random founders so selection always has material.
    for (let i = 0; i < 24; i++) {
      const g = randomGenome(this.rng);
      this.archive.tryInsert(g, evaluate(g), this.generation);
      this.evaluations++;
    }
  }

  /** Produce and evaluate `budget` offspring; install the improvements. */
  step(budget: number): void {
    for (let i = 0; i < budget; i++) {
      const parentA = this.archive.randomElite(() => this.rng.next());
      let child: Genome;
      if (!parentA) {
        child = randomGenome(this.rng);
      } else if (this.rng.next() < 0.15) {
        const parentB = this.archive.randomElite(() => this.rng.next());
        child = parentB ? crossover(parentA.genome, parentB.genome, this.rng) : mutate(parentA.genome, this.rng);
      } else {
        child = mutate(parentA.genome, this.rng);
      }
      this.archive.tryInsert(child, evaluate(child), this.generation);
      this.evaluations++;
    }
    this.generation++;
  }

  stats(): GardenStats {
    const best = this.archive.best();
    return {
      generation: this.generation,
      evaluations: this.evaluations,
      coverage: this.archive.coverage(),
      filled: this.archive.count(),
      cells: this.archive.cols * this.archive.rows,
      bestFidelity: best ? best.cell.evaluation.fidelity : 0,
    };
  }
}
