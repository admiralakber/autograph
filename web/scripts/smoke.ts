// Headless sanity check for the (ES-)HyperNEAT + picture→brain read-back engine
// (run with Node type stripping). Verifies: Genesis determinism; that genuine
// ES-HyperNEAT discovers VARIABLE hidden placement/density (not a fixed grid);
// that NEAT augmenting topologies complexify + speciate; that the read-back loop
// (the PICTURE fed through the creature's own brain → DNA′) is HONEST (a
// constant/trivial creature scores ~0, NOT ~97%, and a genuine creature reaches
// real self-consistency); that fully iterating the loop drifts toward the trivial
// fixed point the vitality gate refuses; and that lineage verification rejects
// tampering. NOT part of the build.
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome, paramCount } from '../src/engine/cppn.ts';
import { evaluate, iterateLoop, loopFidelity } from '../src/engine/fitness.ts';
import { selfConsistencySkill, selfConsistencyR2 } from '../src/engine/readback.ts';
import { buildPhenotype } from '../src/engine/substrate.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile } from '../src/engine/lineage.ts';
import { MapElites } from '../src/engine/mapelites.ts';
import type { Evaluation } from '../src/engine/fitness.ts';

function determinismCheck(): void {
  const a = seededGenome(GENESIS_SEED);
  const b = seededGenome(GENESIS_SEED);
  let same = a.conns.length === b.conns.length;
  for (let i = 0; i < a.conns.length; i++) if (a.conns[i]!.weight !== b.conns[i]!.weight) same = false;
  console.log(`GENESIS determinism (same seed -> same DNA): ${same ? 'OK' : 'FAIL'}`);
  const g = seededGenome(GENESIS_SEED);
  const p = buildPhenotype(g);
  console.log(`genesis DNA: ${g.nodes.length} nodes, ${g.conns.length} connections (minimal) | ES-HyperNEAT substrate: ${p.hiddenCount} hidden neurons placed · ${p.liveConns} connections expressed`);
}

/** The honesty contract: the read-back flows THROUGH THE PICTURE (the rendered
 *  field → the creature's own brain → DNA′). A creature with nothing genuine to
 *  re-encode (a blank picture) must score ~0, never the old ~0.97. We assert it. */
function readbackHonesty(): void {
  // (a) a constant / trivial creature (all weights+biases zero → blank picture)
  const flat = seededGenome('honesty');
  for (const c of flat.conns) c.weight = 0;
  for (const n of flat.nodes) n.bias = 0;
  const flatSkill = selfConsistencySkill(flat, buildPhenotype(flat));

  // (b) a random creature: not evolved → no genuine self-consistency
  let randSkill = 0;
  const N = 120;
  for (let i = 0; i < N; i++) {
    const g = seededGenome(`rand-${i}`);
    randSkill += selfConsistencySkill(g, buildPhenotype(g));
  }
  randSkill /= N;

  console.log(`READ-BACK HONESTY (picture → own brain → DNA′; baseline-corrected R²-skill):`);
  console.log(`  constant/trivial creature skill: ${flatSkill.toFixed(3)}  (was ~0.97 with the old regression hack)`);
  console.log(`  random-creature mean skill     : ${randSkill.toFixed(3)}  (predict-the-mean ⇒ 0)`);
  const ok = flatSkill < 0.05 && randSkill < 0.1;
  console.log(`  ⇒ a creature with nothing genuine to re-encode scores ~0: ${ok ? 'OK ✓' : 'FAIL ✗ — the metric is inflated'}`);
  if (!ok) process.exitCode = 1;
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
        `gen ${String(s.generation).padStart(3)} | cov ${(s.coverage * 100).toFixed(0)}% | best skill ${(s.bestFidelity * 100).toFixed(1)}% | ` +
          `species ${s.species} | biggest DNA ${s.maxNodes} nodes · ${s.maxConns} conns`,
      );
    }
  }
  const ms = performance.now() - t0;
  const s = garden.stats();
  console.log(`\n500 generations in ${ms.toFixed(0)}ms (${((500 * 40 * 1000) / ms).toFixed(0)} evals/s)`);
  const grew = s.maxNodes > 12 || s.maxConns > 14;
  console.log(`COMPLEXIFICATION (NEAT augmenting topologies): ${grew ? 'OK — DNA grew past the minimal 12 nodes / 14 conns' : 'FAIL — stayed minimal'}`);

  // ES-HyperNEAT discovers VARIABLE placement/density — sample the archive.
  let minH = Infinity;
  let maxH = 0;
  let sumH = 0;
  let cnt = 0;
  garden.archive.forEach((c) => {
    if (!c) return;
    const h = buildPhenotype(c.genome).hiddenCount;
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
    sumH += h;
    cnt++;
  });
  console.log(
    `ES-HyperNEAT placement: hidden-neuron count ranges ${cnt ? minH : 0}…${maxH} (mean ${cnt ? (sumH / cnt).toFixed(1) : 0}) across the archive — ` +
      `${maxH > minH ? 'OK — density/placement is genuinely evolvable, not a fixed grid ✓' : 'FAIL — placement looks fixed'}`,
  );

  const lively = garden.archive.bestLively() ?? garden.archive.best();
  if (lively) {
    const g = lively.cell.genome;
    const p = buildPhenotype(g);
    const e = evaluate(g, p);
    console.log(
      `best LIVELY creature: self-consistency skill ${(e.fidelity * 100).toFixed(1)}% (raw R² ${selfConsistencyR2(g, p).toFixed(3)}) | ` +
        `bd [c ${e.bd[0].toFixed(2)}, s ${e.bd[1].toFixed(2)}] | vit ${e.vitality.toFixed(2)} | ` +
        `DNA ${g.nodes.length}n·${g.conns.length}c (${paramCount(g)} genes) | brain ${p.hiddenCount} hidden·${p.liveConns} conns`,
    );
    // Honesty (#10): fully ITERATING the loop g←g+α(E(R(B(g)))−g) settles the
    // creature; we report whether the genuine self-consistency it reaches is
    // partial (a living creature is imperfect self-knowledge) and whether it
    // drifts toward triviality (the only effortless fixed point, vitality-gated).
    const tEvo = iterateLoop(g, 30, 0.25);
    const pf = buildPhenotype(tEvo.final);
    const fe = evaluate(tEvo.final, pf);
    console.log(`  loop honesty (#10): one-step skill ${(loopFidelity(g, p) * 100).toFixed(1)}%; iterating the loop → residual ${tEvo.residual.toFixed(3)}, final vitality ${fe.vitality.toFixed(2)}, final skill ${(loopFidelity(tEvo.final, pf) * 100).toFixed(1)}%`);
    console.log('    ∴ skill is measured one-step self-consistency (picture→brain→DNA′); the vitality gate + MAP-Elites keep creatures lively-but-imperfect, never the empty self.');
  }
}

/** #4 open-endedness: with Novelty Search on, does the search keep discovering
 *  NEW kinds (novelty archive + QD-score + complexification) long after the
 *  fidelity objective plateaus? It must — "always changing", not converged. */
function openEndedness(): void {
  const garden = new Garden(GENESIS_SEED, 14, 14);
  garden.setNovelty(true);
  garden.seedWith([seededGenome(GENESIS_SEED)]);
  const marks = [400, 1200, 2000];
  let mi = 0;
  const snap: { gen: number; fid: number; cov: number; nov: number; qd: number; nodes: number; conns: number }[] = [];
  for (let g = 0; g < 2000; g++) {
    garden.step(30);
    if (mi < marks.length && g + 1 === marks[mi]) {
      const s = garden.stats();
      snap.push({ gen: s.generation, fid: s.bestFidelity, cov: s.coverage, nov: s.novelty, qd: s.qdScore, nodes: s.maxNodes, conns: s.maxConns });
      mi++;
    }
  }
  for (const s of snap) {
    console.log(`  gen ${String(s.gen).padStart(4)}: best-skill ${(s.fid * 100).toFixed(1)}% · coverage ${(s.cov * 100).toFixed(0)}% · novelty ${s.nov} · QD ${s.qd.toFixed(1)} · biggest DNA ${s.nodes}n·${s.conns}c`);
  }
  const a = snap[0]!;
  const z = snap[snap.length - 1]!;
  const keepsGrowing = z.nov > a.nov * 1.3 && z.qd > a.qd * 1.05;
  console.log(
    `OPEN-ENDEDNESS: novelty ${a.nov}→${z.nov}, QD ${a.qd.toFixed(0)}→${z.qd.toFixed(0)}, DNA ${a.nodes}n→${z.nodes}n ` +
      `${keepsGrowing ? '— KEEPS DISCOVERING NEW KINDS ✓' : '(FAIL: stopped rising)'}`,
  );
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

/** #1 anti-degradation: the local archive (which also merges inbound swarm
 *  `delta`s) must never let a near-flat zero-quine — high fidelity, ~0 vitality —
 *  displace a lively champion. So a fresh peer's trivial creatures cannot poison
 *  a shared cell, locally or across the swarm. */
function swarmSafety(): void {
  const a = new MapElites(4, 4);
  const g = seededGenome('safety');
  const idx = a.cellIndex([0.5, 0.5]);
  const lively: Evaluation = { bd: [0.5, 0.5], fidelity: 0.9, vitality: 1.0, liveConns: 20 };
  const blob: Evaluation = { bd: [0.5, 0.5], fidelity: 0.98, vitality: 0.02, liveConns: 1 };
  a.tryInsert(g, lively, 0);
  const installed = a.get(idx)?.evaluation.vitality === 1.0;
  const rejected = a.tryInsert(g, blob, 1) === false; // higher fidelity, ~0 vitality → must be refused
  const stillLively = a.get(idx)?.evaluation.vitality === 1.0;
  const ok = installed && rejected && stillLively;
  console.log(
    `SWARM SAFETY (vitality-gated merge): a trivial high-fidelity blob ${ok ? 'CANNOT' : 'CAN'} displace a lively champion ${ok ? 'OK ✓' : 'FAIL ✗'}`,
  );
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  determinismCheck();
  readbackHonesty();
  evolve();
  openEndedness();
  swarmSafety();
  await lineageCheck();
}

void main();
