// Optional end-to-end smoke over a REAL TCP WebSocket against a running server
// (`npm run dev` in another terminal, or any deployed coordinator URL). This is
// the most production-like local check: two browsers' worth of sockets sharing
// one world. Not part of CI (it needs a live server); the parent can run it to
// sanity-check a `wrangler dev` instance before/after deploying.
//
//   Terminal 1:  npm run dev
//   Terminal 2:  npm run ws-smoke           # defaults to ws://127.0.0.1:8787
//                COORDINATOR_URL=wss://autograph-coordinator.<sub>.workers.dev npm run ws-smoke

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.COORDINATOR_URL ?? 'ws://127.0.0.1:8787').replace(/\/$/, '').replace(/^http/, 'ws');
const room = `ws-smoke-${Math.random().toString(36).slice(2)}`;
const url = `${base}/parties/archive-room/${room}`;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '..', 'test', 'fixtures', 'genuine-elites.json'), 'utf8')) as {
  elites: { lineage: { id: string; signature: string }; genome: { conns: { weight: number }[] } }[];
};
const genuine = fixture.elites;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type Msg = { type: string; [k: string]: unknown };

class Client {
  private readonly ws: WebSocket;
  private readonly queue: Msg[] = [];
  private readonly waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  static connect(): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const fail = setTimeout(() => reject(new Error(`could not connect to ${url}`)), 5000);
      ws.addEventListener('open', () => {
        clearTimeout(fail);
        resolve(new Client(ws));
      });
      ws.addEventListener('error', () => reject(new Error(`socket error connecting to ${url}`)));
    });
  }

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data)) as Msg;
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
  waitFor(pred: (m: Msg) => boolean, timeoutMs = 5000): Promise<Msg> {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }
  waitType(type: string): Promise<Msg> {
    return this.waitFor((m) => m.type === type);
  }
  close(): void {
    this.ws.close();
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  console.log(`ws-smoke → ${url}\n`);

  const a = await Client.connect();
  assert((await a.waitType('welcome')).peers === 1, 'A welcome peers should be 1');
  console.log('  ✓ client A connected (peers = 1)');

  const b = await Client.connect();
  assert((await b.waitType('welcome')).peers === 2, 'B welcome peers should be 2');
  assert((await a.waitFor((m) => m.type === 'peers' && m.peers === 2)).peers === 2, 'A should learn peers = 2');
  console.log('  ✓ client B connected (peers = 2 for both)');

  a.send({ type: 'push', elites: [genuine[1]] }); // genuine[1] is lively (genuine[0] = trivial Genesis)
  const ack = await a.waitType('ack');
  assert(ack.accepted === 1 && ack.rejected === 0, 'push should be accepted');
  console.log('  ✓ A pushed a genuine elite (accepted = 1)');

  const delta = await b.waitType('delta');
  assert((delta.elites as Msg[]).length === 1, 'B should receive the elite as a delta');
  console.log('  ✓ B received the elite live (delta migration)');

  b.send({ type: 'pull' });
  const pulled = await b.waitType('elites');
  const ids = (pulled.elites as { lineage: { id: string } }[]).map((e) => e.lineage.id);
  assert(ids.includes(genuine[1]!.lineage.id), 'pull should return the pushed elite');
  console.log('  ✓ B pulled the shared archive (elite present)');

  const forged = clone(genuine[2]!);
  forged.genome.conns[0]!.weight += 0.5;
  a.send({ type: 'push', elites: [forged] });
  const ack2 = await a.waitType('ack');
  assert(ack2.accepted === 0 && ack2.rejected === 1, 'forged elite must be rejected');
  console.log('  ✓ forged elite rejected (accepted = 0, rejected = 1)');

  a.close();
  b.close();
  console.log('\nPASS — real-socket end-to-end green');
}

main().catch((err) => {
  console.error(`\nFAIL — ${(err as Error).message}`);
  process.exit(1);
});
