import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * The lobby: a single Durable Object holding a list of live rooms.
 *
 * Deliberately **in memory only**. Rooms heartbeat every 20s, and an entry that stops
 * heartbeating is forgotten. If this object is ever evicted, the list rebuilds itself within
 * one heartbeat — so "we store nothing" stays literally true, with no database and no
 * persistence layer to leak anything.
 *
 * It serves two readers:
 *   · players    → public rooms with space, for Quick Match
 *   · the admin  → every room including private ones, counts only
 */

export interface RoomInfo {
  code: string;
  mode: string;
  players: number;
  max: number;
  isPublic: boolean;
  /** epoch ms of the room's first announce */
  since: number;
  /** epoch ms of the most recent heartbeat */
  seen: number;
}

/** An entry older than this without a heartbeat is treated as gone. */
const STALE_MS = 50_000;

export class Lobby extends DurableObject<Env> {
  private rooms = new Map<string, RoomInfo>();

  /** Called by a GameRoom on its heartbeat alarm. */
  announce(info: Omit<RoomInfo, 'since' | 'seen'>): void {
    const now = Date.now();
    const prev = this.rooms.get(info.code);
    this.rooms.set(info.code, {
      ...info,
      since: prev ? prev.since : now,
      seen: now,
    });
  }

  /** Called when a room empties out. */
  drop(code: string): void {
    this.rooms.delete(code);
  }

  /** Public rooms that still have space, newest first. */
  openRooms(): RoomInfo[] {
    return this.live()
      .filter((r) => r.isPublic && r.players < r.max)
      .sort((a, b) => b.since - a.since)
      .slice(0, 40);
  }

  /** Everything, for the admin dashboard. */
  allRooms(): RoomInfo[] {
    return this.live().sort((a, b) => a.since - b.since);
  }

  stats(): { rooms: number; players: number; publicRooms: number } {
    const live = this.live();
    return {
      rooms: live.length,
      players: live.reduce((n, r) => n + r.players, 0),
      publicRooms: live.filter((r) => r.isPublic).length,
    };
  }

  private live(): RoomInfo[] {
    const cutoff = Date.now() - STALE_MS;
    for (const [code, r] of this.rooms) {
      if (r.seen < cutoff) this.rooms.delete(code);
    }
    return [...this.rooms.values()];
  }
}
