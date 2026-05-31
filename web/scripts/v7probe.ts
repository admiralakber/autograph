// v7 evolvability probe — does the AUTOREGRESSIVE SELF-WRITER bootstrap?
// Tracks the two make-or-break questions over evolution:
//   (1) does skill climb off the floor (value-generation bootstraps)?
//   (2) does the emitted length selfLen evolve toward the genome length G
//       (length-discovery genuinely gets off the ground)?
// Run: node --experimental-strip-types scripts/v7probe.ts [gens]
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome, paramCount } from '../src/engine/cppn.ts';
import { buildPhenotype } from '../src/engine/substrate.ts';
import { selfConsistencySkill, writeSkill } from '../src/engine/readback.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';

function floorCheck(): void {
  const flat = seededGenome('honesty');
  for (const c of flat.conns) c.weight = 0;
  for (const n of flat.nodes) n.bias = 0;
  const flatSkill = selfConsistencySkill(flat, buildPhenotype(flat));
  let randSkill = 0;
  const N = 80;
  for (let i = 0; i < N; i++) {
    const g = seededGenome(`rand-${i}`);
    randSkill += selfConsistencySkill(g, buildPhenotype(g));
  }
  randSkill /= N;
  const ok = flatSkill < 0.05 && randSkill < 0.1;
  console.log(`FLOOR: blank ${flatSkill.toFixed(3)} · random-mean ${randSkill.toFixed(3)} ⇒ ${ok ? 'OK ✓' : 'FAIL ✗'}`);
}

function champBreakdown(garden: Garden): string {
  const lively = garden.archive.bestLively() ?? garden.archive.best();
  if (!lively) return 'no champion';
  const g = lively.cell.genome;
  const w = writeSkill(g, buildPhenotype(g));
  return `skill ${(w.skill * 100).toFixed(1)}% | r2self ${w.r2self.toFixed(2)} r2teach ${w.r2teacher.toFixed(2)} | len ${w.selfLen}/${w.geneCount} (Λ ${w.lenSim.toFixed(2)}) | anneal ${w.anneal.toFixed(2)}`;
}

function main(): void {
  floorCheck();
  const gens = Number(process.argv[2] ?? 800);
  const budget = 30;
  const garden = new Garden(GENESIS_SEED, 14, 14);
  garden.setNovelty(true);
  garden.seedWith([seededGenome(GENESIS_SEED)]);
  const t0 = performance.now();
  const marks = new Set([100, 200, 400, 600, gens].filter((m) => m <= gens));
  for (let gen = 1; gen <= gens; gen++) {
    garden.step(budget);
    if (marks.has(gen)) {
      const s = garden.stats();
      console.log(`gen ${String(gen).padStart(4)} | cov ${(s.coverage * 100).toFixed(0)}% | ${champBreakdown(garden)}`);
    }
  }
  const ms = performance.now() - t0;
  console.log(`\n${gens} gens in ${ms.toFixed(0)}ms (${((gens * budget * 1000) / ms).toFixed(0)} evals/s)`);
  // verdict on the two questions
  const s = garden.stats();
  const lively = garden.archive.bestLively() ?? garden.archive.best();
  if (lively) {
    const g = lively.cell.genome;
    const w = writeSkill(g, buildPhenotype(g));
    console.log(`VERDICT: best curriculum skill ${(s.bestFidelity * 100).toFixed(1)}% | champion honest r2self ${w.r2self.toFixed(3)} | length ${w.selfLen}/${w.geneCount}`);
    console.log(`  value-bootstrap: ${s.bestFidelity > 0.05 ? 'CLIMBS ✓' : 'STALLED ✗'} | length-discovery: ${w.lenSim > 0.5 ? `selfLen→G ✓ (Λ ${w.lenSim.toFixed(2)})` : `Λ ${w.lenSim.toFixed(2)} (weak)`}`);
  }
}

main();
