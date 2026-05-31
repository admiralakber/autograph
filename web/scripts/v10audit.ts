// v10 STRUCTURAL AUDIT + ablation. (1) Floor: blank → ~0. (2) NaN sweep: no creature emits a
// NaN. (3) Bootstrap: the structural self-write reconstructs its DNA graph (weights, activations,
// topology, size). (4) Ablation: are plasticity / neuromodulation / attention LOAD-BEARING for
// the structural reconstruction? Turn each off on the best creature and report the change.
// Run: node --experimental-strip-types scripts/v10audit.ts [gens]
import { Garden } from '../src/engine/evolution.ts';
import { seededGenome } from '../src/engine/cppn.ts';
import { buildPhenotype, selfWriteStructural } from '../src/engine/substrate.ts';
import { structTarget, scoreStruct } from '../src/engine/structural.ts';
import { writeSkill, selfConsistencySkill } from '../src/engine/readback.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';
import type { Phenotype } from '../src/engine/substrate.ts';
import type { Genome } from '../src/engine/cppn.ts';

/** A raw structural reconstruction score (value + structure) for the ablation, with the NaN
 *  guard removed so the sweep can see divergence. Returns a blended recon + anyNaN. */
function recon(g: Genome, p: Phenotype, noDev = false): { recon: number; weightR2: number; topo: number; actAcc: number; anyNaN: boolean } {
  const t = structTarget(g);
  const em = selfWriteStructural(p, noDev);
  let anyNaN = false;
  for (let i = 0; i < em.weight.length; i++) if (!Number.isFinite(em.weight[i]!)) anyNaN = true;
  const s = scoreStruct(t, em);
  // a single comparable number: the value + structure reconstruction (not the floored skill)
  const recon = Math.max(0, s.weightR2) * (0.34 + 0.33 * s.topo + 0.33 * s.actAcc);
  return { recon, weightR2: s.weightR2, topo: s.topo, actAcc: s.actAcc, anyNaN };
}

function main(): void {
  const flat = seededGenome('honesty');
  for (const c of flat.conns) c.weight = 0;
  for (const n of flat.nodes) n.bias = 0;
  const flatSkill = selfConsistencySkill(flat, buildPhenotype(flat));
  let randSkill = 0;
  const N = 80;
  for (let i = 0; i < N; i++) { const g = seededGenome(`rand-${i}`); randSkill += selfConsistencySkill(g, buildPhenotype(g)); }
  randSkill /= N;
  console.log(`FLOOR: blank ${flatSkill.toFixed(3)} · random-mean ${randSkill.toFixed(3)} · finite ${Number.isFinite(flatSkill) && Number.isFinite(randSkill)} ⇒ ${flatSkill < 0.05 && randSkill < 0.1 ? 'OK ✓' : 'FAIL ✗'}`);

  const gens = Number(process.argv[2] ?? 1000);
  const garden = new Garden(GENESIS_SEED, 14, 14);
  garden.setNovelty(true);
  garden.seedWith([seededGenome(GENESIS_SEED)]);
  const t0 = performance.now();
  for (let gen = 1; gen <= gens; gen++) garden.step(30);
  const ms = performance.now() - t0;

  let cells = 0, nanSkill = 0, nanWrite = 0, maxSkill = 0;
  let plasticBest: { g: Genome; p: Phenotype; recon: number } | null = null;
  let neuroBest: { g: Genome; p: Phenotype; recon: number } | null = null;
  let attnBest: { g: Genome; p: Phenotype; recon: number } | null = null;
  garden.archive.forEach((c) => {
    if (!c) return;
    cells++;
    const p = buildPhenotype(c.genome);
    const sk = selfConsistencySkill(c.genome, p);
    if (!Number.isFinite(sk)) nanSkill++;
    maxSkill = Math.max(maxSkill, sk);
    const r = recon(c.genome, p);
    if (r.anyNaN) nanWrite++;
    if (p.hasPlastic && (!plasticBest || r.recon > plasticBest.recon)) plasticBest = { g: c.genome, p, recon: r.recon };
    if (p.hasNeuromod && (!neuroBest || r.recon > neuroBest.recon)) neuroBest = { g: c.genome, p, recon: r.recon };
    if (p.hasAttention && (!attnBest || r.recon > attnBest.recon)) attnBest = { g: c.genome, p, recon: r.recon };
  });
  console.log(`\n${gens} gens in ${ms.toFixed(0)}ms (${((gens * 30 * 1000) / ms).toFixed(0)} evals/s)`);
  console.log(`NaN SWEEP: ${cells} cells · NaN skills ${nanSkill} · NaN writes ${nanWrite} ⇒ ${nanSkill === 0 && nanWrite === 0 ? 'NO NaN ANYWHERE ✓' : 'FAIL ✗'}`);

  const champ = garden.archive.bestLively() ?? garden.archive.best();
  if (champ) {
    const g = champ.cell.genome; const p = buildPhenotype(g); const w = writeSkill(g, p);
    console.log(`CHAMPION: skill ${(w.skill * 100).toFixed(1)}% · weightR2 ${w.weightR2.toFixed(3)} · actAcc ${w.actAcc.toFixed(2)} · topo ${w.topo.toFixed(2)} · wrote ${w.nodeLen}n·${w.connLen}c /${w.tgtNodes}n·${w.tgtConns}c · plastic ${p.hasPlastic} neuromod ${p.hasNeuromod} attn ${p.hasAttention}`);
  }

  const abl = (label: string, best: { g: Genome; p: Phenotype; recon: number } | null, off: Partial<Phenotype>, noDev = false): void => {
    if (!best) { console.log(`ABLATION ${label}: no archive creature evolved it`); return; }
    const full = recon(best.g, best.p).recon;
    const ablated = recon(best.g, { ...best.p, ...off }, noDev).recon;
    const drop = full - ablated;
    console.log(`ABLATION ${label}: recon ${full.toFixed(3)} → ${ablated.toFixed(3)} (Δ ${drop >= 0 ? '+' : ''}${drop.toFixed(3)}) ⇒ ${Math.abs(drop) > 0.01 ? 'LOAD-BEARING ✓' : 'negligible'}`);
  };
  abl('plasticity', plasticBest, { hasPlastic: false, hasNeuromod: false });
  abl('neuromodulation', neuroBest, { hasNeuromod: false });
  abl('attention', attnBest, {}, true);
}

main();
