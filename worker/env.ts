import type { GameRoom } from './room';
import type { Lobby } from './lobby';

/**
 * No database, no accounts, no user records.
 *
 * The Worker is a meeting point, not a store. A room holds names and positions in memory
 * only while people are connected, and forgets them the moment they leave. The lobby holds
 * a list of live rooms that rebuilds itself from heartbeats. Nothing is persisted anywhere.
 */
export interface Env {
  /** The static Next.js export (out/), served for every non-/api path. */
  ASSETS: Fetcher;
  /** One Durable Object per game room. */
  ROOM: DurableObjectNamespace<GameRoom>;
  /** A single object listing live rooms, for Quick Match and the admin page. */
  LOBBY: DurableObjectNamespace<Lobby>;

  /**
   * Shared secret for /admin. Set with `wrangler secret put ADMIN_TOKEN`.
   * Without accounts there is nobody to authenticate, so the dashboard is gated by one
   * token rather than by identity.
   */
  ADMIN_TOKEN?: string;
}
