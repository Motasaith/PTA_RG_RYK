/** Small math helpers. Kept allocation-free — these run thousands of times per frame. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential approach. `rate` is roughly "units of catch-up per second". */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-rate * dt));
}

/** Wrap an angle into (-PI, PI]. */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest-path angular damping — never spins the long way round. */
export function angleDamp(a: number, b: number, rate: number, dt: number): number {
  return a + wrapPi(b - a) * (1 - Math.exp(-rate * dt));
}

export function moveTowards(a: number, b: number, maxDelta: number): number {
  const d = b - a;
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * THE handedness convention. Everything — camera, player, cars, radar — uses these.
 *
 *   forward = (sin yaw, 0, cos yaw)
 *   right   = forward × up = (−cos yaw, 0, sin yaw)      ← screen-right
 *
 * The cross-product order is the whole ball game. A three.js camera looks down its local
 * −Z, so a camera whose view direction is +Z has world −X on the right of the screen.
 * Using `up × forward` instead gives screen-LEFT, which makes D strafe left, mouse-right
 * turn the view left, and steer-right turn the car left.
 *
 * Consequence to remember: turning right *decreases* yaw.
 */
export const fwdX = (yaw: number): number => Math.sin(yaw);
export const fwdZ = (yaw: number): number => Math.cos(yaw);
export const rgtX = (yaw: number): number => -Math.cos(yaw);
export const rgtZ = (yaw: number): number => Math.sin(yaw);

export type Rng = () => number;

/** Deterministic PRNG — the whole city is generated from one seed so layouts are reproducible. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rr(rng: Rng, a: number, b: number): number {
  return a + rng() * (b - a);
}

export function ri(rng: Rng, a: number, b: number): number {
  return Math.floor(a + rng() * (b - a + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
