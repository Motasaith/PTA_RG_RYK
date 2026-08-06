/* Headless smoke test: builds the whole city in Node with a stubbed canvas,
   then asserts the things the player complained about are actually true. */

/* ---------------- minimal DOM/canvas stub (three only stores canvases as texture images) ---------------- */
const ctx2d = () => {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', lineCap: '',
    globalAlpha: 1,
    fillRect: noop, strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop, rect: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, clip: noop,
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    measureText: (t) => ({ width: t.length * 8 }), fillText: noop, strokeText: noop,
    putImageData: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    drawImage: noop, setTransform: noop,
  };
};
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    return { width: 1, height: 1, getContext: () => ctx2d(), style: {}, toDataURL: () => '' };
  },
  createElementNS: () => ({ style: {} }),
};
globalThis.self = globalThis;
globalThis.window = globalThis;

const THREE = await import('three');
const { Physics, KIND } = await import('./physics.js');
const { buildMaterials } = await import('./materials.js');
const city = await import('./city.js');
const scheme = await import('./scheme.js');
const { QUALITY } = await import('./settings.js');
const { createHumanoid } = await import('./humanoid.js');
const { createVehicle } = await import('./vehicle.js');
const { createWeaponModel } = await import('./weapons.js');

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg} ${extra}`); fails++; }
};

/* ---------------- 1. physics ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */
console.log('\nphysics');
{
  const p = new Physics();
  p.addBox(0, -5, 1, 5, 0, 3, KIND.Building);        // wall
  p.addBox(-10, -10, 10, 10, 0, 0.16, KIND.Ground);  // pavement slab
  p.addBox(4, -1, 5, 1, 0, 0.4, KIND.Prop);          // low ledge
  p.build();

  p.resolveCircle(0.5, 0, 0.34, 0, 1.78, 0.45, false);
  ok(Math.abs(p.outX - -0.34) < 1e-6 || Math.abs(p.outX - 1.34) < 1e-6,
    'a body inside a wall is pushed out of it', `x=${p.outX.toFixed(3)}`);

  p.resolveCircle(-0.5, 0, 0.34, 0, 1.78, 0.45, false);
  ok(p.outX <= -0.34 + 1e-6, 'approaching from the left cannot enter the wall', `x=${p.outX.toFixed(3)}`);

  p.resolveCircle(4.5, 0, 0.34, 0, 1.78, 0.45, false);
  ok(!p.outHit, 'a 0.4m ledge does not block movement (step-up works)');

  ok(Math.abs(p.groundHeight(0, 0, 0.34, 2, false) - 0.16) === 0, 'stands on the pavement slab');
  ok(p.groundHeight(4.5, 0, 0.34, 2, false) === 0.4, 'stands on top of the ledge');
  ok(p.groundHeight(50, 50, 0.34, 2, false) === 0, 'falls back to ground level off-slab');

  const hit = p.raycast(-4, 1.5, 0, 1, 0, 0, 20, false);
  ok(hit && Math.abs(hit.t - 4) < 1e-6, 'ray hits the wall face at the right distance', `t=${hit?.t}`);
  ok(hit && hit.nx === -1, 'hit normal points back along the ray', `n=${hit?.nx}`);
  const miss = p.raycast(-4, 1.5, 20, 1, 0, 0, 20, false);
  ok(miss === null, 'ray past the wall misses');
  ok(p.segmentClear(-4, 1.5, 0, 4, 1.5, 0) < 1, 'line of sight is blocked through a wall');
  ok(p.segmentClear(-4, 1.5, 20, 4, 1.5, 20) === 1, 'line of sight is clear in the open');
}

/* ---------------- 2. characters, cars and guns actually merge ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */
console.log('\nmodels');
{
  const h = createHumanoid({ skin: 0xf0c69a, shirt: 0xc94f4f, pants: 0x2f3a4a, hair: 0x24170f, shoes: 0x222222, scale: 1 });
  ok(h.meshes.length >= 10, `humanoid built from ${h.meshes.length} jointed parts`);
  ok(h.meshes.every((m) => m.geometry && m.geometry.attributes.position && m.geometry.attributes.color),
    'every body part merged with vertex colours');
  const joints = ['hips', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'];
  ok(joints.every((j) => h[j] && h[j].isObject3D), 'has hips/chest/head/shoulders/elbows/hips/knees');
  // knees must hang below the hips, feet below the knees
  const kneeY = h.shinL.position.y, hipY = h.hips.position.y;
  ok(hipY > 0.85 && hipY < 1.0, `hip height is human (${hipY.toFixed(2)}m)`);
  ok(kneeY < -0.4, `knee sits below the hip (${kneeY.toFixed(2)}m)`);

  for (const kind of ['sedan', 'suv', 'van', 'sports', 'police', 'rickshaw', 'hatch']) {
    const v = createVehicle(kind, 0xb8342a);
    const body = v.bodyPivot.children[0];
    ok(body.geometry && body.geometry.attributes.position.count > 50, `${kind} body mesh built`);
    ok(v.wheelMeshes.length >= 3, `${kind} has wheels`);
    ok(v.wheelMeshes.filter((w) => w.front).length >= 1, `${kind} has steerable front wheels`);
  }

  for (const id of ['pistol', 'smg', 'shotgun']) {
    const w = createWeaponModel(id);
    ok(!!w && !!w.muzzle, `${id} model + muzzle point built`);
    const p = new THREE.Vector3();
    w.group.updateMatrixWorld(true);
    w.muzzle.getWorldPosition(p);
    ok(p.length() > 0.05, `${id} muzzle is out in front of the grip (${p.length().toFixed(2)}m)`);
  }
  ok(createWeaponModel('fists') === null, 'fists have no model');
}

/* ---------------- 3. the city -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */
console.log('\ncity layout');
const phys = new Physics();
const scene = new THREE.Scene();
const mats = buildMaterials();
const t0 = Date.now();
const C = city.buildCity(scene, phys, mats, QUALITY.medium, 20260805);
console.log(`  (generated in ${Date.now() - t0}ms - ${Math.round(C.triangles / 1000)}k triangles, ${phys.boxes.length} colliders)`);

ok(C.nodes.length === city.N * city.N + 24, `road graph has ${C.nodes.length} intersections (36 city + 24 scheme)`);
ok(C.nodes.every((n) => n.nb.length >= 2), 'every intersection connects to its neighbours');
ok(C.pedLoops.length === (city.N - 1) * (city.N - 1) + 9,
  `${C.pedLoops.length} pedestrian routes (25 city blocks + 8 scheme kerbs + park)`);
ok(C.shops.length >= 6, `${C.shops.length} shop counters`);
ok(C.parkSpots.length >= 20, `${C.parkSpots.length} parking spots`);
ok(C.itemSpots.length >= 8, `${C.itemSpots.length} candidate objective spots`);
ok(C.pickupSpots.length >= 20, `${C.pickupSpots.length} pickup spots`);

// Road strips: the band each grid line owns.
const HR = city.ROADW / 2;
const strips = [];
for (let i = 0; i < city.N; i++) {
  const x = city.roadCoord(i);
  strips.push({ minX: x - HR, maxX: x + HR, minZ: city.roadCoord(0) - HR, maxZ: city.roadCoord(city.N - 1) + HR });
  strips.push({ minZ: x - HR, maxZ: x + HR, minX: city.roadCoord(0) - HR, maxX: city.roadCoord(city.N - 1) + HR });
}
const onRoad = (x, z, r = 0) => strips.some((s) => x + r > s.minX && x - r < s.maxX && z + r > s.minZ && z - r < s.maxZ);
const rectOnRoad = (b) => strips.some((s) => b.maxX > s.minX && b.minX < s.maxX && b.maxZ > s.minZ && b.minZ < s.maxZ);

const solid = phys.boxes.filter((b) => b.kind === KIND.Building || b.kind === KIND.Prop || b.kind === KIND.Fence);
const trespassers = solid.filter(rectOnRoad);
ok(trespassers.length === 0,
  `none of the ${solid.length} buildings/trees/lamps/walls overlap a road`,
  trespassers.length ? `first offender: ${JSON.stringify(trespassers[0])}` : '');

const badLoop = C.pedLoops.flat().filter((p) => onRoad(p.x, p.z, 0.4));
ok(badLoop.length === 0, 'no pedestrian waypoint sits on the tarmac', `${badLoop.length} bad`);

const badShop = C.shops.filter((s) => onRoad(s.x, s.z, 0.5));
ok(badShop.length === 0, 'no shop counter is in the road');

const badItem = C.itemSpots.filter((s) => onRoad(s.x, s.z, 0.4));
ok(badItem.length === 0, 'no objective spawns in the road');

const badPickup = C.pickupSpots.filter((s) => onRoad(s.x, s.z, 0.4));
ok(badPickup.length === 0, 'no pickup spawns in the road');

const badPark = C.parkSpots.filter((s) => onRoad(s.x, s.z, 1.2));
ok(badPark.length === 0, 'every parking spot is off the carriageway');

// traffic spawns, on the other hand, must be ON a road
ok(C.roadSpawns.length > 40 && C.roadSpawns.every((s) => onRoad(s.x, s.z)),
  `all ${C.roadSpawns.length} traffic spawns are on roads`);

// the player must start on solid ground, not inside a wall
const startGround = phys.groundHeight(C.playerStart.x, C.playerStart.z, 0.34, 3);
phys.resolveCircle(C.playerStart.x, C.playerStart.z, 0.34, startGround, startGround + 1.78, 0.45, false);
ok(!phys.outHit, 'player start position is not inside geometry');
ok(startGround > 0.1, `player starts on the pavement (y=${startGround})`);

// nothing should be floating: every collider must start at or below ground level
const floating = phys.boxes.filter((b) => b.bottom > 0.2);
ok(floating.length === 0, 'no collider floats above the ground', `${floating.length} floating`);

/* -- Rahim Garden housing scheme ----------------------------------------- */
console.log(`
rahim garden housing scheme`);
{
  const P = scheme.PLAN;
  ok(Math.abs(P.R30 - 9.144) < 0.01 && Math.abs(P.R50 - 15.24) < 0.01,
    `built to the plan road widths (30ft=${P.R30.toFixed(2)}m, 50ft=${P.R50.toFixed(2)}m)`);
  ok(Math.abs(P.PARK_W - 21.336) < 0.01, `central park is the plan 70ft (${P.PARK_W.toFixed(2)}m)`);
  ok(Math.abs(P.PLOT_W - 15.24) < 0.01, `plot frontage is the plan 50ft (${P.PLOT_W.toFixed(2)}m)`);

  const plots = C.minimap.buildings.filter((o) => o.z > 210);
  ok(plots.length > 110, `${plots.length} plots and civic buildings in the scheme`);

  ok(C.bounds.maxZ > 500 && C.bounds.maxZ < 600, `world extends south to z=${C.bounds.maxZ.toFixed(0)}`);
  ok(C.bounds.minZ < -200, 'the city end of the world is unchanged');

  // the scheme has to be reachable: its entrances must link to city intersections
  const cityNodes = C.nodes.filter((n) => n.z <= 200);
  const schemeNodes = C.nodes.filter((n) => n.z > 200);
  const links = schemeNodes.filter((n) => n.nb.some((k) => cityNodes.includes(k)));
  ok(links.length === 4, `${links.length} scheme streets connect through to the city grid`);
  ok(schemeNodes.every((n) => n.nb.length >= 2), 'every scheme junction has at least two exits');

  // flood fill: traffic must be able to drive from the city into the scheme and back
  const seen = new Set([C.nodes[0]]);
  const queue = [C.nodes[0]];
  while (queue.length) {
    const n = queue.pop();
    for (const k of n.nb) if (!seen.has(k)) { seen.add(k); queue.push(k); }
  }
  ok(seen.size === C.nodes.length, `all ${C.nodes.length} junctions reachable from one another`);

  ok(C.playerStart.z > 210, 'the player now lives in Rahim Garden');
  const homeGround = phys.groundHeight(C.playerStart.x, C.playerStart.z, 0.34, 3);
  phys.resolveCircle(C.playerStart.x, C.playerStart.z, 0.34, homeGround, homeGround + 1.78, 0.45, false);
  ok(!phys.outHit, 'the home spawn is clear of walls and gate posts');
  ok(!onRoad(C.playerStart.x, C.playerStart.z), 'the home spawn is not in the street');
  ok(C.pois.some((q) => q.kind === 'gate'), 'the entrance gate is a map landmark');
  ok(C.pois.some((q) => q.name === 'RAHIM GARDEN PARK'), 'the central park is a map landmark');

  // an entry edge must carry the scheme street's width, not the city's 16m
  const entryWidths = [];
  for (const n of cityNodes) {
    for (let i = 0; i < n.nb.length; i++) {
      if (n.nb[i].z > 200) entryWidths.push(n.nbWidth[i]);
    }
  }
  ok(entryWidths.length === 4 && entryWidths.every((w) => w < 16),
    `entry lanes sized to the scheme streets (${entryWidths.map((w) => w.toFixed(1)).join(', ')}m)`);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}\n`);
process.exit(fails ? 1 : 0);


