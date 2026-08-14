import { normaliseRoomCode } from '../game/protocol';
import type { Env } from './env';

export { GameRoom } from './room';
export { Lobby } from './lobby';

/**
 * The one Worker. It serves the static game for every ordinary request and handles a very
 * small API itself, so the game keeps loading like a static site (no SSR, no cold start on
 * the path that matters) while still having somewhere for players to meet.
 *
 * There is no database and there are no accounts. Nothing here writes anything down.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/health') {
      return json({ ok: true, ts: Date.now() });
    }

    // ── join a room: /api/room/<CODE>/ws
    const room = path.match(/^\/api\/room\/([^/]+)\/ws$/);
    if (room) {
      const code = normaliseRoomCode(decodeURIComponent(room[1]));
      if (!code) return json({ error: 'bad room code' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected websocket' }, 426);
      }
      return env.ROOM.getByName(code).fetch(request);
    }

    // ── Quick Match: public rooms that still have space
    if (path === '/api/lobby/rooms') {
      const rooms = await env.LOBBY.getByName('global').openRooms();
      return json({ rooms }, 200, 5);
    }

    // ── admin: every live room, counts only, gated by one shared token
    if (path === '/api/admin/live') {
      if (!authorised(request, url, env)) return json({ error: 'unauthorised' }, 401);
      const lobby = env.LOBBY.getByName('global');
      const [rooms, stats] = await Promise.all([lobby.allRooms(), lobby.stats()]);
      return json({ rooms, stats, ts: Date.now() });
    }

    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);

    return env.ASSETS.fetch(request);
  },
};

/**
 * Without accounts there is no identity to check, so the dashboard is gated by a single
 * shared secret. Compared in constant time so a wrong token cannot be discovered by timing.
 */
function authorised(request: Request, url: URL, env: Env): boolean {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;                       // unset = dashboard disabled
  const header = request.headers.get('Authorization') ?? '';
  const supplied = header.startsWith('Bearer ')
    ? header.slice(7)
    : url.searchParams.get('token') ?? '';
  return timingSafeEqual(supplied, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
  };
  headers['cache-control'] = cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store';
  return new Response(JSON.stringify(body), { status, headers });
}
