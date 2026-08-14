import { DurableObject } from 'cloudflare:workers';
import {
  C_HELLO, C_STATE, MAX_PLAYERS, Peer, PROTOCOL_VERSION, PlayerState,
  REJECT_FULL, REJECT_VERSION, decodeHello, decodeState, encodeJoin, encodeLeave,
  encodeReject, encodeSnapshot, encodeWelcome, messageId,
} from '../game/protocol';
import type { Env } from './env';

/**
 * One Durable Object per room. `env.ROOM.getByName(code)` always routes to the same
 * instance worldwide, which is exactly what "a game room" means.
 *
 * ── Why this is a relay and not a 20 Hz authoritative simulation ──
 *
 * Durable Objects are billed for wall-clock time spent *active*, and WebSocket hibernation
 * lets an object sleep while its sockets stay open. A setInterval game loop would pin the
 * object awake for the entire life of the room and throw that away.
 *
 * So for free-roam we relay: a client reports its own state, we stamp it with the sender's
 * id and fan it out. The object wakes only to forward a frame, then sleeps. Latency is as
 * low as it can be, and an idle lobby costs nothing.
 *
 * The trade-off is honest: clients are trusted about their own position. Among friends that
 * is fine. It is NOT fine for competitive shooting, so milestone 3 (hit registration) adds
 * an authoritative tick — at which point that mode pays for the duration it uses.
 */

interface Attach {
  id: number;
  name: string;
}

/** Per-connection state that does not need to survive hibernation. */
interface Live {
  seq: number;
  msgs: number;
  windowStart: number;
}

const RATE_LIMIT_MSGS = 80;      // per second, per socket — generous vs the 20 Hz we send
const NAME_MAX = 24;
/** How often we tell the lobby we are still alive. Must be under the lobby's stale cutoff. */
const HEARTBEAT_MS = 20_000;

export class GameRoom extends DurableObject<Env> {
  private live = new WeakMap<WebSocket, Live>();
  private tick = 0;
  private mode = 'freeroam';
  private isPublic = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime without waking us up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    // The first connection settles the room's advertised mode and visibility.
    const url = new URL(request.url);
    if (this.ctx.getWebSockets().length === 0) {
      this.mode = (url.searchParams.get('mode') ?? 'freeroam').slice(0, 16);
      this.isPublic = url.searchParams.get('public') === '1';
    }

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    // acceptWebSocket (not server.accept()) is what enables hibernation.
    this.ctx.acceptWebSocket(server);

    if (this.ctx.getWebSockets().length > MAX_PLAYERS) {
      server.send(encodeReject(REJECT_FULL));
      server.close(1013, 'room full');
    } else {
      // Alarms fire even while hibernating, so the lobby heartbeat costs us no wake time
      // of our own — this is why the room list can be live with no database behind it.
      void this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
      void this.heartbeat();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw === 'string') return;                 // we only speak binary
    if (!this.allow(ws)) return;

    switch (messageId(raw)) {
      case C_HELLO: return this.onHello(ws, raw);
      case C_STATE: return this.onState(ws, raw);
      default: return;                                    // unknown frame: ignore
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const me = this.attach(ws);
    if (me) {
      const bye = encodeLeave(me.id);
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.trySend(other, bye);
      }
    }
    // getWebSockets() still includes the closing socket here, so 1 means "last one out".
    if (this.ctx.getWebSockets().length <= 1) {
      void this.ctx.storage.deleteAlarm();
      const code = this.ctx.id.name;
      if (code) void this.env.LOBBY.getByName('global').drop(code);
    } else {
      void this.heartbeat();
    }
  }

  /** Heartbeat: re-announce to the lobby and re-arm, for as long as anyone is here. */
  override async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) return;
    await this.heartbeat();
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  private async heartbeat(): Promise<void> {
    const code = this.ctx.id.name;
    if (!code) return;
    try {
      await this.env.LOBBY.getByName('global').announce({
        code,
        mode: this.mode,
        players: this.ctx.getWebSockets().length,
        max: MAX_PLAYERS,
        isPublic: this.isPublic,
      });
    } catch { /* the lobby is a convenience, never a hard dependency */ }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /* ── handlers ───────────────────────────────────────────────────────────── */

  private onHello(ws: WebSocket, raw: ArrayBuffer): void {
    if (this.attach(ws)) return;                          // already greeted
    const hello = decodeHello(raw);
    if (!hello) return;
    if (hello.version !== PROTOCOL_VERSION) {
      ws.send(encodeReject(REJECT_VERSION));
      ws.close(1002, 'protocol version');
      return;
    }

    const peers: Peer[] = [];
    const taken = new Set<number>();
    for (const other of this.ctx.getWebSockets()) {
      const a = this.attach(other);
      if (!a || other === ws) continue;
      taken.add(a.id);
      peers.push({ id: a.id, name: a.name });
    }
    if (peers.length >= MAX_PLAYERS) {
      ws.send(encodeReject(REJECT_FULL));
      ws.close(1013, 'room full');
      return;
    }

    let id = 1;
    while (taken.has(id) && id < 255) id++;
    const name = cleanName(hello.name, id);
    // Attachments survive hibernation, so identity outlives a sleeping object.
    ws.serializeAttachment({ id, name } satisfies Attach);

    ws.send(encodeWelcome(id, peers));
    const joined = encodeJoin({ id, name });
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) this.trySend(other, joined);
    }
  }

  private onState(ws: WebSocket, raw: ArrayBuffer): void {
    const me = this.attach(ws);
    if (!me) return;                                      // must say hello first
    const msg = decodeState(raw);
    if (!msg) return;

    // Drop stale/duplicate frames. uint16 wraps, so compare on the short way round.
    const l = this.liveOf(ws);
    const delta = (msg.seq - l.seq) & 0xffff;
    if (l.seq !== 0 && (delta === 0 || delta > 0x8000)) return;
    l.seq = msg.seq;

    const state: PlayerState = { ...msg.state, id: me.id };
    const frame = encodeSnapshot(++this.tick, [state]);
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) this.trySend(other, frame);
    }
  }

  /* ── plumbing ───────────────────────────────────────────────────────────── */

  private attach(ws: WebSocket): Attach | null {
    try {
      const a = ws.deserializeAttachment() as Attach | null;
      return a && typeof a.id === 'number' ? a : null;
    } catch {
      return null;
    }
  }

  private liveOf(ws: WebSocket): Live {
    let l = this.live.get(ws);
    if (!l) {
      l = { seq: 0, msgs: 0, windowStart: Date.now() };
      this.live.set(ws, l);
    }
    return l;
  }

  /** Simple fixed-window limiter: a flooding client gets disconnected, not served. */
  private allow(ws: WebSocket): boolean {
    const l = this.liveOf(ws);
    const now = Date.now();
    if (now - l.windowStart >= 1000) {
      l.windowStart = now;
      l.msgs = 0;
    }
    if (++l.msgs > RATE_LIMIT_MSGS) {
      try {
        ws.close(1008, 'rate limit');
      } catch { /* already gone */ }
      return false;
    }
    return true;
  }

  /** A socket can die between getWebSockets() and send(); that must not kill the room. */
  private trySend(ws: WebSocket, data: ArrayBuffer): void {
    try {
      ws.send(data);
    } catch { /* closing */ }
  }
}

/** Never trust a client-supplied name: strip controls, cap length, always non-empty. */
function cleanName(raw: string, id: number): string {
  const clean = Array.from(raw)
    .filter((ch) => ch >= ' ' && ch !== '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return clean.length ? clean : `Player ${id}`;
}
