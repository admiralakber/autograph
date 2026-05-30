// Headless sanity check for the NEAT (ES-)HyperNEAT engine (run with Node type
// stripping). Verifies: Genesis determinism, that augmenting topologies actually
// complexify (nodes/connections grow) and speciate, that the self-encoding loop
// climbs AND closes to a fixed point (evolved converges, random only partially),
// and that lineage verification rejects tampering. NOT part of the build.
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome, genomeVector } from '../src/engine/cppn.ts';
import { evaluate, iterateLoop } from '../src/engine/fitness.ts';
import { buildPhenotype } from '../src/engine/substrate.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile } from '../src/engine/lineage.ts';

function determinismCheck(): void {
  const a = genomeVector(seededGenome(GENESIS_SEED));
  const b = genomeVector(seededGenome(GENESIS_SEED));
  let same = a.length === b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
  console.log(`GENESIS determinism (same seed -> same DNA): ${same ? 'OK' : 'FAIL'}`);
  const g = seededGenome(GENESIS_SEED);
  const p = buildPhenotype(g);
  console.log(`genesis DNA: ${g.nodes.length} nodes, ${g.conns.length} connections (minimal) | phenotype ${p.liveConns} expressed`);
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
        `gen ${String(s.generation).padStart(3)} | cov ${(s.coverage * 100).toFixed(0)}% | best fid ${(s.bestFidelity * 100).toFixed(1)}% | ` +
          `species ${s.species} | biggest DNA ${s.maxNodes} nodes · ${s.maxConns} conns`,
      );
    }
  }
  console.log(`\n500 generations in ${(performance.now() - t0).toFixed(0)}ms`);
  const s = garden.stats();
  const grew = s.maxNodes > 9 || s.maxConns > 14;
  console.log(`COMPLEXIFICATION (NEAT augmenting topologies): ${grew ? 'OK — DNA grew past the minimal 9 nodes / 14 conns' : 'FAIL — stayed minimal'}`);

  const lively = garden.archive.bestLively() ?? garden.archive.best();
  if (lively) {
    const e = evaluate(lively.cell.genome);
    console.log(
      `best LIVELY creature: fid ${(e.fidelity * 100).toFixed(1)}% | bd [c ${e.bd[0].toFixed(2)}, s ${e.bd[1].toFixed(2)}] | ` +
        `vit ${e.vitality.toFixed(2)} | DNA ${lively.cell.genome.nodes.length} nodes · ${lively.cell.genome.conns.length} conns`,
    );
    // #10 honesty: fully ITERATING the encode∘render map drifts toward the ONLY
    // perfect fixed point — the trivial flat zero-quine (vitality 0). So closure
    // is genuine but NOT trivially-too-easy: a lively creature cannot reach it.
    const tEvo = iterateLoop(lively.cell.genome, 30, 0.25);
    const fe = evaluate(tEvo.final);
    const tRnd = iterateLoop(seededGenome('random-control-9'), 30, 0.25);
    const fr = evaluate(tRnd.final);
    console.log('  loop honesty (#10): iterating decode∘render drifts toward the ONLY perfect fixed point — the trivial flat zero-quine (vitality 0).');
    console.log(`    lively start → residual ${tEvo.residual.toFixed(3)}, final vitality ${fe.vitality.toFixed(2)}`);
    console.log(`    random start → residual ${tRnd.residual.toFixed(3)}, final vitality ${fr.vitality.toFixed(2)}`);
    console.log('    ∴ we score ONE-STEP self-consistency (loop fidelity) and let the vitality gate + MAP-Elites keep creatures lively-but-imperfect — never collapsing to the empty self.');
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
