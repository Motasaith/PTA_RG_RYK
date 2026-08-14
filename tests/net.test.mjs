/* Wire protocol + interpolation. These run in plain Node — no server, no sockets. */

const { installCanvasStub } = await import('./stub-canvas.mjs');
installCanvasStub();

const P = await import('./protocol.js');
const { InterpBuffer } = await import('./netclient.js');

let fails = 0;
const ok = (c, m, x = '') => { if (c) console.log(`  ok   ${m}`); else { console.log(`  FAIL ${m} ${x}`); fails++; } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* -- round trips ---------------------------------------------------------- */
console.log(`
protocol round trips`);
{
  const hello = P.decodeHello(P.encodeHello('Saith'));
  ok(hello && hello.name === 'Saith' && hello.version === P.PROTOCOL_VERSION, 'hello survives a round trip');

  const long = 'x'.repeat(200);
  ok(P.decodeHello(P.encodeHello(long)).name.length === 24, 'an over-long name is truncated on the wire');

  const st = { x: -123.456, y: 12.34, z: 501.02, yaw: 2.1, flags: P.F_SPRINT | P.F_GROUNDED, speed: 6.1, weapon: 2 };
  const back = P.decodeState(P.encodeState(7, st));
  ok(back && back.seq === 7, 'state carries its sequence number');
  ok(near(back.state.x, st.x, 0.01) && near(back.state.y, st.y, 0.01) && near(back.state.z, st.z, 0.01),
    'position survives quantisation to within 1cm',
    `${back.state.x.toFixed(3)} ${back.state.y.toFixed(3)} ${back.state.z.toFixed(3)}`);
  ok(near(back.state.yaw, st.yaw, 0.001), 'yaw survives to within 0.001 rad');
  ok(back.state.flags === st.flags && back.state.weapon === 2, 'flags and weapon are exact');
  ok(near(back.state.speed, 6.1, 0.05), 'speed survives to 0.1 m/s');

  const snap = P.decodeSnapshot(P.encodeSnapshot(99, [
    { id: 3, ...st }, { id: 5, x: 1, y: 2, z: 3, yaw: -3.1, flags: 0, speed: 0, weapon: 0 },
  ]));
  ok(snap && snap.tick === 99 && snap.states.length === 2, 'snapshot carries tick and every player');
  ok(snap.states[0].id === 3 && snap.states[1].id === 5, 'player ids are preserved');

  const w = P.decodeWelcome(P.encodeWelcome(4, [{ id: 1, name: 'Abdul' }, { id: 2, name: 'Bina' }]));
  ok(w && w.yourId === 4 && w.peers.length === 2 && w.peers[1].name === 'Bina', 'welcome lists the existing peers');
  ok(P.decodeJoin(P.encodeJoin({ id: 6, name: 'Rauf' })).name === 'Rauf', 'join round trip');
  ok(P.decodeLeave(P.encodeLeave(6)) === 6, 'leave round trip');
  ok(P.decodeReject(P.encodeReject(P.REJECT_FULL)) === P.REJECT_FULL, 'reject round trip');
}

/* -- bandwidth ------------------------------------------------------------ */
console.log(`
bandwidth budget`);
{
  const one = P.encodeState(1, { x: 1, y: 1, z: 1, yaw: 1, flags: 0, speed: 1, weapon: 0 });
  ok(one.byteLength <= 16, `a client state frame is ${one.byteLength} bytes`);
  const full = P.encodeSnapshot(1, Array.from({ length: P.MAX_PLAYERS }, (_, i) => (
    { id: i + 1, x: i, y: 0, z: i, yaw: 0, flags: 0, speed: 3, weapon: 1 }
  )));
  ok(full.byteLength < 128, `a full ${P.MAX_PLAYERS}-player snapshot is ${full.byteLength} bytes`);
  const perSec = one.byteLength * P.SEND_HZ;
  ok(perSec < 400, `each client uploads ~${perSec} B/s`);
}

/* -- hostile input -------------------------------------------------------- */
console.log(`
malformed frames must not throw`);
{
  const cases = [
    new ArrayBuffer(0), new ArrayBuffer(1), new ArrayBuffer(3),
    P.encodeState(1, { x: 0, y: 0, z: 0, yaw: 0, flags: 0, speed: 0, weapon: 0 }).slice(0, 5),
    P.encodeSnapshot(1, [{ id: 1, x: 0, y: 0, z: 0, yaw: 0, flags: 0, speed: 0, weapon: 0 }]).slice(0, 8),
    P.encodeWelcome(1, [{ id: 2, name: 'truncated' }]).slice(0, 6),
  ];
  let threw = false;
  for (const buf of cases) {
    for (const fn of [P.decodeHello, P.decodeState, P.decodeSnapshot, P.decodeWelcome, P.decodeJoin, P.decodeLeave, P.decodeReject]) {
      try { fn(buf); } catch { threw = true; }
    }
  }
  ok(!threw, 'every decoder returns null on truncated input instead of throwing');

  // a claimed player count larger than the frame must be rejected, not read past the end
  const lying = P.encodeSnapshot(1, [{ id: 1, x: 0, y: 0, z: 0, yaw: 0, flags: 0, speed: 0, weapon: 0 }]);
  new DataView(lying).setUint8(5, 40);
  ok(P.decodeSnapshot(lying) === null, 'a snapshot claiming more players than it contains is rejected');

  // NaN and Infinity must never reach the wire
  const bad = P.decodeState(P.encodeState(1, { x: NaN, y: Infinity, z: -Infinity, yaw: NaN, flags: 0, speed: NaN, weapon: 0 }));
  ok(Number.isFinite(bad.state.x) && Number.isFinite(bad.state.y) && Number.isFinite(bad.state.yaw),
    'NaN and Infinity are sanitised to finite values');

  // a yaw that has drifted far outside −π…π must still decode sanely
  const spun = P.decodeState(P.encodeState(1, { x: 0, y: 0, z: 0, yaw: 400.5, flags: 0, speed: 0, weapon: 0 }));
  ok(Math.abs(spun.state.yaw) <= Math.PI + 0.01, `a drifting yaw wraps instead of overflowing (${spun.state.yaw.toFixed(2)})`);
}

/* -- room codes ----------------------------------------------------------- */
console.log(`
room codes`);
{
  let rngState = 12345;
  const rand = () => ((rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const codes = new Set();
  for (let i = 0; i < 400; i++) codes.add(P.makeRoomCode(rand));
  ok(codes.size > 390, `${codes.size}/400 generated codes were unique`);
  for (const c of codes) {
    if (c.length !== 5 || /[O0I1L]/.test(c)) { ok(false, 'codes avoid ambiguous characters', c); break; }
  }
  ok(true, 'codes are 5 chars and avoid O/0 and I/1/L');
  ok(P.normaliseRoomCode(' abc23 ') === 'ABC23', 'user input is trimmed and upper-cased');
  ok(P.normaliseRoomCode('ab-c23') === 'ABC23', 'punctuation is stripped');
  ok(P.normaliseRoomCode('ABC2') === '', 'a short code is rejected');
  ok(P.normaliseRoomCode('ABC2O') === '', 'a code with an ambiguous character is rejected');
}

/* -- interpolation -------------------------------------------------------- */
console.log(`
interpolation (remote players must move smoothly)`);
{
  const mk = (x, yaw = 0) => ({ id: 1, x, y: 0, z: 0, yaw, flags: 0, speed: 4, weapon: 0 });
  const b = new InterpBuffer();

  ok(b.sample(1000) === null, 'an empty buffer samples to null');

  // snapshots at 0, 50, 100 ms — a player walking +1 m per 50 ms
  b.push(mk(0), 1000);
  b.push(mk(1), 1050);
  b.push(mk(2), 1100);

  // render time = now − INTERP_DELAY_MS, so at now=1160 we want t=1050 exactly
  const at = b.sample(1050 + P.INTERP_DELAY_MS);
  ok(near(at.x, 1, 0.001), `samples exactly on a snapshot boundary (${at.x.toFixed(3)})`);

  const mid = b.sample(1075 + P.INTERP_DELAY_MS);
  ok(near(mid.x, 1.5, 0.001), `interpolates halfway between two snapshots (${mid.x.toFixed(3)})`);

  // beyond the newest sample it must hold, not extrapolate off into the distance
  const future = b.sample(3000 + P.INTERP_DELAY_MS);
  ok(near(future.x, 2, 0.001), `holds the last pose instead of extrapolating (${future.x.toFixed(3)})`);

  // yaw must take the short way round when crossing ±π
  const y = new InterpBuffer();
  y.push(mk(0, Math.PI - 0.1), 2000);
  y.push(mk(0, -Math.PI + 0.1), 2100);
  const half = y.sample(2050 + P.INTERP_DELAY_MS);
  ok(Math.abs(half.yaw) > Math.PI - 0.15,
    `yaw crossing ±π interpolates the short way (${half.yaw.toFixed(2)})`);

  // out-of-order arrivals are dropped rather than jerking the player backwards
  const o = new InterpBuffer();
  o.push(mk(0), 3000);
  o.push(mk(5), 3100);
  o.push(mk(99), 3050);
  ok(o.latest().x === 5, 'a late-arriving stale frame is ignored');

  // history is bounded, so a long session cannot grow the buffer forever
  const g = new InterpBuffer();
  for (let i = 0; i < 500; i++) g.push(mk(i), 5000 + i * 50);
  ok(g.length <= 40, `buffer stays bounded (${g.length} samples after 500 pushes)`);
}

console.log(`
${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}
`);
process.exit(fails ? 1 : 0);
