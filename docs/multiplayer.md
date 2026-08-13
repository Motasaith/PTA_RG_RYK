# Online play, accounts and admin — plan

Goal: **play online with friends**, with GTA free-roam kept as one of several modes.
Not ranked, not anti-cheat-hardened. That distinction keeps the whole thing achievable.

---

## 1. The blocker: we are currently a static site

`next.config.mjs` sets `output: 'export'`. That produces `out/` — pure HTML/JS/CSS with
**no server**. A static site cannot:

- run the Google OAuth code exchange (it needs `GOOGLE_CLIENT_SECRET`, which must never
  reach the browser),
- talk to a database,
- host authoritative game rooms.

So we add a server. The good news is the *game* stays static and fast.

### Target architecture

One Cloudflare Worker, three responsibilities:

```
                 ┌──────────────────────────── Cloudflare Worker ───────┐
  browser ──────▶│  /            → env.ASSETS.fetch()   (the static game)│
                 │  /api/auth/*  → Google OAuth + session cookie          │
                 │  /api/admin/* → admin dashboard API (email allowlist)  │
                 │  /api/room/*  → WebSocket upgrade ──▶ GameRoom DO      │
                 └───────────────────────────────────────────────────────┘
                                                          │
                                       ┌──────────────────┴─────────────────┐
                                       │  GameRoom (Durable Object)          │
                                       │  one instance per match, holds the  │
                                       │  authoritative state, 20 Hz tick    │
                                       └─────────────────────────────────────┘
```

The Next.js build keeps `output: 'export'`. The game path has no SSR, no cold start —
exactly the property that makes it load instantly today.

### Why Durable Objects

A DO is a single-threaded object with a stable identity — `env.ROOM.getByName('abc123')`
always routes to the same instance globally. That is precisely "a game room". They support
**WebSocket hibernation**: the object sleeps between messages while keeping sockets open,
so an idle lobby costs nothing.

```ts
import { DurableObject } from 'cloudflare:workers';

export class GameRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // heartbeats answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request) {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);          // hibernation-aware accept
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) { /* … */ }
  async webSocketClose(ws: WebSocket, code: number, reason: string) { /* … */ }
}
```

```jsonc
// wrangler.jsonc
{
  "assets": { "directory": "./out", "binding": "ASSETS" },
  "durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "GameRoom" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }]
}
```

SQLite-backed DOs (`new_sqlite_classes`) are the cheaper class and give each room its own
SQL storage for free. **Verify current Durable Object pricing before launch** — DOs have
historically required the paid Workers plan.

---

## 2. Database

`DATABASE_URL` is a raw `postgres://` URL. **Workers cannot open a raw TCP socket to
Postgres.** Three ways forward:

| Option | How | Verdict |
|---|---|---|
| **Cloudflare D1** | native SQLite binding, zero config | **Recommended.** Our data is tiny |
| **Neon** | `@neondatabase/serverless` driver over HTTP | Good if Postgres is required |
| **Hyperdrive** | Cloudflare's pooler in front of any Postgres | Works with the existing URL |

What we actually need to store is small:

```sql
users        (id, google_sub, email, name, avatar_url, created_at, last_seen)
profiles     (user_id, nickname, colour_shirt, colour_pants, stats_json)
matches      (id, mode, map, started_at, ended_at, players_json)
bans         (user_id, reason, until, by_admin)
```

That is D1-shaped. Postgres is not wrong, it is just more moving parts than this needs.

---

## 3. Auth

Google OAuth 2.0 **authorization-code flow**, entirely server-side:

1. `/api/auth/google` → 302 to Google with `state` + PKCE.
2. `/api/auth/callback` → Worker exchanges code for tokens using `GOOGLE_CLIENT_SECRET`,
   verifies the ID token, upserts the user, sets a signed `HttpOnly; Secure; SameSite=Lax`
   session cookie.
3. `/api/me` → returns the session user, or 401.

Because the Worker owns the whole flow, **the client id never needs to be public** — drop
`VITE_GOOGLE_CLIENT_ID` entirely. (`VITE_` is Vite's prefix anyway; Next.js uses
`NEXT_PUBLIC_`.)

Production secrets go in via `wrangler secret put GOOGLE_CLIENT_SECRET`, never in
`wrangler.jsonc`.

---

## 4. Admin dashboard

`/admin` is a static page; the API is Worker routes gated by an email allowlist from
`ADMIN_USERS`. Every admin route re-checks the session — never trust a client flag.

Screens: live rooms and player counts, recent matches, kick/ban, feature flags
(enable a mode, cap room size), and basic Worker analytics.

---

## 5. Netcode

Server-authoritative, because a browser client is trivially modifiable.

- **20 Hz** server tick; clients render at their own frame rate.
- Clients send *inputs*, not positions.
- Clients **predict** locally and reconcile against server snapshots.
- Remote players are **interpolated** ~100 ms in the past — this is what makes other
  players look smooth instead of teleporting.
- Snapshots are binary (`ArrayBuffer`), delta-encoded, ~30 bytes per player per tick.

### Milestones

| # | Deliverable | Why this order |
|---|---|---|
| **1** | Rooms + presence. Join a code, see friends running around the existing city | Proves transport, interpolation and reconciliation with zero hit-registration risk |
| **2** | Vehicles synced + **rickshaw derby** mode | Physics sync, still forgiving — a 50 ms error is invisible |
| **3** | Shooting: server-side hit registration + lag compensation | The genuinely hard part, on a foundation that already works |
| **4** | Arena maps **with interiors** + round logic (2v2) | The Valorant-ish mode. Needs a new hand-authored map builder |
| **5** | Prop hunt · cops & robbers · battle-royale zone | Cheap once 1–4 exist; they are rule changes, not new tech |

Milestone 1 is the one that delivers "play online with friends". Everything after it is
gravy on a working base.

---

## 6. Open questions

1. **Database**: D1, or keep Postgres (which provider, so I can pick the driver)?
2. **Durable Objects need the paid Workers plan** — is $5/month acceptable?
3. Room size cap for free-roam — 8? 16?
