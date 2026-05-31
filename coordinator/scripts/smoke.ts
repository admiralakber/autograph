// Zero-dependency proof of the coordinator's logic — runs ANYWHERE Node runs
// (type-stripping, no install), in the spirit of web/scripts/smoke.ts. It proves
// every property the brief asks for, without a deploy and without the heavier
// workerd harness:
//
//   • signed-lineage verification ACCEPTS a genuine, engine-signed elite, and
//     REJECTS a tampered genome / forged signature / unbound fidelity / junk;
//   • keep-best-per-cell merge + content-addressed dedup + a deterministic
//     tiebreak that makes the merge order-independent (a CRDT);
//   • token-bucket rate-limiting;
//   • a TWO-CLIENT room: peer count = 2, one pushes an elite, the other pulls
//     it, and a forged elite is rejected with honest feedback.
//
// `npm test` re-proves the WebSocket/Durable-Object wiring in real workerd.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyElite, hashGenome } from '../src/verify.ts';
import { ServerArchive } from '../src/archive.ts';
import { RoomCore } from '../src/room.ts';
import type { RoomTransport } from '../src/room.ts';
import { TokenBucket } from '../src/ratelimit.ts';
import { LIMITS } from '../src/protocol.ts';
import type { Evaluation, Genome, LineageEntry, ServerMessage, WireElite } from '../src/protocol.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'test', 'fixtures', 'genuine-elites.json'), 'utf8')) as {
  elites: WireElite[];
};
const genuine = fixture.elites;

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failures++;
    console.log(`  \u2717 ${name}`);
    console.log(`      ${(err as Error).message}`);
  }
}

/** Deep clone so mutations in one test never leak into another. */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ── A fake transport: records what every connection receives ─────────────────

class Harness implements RoomTransport {
  readonly connected = new Set<string>();
  private readonly inbox = new Map<string, ServerMessage[]>();

  send(id: string, msg: ServerMessage): void {
    this.box(id).push(msg);
  }
  broadcast(msg: ServerMessage, exclude: string[] = []): void {
    for (const id of this.connected) if (!exclude.includes(id)) this.box(id).push(msg);
  }
  peerCount(): number {
    return this.connected.size;
  }

  connect(core: RoomCore, id: string): void {
    this.connected.add(id); // PartyServer accepts the socket before onConnect
    core.onConnect(id);
  }
  disconnect(core: RoomCore, id: string): void {
    this.connected.delete(id); // …and closes it before onClose
    core.onClose(id);
  }
  box(id: string): ServerMessage[] {
    let arr = this.inbox.get(id);
    if (!arr) this.inbox.set(id, (arr = []));
    return arr;
  }
  last<T extends ServerMessage['type']>(id: string, type: T): Extract<ServerMessage, { type: T }> | null {
    const arr = this.inbox.get(id) ?? [];
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i]!.type === type) return arr[i] as Extract<ServerMessage, { type: T }>;
    return null;
  }
}

// ── Synthetic elites for archive-level merge tests (no signature needed) ─────
// ServerArchive.insert reads only evaluation.bd + lineage.{genomeHash,fidelity}.

let synthN = 0;
function synth(bd: [number, number], fidelity: number, hash?: string, vitality = 0.5): WireElite {
  const genome: Genome = { nodes: [{ id: 0, kind: 0, act: 0, bias: 0 }], conns: [] };
  const evaluation: Evaluation = { bd, fidelity, vitality, liveConns: 1 };
  const genomeHash = hash ?? `hash-${synthN++}`;
  const lineage = { genomeHash, fidelity } as unknown as LineageEntry;
  return { genome, evaluation, lineage };
}

async function main(): Promise<void> {
  console.log('Autograph coordinator — smoke proof\n');

  console.log('verification (genuine engine fixture):');
  await test('genomeBytes mirrors the engine (hash matches lineage.genomeHash)', async () => {
    const h = await hashGenome(genuine[0]!.genome);
    assert.equal(h, genuine[0]!.lineage.genomeHash);
  });
  await test('accepts a genuine, signed elite', async () => {
    const v = await verifyElite(clone(genuine[0]!));
    assert.equal(v.ok, true, v.reason);
  });
  await test('rejects a tampered genome (hash binding broken)', async () => {
    const bad = clone(genuine[0]!);
    bad.genome.conns[0]!.weight += 0.001;
    const v = await verifyElite(bad);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'genome-hash-mismatch');
  });
  await test('rejects a forged signature', async () => {
    const bad = clone(genuine[0]!);
    bad.lineage = { ...bad.lineage, signature: (bad.lineage.signature.startsWith('00') ? 'ff' : '00') + bad.lineage.signature.slice(2) };
    const v = await verifyElite(bad);
    assert.equal(v.ok, false);
    assert.ok(v.reason === 'bad-signature' || v.reason === 'unverifiable-key', `got ${v.reason}`);
  });
  await test('rejects a swapped (wrong) author key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const otherAuthor = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
    const bad = clone(genuine[0]!);
    bad.lineage = { ...bad.lineage, author: otherAuthor };
    const v = await verifyElite(bad);
    assert.equal(v.ok, false); // id no longer derives → caught before signature
  });
  await test('rejects an unbound (spoofed) evaluation fidelity', async () => {
    const bad = clone(genuine[1]!);
    bad.evaluation = { ...bad.evaluation, fidelity: Math.min(1, bad.evaluation.fidelity + 0.2) };
    const v = await verifyElite(bad);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'fidelity-unbound');
  });
  await test('rejects malformed junk', async () => {
    const v = await verifyElite({ genome: { nodes: [], conns: [] } } as unknown as WireElite);
    assert.equal(v.ok, false);
  });

  console.log('\nkeep-best-per-cell merge + dedup + CRDT tiebreak:');
  await test('keeps the best per cell; worse is rejected', () => {
    const a = new ServerArchive();
    assert.equal(a.insert(synth([0.5, 0.5], 0.5, 'g1')).accepted, true);
    assert.equal(a.insert(synth([0.5, 0.5], 0.7, 'g2')).accepted, true); // improves → replaces
    assert.equal(a.insert(synth([0.5, 0.5], 0.6, 'g3')).accepted, false); // worse → rejected
    assert.equal(a.count(), 1);
    assert.equal(a.champion()!.fidelity, 0.7);
  });
  await test('content-addressed dedup (same genome hash is idempotent)', () => {
    const a = new ServerArchive();
    const e = synth([0.2, 0.2], 0.5, 'dup');
    assert.equal(a.insert(e).accepted, true);
    assert.equal(a.insert(clone(e)).accepted, false);
    assert.equal(a.insert(clone(e)).reason, 'duplicate');
  });
  await test('merge is order-independent (commutative CRDT)', () => {
    const elites = [
      synth([0.1, 0.1], 0.4, 'a'),
      synth([0.1, 0.1], 0.9, 'b'), // same cell, best
      synth([0.9, 0.9], 0.5, 'c'),
      synth([0.5, 0.1], 0.5, 'd'),
      synth([0.5, 0.1], 0.5, 'e'), // same cell + same fidelity as d → tiebreak
    ];
    const forward = new ServerArchive();
    for (const e of elites) forward.insert(clone(e));
    const reverse = new ServerArchive();
    for (const e of [...elites].reverse()) reverse.insert(clone(e));
    const key = (a: ServerArchive) =>
      a
        .snapshot(0)
        .map((e) => `${a.cellIndex(e.evaluation.bd)}:${e.lineage.genomeHash}`)
        .sort()
        .join('|');
    assert.equal(key(forward), key(reverse));
    // deterministic tiebreak: lower hash ('d' < 'e') wins the shared cell
    const tieCell = forward.cellIndex([0.5, 0.1]);
    assert.equal(forward.get(tieCell)!.hash, 'd');
  });

  console.log('\nanti-degradation (the critical RESET fix — vitality-gated quality):');
  await test('a trivial near-flat blob can never displace a lively champion', () => {
    const a = new ServerArchive();
    const cell = a.cellIndex([0.5, 0.5]);
    // A lively champion: fidelity 0.90, vitality 1.0.
    assert.equal(a.insert(synth([0.5, 0.5], 0.9, 'lively', 1.0)).accepted, true);
    // A near-flat zero-quine in the SAME cell: HIGHER fidelity, ~0 vitality → gated out.
    const blob = a.insert(synth([0.5, 0.5], 0.98, 'blob', 0.02));
    assert.equal(blob.accepted, false);
    assert.equal(blob.reason, 'degenerate');
    // Even above the gate, a dim creature's vitality-gated quality stays below the champion.
    assert.equal(a.insert(synth([0.5, 0.5], 0.98, 'dim', 0.1)).accepted, false);
    assert.equal(a.get(cell)!.hash, 'lively'); // champion untouched
    // …but a genuinely better-AND-alive creature still improves the cell (monotone up).
    assert.equal(a.insert(synth([0.5, 0.5], 0.95, 'better', 1.0)).accepted, true);
    assert.equal(a.get(cell)!.hash, 'better');
  });

  console.log('\nrate-limiting (token bucket):');
  await test('allows a burst then throttles, and refills over time', () => {
    const b = new TokenBucket(3, 1, 0);
    assert.equal(b.take(0), true);
    assert.equal(b.take(0), true);
    assert.equal(b.take(0), true);
    assert.equal(b.take(0), false); // burst spent
    assert.equal(b.take(1000), true); // +1s → +1 token
  });

  console.log('\ntwo-client room (peer count, push, pull, rejection):');
  await test('peer count reaches 2 as clients join, drops on leave', async () => {
    const h = new Harness();
    const core = new RoomCore({ archive: new ServerArchive(), transport: h, verify: verifyElite });
    h.connect(core, 'A');
    assert.equal(h.last('A', 'welcome')!.peers, 1);
    h.connect(core, 'B');
    assert.equal(h.last('B', 'welcome')!.peers, 2);
    assert.equal(h.last('A', 'peers')!.peers, 2); // A was told about B
    h.disconnect(core, 'B');
    assert.equal(h.last('A', 'peers')!.peers, 1);
  });
  await test('client A pushes a lively elite; client B receives it via delta + pull', async () => {
    const h = new Harness();
    const archive = new ServerArchive();
    const core = new RoomCore({ archive, transport: h, verify: verifyElite });
    h.connect(core, 'A');
    h.connect(core, 'B');

    // genuine[1] is a lively, self-consistent elite; genuine[0] is a degenerate
    // (zeroed → vitality 0) creature — it verifies but is gated out (below).
    await core.onMessage('A', JSON.stringify({ type: 'push', elites: [genuine[1]] }));
    const ack = h.last('A', 'ack')!;
    assert.equal(ack.accepted, 1);
    assert.equal(ack.rejected, 0);

    // B got the elite broadcast (delta excludes the pusher A)
    const delta = h.last('B', 'delta')!;
    assert.equal(delta.elites.length, 1);
    assert.equal(delta.elites[0]!.lineage.id, genuine[1]!.lineage.id);
    assert.equal(h.last('A', 'delta'), null); // sender excluded

    // and an explicit pull returns it too
    await core.onMessage('B', JSON.stringify({ type: 'pull' }));
    const pulled = h.last('B', 'elites')!;
    assert.equal(pulled.elites.some((e) => e.lineage.id === genuine[1]!.lineage.id), true);
  });
  await test('a forged elite is rejected with honest feedback; no broadcast', async () => {
    const h = new Harness();
    const core = new RoomCore({ archive: new ServerArchive(), transport: h, verify: verifyElite });
    h.connect(core, 'A');
    h.connect(core, 'B');
    const forged = clone(genuine[0]!);
    forged.genome.conns[0]!.weight += 0.5; // breaks the hash binding
    await core.onMessage('A', JSON.stringify({ type: 'push', elites: [forged] }));
    const ack = h.last('A', 'ack')!;
    assert.equal(ack.accepted, 0);
    assert.equal(ack.rejected, 1);
    assert.ok(ack.reasons.includes('genome-hash-mismatch'));
    assert.equal(h.last('B', 'delta'), null); // nothing fanned out
  });
  await test('a fresh peer cannot degrade the swarm: a degenerate creature is gated out', async () => {
    const h = new Harness();
    const archive = new ServerArchive();
    const core = new RoomCore({ archive, transport: h, verify: verifyElite });
    h.connect(core, 'A');
    h.connect(core, 'B');
    // A shares a genuine, signed, LIVELY elite.
    await core.onMessage('A', JSON.stringify({ type: 'push', elites: [genuine[1]] }));
    assert.equal(h.last('A', 'ack')!.accepted, 1);
    const champ = archive.champion()!.elite.lineage.id;
    // B (a fresh world) pushes a genuine but DEGENERATE creature — fully signed, yet
    // vitality 0. It VERIFIES, but the vitality gate rejects it, so the good shared
    // champion survives untouched and nothing fans out to the other peers.
    await core.onMessage('B', JSON.stringify({ type: 'push', elites: [genuine[0]] }));
    const ack = h.last('B', 'ack')!;
    assert.equal(ack.accepted, 0);
    assert.ok(ack.reasons.includes('degenerate'));
    assert.equal(h.last('A', 'delta'), null);
    assert.equal(archive.champion()!.elite.lineage.id, champ);
  });
  await test('over-rate messages get a rate-limited error', async () => {
    const h = new Harness();
    let clock = 0;
    const core = new RoomCore({ archive: new ServerArchive(), transport: h, verify: verifyElite, now: () => clock });
    h.connect(core, 'A');
    for (let i = 0; i < LIMITS.bucketCapacity + 5; i++) await core.onMessage('A', JSON.stringify({ type: 'pull' }));
    assert.ok(h.last('A', 'error')!.code === 'rate-limited');
  });

  console.log('\nswarm gen/s aggregation (the collective pulse):');
  await test('sums local gen/s across peers; updates on join + leave; clamps inflation', async () => {
    const h = new Harness();
    const core = new RoomCore({ archive: new ServerArchive(), transport: h, verify: verifyElite });
    h.connect(core, 'A');
    h.connect(core, 'B');
    await core.onMessage('A', JSON.stringify({ type: 'rate', gps: 100 }));
    await core.onMessage('B', JSON.stringify({ type: 'rate', gps: 250 }));
    assert.equal(h.last('A', 'swarm')!.gps, 350); // collective = 100 + 250
    assert.equal(h.last('B', 'swarm')!.gps, 350);
    h.disconnect(core, 'B'); // B leaves → total falls to A's 100
    assert.equal(h.last('A', 'swarm')!.gps, 100);
    await core.onMessage('A', JSON.stringify({ type: 'rate', gps: 1e12 })); // anti-inflation clamp
    assert.equal(h.last('A', 'swarm')!.gps, LIMITS.maxGpsPerPeer);
  });

  console.log('');
  if (failures > 0) {
    console.log(`FAIL — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('PASS — all checks green');
}

void main();
