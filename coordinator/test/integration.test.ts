// End-to-end proof in the REAL workerd runtime (via Miniflare): the actual
// Worker + ArchiveRoom Durable Object, real WebSocket upgrades through
// routePartykitRequest, real WebCrypto verification. This covers the wiring that
// the pure smoke test cannot — that two browsers genuinely share one world.

import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/genuine-elites.json';

type Msg = { type: string; [k: string]: unknown };
const genuine = (fixture as unknown as { elites: Msg[] }).elites;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A thin test WebSocket client over the Worker's self-binding. */
class Client {
  private readonly ws: WebSocket;
  private readonly queue: Msg[] = [];
  private readonly waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  static async open(room: string): Promise<Client> {
    const res = await SELF.fetch(`http://coordinator.test/parties/archive-room/${room}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
    ws!.accept();
    return new Client(ws!);
  }

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as Msg;
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) {
        const [w] = this.waiters.splice(i, 1);
        clearTimeout(w!.timer);
        w!.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  waitFor(pred: (m: Msg) => boolean, timeoutMs = 3000): Promise<Msg> {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
      this.waiters.push({ pred, resolve, reject, timer });
    });
  }

  waitType(type: string, timeoutMs?: number): Promise<Msg> {
    return this.waitFor((m) => m.type === type, timeoutMs);
  }

  close(): void {
    this.ws.close();
  }
}

describe('autograph-coordinator (workerd)', () => {
  it('serves a health check', async () => {
    const res = await SELF.fetch('http://coordinator.test/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('autograph-coordinator');
  });

  it('two clients share one world: peer count, push → delta + pull, forgery rejected', async () => {
    const room = `world-${Math.random().toString(36).slice(2)}`;

    // Client A joins → peer count 1.
    const a = await Client.open(room);
    expect((await a.waitType('welcome')).peers).toBe(1);

    // Client B joins → both see peer count 2.
    const b = await Client.open(room);
    expect((await b.waitType('welcome')).peers).toBe(2);
    expect((await a.waitFor((m) => m.type === 'peers' && m.peers === 2)).peers).toBe(2);

    // A pushes a genuine, signed elite.
    a.send({ type: 'push', elites: [genuine[0]] });
    const ack = await a.waitType('ack');
    expect(ack.accepted).toBe(1);
    expect(ack.rejected).toBe(0);

    // B receives it live as a delta (migration), pusher excluded.
    const delta = await b.waitType('delta');
    expect((delta.elites as Msg[]).length).toBe(1);
    expect(((delta.elites as Msg[])[0]!.lineage as { id: string }).id).toBe((genuine[0]!.lineage as { id: string }).id);

    // …and an explicit pull returns it from the shared archive.
    b.send({ type: 'pull' });
    const pulled = await b.waitType('elites');
    const ids = (pulled.elites as Msg[]).map((e) => (e.lineage as { id: string }).id);
    expect(ids).toContain((genuine[0]!.lineage as { id: string }).id);

    // A pushes a tampered genome → rejected by server-side verification.
    const tampered = clone(genuine[1]!);
    (tampered.genome as { conns: { weight: number }[] }).conns[0]!.weight += 0.5;
    a.send({ type: 'push', elites: [tampered] });
    const ack2 = await a.waitType('ack');
    expect(ack2.accepted).toBe(0);
    expect(ack2.rejected).toBe(1);
    expect(ack2.reasons).toContain('genome-hash-mismatch');

    // A pushes a forged-signature elite → also rejected.
    const forged = clone(genuine[2]!);
    const sig = (forged.lineage as { signature: string }).signature;
    (forged.lineage as { signature: string }).signature = (sig.startsWith('00') ? 'ff' : '00') + sig.slice(2);
    a.send({ type: 'push', elites: [forged] });
    const ack3 = await a.waitType('ack');
    expect(ack3.accepted).toBe(0);
    expect(ack3.rejected).toBe(1);

    // B leaving drops the live peer count back to 1.
    b.close();
    expect((await a.waitFor((m) => m.type === 'peers' && m.peers === 1)).peers).toBe(1);

    a.close();
  });

  it('aggregates the collective gen/s across peers (sums; falls on leave)', async () => {
    const room = `gps-${Math.random().toString(36).slice(2)}`;
    const a = await Client.open(room);
    await a.waitType('welcome');
    const b = await Client.open(room);
    await b.waitType('welcome');

    // Each peer reports its local generations/sec; the room sums them.
    a.send({ type: 'rate', gps: 120 });
    b.send({ type: 'rate', gps: 80 });
    expect((await a.waitFor((m) => m.type === 'swarm' && m.gps === 200)).gps).toBe(200);
    expect((await b.waitFor((m) => m.type === 'swarm' && m.gps === 200)).gps).toBe(200);

    // B leaves → the collective falls to A's own 120.
    b.close();
    expect((await a.waitFor((m) => m.type === 'swarm' && m.gps === 120)).gps).toBe(120);
    a.close();
  });
});
