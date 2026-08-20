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
- host game rooms that both players can reach.

So we add a server. The good news is the *game* stays static and fast.

### Target architecture

One Cloudflare Worker, four responsibilities:

```
                 ┌──────────────────────────── Cloudflare Worker ───────┐
  browser ──────▶│  /            → env.ASSETS.fetch()   (the static game)│
                 │  /api/lobby/* → public room list (Quick Match)         │
                 │  /api/admin/* → live room counts (shared token)        │
                 │  /api/room/*  → WebSocket upgrade ──▶ GameRoom DO      │
                 └───────────────────────────────────────────────────────┘
                                                          │
                                       ┌──────────────────┴─────────────────┐
                                       │  GameRoom DO — one per room code    │
                                       │  Lobby DO   — one, lists live rooms │
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

`new_sqlite_classes` is not a detail — it is the whole reason this is free.

**Verified Aug 2026:** Durable Objects have been on the Workers **Free** plan since
April 2025, but *only with the SQLite storage backend*. The older key-value backend is
still paid-only. Free accounts get 5 GB of total DO storage, and every Worker request may
call a Durable Object. So `new_sqlite_classes` it is — using `new_classes` instead would
silently put us on a paid-only path.

---

## 2. No database, no accounts

Dropped deliberately. `DATABASE_URL`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are all
unused now.

The distinction that matters: **the Worker is a meeting point, not a store.** Two browsers
on different networks cannot find each other — something has to introduce them. That is all
a room does. It holds names and positions in memory while people are connected and forgets
them the moment they leave.

(Peer-to-peer would not remove the server either: WebRTC still needs a signalling server to
exchange connection details, plus STUN/TURN for NAT traversal. It is *more* infrastructure,
not less, and it degrades badly past two players.)

What this buys: nothing about a player is written down anywhere. No account, no profile, no
history, no cookie. Your chosen name lives in your own browser's localStorage.

What it costs: no saved stats, no persistent identity, no ban list. Someone can pick any
name they like. For playing with friends that is the right trade.

## 3. Rooms

One Durable Object per room code, so **rooms are completely independent**:

```ts
env.ROOM.getByName('KHP47')   // its own object, its own memory
env.ROOM.getByName('TX9BM')   // a different one entirely
```

There is no single server to fill up. A thousand simultaneous rooms is a thousand objects,
each placed near whoever created it, each asleep when nobody is talking. Worldwide
simultaneous play works with no extra work.

| Mode | Players | Teams |
|---|---|---|
| Free-roam | 8 | none |
| 2v2 | 4 | 2 + 2 |
| 3v3 | 6 | 3 + 3 |
| 4v4 | 8 | 4 + 4 |

One cap of 8 covers everything. Bandwidth is not the constraint — a full 8-player snapshot
is 102 bytes. The limit is rendering ~11 draw calls per character and keeping a fight
readable. 16 would be about 32 KB/s, still trivial, if bigger matches are wanted.

**Lobby flow for team modes (implemented):** the host creates one room and sends the code to
*everyone*, their own side and the opposition. Everyone joins the same code and is
auto-balanced onto GREEN or ORANGE on arrival; you may switch sides, but only while it does
not leave one team two or more players larger. The host presses START TEAM DEATHMATCH and
first to 25 kills wins. One code, one room, both teams — exactly how a private lobby works in
every shooter.

Teams are GREEN and ORANGE rather than the usual red and green, because red/green is the pair
most colour-blind players cannot separate and team identity has to be readable at a glance.

Free-roam is the same room with teams set to 0, where nobody can hurt anybody. The host can
start a match and drop back to free-roam without anyone reconnecting.

### Finding strangers

A code only works if you can send it to someone. So rooms may optionally be **public**, and
a single `Lobby` Durable Object keeps the list:

- rooms heartbeat to it every 20s using a **storage alarm**, which fires even while the room
  is hibernating — so the list stays live without keeping anything awake
- an entry that stops heartbeating is forgotten after 50s
- the list is **in memory only**. If the lobby object is ever evicted it rebuilds itself
  within one heartbeat, so "we store nothing" stays literally true

Quick Match joins any public room with space, or hosts a new public one if there are none.

## 4. Admin dashboard

At `/admin`, gated by a single shared token (`wrangler secret put ADMIN_TOKEN`) compared in
constant time. Without accounts there is no identity to authenticate, so a token is the
honest mechanism. It is held in `sessionStorage`, so it dies with the tab.

It shows live room count, players online, public room count, and a table of live rooms
(code, mode, occupancy, visibility, age). That is everything there is to show — no player
records exist to display.

---

## 5. Netcode

### Free-roam is a relay (revised during implementation)

The original plan here said "20 Hz authoritative server tick". Building it made the flaw
obvious: a `setInterval` loop inside a Durable Object pins the object **awake** for the
entire life of the room, and DOs are billed for time spent active. That throws away
hibernation — the very thing that makes this free.

So free-roam relays instead. A client reports its own state; the room stamps it with the
sender's id and fans it out, then goes back to sleep. Lowest possible latency, and an idle
lobby costs nothing.

The trade-off, stated plainly: **clients are trusted about their own position.** Among
friends that is fine — the worst case is someone teleporting. It is *not* acceptable for
competitive shooting, so milestone 3 introduces an authoritative tick for that mode only,
and that mode pays for the duration it uses.

### What is implemented

- Binary frames. A client state frame is **16 bytes**; a full 8-player snapshot is
  **118 bytes**. Each client uploads ~**320 B/s** of player state.
- **Teams and PvP.** Protocol v2 carries a team, health and the vehicle a player is
  driving. In a match you can shoot, melee and run over the other side; friendly fire is
  off and enforced *on the server*, so a modified client cannot switch it on.
- **A shared world.** One client is named traffic host by the server and broadcasts the
  moving cars (~5.8 KB/s for 48 cars at 10 Hz). Everyone else replays them, interpolated
  at the same 110 ms delay as players.
- Positions quantised to 2 cm in an int16 (±655 m), yaw to ~0.01 degrees.
- Remote players are rendered **110 ms in the past**, interpolated between two snapshots we
  already hold. Past the newest sample it **holds** the last pose rather than extrapolating,
  because extrapolation is what produces rubber-banding.
- Yaw interpolation takes the short way round the +/-pi wrap.
- Every decoder is hostile-input safe: truncated frames, over-long names, lying player
  counts, NaN and drifting yaw are all handled and covered by tests.
- Per-socket rate limit (80 msg/s) and server-side name sanitisation.
- Full snapshots, not delta-encoded: at 118 bytes for a full room, delta compression would
  add complexity for no measurable gain. It becomes worthwhile if the cap rises.

### Who decides what

The room is still a relay, but three things are decided by the server, because leaving them
to clients produces *disagreement* rather than cheating — and all three are event-driven, so
none of them costs a tick loop or breaks hibernation:

| Decided by the server | Why it cannot be a client |
|---|---|
| Team assignment | Clients picking their own side end up 5v1 |
| The score | Two clients tallying kills independently drift apart on the first dropped frame |
| Who is traffic host | Exactly one client may own the ambient cars |

Everything else stays client-reported. **Damage is applied by the victim**: the shooter
reports "I hit player N", the server forwards it to N alone, and N subtracts its own health
and reports its own death. One machine owning a player's health is what stops two
simultaneous shooters each subtracting from a stale copy and killing them twice — and it
means a kill is counted exactly once however many people were firing.

### What is shared and what is not

| | Shared | Notes |
|---|---|---|
| Players | yes | position, pose, weapon, team, health |
| The car a player drives | yes | kind and colour travel in their state |
| Moving ambient traffic | yes | host-owned, capped at 48 cars |
| Parked cars | no | deterministic from their own seed, so they match anyway |
| Pedestrians | no | ~60 humanoids would cost more than everything else combined |

Parked cars are the honest caveat: they are placed identically on every machine from a
dedicated RNG stream, but if you nudge one with your bumper it moves only on your screen
until somebody drives it — at which point the driver claims it and it syncs properly.

Ambient traffic is capped at 48 cars for everyone in a room regardless of quality preset,
because the host sends all of them and the count cannot depend on one player's settings.

### Milestones

| # | Deliverable | Why this order |
|---|---|---|
| **1** DONE | Rooms + presence. Join a code, see friends running around the existing city | Proves transport, interpolation and reconciliation with zero hit-registration risk |
| **2** DONE | Vehicles synced + host-owned ambient traffic | Physics sync, still forgiving — a 50 ms error is invisible |
| **3** PARTLY | Shooting: teams, PvP damage, kill feed and score. **Not** yet server-side hit registration or lag compensation | Playable against friends now; the authoritative tick is what competitive play would still need |
| **4** | Arena maps **with interiors** + round logic (2v2) | The Valorant-ish mode. Needs a new hand-authored map builder |
| **5** | Prop hunt · cops & robbers · battle-royale zone | Cheap once 1–4 exist; they are rule changes, not new tech |

Milestone 1 is the one that delivers "play online with friends". Everything after it is
gravy on a working base.

---

## 6. Cost

Everything on the free plan, verified August 2026:

| | Free allowance | What we need |
|---|---|---|
| Workers requests | 100 K/day | fine |
| Durable Objects | SQLite backend, 5 GB | one per room + one lobby |
| Durable Object alarms | included | one per live room, every 20s |

The thing to watch as it grows is **DO duration**: billed by wall-clock time an object is
active. That is the whole reason free-roam is a relay rather than a tick loop, and why the
lobby heartbeat uses a storage alarm — a room with sockets open but nobody talking is
hibernating, which is not "active".

## 7. Decided

Free-roam room cap: **8** (`MAX_PLAYERS` in `game/protocol.ts`).
