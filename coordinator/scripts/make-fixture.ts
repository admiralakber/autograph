// Mint GENUINE elites with the REAL engine and freeze them as a test fixture.
//
// This is the "don't trust, verify" anchor: it imports web/src/engine (READ-ONLY
// — it never edits anything there) to produce content-addressed, ECDSA-signed
// elites exactly as a browser would, then writes them to
// test/fixtures/genuine-elites.json. The coordinator's own verifier is then
// proven against authentic client output rather than against my own assumptions.
// If the engine's genome/lineage format ever drifts, regenerating this fixture
// and re-running the tests is how the drift is caught — deliberately, not silently.
//
// Run:  npm run make-fixture     (Node type-stripping; reads the engine, no deploy)

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { seededGenome } from '../../web/src/engine/cppn.ts';
import { evaluate } from '../../web/src/engine/fitness.ts';
import { Garden } from '../../web/src/engine/evolution.ts';
import { generateIdentity, createEntry } from '../../web/src/engine/lineage.ts';
import { GENESIS_SEED } from '../../web/src/engine/genesis.ts';
import type { Genome } from '../../web/src/engine/cppn.ts';

const identity = await generateIdentity();

// The fixture pins TWO things the coordinator's verifier and merge depend on:
//   • index 0 — a genuinely DEGENERATE creature (a zeroed Genesis genome → empty
//     ES-HyperNEAT substrate → vitality 0). It still VERIFIES (real signature),
//     but the vitality gate must refuse it. This is what makes the "a fresh peer
//     cannot degrade the shared archive" test meaningful under the v3 genome.
//   • indices 1+ — genuinely LIVELY, self-consistent elites discovered by real
//     evolution (so the fixture reflects the actual engine, not raw seeds).
const degenerate: Genome = seededGenome(GENESIS_SEED);
for (const c of degenerate.conns) c.weight = 0;
for (const n of degenerate.nodes) n.bias = 0;

const elites: { genome: Genome; evaluation: ReturnType<typeof evaluate>; lineage: Awaited<ReturnType<typeof createEntry>> }[] = [];
const sign = async (genome: Genome, seed: string | null): Promise<void> => {
  const evaluation = evaluate(genome);
  const lineage = await createEntry({ genome, parents: [], seed, fidelity: evaluation.fidelity, identity });
  elites.push({ genome, evaluation, lineage });
};

await sign(degenerate, GENESIS_SEED);

// Evolve the canonical world and harvest the liveliest, most self-consistent elites.
const garden = new Garden(GENESIS_SEED, 14, 14);
garden.seedWith([seededGenome(GENESIS_SEED)]);
for (let gen = 0; gen < 500; gen++) garden.step(40);
const lively: { genome: Genome; vit: number; skill: number }[] = [];
garden.archive.forEach((cell) => {
  if (!cell) return;
  if (cell.evaluation.vitality >= 0.2) lively.push({ genome: cell.genome, vit: cell.evaluation.vitality, skill: cell.evaluation.fidelity });
});
lively.sort((a, b) => b.skill - a.skill);
for (const l of lively.slice(0, 3)) await sign(l.genome, null);

const out = {
  format: 'autograph-coordinator-fixture',
  note: 'GENUINE elites produced by web/src/engine (genesis-v9 clean architecture — CPPN_OUTPUTS=6: weight, bias, density, hue, α, modGate). Index 0 is a degenerate (vitality 0) creature for the gating test; the rest are evolved, lively, self-consistent elites. Real genomeBytes + ECDSA P-256 lineage.',
  generatedAt: new Date().toISOString(),
  author: identity.publicKeyHex,
  elites,
};

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'test', 'fixtures', 'genuine-elites.json');
writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`wrote ${elites.length} genuine elites → ${dest}`);
console.log(`author key: ${identity.publicKeyHex.slice(0, 24)}…`);
for (const e of elites) {
  console.log(`  ${e.lineage.id.slice(0, 16)}…  fidelity ${e.evaluation.fidelity.toFixed(4)}  bd [${e.evaluation.bd.map((x) => x.toFixed(3)).join(', ')}]`);
}
