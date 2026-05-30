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
import { generateIdentity, createEntry } from '../../web/src/engine/lineage.ts';
import { GENESIS_SEED } from '../../web/src/engine/genesis.ts';

const seeds = [GENESIS_SEED, 'escher', 'godel', 'bach'];

const identity = await generateIdentity();

const elites = [];
for (const seed of seeds) {
  const genome = seededGenome(seed);
  const evaluation = evaluate(genome);
  const lineage = await createEntry({
    genome,
    parents: [],
    seed,
    fidelity: evaluation.fidelity,
    identity,
  });
  elites.push({ genome, evaluation, lineage });
}

const out = {
  format: 'autograph-coordinator-fixture',
  note: 'GENUINE elites produced by web/src/engine — real genomeBytes + ECDSA P-256 lineage.',
  generatedAt: new Date().toISOString(),
  author: identity.publicKeyHex,
  seeds,
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
