// The Cloudflare Worker entry + the `ArchiveRoom` Durable Object.
//
// This file is a THIN ADAPTER. All room logic lives in RoomCore (src/room.ts),
// which is pure and unit-tested. Here we only:
//   • bridge PartyServer's connection lifecycle to RoomCore;
//   • give RoomCore an authoritative live peer count (getConnections());
//   • persist accepted elites durably (per-cell, survives hibernation/eviction)
//     and keep a throttled KV snapshot for cheap cold reads.
//
// Sandbox note: the only bindings this Worker touches are its OWN dedicated
// Durable Object namespace (ARCHIVE_ROOM) and its OWN dedicated KV (SNAPSHOTS).
// It has no service binding, secret or handle to anything meos. See wrangler.jsonc.

import { Server, routePartykitRequest } from 'partyserver';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { ServerArchive } from './archive.ts';
import { RoomCore } from './room.ts';
import type { RoomTransport } from './room.ts';
import { verifyElite } from './verify.ts';
import type { ServerMessage, WireElite } from './protocol.ts';
import { PROTOCOL_VERSION } from './protocol.ts';

export interface Env {
  ARCHIVE_ROOM: DurableObjectNamespace<ArchiveRoom>;
  /** Optional: dedicated KV for cold-read archive snapshots. */
  SNAPSHOTS?: KVNamespace;
}

const CELL_PREFIX = 'cell:';
const KV_SNAPSHOT_THROTTLE_MS = 15_000;

const serialise = (msg: ServerMessage): string => JSON.stringify(msg);

export class ArchiveRoom extends Server<Env> {
  // Hibernate when idle; onStart() rehydrates the archive on wake.
  static override options = { hibernate: true };

  private readonly archive = new ServerArchive();
  private core: RoomCore | null = null;
  private startup: Promise<void> | null = null;
  private lastKvWrite = 0;

  /** Idempotent, race-free initialisation (deduped across concurrent handlers). */
  private boot(): Promise<void> {
    if (!this.startup) this.startup = this.init();
    return this.startup;
  }

  private async init(): Promise<void> {
    // Rehydrate from durable per-cell storage first; fall back to KV snapshot.
    const stored = await this.ctx.storage.list<WireElite>({ prefix: CELL_PREFIX });
    if (stored.size > 0) {
      this.archive.load([...stored.values()]);
    } else if (this.env.SNAPSHOTS) {
      const raw = await this.env.SNAPSHOTS.get(this.kvKey());
      if (raw) {
        try {
          this.archive.load(JSON.parse(raw) as WireElite[]);
        } catch {
          // Ignore a corrupt snapshot — durable per-cell storage is the truth.
        }
      }
    }

    const transport: RoomTransport = {
      send: (id, msg) => this.getConnection(id)?.send(serialise(msg)),
      broadcast: (msg, exclude) => this.broadcast(serialise(msg), exclude),
      peerCount: () => this.countConnections(),
    };
    this.core = new RoomCore({
      archive: this.archive,
      transport,
      verify: verifyElite,
      hooks: { onAccept: (elites) => this.persist(elites) },
    });
  }

  override onStart(): Promise<void> {
    return this.boot();
  }

  override async onConnect(connection: Connection, _ctx: ConnectionContext): Promise<void> {
    await this.boot();
    this.core!.onConnect(connection.id);
  }

  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    await this.boot();
    // The protocol is JSON text; decode any binary frame to a string for RoomCore.
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message as BufferSource);
    await this.core!.onMessage(connection.id, raw);
  }

  override async onClose(connection: Connection): Promise<void> {
    await this.boot();
    this.core!.onClose(connection.id);
    if (this.countConnections() === 0) await this.flushKv(true);
  }

  private countConnections(): number {
    let n = 0;
    for (const _conn of this.getConnections()) n++;
    return n;
  }

  /** Persist newly-accepted elites to durable per-cell storage; refresh KV. */
  private persist(accepted: WireElite[]): void {
    for (const elite of accepted) {
      const cell = this.archive.cellIndex(elite.evaluation.bd);
      // The DO output gate guarantees this commits before responses are sent.
      void this.ctx.storage.put(`${CELL_PREFIX}${cell}`, elite);
    }
    void this.flushKv(false);
  }

  private async flushKv(force: boolean): Promise<void> {
    if (!this.env.SNAPSHOTS) return;
    const now = Date.now();
    if (!force && now - this.lastKvWrite < KV_SNAPSHOT_THROTTLE_MS) return;
    this.lastKvWrite = now;
    try {
      await this.env.SNAPSHOTS.put(this.kvKey(), JSON.stringify(this.archive.snapshot(0)));
    } catch {
      // Cold-read cache only; never fail a request because KV hiccuped.
    }
  }

  private kvKey(): string {
    return `room:${this.name}`;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({ ok: true, service: 'autograph-coordinator', protocol: PROTOCOL_VERSION });
    }
    // WebSocket rooms live at /parties/archive-room/:room (kebab of ArchiveRoom).
    return (await routePartykitRequest(request, env)) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
