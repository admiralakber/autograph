// v7 HONEST AUDIT + NaN-fix verification.
//   (1) Floor: blank/random → finite ~0.
//   (2) NaN sweep: after the fix, NO creature anywhere produces a NaN skill or NaN write
//       (the bounded recurrent state can't diverge to Infinity → NaN).
//   (3) Bootstrap: skill climbs, length-discovery evolves (selfLen → G).
//   (4) Ablation: is plasticity / neuromodulation / attention LOAD-BEARING? Turn each off
//       on the best creature that uses it and report the change in honest r2self.
// Run: node --experimental-strip-types scripts/v7audit.ts [gens]
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome, paramCount } from '../src/engine/cppn.ts';
import { buildPhenotype, selfWrite } from '../src/engine/substrate.ts';
import { writeSkill, selfConsistencySkill, dnaTargetUnits } from '../src/engine/readback.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';
import type { Phenotype } from '../src/engine/substrate.ts';
import type { Genome } from '../src/engine/cppn.ts';

/** Raw (UNGUARDED) honest r2self — keeps NaN visible so the sweep can detect it. */
function rawR2self(g: Genome, p: Phenotype, noDeviation = false): { r2: number; selfLen: number; ponder: number; anyNaN: boolean } {
  const G = paramCount(g);
  const target = dnaTargetUnits(g);
  let mean = 0; for (let i = 0; i < G; i++) mean += target[i]!; mean /= Math.max(1, G);
  let varr = 0; for (let i = 0; i < G; i++) { const d = target[i]! - mean; varr += d * d; } varr /= Math.max(1, G);
  const w = selfWrite(p, G, noDeviation);
  let anyNaN = false;
  for (let i = 0; i < w.values.length; i++) if (!Number.isFinite(w.values[i]!)) anyNaN = true;
  if (varr < 1e-9) return { r2: 0, selfLen: w.selfLen, ponder: w.ponder, anyNaN };
  let mse = 0;
  for (let i = 0; i < G; i++) { const pred = i < w.selfLen ? w.values[i]! : mean; const d = pred - target[i]!; mse += d * d; }
  return { r2: 1 - mse / G / varr, selfLen: w.selfLen, ponder: w.ponder, anyNaN };
}

function main(): void {
  // (1) FLOOR
  const flat = seededGenome('honesty');
  for (const c of flat.conns) c.weight = 0; for (const n of flat.nodes) n.bias = 0;
  const flatSkill = selfConsistencySkill(flat, buildPhenotype(flat));
  let randSkill = 0; const N = 80;
  for (let i = 0; i < N; i++) { const g = seededGenome(`rand-${i}`); randSkill += selfConsistencySkill(g, buildPhenotype(g)); }
  randSkill /= N;
  console.log(`FLOOR: blank ${flatSkill.toFixed(3)} · random-mean ${randSkill.toFixed(3)} · both finite ${Number.isFinite(flatSkill) && Number.isFinite(randSkill)} ⇒ ${flatSkill < 0.05 && randSkill < 0.1 ? 'OK ✓' : 'FAIL ✗'}`);

  // (2)+(3) EVOLVE
  const gens = Number(process.argv[2] ?? 800);
  const garden = new Garden(GENESIS_SEED, 14, 14);
  garden.setNovelty(true);
  garden.seedWith([seededGenome(GENESIS_SEED)]);
  const t0 = performance.now();
  for (let gen = 1; gen <= gens; gen++) garden.step(30);
  const ms = performance.now() - t0;

  // NaN SWEEP across the whole archive
  let cells = 0, nanSkill = 0, nanWrite = 0, maxSkill = 0;
  let plasticBest: { g: Genome; p: Phenotype; r2: number } | null = null;
  let neuroBest: { g: Genome; p: Phenotype; r2: number } | null = null;
  let attnBest: { g: Genome; p: Phenotype; r2: number } | null = null;
  garden.archive.forEach((c) => {
    if (!c) return;
    cells++;
    const p = buildPhenotype(c.genome);
    const sk = selfConsistencySkill(c.genome, p);
    if (!Number.isFinite(sk)) nanSkill++;
    maxSkill = Math.max(maxSkill, sk);
    const raw = rawR2self(c.genome, p);
    if (raw.anyNaN) nanWrite++;
    if (p.hasPlastic && (!plasticBest || raw.r2 > plasticBest.r2)) plasticBest = { g: c.genome, p, r2: raw.r2 };
    if (p.hasNeuromod && (!neuroBest || raw.r2 > neuroBest.r2)) neuroBest = { g: c.genome, p, r2: raw.r2 };
    if (p.hasAttention && (!attnBest || raw.r2 > attnBest.r2)) attnBest = { g: c.genome, p, r2: raw.r2 };
  });
  console.log(`\n${gens} gens in ${ms.toFixed(0)}ms (${((gens * 30 * 1000) / ms).toFixed(0)} evals/s)`);
  console.log(`NaN SWEEP: ${cells} cells · NaN skills ${nanSkill} · NaN writes ${nanWrite} ⇒ ${nanSkill === 0 && nanWrite === 0 ? 'NO NaN ANYWHERE ✓' : 'FAIL ✗'}`);

  // (3) champion breakdown
  const champ = garden.archive.bestLively() ?? garden.archive.best();
  if (champ) {
    const g = champ.cell.genome; const p = buildPhenotype(g); const w = writeSkill(g, p);
    console.log(`CHAMPION: skill ${(w.skill * 100).toFixed(1)}% · r2self ${w.r2self.toFixed(3)} · r2teach ${w.r2teacher.toFixed(3)} · GLIMPSED ×${w.selfLen <= 0 ? '?' : ''}${rawR2self(g, p).ponder} · WROTE ${w.selfLen}/${w.geneCount} (Λ ${w.lenSim.toFixed(2)}) · plastic ${p.hasPlastic} neuromod ${p.hasNeuromod} attention ${p.hasAttention}`);
  }

  // (4) ABLATION — is each faculty load-bearing? Turn it off on the best creature that uses it.
  const abl = (label: string, best: { g: Genome; p: Phenotype; r2: number } | null, off: Partial<Phenotype>, noDev = false): void => {
    if (!best) { console.log(`ABLATION ${label}: no archive creature evolved it (⇒ not load-bearing for the current population)`); return; }
    const full = rawR2self(best.g, best.p).r2;
    const ablated = rawR2self(best.g, { ...best.p, ...off }, noDev).r2;
    const drop = full - ablated;
    console.log(`ABLATION ${label}: r2self ${full.toFixed(3)} → ${ablated.toFixed(3)} (Δ ${drop >= 0 ? '+' : ''}${drop.toFixed(3)}) ⇒ ${Math.abs(drop) > 0.02 ? 'LOAD-BEARING ✓' : 'negligible'}`);
  };
  abl('plasticity', plasticBest, { hasPlastic: false, hasNeuromod: false });
  abl('neuromodulation', neuroBest, { hasNeuromod: false });
  abl('attention', attnBest, {}, true); // noDeviation = pure scan, no chosen gaze
}

main();
