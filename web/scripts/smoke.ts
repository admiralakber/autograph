// Headless sanity check for the evolution engine (run with Node's type
// stripping). Verifies: determinism, that loop fidelity genuinely climbs, and
// that MAP-Elites coverage fills. NOT part of the build.
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome } from '../src/engine/cppn.ts';
import { evaluate, loopFidelity } from '../src/engine/fitness.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile } from '../src/engine/lineage.ts';

function determinismCheck(): void {
  const a = seededGenome('drawing hands');
  const b = seededGenome('drawing hands');
  let same = true;
  for (let i = 0; i < a.weights.length; i++) if (a.weights[i] !== b.weights[i]) same = false;
  console.log(`determinism (same seed -> same creature): ${same ? 'OK' : 'FAIL'}`);
}

function baseline(): void {
  let sum = 0;
  const n = 200;
  for (let i = 0; i < n; i++) sum += loopFidelity(seededGenome(`r${i}`));
  console.log(`random-creature mean loop fidelity: ${(sum / n).toFixed(3)}`);
}

function evolve(): void {
  const garden = new Garden('drawing hands', 14, 14);
  garden.seedWith([seededGenome('drawing hands'), seededGenome('escher')]);
  const t0 = performance.now();
  for (let gen = 0; gen < 600; gen++) {
    garden.step(80);
    if (gen % 150 === 149) {
      const s = garden.stats();
      console.log(
        `gen ${String(s.generation).padStart(3)} | coverage ${(s.coverage * 100).toFixed(0)}% ` +
          `(${s.filled}/${s.cells}) | best fidelity ${(s.bestFidelity * 100).toFixed(1)}% | ` +
          `evals ${s.evaluations}`,
      );
    }
  }
  const ms = performance.now() - t0;
  const best = garden.archive.best();
  const lively = garden.archive.bestLively();
  console.log(`\n600 generations (48k evals) in ${ms.toFixed(0)}ms`);
  if (best) {
    const e = evaluate(best.cell.genome);
    console.log(
      `global best (often trivial): fidelity ${(e.fidelity * 100).toFixed(1)}% | ` +
        `bd [c ${e.bd[0].toFixed(2)}, s ${e.bd[1].toFixed(2)}] | vit ${e.vitality.toFixed(2)}`,
    );
  }
  if (lively) {
    const e = evaluate(lively.cell.genome);
    console.log(
      `best LIVELY creature (showcase): fidelity ${(e.fidelity * 100).toFixed(1)}% | ` +
        `bd [c ${e.bd[0].toFixed(2)}, s ${e.bd[1].toFixed(2)}] | vit ${e.vitality.toFixed(2)}`,
    );
  } else {
    console.log('no lively creature found above thresholds');
  }
}

async function lineageCheck(): Promise<void> {
  const identity = await generateIdentity();
  const founder = await createEntry({
    genome: seededGenome('drawing hands'),
    parents: [],
    seed: 'drawing hands',
    fidelity: 0.85,
    identity,
  });
  const child = await createEntry({
    genome: seededGenome('escher'),
    parents: [founder.id],
    seed: null,
    fidelity: 0.81,
    identity,
  });
  const file = makeLineageFile([founder, child]);

  const good = await verifyLineage(file);
  console.log(`lineage verify (untampered): ${good.valid ? 'OK' : 'FAIL'} (checked ${good.checked})`);

  // Tamper with the genome hash — the id no longer matches its content.
  const tampered = makeLineageFile([founder, { ...child, genomeHash: '00'.repeat(32) }]);
  const bad = await verifyLineage(tampered);
  console.log(`lineage verify (tampered content): ${!bad.valid ? 'OK — rejected' : 'FAIL — accepted forgery'}`);

  // Tamper with a signature — content hash still matches, signature does not.
  const forgedSig = makeLineageFile([{ ...founder, signature: founder.signature.replace(/^../, 'ff') }]);
  const bad2 = await verifyLineage(forgedSig);
  console.log(`lineage verify (forged signature): ${!bad2.valid ? 'OK — rejected' : 'FAIL — accepted forgery'}`);
}

async function main(): Promise<void> {
  determinismCheck();
  baseline();
  evolve();
  await lineageCheck();
}

void main();
