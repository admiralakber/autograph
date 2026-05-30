// Live integration test against the DEPLOYED swarm coordinator (run with Node
// type-stripping; Node ≥ 22 has global WebSocket + Web Crypto). This is the real
// end-to-end proof, exercising the SAME client code the site ships
// (net/swarm.ts + the engine), not a mock:
//
//   1. Liveness — probe the default shared room real visitors join and print its
//      protocol + grid + coverage straight from the Worker's `welcome`.
//   2. Peers   — open TWO clients in an isolated room; peer count must reach 2.
//   3. Migration — evolve on A so it PUSHES best-per-niche elites; B must PULL
//      them (delta), and A's exact signed elites must appear in B's mirror.
//
// Not part of `npm run build` or `npm run smoke` (network-dependent); run
// manually with `npm run swarm-live`. If the coordinator is unreachable it
// reports cleanly and exits non-zero — the site itself still works offline.

import { Garden } from '../src/engine/evolution.ts';
import { MapElites } from '../src/engine/mapelites.ts';
import { SharedArchive } from '../src/net/swarm.ts';
import { seededGenome } from '../src/engine/cppn.ts';
import type { Genome } from '../src/engine/cppn.ts';
import type { Evaluation } from '../src/engine/fitness.ts';
import { GENESIS_SEED } from '../src/engine/genesis.ts';
import { HYPER } from '../src/engine/hyperparams.ts';
import { generateIdentity, createEntry, hashGenome } from '../src/engine/lineage.ts';
import type { Identity } from '../src/engine/lineage.ts';
import type { Archive } from '../src/engine/archive.ts';
import type { EliteSigner } from '../src/net/swarm.ts';

const URL = process.env.SWARM_URL ?? 'wss://autograph-coordinator.usemeos.workers.dev';
const COLS = HYPER.gridCols;
const ROWS = HYPER.gridRows;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number, every = 100): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(every);
  }
  return pred();
}

/** Same signer the dashboard uses: sign an outgoing elite with an ephemeral key. */
const signerFor = (id: Identity): EliteSigner => ({
  sign: (g: Genome, e: Evaluation) => createEntry({ genome: g, parents: [], seed: null, fidelity: e.fidelity, identity: id }),
});

/** Hash every elite genome in an archive into a set of content addresses. */
async function genomeHashes(archive: Archive): Promise<Set<string>> {
  const genomes: Genome[] = [];
  archive.forEach((cell) => {
    if (cell) genomes.push(cell.genome);
  });
  const out = new Set<string>();
  for (const g of genomes) out.add(await hashGenome(g));
  return out;
}

/** Phase 1: probe the default shared room with a raw socket and read its
 *  `welcome` — proves the deployed protocol on the room real visitors join. */
async function probeDefaultRoom(): Promise<boolean> {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket;
  if (!Ctor) {
    console.log('  no WebSocket available in this runtime');
    return false;
  }
  const url = `${URL.replace(/\/$/, '')}/parties/archive-room/archipelago`;
  return await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const sock = new Ctor(url);
    const timer = setTimeout(() => {
      console.log('  default room did not respond within 8s');
      finish(false);
    }, 8000);
    sock.addEventListener('open', () => {
      sock.send(JSON.stringify({ type: 'hello' }));
      sock.send(JSON.stringify({ type: 'pull' }));
    });
    sock.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { type: string; peers?: number; room?: Record<string, number> };
      if (msg.type === 'welcome') {
        const r = msg.room ?? {};
        console.log(`  welcome from "archipelago": peers ${msg.peers} · protocol ${r.protocol} · grid ${r.cols}×${r.rows} · filled ${r.filled} · coverage ${((r.coverage ?? 0) * 100).toFixed(1)}%`);
        clearTimeout(timer);
        finish(true);
      }
    });
    sock.addEventListener('error', () => {
      console.log('  socket error reaching the default room');
      clearTimeout(timer);
      finish(false);
    });
  });
}

async function main(): Promise<void> {
  console.log(`LIVE swarm integration test → ${URL}`);

  // ── Phase 1: default-room liveness ───────────────────────────────────────
  console.log('\n[1] Default shared room (what GENESIS visitors auto-join):');
  const live = await probeDefaultRoom();
  if (!live) {
    console.log('\nLIVE SWARM UNREACHABLE — the site still runs fully offline. Exiting 1.');
    process.exit(1);
  }

  // ── Phase 2 + 3: two clients, isolated room → peers=2 + A→B migration ─────
  const room = `live-test-${Date.now().toString(36)}`;
  console.log(`\n[2] Two clients in an isolated room "${room}" (clean A→B proof):`);
  const idA = await generateIdentity();
  const idB = await generateIdentity();
  let peersA = 0;
  let peersB = 0;
  const errors: string[] = [];

  const mirrorA = new MapElites(COLS, ROWS);
  const A = new SharedArchive({
    url: URL,
    room,
    mirror: mirrorA,
    signer: signerFor(idA),
    onPeers: (n) => (peersA = n),
    onError: (c, m) => errors.push(`A:${c} ${m}`),
  });
  const mirrorB = new MapElites(COLS, ROWS);
  const B = new SharedArchive({
    url: URL,
    room,
    mirror: mirrorB,
    signer: signerFor(idB),
    onPeers: (n) => (peersB = n),
    onError: (c, m) => errors.push(`B:${c} ${m}`),
  });

  const connected = await waitFor(() => A.connected() && B.connected() && peersA >= 2 && peersB >= 2, 10000);
  console.log(`  A.connected=${A.connected()} B.connected=${B.connected()} · peers A=${peersA} B=${peersB}`);
  if (!connected) {
    console.log(`  FAILED to reach 2 peers${errors.length ? ` (errors: ${errors.join('; ')})` : ''}`);
    A.close();
    B.close();
    process.exit(1);
  }
  console.log('  ✓ peer count reached 2');

  await sleep(800); // let each client's initial pull settle
  const b0 = B.count();

  console.log('\n[3] Migration — evolve on A (push best-per-niche) → B must receive it:');
  const gardenA = new Garden(GENESIS_SEED, COLS, ROWS, A);
  gardenA.seedWith([seededGenome(GENESIS_SEED)]);
  // Evolve in rounds with yields so the 200 ms flush fires between bursts —
  // mirrors the live site (per-frame evolution), not one giant blocking batch.
  for (let round = 0; round < 25; round++) {
    for (let i = 0; i < 20; i++) gardenA.step(30);
    await sleep(120);
  }
  const aBest = A.best();
  console.log(`  A evolved ${A.count()} elites · best fidelity ${aBest ? (aBest.cell.evaluation.fidelity * 100).toFixed(1) : '–'}%`);

  const grew = await waitFor(() => B.count() > b0, 8000);
  await sleep(600); // allow the tail of the delta batch to land
  const b1 = B.count();

  const aHashes = await genomeHashes(A);
  const bHashes = await genomeHashes(B);
  let crossed = 0;
  for (const h of aHashes) if (bHashes.has(h)) crossed++;
  let bBestFid = 0;
  mirrorB.forEach((c) => {
    if (c) bBestFid = Math.max(bBestFid, c.evaluation.fidelity);
  });

  console.log(`  B archive: ${b0} → ${b1} cells (+${b1 - b0} migrated in after A pushed)`);
  console.log(`  B best fidelity via migration: ${(bBestFid * 100).toFixed(1)}%`);
  console.log(`  A's exact signed elites now present in B: ${crossed} of ${aHashes.size}`);

  A.close();
  B.close();

  if (errors.length) console.log(`  notes: ${[...new Set(errors)].join('; ')}`);

  const ok = peersA >= 2 && peersB >= 2 && grew && b1 > b0 && crossed > 0;
  console.log(
    `\n${ok ? 'LIVE SWARM OK' : 'LIVE SWARM FAIL'} — peers reached 2 and ${crossed} signed elite(s) migrated A→B across the deployed Worker.`,
  );
  process.exit(ok ? 0 : 1);
}

void main();
