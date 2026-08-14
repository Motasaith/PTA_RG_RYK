/**
 * Wire protocol, shared verbatim by the browser client and the Cloudflare Worker.
 *
 * Binary, not JSON. A player's state is 12 bytes, so a full 8-player snapshot is under
 * 100 bytes — at 20 Hz that is about 2 KB/s down per client. The same state as JSON would
 * be roughly ten times that, and JSON.parse on every frame is real main-thread work.
 *
 * Positions are quantised to 2 cm in an int16, which covers ±655 m — comfortably more than
 * the world (x ±216, z −216…560). Yaw is an int16 over −π…π, giving ~0.01° steps.
 *
 * Every decoder is written to be hostile-input safe: a truncated or malformed frame returns
 * null rather than throwing, because these bytes arrive from the network.
 */

export const PROTOCOL_VERSION = 1;

/** Free-roam room cap. Bandwidth is linear in this, so it is deliberately modest. */
export const MAX_PLAYERS = 8;

/** How often a client reports its own state. */
export const SEND_HZ = 20;

/**
 * How far in the past remote players are rendered. Interpolating between two snapshots we
 * already have looks smooth; extrapolating into the future looks like teleporting.
 */
export const INTERP_DELAY_MS = 110;

const POS_STEP = 0.02;
const POS_MIN = -655;
const POS_MAX = 655;
const YAW_SCALE = 32767 / Math.PI;

/* ── message ids ──────────────────────────────────────────────────────────── */
export const C_HELLO = 0x01;
export const C_STATE = 0x02;

export const S_WELCOME = 0x81;
export const S_SNAPSHOT = 0x82;
export const S_JOIN = 0x83;
export const S_LEAVE = 0x84;
export const S_REJECT = 0x85;

/* ── state flags ──────────────────────────────────────────────────────────── */
export const F_SPRINT = 1 << 0;
export const F_AIMING = 1 << 1;
export const F_VEHICLE = 1 << 2;
export const F_DEAD = 1 << 3;
export const F_GROUNDED = 1 << 4;
export const F_FIRING = 1 << 5;

export const REJECT_FULL = 1;
export const REJECT_VERSION = 2;
export const REJECT_BANNED = 3;

export interface PlayerState {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  flags: number;
  /** horizontal speed in m/s, quantised to 0.1 */
  speed: number;
  /** weapon index into WEAPON_ORDER */
  weapon: number;
}

export interface Peer {
  id: number;
  name: string;
}

export const STATE_BYTES = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** NaN and Infinity must never reach the wire — they decode to garbage positions. */
function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function quantPos(v: number): number {
  return Math.round(clamp(finite(v), POS_MIN, POS_MAX) / POS_STEP);
}

function quantYaw(v: number): number {
  let a = finite(v);
  // wrap into −π…π before scaling, otherwise a drifting yaw overflows the int16
  a = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Math.round(a * YAW_SCALE);
}

function writeState(dv: DataView, o: number, s: PlayerState, withId: boolean): number {
  if (withId) dv.setUint8(o++, s.id & 0xff);
  dv.setInt16(o, quantPos(s.x), true); o += 2;
  dv.setInt16(o, quantPos(s.y), true); o += 2;
  dv.setInt16(o, quantPos(s.z), true); o += 2;
  dv.setInt16(o, quantYaw(s.yaw), true); o += 2;
  dv.setUint8(o++, s.flags & 0xff);
  dv.setUint8(o++, clamp(Math.round(finite(s.speed) * 10), 0, 255));
  dv.setUint8(o++, s.weapon & 0xff);
  return o;
}

function readState(dv: DataView, o: number, id: number, withId: boolean): [PlayerState, number] {
  let pid = id;
  if (withId) pid = dv.getUint8(o++);
  const x = dv.getInt16(o, true) * POS_STEP; o += 2;
  const y = dv.getInt16(o, true) * POS_STEP; o += 2;
  const z = dv.getInt16(o, true) * POS_STEP; o += 2;
  const yaw = dv.getInt16(o, true) / YAW_SCALE; o += 2;
  const flags = dv.getUint8(o++);
  const speed = dv.getUint8(o++) / 10;
  const weapon = dv.getUint8(o++);
  return [{ id: pid, x, y, z, yaw, flags, speed, weapon }, o];
}

/* ── client → server ──────────────────────────────────────────────────────── */

export function encodeHello(name: string): ArrayBuffer {
  const bytes = enc.encode(name.slice(0, 24));
  const buf = new ArrayBuffer(3 + bytes.length);
  const dv = new DataView(buf);
  dv.setUint8(0, C_HELLO);
  dv.setUint8(1, PROTOCOL_VERSION);
  dv.setUint8(2, bytes.length);
  new Uint8Array(buf, 3).set(bytes);
  return buf;
}

export function decodeHello(buf: ArrayBuffer): { version: number; name: string } | null {
  if (buf.byteLength < 3) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== C_HELLO) return null;
  const version = dv.getUint8(1);
  const len = dv.getUint8(2);
  if (buf.byteLength < 3 + len) return null;
  return { version, name: dec.decode(new Uint8Array(buf, 3, len)) };
}

/** `seq` lets the server drop out-of-order frames without a full ack scheme. */
export function encodeState(seq: number, s: Omit<PlayerState, 'id'>): ArrayBuffer {
  const buf = new ArrayBuffer(3 + STATE_BYTES - 1);
  const dv = new DataView(buf);
  dv.setUint8(0, C_STATE);
  dv.setUint16(1, seq & 0xffff, true);
  writeState(dv, 3, { id: 0, ...s }, false);
  return buf;
}

export function decodeState(buf: ArrayBuffer): { seq: number; state: PlayerState } | null {
  if (buf.byteLength < 3 + STATE_BYTES - 1) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== C_STATE) return null;
  const seq = dv.getUint16(1, true);
  const [state] = readState(dv, 3, 0, false);
  return { seq, state };
}

/* ── server → client ──────────────────────────────────────────────────────── */

export function encodeWelcome(yourId: number, peers: Peer[]): ArrayBuffer {
  const names = peers.map((p) => enc.encode(p.name.slice(0, 24)));
  let size = 4;
  for (const n of names) size += 2 + n.length;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint8(0, S_WELCOME);
  dv.setUint8(1, PROTOCOL_VERSION);
  dv.setUint8(2, yourId);
  dv.setUint8(3, peers.length);
  let o = 4;
  for (let i = 0; i < peers.length; i++) {
    dv.setUint8(o++, peers[i].id);
    dv.setUint8(o++, names[i].length);
    u8.set(names[i], o);
    o += names[i].length;
  }
  return buf;
}

export function decodeWelcome(buf: ArrayBuffer): { version: number; yourId: number; peers: Peer[] } | null {
  if (buf.byteLength < 4) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== S_WELCOME) return null;
  const version = dv.getUint8(1);
  const yourId = dv.getUint8(2);
  const count = dv.getUint8(3);
  const peers: Peer[] = [];
  let o = 4;
  for (let i = 0; i < count; i++) {
    if (o + 2 > buf.byteLength) return null;
    const id = dv.getUint8(o++);
    const len = dv.getUint8(o++);
    if (o + len > buf.byteLength) return null;
    peers.push({ id, name: dec.decode(new Uint8Array(buf, o, len)) });
    o += len;
  }
  return { version, yourId, peers };
}

export function encodeSnapshot(tick: number, states: PlayerState[]): ArrayBuffer {
  const n = Math.min(states.length, MAX_PLAYERS);
  const buf = new ArrayBuffer(6 + n * STATE_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, S_SNAPSHOT);
  dv.setUint32(1, tick >>> 0, true);
  dv.setUint8(5, n);
  let o = 6;
  for (let i = 0; i < n; i++) o = writeState(dv, o, states[i], true);
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): { tick: number; states: PlayerState[] } | null {
  if (buf.byteLength < 6) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== S_SNAPSHOT) return null;
  const tick = dv.getUint32(1, true);
  const n = dv.getUint8(5);
  if (buf.byteLength < 6 + n * STATE_BYTES) return null;
  const states: PlayerState[] = [];
  let o = 6;
  for (let i = 0; i < n; i++) {
    const [s, next] = readState(dv, o, 0, true);
    states.push(s);
    o = next;
  }
  return { tick, states };
}

export function encodeJoin(p: Peer): ArrayBuffer {
  const bytes = enc.encode(p.name.slice(0, 24));
  const buf = new ArrayBuffer(3 + bytes.length);
  const dv = new DataView(buf);
  dv.setUint8(0, S_JOIN);
  dv.setUint8(1, p.id);
  dv.setUint8(2, bytes.length);
  new Uint8Array(buf, 3).set(bytes);
  return buf;
}

export function decodeJoin(buf: ArrayBuffer): Peer | null {
  if (buf.byteLength < 3) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== S_JOIN) return null;
  const id = dv.getUint8(1);
  const len = dv.getUint8(2);
  if (buf.byteLength < 3 + len) return null;
  return { id, name: dec.decode(new Uint8Array(buf, 3, len)) };
}

export function encodeLeave(id: number): ArrayBuffer {
  const buf = new ArrayBuffer(2);
  const dv = new DataView(buf);
  dv.setUint8(0, S_LEAVE);
  dv.setUint8(1, id);
  return buf;
}

export function decodeLeave(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 2) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== S_LEAVE) return null;
  return dv.getUint8(1);
}

export function encodeReject(reason: number): ArrayBuffer {
  const buf = new ArrayBuffer(2);
  const dv = new DataView(buf);
  dv.setUint8(0, S_REJECT);
  dv.setUint8(1, reason);
  return buf;
}

export function decodeReject(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 2) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== S_REJECT) return null;
  return dv.getUint8(1);
}

/** First byte of any frame, or −1 if it is not even one byte long. */
export function messageId(buf: ArrayBuffer): number {
  return buf.byteLength ? new DataView(buf).getUint8(0) : -1;
}

/** Room codes are typed by humans, so avoid 0/O and 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

/** Normalise whatever the user typed; returns '' if it cannot be a room code. */
export function normaliseRoomCode(input: string): string {
  const up = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (up.length !== 5) return '';
  for (const ch of up) if (!CODE_ALPHABET.includes(ch)) return '';
  return up;
}
