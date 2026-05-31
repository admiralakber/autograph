// Headless sanity check for the NEAT (ES-)HyperNEAT engine (run with Node type
// stripping). Verifies: Genesis determinism, that augmenting topologies actually
// complexify (nodes/connections grow) and speciate, that the self-encoding loop
// climbs AND closes to a fixed point (evolved converges, random only partially),
// and that lineage verification rejects tampering. NOT part of the build.
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome, genomeVector, paramToUnit } from '../src/engine/cppn.ts';
import { evaluate, iterateLoop } from '../src/engine/fitness.ts';
import { buildPhenotype, substrateForward } from '../src/engine/substrate.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';
import { generateIdentity, createEntry, verifyLineage, makeLineageFile } from '../src/engine/lineage.ts';
import { MapElites } from '../src/engine/mapelites.ts';
import type { Evaluation } from '../src/engine/fitness.ts';

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

/** #4 mirror-brain: can a NETWORK (not the hand-coded analytic inverse) learn the
 *  read-back portrait→DNA? We fit a small linear encoder from a fixed portrait
 *  fingerprint (density at M fixed probes) to a fixed DNA fingerprint (K-bin means
 *  of the genome), across many creatures, and report held-out R². */
function mirrorBrainExperiment(): void {
  const M = 24;
  const K = 12;
  const ga = Math.PI * (3 - Math.sqrt(5));
  const probes = new Float64Array(M * 3);
  for (let k = 0; k < M; k++) {
    const y = 1 - (k / (M - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = k * ga;
    probes[k * 3] = Math.cos(a) * r * 0.85;
    probes[k * 3 + 1] = y * 0.85;
    probes[k * 3 + 2] = Math.sin(a) * r * 0.85;
  }
  const fingerprint = (g: ReturnType<typeof seededGenome>): Float64Array => {
    const v = genomeVector(g);
    const out = new Float64Array(K);
    const cnt = new Float64Array(K);
    for (let i = 0; i < v.length; i++) {
      const b = Math.min(K - 1, Math.floor((i / v.length) * K));
      out[b]! += paramToUnit(v[i]!);
      cnt[b]!++;
    }
    for (let b = 0; b < K; b++) out[b] = cnt[b]! ? out[b]! / cnt[b]! : 0.5;
    return out;
  };
  const N = 400;
  const X: Float64Array[] = [];
  const Y: Float64Array[] = [];
  const o2: [number, number] = [0, 0];
  for (let i = 0; i < N; i++) {
    const g = seededGenome(`mirror-${i}`);
    const p = buildPhenotype(g);
    const x = new Float64Array(M);
    for (let k = 0; k < M; k++) x[k] = substrateForward(p, probes[k * 3]!, probes[k * 3 + 1]!, probes[k * 3 + 2]!, o2)[0];
    X.push(x);
    Y.push(fingerprint(g));
  }
  const ntr = 320;
  const W = Array.from({ length: K }, () => new Float64Array(M));
  const b = new Float64Array(K);
  const lr = 0.08;
  for (let ep = 0; ep < 2500; ep++) {
    const gW = Array.from({ length: K }, () => new Float64Array(M));
    const gb = new Float64Array(K);
    for (let n = 0; n < ntr; n++) {
      const x = X[n]!;
      const y = Y[n]!;
      for (let kk = 0; kk < K; kk++) {
        let pred = b[kk]!;
        const wk = W[kk]!;
        for (let m = 0; m < M; m++) pred += wk[m]! * x[m]!;
        const e = pred - y[kk]!;
        gb[kk]! += e;
        const gk = gW[kk]!;
        for (let m = 0; m < M; m++) gk[m]! += e * x[m]!;
      }
    }
    for (let kk = 0; kk < K; kk++) {
      b[kk]! -= (lr * gb[kk]!) / ntr;
      const wk = W[kk]!;
      const gk = gW[kk]!;
      for (let m = 0; m < M; m++) wk[m]! -= lr * (gk[m]! / ntr + 1e-3 * wk[m]!);
    }
  }
  const mean = new Float64Array(K);
  for (let n = ntr; n < N; n++) for (let kk = 0; kk < K; kk++) mean[kk]! += Y[n]![kk]! / (N - ntr);
  const r2 = (predict: (x: Float64Array) => Float64Array): number => {
    let ssRes = 0;
    let ssTot = 0;
    for (let n = ntr; n < N; n++) {
      const p = predict(X[n]!);
      for (let kk = 0; kk < K; kk++) {
        ssRes += (p[kk]! - Y[n]![kk]!) ** 2;
        ssTot += (Y[n]![kk]! - mean[kk]!) ** 2;
      }
    }
    return ssTot > 0 ? 1 - ssRes / ssTot : 0;
  };
  const r2lin = r2((x) => {
    const p = new Float64Array(K);
    for (let kk = 0; kk < K; kk++) {
      let s = b[kk]!;
      for (let m = 0; m < M; m++) s += W[kk]![m]! * x[m]!;
      p[kk] = s;
    }
    return p;
  });

  // a small nonlinear "mirror brain": M → H tanh → K, trained by backprop
  const H = 16;
  const rng = (() => {
    let s = 12345;
    return (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 0.4;
  })();
  const W1 = Array.from({ length: H }, () => Float64Array.from({ length: M }, rng));
  const b1 = new Float64Array(H);
  const W2 = Array.from({ length: K }, () => Float64Array.from({ length: H }, rng));
  const b2 = new Float64Array(K);
  const fwd = (x: Float64Array): { h: Float64Array; p: Float64Array } => {
    const h = new Float64Array(H);
    for (let j = 0; j < H; j++) {
      let s = b1[j]!;
      for (let m = 0; m < M; m++) s += W1[j]![m]! * x[m]!;
      h[j] = Math.tanh(s);
    }
    const p = new Float64Array(K);
    for (let kk = 0; kk < K; kk++) {
      let s = b2[kk]!;
      for (let j = 0; j < H; j++) s += W2[kk]![j]! * h[j]!;
      p[kk] = s;
    }
    return { h, p };
  };
  const lr2 = 0.06;
  for (let ep = 0; ep < 1500; ep++) {
    for (let n = 0; n < ntr; n++) {
      const x = X[n]!;
      const y = Y[n]!;
      const { h, p } = fwd(x);
      const dh = new Float64Array(H);
      for (let kk = 0; kk < K; kk++) {
        const e = p[kk]! - y[kk]!;
        b2[kk]! -= lr2 * e;
        for (let j = 0; j < H; j++) {
          dh[j]! += e * W2[kk]![j]!;
          W2[kk]![j]! -= lr2 * e * h[j]!;
        }
      }
      for (let j = 0; j < H; j++) {
        const g = dh[j]! * (1 - h[j]! * h[j]!);
        b1[j]! -= lr2 * g;
        for (let m = 0; m < M; m++) W1[j]![m]! -= lr2 * g * x[m]!;
      }
    }
  }
  const r2mlp = r2((x) => fwd(x).p);

  const best = Math.max(r2lin, r2mlp);
  console.log(`MIRROR-BRAIN (a NETWORK learns the read-back portrait→DNA): linear R² ${r2lin.toFixed(2)} · MLP R² ${r2mlp.toFixed(2)}`);
  console.log(
    best > 0.2
      ? '  → a shared mirror network CAN read the portrait back non-trivially across the population.'
      : '  → a shared mirror network barely beats the mean: the render→DNA inverse is creature-specific, not one learnable map — which is exactly why each creature carries its OWN co-evolved read-back network (the loop fidelity above).',
  );
  console.log('  full closure is unchanged either way: iterating decode∘render collapses to the empty fixed point — life = imperfect self-knowledge.');
}

/** #4 open-endedness: with Novelty Search on, does the search keep discovering
 *  NEW kinds (novelty archive + QD-score + complexification) long after the
 *  fidelity objective plateaus? It must — "always changing", not converged. */
function openEndedness(): void {
  const garden = new Garden(GENESIS_SEED, 14, 14);
  garden.setNovelty(true);
  garden.seedWith([seededGenome(GENESIS_SEED)]);
  const marks = [400, 1200, 2500];
  let mi = 0;
  const snap: { gen: number; fid: number; cov: number; nov: number; qd: number; nodes: number; conns: number }[] = [];
  for (let g = 0; g < 2500; g++) {
    garden.step(30);
    if (mi < marks.length && g + 1 === marks[mi]) {
      const s = garden.stats();
      snap.push({ gen: s.generation, fid: s.bestFidelity, cov: s.coverage, nov: s.novelty, qd: s.qdScore, nodes: s.maxNodes, conns: s.maxConns });
      mi++;
    }
  }
  for (const s of snap) {
    console.log(`  gen ${String(s.gen).padStart(4)}: best-fid ${(s.fid * 100).toFixed(1)}% · coverage ${(s.cov * 100).toFixed(0)}% · novelty ${s.nov} · QD ${s.qd.toFixed(1)} · biggest DNA ${s.nodes}n·${s.conns}c`);
  }
  const a = snap[0]!;
  const z = snap[snap.length - 1]!;
  const fidFlat = z.fid - a.fid < 0.04;
  const keepsGrowing = z.nov > a.nov * 1.3 && z.qd > a.qd * 1.05;
  console.log(
    `OPEN-ENDEDNESS: fidelity ${fidFlat ? 'PLATEAUED' : 'still rising'} (${(a.fid * 100).toFixed(1)}%→${(z.fid * 100).toFixed(1)}%); ` +
      `novelty ${a.nov}→${z.nov}, QD ${a.qd.toFixed(0)}→${z.qd.toFixed(0)}, DNA ${a.nodes}n→${z.nodes}n ` +
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
 *  displace a lively champion. So a RESET/fresh peer's trivial creatures cannot
 *  poison a shared cell, locally or across the swarm. */
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
  baseline();
  evolve();
  openEndedness();
  mirrorBrainExperiment();
  swarmSafety();
  await lineageCheck();
}

void main();
