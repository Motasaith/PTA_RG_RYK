import {
  INTERP_DELAY_MS, MAX_PLAYERS, Peer, PlayerState, REJECT_FULL, REJECT_VERSION, SEND_HZ,
  S_JOIN, S_LEAVE, S_REJECT, S_SNAPSHOT, S_WELCOME,
  decodeJoin, decodeLeave, decodeReject, decodeSnapshot, decodeWelcome,
  encodeHello, encodeState, messageId,
} from './protocol';
import { wrapPi } from './mathx';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';

interface Sample {
  /** local arrival time — the only honest clock we share with the server */
  t: number;
  s: PlayerState;
}

/**
 * Playback buffer for one remote player.
 *
 * Remote players are rendered ~110 ms in the past, between two snapshots we already hold.
 * Interpolating known samples looks smooth; extrapolating past the newest one produces the
 * rubber-banding and mispredicted corners that make netcode feel bad. So when we run out of
 * future we hold the last known pose instead of guessing.
 */
export class InterpBuffer {
  private samples: Sample[] = [];

  push(s: PlayerState, now: number): void {
    // out-of-order arrival: drop anything older than what we already have
    const last = this.samples[this.samples.length - 1];
    if (last && now < last.t) return;
    this.samples.push({ t: now, s });
    // keep a second of history, no more
    while (this.samples.length > 2 && now - this.samples[0].t > 1000) this.samples.shift();
    if (this.samples.length > 40) this.samples.shift();
  }

  get length(): number {
    return this.samples.length;
  }

  /** Newest sample, ignoring the interpolation delay. */
  latest(): PlayerState | null {
    const s = this.samples[this.samples.length - 1];
    return s ? s.s : null;
  }

  /** Interpolated pose for `now`, or null if we have never heard from this player. */
  sample(now: number): PlayerState | null {
    if (!this.samples.length) return null;
    const target = now - INTERP_DELAY_MS;

    // before our history: hold the oldest pose
    if (target <= this.samples[0].t) return this.samples[0].s;

    for (let i = this.samples.length - 1; i > 0; i--) {
      const b = this.samples[i], a = this.samples[i - 1];
      if (target >= a.t && target <= b.t) {
        const span = b.t - a.t;
        const k = span > 0.001 ? (target - a.t) / span : 1;
        return lerpState(a.s, b.s, k);
      }
    }
    // past the newest: freeze rather than extrapolate
    return this.samples[this.samples.length - 1].s;
  }
}

function lerpState(a: PlayerState, b: PlayerState, k: number): PlayerState {
  return {
    id: b.id,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    // shortest way round, or a player turning past π spins the wrong way
    yaw: a.yaw + wrapPi(b.yaw - a.yaw) * k,
    flags: k < 0.5 ? a.flags : b.flags,
    speed: a.speed + (b.speed - a.speed) * k,
    weapon: k < 0.5 ? a.weapon : b.weapon,
  };
}

export interface RemotePeer {
  id: number;
  name: string;
  buf: InterpBuffer;
}

export interface ConnectOpts {
  /** advertise the room in the public list so strangers can join */
  isPublic?: boolean;
  mode?: string;
  /** override the server origin (tests) */
  origin?: string;
}

export interface OpenRoom {
  code: string;
  mode: string;
  players: number;
  max: number;
}

/**
 * Public rooms with space. Returns [] rather than throwing when the lobby is unreachable —
 * a missing room list must never stop someone playing with a code they already have.
 */
export async function fetchOpenRooms(origin?: string): Promise<OpenRoom[]> {
  const base = origin ?? (typeof location !== 'undefined' ? location.origin : '');
  try {
    const res = await fetch(`${base}/api/lobby/rooms`);
    if (!res.ok) return [];
    const body = await res.json() as { rooms?: OpenRoom[] };
    return Array.isArray(body.rooms) ? body.rooms : [];
  } catch {
    return [];
  }
}

/**
 * WebSocket client. Owns the connection, the peer list and each peer's playback buffer.
 * Knows nothing about three.js — rendering remote players is remoteplayers.ts's job.
 */
export class NetClient {
  status: NetStatus = 'offline';
  roomCode = '';
  myId = 0;
  error = '';
  peers = new Map<number, RemotePeer>();

  onChange: (() => void) | null = null;

  private ws: WebSocket | null = null;
  private seq = 1;
  private lastSend = 0;
  private lastPing = 0;
  private name = 'Player';

  get online(): boolean {
    return this.status === 'online';
  }

  get peerCount(): number {
    return this.peers.size;
  }

  connect(code: string, name: string, opts: ConnectOpts = {}): void {
    this.disconnect();
    this.roomCode = code;
    this.name = name;
    this.status = 'connecting';
    this.error = '';
    this.notify();

    const base = opts.origin ?? (typeof location !== 'undefined' ? location.origin : '');
    const q = `?mode=${encodeURIComponent(opts.mode ?? 'freeroam')}${opts.isPublic ? '&public=1' : ''}`;
    const url = base.replace(/^http/, 'ws') + `/api/room/${encodeURIComponent(code)}/ws` + q;

    try {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => ws.send(encodeHello(this.name));
      ws.onmessage = (ev: MessageEvent) => this.onMessage(ev.data as ArrayBuffer);
      ws.onerror = () => this.fail('connection failed');
      ws.onclose = (ev: CloseEvent) => {
        if (this.status !== 'error') {
          this.status = 'offline';
          this.error = ev.code === 1013 ? 'room is full' : '';
          this.reset();
          this.notify();
        }
      };
    } catch {
      this.fail('could not open a connection');
    }
  }

  disconnect(): void {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch { /* already closed */ }
    }
    this.status = 'offline';
    this.reset();
    this.notify();
  }

  /** Called every frame; throttles itself to SEND_HZ. */
  sendState(now: number, s: Omit<PlayerState, 'id'>): void {
    if (!this.online || !this.ws) return;
    if (now - this.lastSend < 1000 / SEND_HZ) return;
    this.lastSend = now;
    try {
      this.ws.send(encodeState(this.seq++, s));
    } catch { /* closing */ }

    // The room auto-replies to this without waking the Durable Object, so it is a free
    // keepalive through proxies that would otherwise drop an idle socket.
    if (now - this.lastPing > 8000) {
      this.lastPing = now;
      try {
        this.ws.send('ping');
      } catch { /* closing */ }
    }
  }

  private onMessage(buf: ArrayBuffer): void {
    if (typeof buf === 'string' || !(buf instanceof ArrayBuffer)) return;   // 'pong'
    const now = Date.now();
    switch (messageId(buf)) {
      case S_WELCOME: {
        const w = decodeWelcome(buf);
        if (!w) return;
        this.myId = w.yourId;
        this.peers.clear();
        for (const p of w.peers) this.addPeer(p);
        this.status = 'online';
        this.notify();
        return;
      }
      case S_JOIN: {
        const p = decodeJoin(buf);
        if (p) {
          this.addPeer(p);
          this.notify();
        }
        return;
      }
      case S_LEAVE: {
        const id = decodeLeave(buf);
        if (id !== null && this.peers.delete(id)) this.notify();
        return;
      }
      case S_SNAPSHOT: {
        const snap = decodeSnapshot(buf);
        if (!snap) return;
        for (const s of snap.states) {
          if (s.id === this.myId) continue;                 // never rewind ourselves
          const peer = this.peers.get(s.id);
          // A state can arrive a frame before its JOIN; make a placeholder rather than drop it.
          if (peer) peer.buf.push(s, now);
          else if (this.peers.size < MAX_PLAYERS) {
            const fresh = this.addPeer({ id: s.id, name: `Player ${s.id}` });
            fresh.buf.push(s, now);
            this.notify();
          }
        }
        return;
      }
      case S_REJECT: {
        const r = decodeReject(buf);
        this.fail(
          r === REJECT_FULL ? 'room is full'
            : r === REJECT_VERSION ? 'this build is out of date — reload the page'
              : 'the server refused the connection',
        );
        return;
      }
      default:
        return;
    }
  }

  private addPeer(p: Peer): RemotePeer {
    const peer: RemotePeer = { id: p.id, name: p.name, buf: new InterpBuffer() };
    this.peers.set(p.id, peer);
    return peer;
  }

  private fail(msg: string): void {
    this.status = 'error';
    this.error = msg;
    this.reset();
    this.notify();
  }

  private reset(): void {
    this.peers.clear();
    this.myId = 0;
    this.seq = 1;
  }

  private notify(): void {
    this.onChange?.();
  }
}
