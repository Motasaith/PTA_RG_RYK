# LOST & FOUND — Rahim Garden City

An open-world, GTA-style browser game set in Rahim Garden City, R.Y. Khan.
Next.js (static export) + three.js + a purpose-built collision/vehicle engine.
No art assets, no WASM physics library, no server: the entire city is generated
in the browser at load time and the whole deploy is ~1.3 MB (≈380 KB gzipped).

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # headless physics / layout / AI tests (no browser needed)
npm run build      # static export into out/
npm run cf:deploy  # build + wrangler pages deploy out
```

## Deploying to Cloudflare

Yes — this runs on Cloudflare with no compromises, because it is 100% client-side.
`next.config.mjs` sets `output: 'export'`, so `npm run build` produces a plain
static site in `out/`.

**Option A — Pages via CLI**

```bash
npm run cf:deploy          # npx wrangler pages deploy out
```

**Option B — Pages via Git integration**

| Setting                | Value                   |
| ---------------------- | ----------------------- |
| Framework preset       | Next.js (Static Export) |
| Build command          | `npm run build`         |
| Build output directory | `out`                   |

`wrangler.toml` already declares `pages_build_output_dir = "out"`.

There is no Node runtime, no SSR and nothing in the hot path but static assets,
so you stay on the free tier with no cold starts. If you later want cloud saves
or a leaderboard, that is the point to add a Worker + KV.

## Controls

| Input          | Action                                        |
| -------------- | --------------------------------------------- |
| `W A S D`      | move, relative to where the camera is looking |
| `SHIFT`        | sprint                                        |
| `SPACE`        | jump · handbrake in a vehicle                 |
| mouse          | look (pointer lock)                           |
| RMB (hold)     | aim down sights                               |
| LMB            | fire · punch                                  |
| `1 2 3 4`      | fists · pistol · SMG · shotgun                |
| `R`            | reload                                        |
| `E`            | enter/exit vehicle, buy from a shop           |
| `H`            | horn                                          |
| `TAB` / `M`    | full map                                      |
| `ESC`          | pause (also releases the mouse)               |

Every key is rebindable in Pause → Controls, along with mouse sensitivity,
separate aim sensitivity and invert-Y.

## What is in the game

- **The map** — two districts joined at one arterial, ~440 m x 760 m in total.

  **Rahim Garden Housing Scheme** (south) is the real society, built from its own
  layout plan, at 1:1 in metres: 50' x 103' plots, 30'/40'/50' road hierarchy, the
  70'-wide central park with the masjid on its east end and the community hall and
  parking on its west, the 50' entrance boulevard with the scheme's gate and
  "near Gulshan-e-Iqbal Scheme No. 3" board, and Link Rd along the east edge.
  132 plots, each with a boundary wall, gate posts carrying its **plot number**,
  driveway, courtyard and flat-roofed house with a rooftop water tank. Roughly one
  plot in seven is still vacant with a PLOT AVAILABLE board — encircled plots are
  available, as the banner says. You live on plot 34.

  **Rahim Garden City** (north) is invented, and supplies what a plot scheme has
  no room for: 5x5 blocks of downtown towers, shop rows with signage, a
  supermarket, a police station, a mosque, parks with a pond and a cricket pitch,
  car parks, and a plaza with a clock tower and fountain — plus the wide roads
  that make driving fun.
- **Traffic** — left-hand traffic (as in Pakistan) on a proper lane graph. AI
  cars run the *same* physics as the player, so they understeer, queue, get
  shunted and recover their lane. Jams break themselves up after 5 s.
- **People** — 8–26 pedestrians (quality dependent) with an 11-joint skeleton,
  procedural walk/run/idle/aim/death animation, hit reactions, headshots, blood
  particles and pools, and corpses that persist. The population streams to stay
  near the player instead of spreading thin over 25 blocks.
- **Police** — 5-star wanted level. Firing in public, hitting people or running
  them over raises heat; foot officers and cruisers spawn out of sight and
  pursue. Break line of sight for ~15 s to lose them. Standing next to an
  officer unarmed gets you **BUSTED** (fine + drop-off at the station); dying
  gets you **WASTED** (clinic fee).
- **Vehicles** — sedan, hatchback, SUV, van, sports, police cruiser, rickshaw.
  Parked cars can be stolen; the driver is animated at the wheel and leans with
  the suspension.
- **Economy & missions** — Mom's list of 8 objectives with map beacons; cash,
  ammo, health and armour pickups; shops selling food (health) and ammo (which
  also unlock the SMG and shotgun).
- **Presentation** — shader sky dome with day/night cycle, sun-following soft
  shadows, procedural PBR textures with world-space-constant tiling, lit windows
  and street lamps after dark, rotating radar plus a full map.

## Architecture

```
app/                Next.js App Router shell (one static page)
components/         React HUD, menus, settings — DOM only, no game logic
game/
  engine.ts         orchestrator: player controller, weapons, heat, missions, frame loop
  physics.ts        AABB world + spatial hash: ground query, cylinder resolve, raycast
  layout.ts         geometry batcher, street furniture, road-graph types, plot-number atlas
  city.ts           the invented grid city, and the district that stitches it all together
  scheme.ts         the real Rahim Garden housing scheme, authored from its layout plan
  humanoid.ts       11-joint character rig + procedural animation
  vehicle.ts        bicycle-model arcade vehicle physics + car models
  traffic.ts        lane-graph vehicle AI (drives the same physics as the player)
  peds.ts           pedestrian/police AI, damage, death, population streaming
  combat.ts         authoritative bullet raycast, blood, decals, tracers (all pooled)
  camerarig.ts      third-person spring arm, over-shoulder aim, recoil, shake
  materials.ts      canvas-generated textures and the shared material set
  sky.ts audio.ts minimap.ts input.ts settings.ts hudstore.ts
scripts/smoke.mjs   compiles game/ to ESM and runs tests/ in Node
tests/              headless assertions (see below)
_archive/           previous versions, kept for reference
```

Choices worth knowing about:

- **React never touches the render loop.** The engine writes to a tiny external
  store (`hudstore.ts`) which shallow-diffs before notifying, so a 60 Hz game
  loop does not cause 60 React renders a second.
- **The game logic imports no WebGL.** That is why `npm test` can build the whole
  city, run a minute of traffic and AI, and fire bullets in plain Node.
- **Everything static is merged.** The entire city is ~14 draw calls; a character
  is 11 (one shared vertex-coloured material for every human in the scene).
  Bullets, blood, dust, tracers and decals are pooled — nothing is allocated per
  shot.
- **Movement is sub-stepped.** Steps are subdivided by distance travelled, so
  nothing tunnels through a wall at any frame rate, and every smoothing call is
  exponential (frame-rate independent).
- **Nothing is scattered at random.** Both districts place props against an
  explicit zoning rule — the city against its road/pavement/lot bands, the scheme
  against its plan-derived plot rows — and the tests assert that no building,
  tree, lamp, vendor, spawn point or pedestrian waypoint ever overlaps a
  carriageway. That is checked against the generator's own road data, so it covers
  the scheme's 9 m streets as well as the city's 16 m ones.
- **One road graph, no grid assumptions.** Traffic picks its next turn
  geometrically rather than from grid indices, and each edge carries its own
  carriageway width, so cars keep left correctly on a 30' scheme street and on a
  city arterial alike.
- **One key press fires one action.** Handlers run in sequence within a frame and
  all read the same key edge, so acting on a press consumes it. Without that,
  tapping E in a car exits the vehicle and the interaction pass immediately puts
  you back in — a bug that looks like "E doesn't work".
- **Aiming is analytic.** Bullets come from a hand-written ray against the
  collision grid and character spheres — the player is never a candidate, and the
  camera sits over the right shoulder, so the crosshair cannot land on your own
  head.

## Performance

Three presets (Pause → Display) change pixel ratio, shadows, draw distance, crowd
size and prop density. Adaptive resolution then protects the frame budget: if the
average frame goes over ~19 ms the render scale drops (never below 0.66) and
recovers when there is headroom. Turn on Show Performance for a live
FPS / draw-call / triangle readout.

Medium preset, measured: ~141 k static triangles, ~1000 colliders, city generated
in ~270 ms, 261 kB of JS on first load.

## Tests

`npm test` compiles the game modules and runs two headless suites:

- **`tests/world.test.mjs`** — collision primitives (push-out, step-up, ground
  snapping, ray hits, line of sight), model integrity (every rig/vehicle/weapon
  merges correctly, muzzles sit in front of grips) and **layout invariants**: all
  ~1000 buildings/trees/lamps/walls are proven not to overlap any road, and no
  pedestrian route, shop, objective, pickup or parking bay sits on tarmac.
- **`tests/gameplay.test.mjs`** — vehicle handling (cannot pivot on the spot,
  drives straight, steer sign, wall crashes, handbrake slides), a full minute of
  traffic and pedestrian simulation (cars stay on the road, nobody walks into a
  building, no NaN), headshot vs body-shot detection, death and panic
  propagation, and police pursuit + fire.

## Not included

Being explicit about the gaps rather than pretending:

- **No building interiors.** Buildings are solid; there is no enterable house
  like the single interior in the original prototype.
- **No train, plane, bus or bicycle.** The original had them as set pieces; this
  version has seven road vehicles instead. The vehicle system is data-driven
  (`SPECS` in `game/vehicle.ts`), so adding more is mostly a spec entry plus a
  mesh builder.
- **Desktop only.** The HUD is responsive, but there are no touch controls or
  gamepad support and the game needs pointer lock.
- **Death is procedural, not ragdoll.** Bodies collapse convincingly but do not
  tumble down stairs.
