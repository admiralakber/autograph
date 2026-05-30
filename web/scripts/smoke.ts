// Headless sanity check for the (ES-)HyperNEAT engine (run with Node type
// stripping). Verifies: Genesis determinism, that the self-encoding loop
// genuinely climbs, MAP-Elites coverage fills, phenotypes have structure, and
// lineage verification rejects tampering. NOT part of the build.
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome } from '../src/engine/cppn.ts';
import { evaluate, iterateLoop } from '../src/engine/fitness.ts';
import { buildPhenotype } from '../src/engine/substrate.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile } from '../src/engine/lineage.ts';

function determinismCheck(): void {
  const a = seededGenome(GENESIS_SEED);
  const b = seededGenome(GENESIS_SEED);
  let same = a.weights.length === b.weights.length;
  for (let i = 0; i < a.weights.length; i++) if (a.weights[i] !== b.weights[i]) same = false;
  console.log(`GENESIS determinism (same seed -> same DNA): ${same ? 'OK' : 'FAIL'}`);
  const p = buildPhenotype(a);
  console.log(`genesis phenotype: ${p.liveConns} expressed connections, ${p.hidden.length / 3} hidden neurons`);
}

function baseline(): void {
  let sum = 0;
  const n = 120;
  for (let i = 0; i < n; i++) sum += evaluate(seededGenome(`r${i}`)).fidelity;
  console.log(`random-creature mean loop fidelity: ${(sum / n).toFixed(3)}`);
}

function evolve(): void {
  const garden = new Garden(GENESIS_SEED, 12, 12);
  garden.seedWith([seededGenome(GENESIS_SEED)]);
  const t0 = performance.now();
  for (let gen = 0; gen < 500; gen++) {
    garden.step(40);
    if (gen % 125 === 124) {
      const s = garden.stats();
      console.log(
        `gen ${String(s.generation).padStart(3)} | coverage ${(s.coverage * 100).toFixed(0)}% ` +
          `(${s.filled}/${s.cells}) | best loop fidelity ${(s.bestFidelity * 100).toFixed(1)}% | evals ${s.evaluations}`,
      );
    }
  }
  console.log(`\n500 generations in ${(performance.now() - t0).toFixed(0)}ms`);
  const lively = garden.archive.bestLively() ?? garden.archive.best();
  if (lively) {
    const e = evaluate(lively.cell.genome);
    console.log(
      `best LIVELY creature (showcase): loop fidelity ${(e.fidelity * 100).toFixed(1)}% | ` +
        `bd [c ${e.bd[0].toFixed(2)}, s ${e.bd[1].toFixed(2)}] | vit ${e.vitality.toFixed(2)} | conns ${e.liveConns}`,
    );
    const show = (a: number[]): string => a.filter((_, i) => i % 3 === 0).map((x) => x.toFixed(3)).join(' ');
    const tEvo = iterateLoop(lively.cell.genome, 24, 0.55);
    console.log(`  FIXED-POINT iteration (evolved): drift ${show(tEvo.drift)} → residual ${tEvo.residual.toFixed(3)} ${tEvo.converged ? '✓ CONVERGED' : '(partial)'}`);
    console.log(`                                   fidelity ${show(tEvo.fidelity)}`);
    const tRnd = iterateLoop(seededGenome('random-control-9'), 24, 0.55);
    console.log(`  FIXED-POINT iteration (random):  residual ${tRnd.residual.toFixed(3)} ${tRnd.converged ? '✓ converged' : '(partial)'}`);
  }
}

async function lineageCheck(): Promise<void> {
  const identity = await generateIdentity();
  const founder = await createEntry({ genome: seededGenome(GENESIS_SEED), parents: [], seed: GENESIS_SEED, fidelity: 0.5, identity });
  const child = await createEntry({ genome: seededGenome('escher'), parents: [founder.id], seed: null, fidelity: 0.6, identity });
  const file = makeLineageFile([founder, child]);
  const good = await verifyLineage(file);
  console.log(`lineage verify (untampered): ${good.valid ? 'OK' : 'FAIL'} (checked ${good.checked})`);
  const tampered = makeLineageFile([founder, { ...child, genomeHash: '00'.repeat(32) }]);
  const bad = await verifyLineage(tampered);
  console.log(`lineage verify (tampered): ${!bad.valid ? 'OK — rejected' : 'FAIL — accepted forgery'}`);
  const forged = makeLineageFile([{ ...founder, signature: founder.signature.replace(/^../, 'ff') }]);
  const bad2 = await verifyLineage(forged);
  console.log(`lineage verify (forged signature): ${!bad2.valid ? 'OK — rejected' : 'FAIL — accepted forgery'}`);
}

async function main(): Promise<void> {
  determinismCheck();
  baseline();
  evolve();
  await lineageCheck();
}

void main();
