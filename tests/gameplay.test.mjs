/* Simulation test: runs the real update loops headlessly for a minute of game time. */

const ctx2d = () => {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', lineCap: '', globalAlpha: 1,
    fillRect: noop, strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop, rect: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, clip: noop,
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    measureText: (t) => ({ width: t.length * 8 }), fillText: noop, strokeText: noop,
    putImageData: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) }), drawImage: noop, setTransform: noop,
  };
};
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? { width: 1, height: 1, getContext: () => ctx2d(), style: {} } : {}),
  createElementNS: () => ({ style: {} }),
};
globalThis.window = globalThis;
globalThis.self = globalThis;

const THREE = await import('three');
const { Physics, KIND } = await import('./physics.js');
const { buildMaterials } = await import('./materials.js');
const city = await import('./city.js');
const { QUALITY, DEFAULT_SETTINGS } = await import('./settings.js');
const { PedManager } = await import('./peds.js');
const { Traffic } = await import('./traffic.js');
const { Combat } = await import('./combat.js');
const { CameraRig } = await import('./camerarig.js');
const { radarProject } = await import('./minimap.js');
const { fwdX, fwdZ, rgtX, rgtZ } = await import('./mathx.js');
const { createVehicle, placeVehicle, stepVehicle, updateVehicleBox } = await import('./vehicle.js');

let fails = 0;
const ok = (c, m, x = '') => { if (c) console.log(`  ok   ${m}`); else { console.log(`  FAIL ${m} ${x}`); fails++; } };
const DT = 1 / 60;

/* -- handedness -------------------------------------------------------------
   three.js's own camera matrix is the oracle here: whatever the maths says,
   "right" must be whatever appears on the right of the screen.               */
console.log('\nhandedness (D must strafe right)');
{
  const settings = { ...DEFAULT_SETTINGS };
  const phys = new Physics();
  phys.addBox(-400, -400, 400, 400, 0, 0.0001, KIND.Ground);
  phys.build();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);

  for (const yaw of [0, 0.9, -2.4, 3.05]) {
    const rig = new CameraRig();
    rig.reset(yaw, 0, 0, 0);
    rig.yaw = yaw;
    for (let i = 0; i < 90; i++) rig.updateOnFoot(cam, DT, 0, 0, 0, false, 1, phys, settings);
    cam.updateMatrixWorld(true);

    const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
    const camFwd = new THREE.Vector3();
    cam.getWorldDirection(camFwd);
    camFwd.setY(0).normalize();

    const strafe = new THREE.Vector3(rig.rightX(), 0, rig.rightZ());
    const ahead = new THREE.Vector3(rig.forwardX(), 0, rig.forwardZ());
    ok(strafe.dot(camRight) > 0.99, `yaw ${yaw.toFixed(2)}: D strafes towards screen-right`, `dot=${strafe.dot(camRight).toFixed(3)}`);
    ok(ahead.dot(camFwd) > 0.99, `yaw ${yaw.toFixed(2)}: W walks towards screen-up`, `dot=${ahead.dot(camFwd).toFixed(3)}`);
  }

  // dragging the mouse right must swing the view towards what was screen-right
  const rig = new CameraRig();
  rig.yaw = 0.4;
  const before = new THREE.Vector3(rig.rightX(), 0, rig.rightZ());
  rig.applyMouse(300, 0, { ...DEFAULT_SETTINGS }, false);
  const after = new THREE.Vector3(rig.forwardX(), 0, rig.forwardZ());
  ok(after.dot(before) > 0.05, 'mouse right turns the view right', `dot=${after.dot(before).toFixed(3)}`);

  // the radar must not be mirrored
  const yaw = 1.1;
  const [rxp, ryp] = radarProject(40 + rgtX(yaw) * 20, 40 + rgtZ(yaw) * 20, 40, 40, yaw, 1.5, 100);
  const [axp, ayp] = radarProject(40 + fwdX(yaw) * 20, 40 + fwdZ(yaw) * 20, 40, 40, yaw, 1.5, 100);
  ok(rxp > 110 && Math.abs(ryp - 100) < 1, 'radar puts things on your right on the right');
  ok(ayp < 90 && Math.abs(axp - 100) < 1, 'radar puts things ahead of you at the top');
}

/* -- vehicle handling ----------------------------------------------------- */
console.log('\nvehicle handling');
{
  const p = new Physics();
  p.addBox(-200, -200, 200, 200, 0, 0.0001, KIND.Ground);
  p.addBox(-6, 40, 6, 46, 0, 4, KIND.Building);        // wall 40m ahead
  p.build();

  const v = createVehicle('sedan', 0xff0000);
  placeVehicle(v, 0, 0, 0);
  updateVehicleBox(v);

  // full lock, no throttle: a real car cannot pivot on the spot
  v.ctrl = { throttle: 0, brake: 0, steer: 1, handbrake: false };
  for (let i = 0; i < 120; i++) stepVehicle(v, DT, p);
  ok(Math.abs(v.yaw) < 0.01, 'cannot turn while stationary', `yaw=${v.yaw.toFixed(4)}`);

  // accelerate straight (reset: wheels legitimately stay turned after standstill steering)
  placeVehicle(v, 0, 0, 0);
  v.steerAngle = 0;
  v.ctrl = { throttle: 1, brake: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 120; i++) stepVehicle(v, DT, p);
  ok(v.speed > 8, `accelerates to ${(v.speed * 3.6).toFixed(0)} km/h in 2s`);
  ok(v.z > 8 && Math.abs(v.x) < 0.2, 'drives straight along its own forward axis', `x=${v.x.toFixed(2)} z=${v.z.toFixed(2)}`);

  // steer +1 must move the car towards its own right-hand side, and yaw must DECREASE
  const x0 = v.x, z0 = v.z, yaw0 = v.yaw;
  const right0 = { x: rgtX(yaw0), z: rgtZ(yaw0) };
  v.ctrl.steer = 1;
  for (let i = 0; i < 45; i++) stepVehicle(v, DT, p);
  const drift = (v.x - x0) * right0.x + (v.z - z0) * right0.z;
  ok(drift > 0.5, 'steer +1 (the D key) turns the car right', `sideways travel=${drift.toFixed(2)}m`);
  ok(v.yaw < yaw0, 'a right turn decreases yaw', `dyaw=${(v.yaw - yaw0).toFixed(3)}`);

  // drive into the wall: must not pass through
  const v2 = createVehicle('sports', 0x00ff00);
  placeVehicle(v2, 0, 0, 0);
  v2.ctrl = { throttle: 1, brake: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 60 * 8; i++) stepVehicle(v2, DT, p);
  ok(v2.z < 40, `stopped by the wall at z=${v2.z.toFixed(2)} (wall face is 40)`);
  ok(v2.health < 100, `took crash damage (${Math.round(v2.health)} hp)`);

  // handbrake slide keeps momentum sideways
  const v3 = createVehicle('sedan', 0x0000ff);
  placeVehicle(v3, 0, -100, 0);
  v3.ctrl = { throttle: 1, brake: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 200; i++) stepVehicle(v3, DT, p);
  v3.ctrl = { throttle: 0, brake: 0, steer: 1, handbrake: true };
  for (let i = 0; i < 40; i++) stepVehicle(v3, DT, p);
  const lateral = Math.abs(v3.vx * rgtX(v3.yaw) + v3.vz * rgtZ(v3.yaw));
  ok(lateral > 0.4, `handbrake produces a real slide (${lateral.toFixed(2)} m/s lateral)`);
}

/* -- city sim: traffic + pedestrians ------------------------------------- */
console.log('\ncity simulation (60s of game time)');
const phys = new Physics();
const scene = new THREE.Scene();
const mats = buildMaterials();
const C = city.buildCity(scene, phys, mats, QUALITY.medium, 20260805);

const HR = city.ROADW / 2;
const strips = [];
for (let i = 0; i < city.N; i++) {
  const x = city.roadCoord(i);
  strips.push({ minX: x - HR, maxX: x + HR, minZ: city.roadCoord(0) - HR, maxZ: city.roadCoord(city.N - 1) + HR });
  strips.push({ minZ: x - HR, maxZ: x + HR, minX: city.roadCoord(0) - HR, maxX: city.roadCoord(city.N - 1) + HR });
}
const onRoad = (x, z) => strips.some((s) => x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ);
const solids = phys.boxes.filter((b) => b.kind === KIND.Building);
const insideBuilding = (x, z) => solids.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);

const peds = new PedManager(scene, phys, C);
peds.populate(16);
const traffic = new Traffic(scene, C, phys);
traffic.spawn(12);
traffic.spawnParked(8);
const combat = new Combat(scene, phys, 12);

let offRoad = 0, samples = 0, pedInBuilding = 0, pedSamples = 0;
const startPos = peds.peds.map((p) => ({ x: p.x, z: p.z }));
const px = C.playerStart.x, pz = C.playerStart.z;

for (let f = 0; f < 60 * 60; f++) {
  phys.dyn.length = 0;
  for (const v of traffic.cars) phys.dyn.push(v.box);
  traffic.update(DT, f * DT, null, px, pz, null);
  peds.update(DT, f * DT, px, 0.16, pz, true, 0, () => {}, 400);
  combat.update(DT);
  if (f % 30 === 0) {
    for (const v of traffic.cars) {
      if (!v.ai) continue;               // parked cars are meant to be off-road
      samples++;
      if (!onRoad(v.x, v.z)) offRoad++;
    }
    for (const p of peds.peds) {
      pedSamples++;
      if (insideBuilding(p.x, p.z)) pedInBuilding++;
    }
  }
}

ok(offRoad / samples < 0.06, `traffic stayed on the road ${(100 - (offRoad / samples) * 100).toFixed(1)}% of samples`);
ok(pedInBuilding === 0, 'no pedestrian ever ended up inside a building', `${pedInBuilding}/${pedSamples}`);
const moved = peds.peds.filter((p, i) => Math.hypot(p.x - startPos[i].x, p.z - startPos[i].z) > 4).length;
ok(moved >= peds.peds.length * 0.7, `${moved}/${peds.peds.length} pedestrians actually walked their route`);
const movedCars = traffic.cars.filter((v) => v.ai && Math.abs(v.speed) > 1).length;
ok(movedCars >= 8, `${movedCars}/12 traffic cars are still driving after a minute`);
ok(traffic.cars.every((v) => Number.isFinite(v.x) && Number.isFinite(v.yaw)), 'no NaN leaked into vehicle state');
ok(peds.peds.every((p) => Number.isFinite(p.x) && Number.isFinite(p.yaw)), 'no NaN leaked into pedestrian state');

/* -- driving on the left ------------------------------------------------- */
{
  // Sample cars travelling along a road and check which side of the centre line they use.
  let correctSide = 0, checked = 0;
  for (const v of traffic.cars) {
    if (!v.ai || Math.abs(v.speed) < 2) continue;
    // nearest road centre line on each axis
    let best = null, bd = 1e9;
    for (let i = 0; i < city.N; i++) {
      const cx = city.roadCoord(i);
      if (Math.abs(v.x - cx) < bd) { bd = Math.abs(v.x - cx); best = { axis: 'x', c: cx }; }
      const cz = city.roadCoord(i);
      if (Math.abs(v.z - cz) < bd) { bd = Math.abs(v.z - cz); best = { axis: 'z', c: cz }; }
    }
    if (!best || bd > HR) continue;
    checked++;
    // offset from the centre line, projected onto the car's own right
    const offX = best.axis === 'x' ? v.x - best.c : 0;
    const offZ = best.axis === 'z' ? v.z - best.c : 0;
    const onRight = offX * rgtX(v.yaw) + offZ * rgtZ(v.yaw);
    if (onRight < 0) correctSide++;   // left-hand traffic sits left of the centre line
  }
  ok(checked > 4 && correctSide / checked > 0.8,
    `${correctSide}/${checked} moving cars are keeping left (Pakistan)`);
}

/* -- shooting ------------------------------------------------------------ */
console.log('\ncombat');
{
  const target = peds.peds[0];
  target.x = px + 6; target.z = pz; target.y = 0.16; target.state = 'walk'; target.health = 100;
  const head = combat.raycast(px, 0.16 + 1.64, pz, 1, 0, 0, 60, peds.peds, null, null);
  ok(head.kind === 'ped' && head.ped === target && head.head, 'a level shot at head height is a headshot');
  const body = combat.raycast(px, 0.16 + 1.15, pz, 1, 0, 0, 60, peds.peds, null, null);
  ok(body.kind === 'ped' && !body.head, 'a shot at chest height is a body hit');
  const over = combat.raycast(px, 0.16 + 2.6, pz, 1, 0, 0, 60, peds.peds, null, null);
  ok(over.kind !== 'ped', 'a shot over their head misses the pedestrian');

  const died = peds.damage(target, 500, px, pz);
  ok(died && target.state === 'dead', 'lethal damage kills instead of scaring');
  for (let i = 0; i < 90; i++) peds.update(DT, i * DT, px, 0.16, pz, true, 0, () => {}, 400);
  ok(target.deadT >= 1, 'the corpse finishes its collapse animation');
  ok(Math.abs(target.h.tilt.rotation.x) > 1.2, 'the body ends up flat on the ground', `x=${target.h.tilt.rotation.x.toFixed(2)}`);

  const alive = peds.peds.find((q) => q.state !== 'dead');
  peds.panic(alive.x, alive.z, 40, 5);
  const fleeing = peds.peds.filter((p) => p.state === 'flee').length;
  ok(fleeing > 3, `${fleeing} bystanders panicked at the gunfire`);
}

/* -- police -------------------------------------------------------------- */
console.log('\npolice');
{
  const rx = city.roadCoord(2), rz = city.blockCentre(2);
  const cop = peds.spawnPed(true, rx, rz + 16);
  cop.y = 0;
  let shots = 0;
  for (let i = 0; i < 60 * 6; i++) {
    peds.update(DT, i * DT, rx, 0, rz, true, 3, () => { shots++; }, 400);
  }
  ok(Math.hypot(cop.x - rx, cop.z - rz) < 14, `the cop closed in (now ${Math.hypot(cop.x - rx, cop.z - rz).toFixed(1)}m away)`);
  ok(shots > 3, `the cop opened fire ${shots} times in 6s`);
  ok(cop.aiming, 'the cop is holding an aiming pose while shooting');
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}\n`);
process.exit(fails ? 1 : 0);
