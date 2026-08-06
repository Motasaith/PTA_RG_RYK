import * as THREE from 'three';
import { City, laneOffsetFor, LEFT_HAND_TRAFFIC, RoadNode } from './layout';
import { clamp, dist2, mulberry32, pick, Rng, wrapPi } from './mathx';
import { Physics } from './physics';
import {
  CAR_COLOURS, createVehicle, placeVehicle, stepVehicle, updateVehicleBox, updateSiren, Vehicle, VehKind,
} from './vehicle';

interface Lane {
  from: RoadNode;
  to: RoadNode;
  next: RoadNode;
  /** metres travelled along the current edge */
  s: number;
  stuck: number;
}

const CIVILIAN: VehKind[] = ['sedan', 'hatch', 'suv', 'van', 'sports', 'rickshaw', 'sedan', 'hatch'];

/**
 * Traffic drives the *same* physics as the player: an AI controller writes throttle/brake/
 * steer and stepVehicle does the rest. That means AI cars understeer, get shunted, and can
 * be pushed off the road — but they always try to get back into their lane.
 */
export class Traffic {
  cars: Vehicle[] = [];
  private lanes = new Map<Vehicle, Lane>();
  private rng: Rng = mulberry32(90210);
  private tmp = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private city: City,
    private phys: Physics,
  ) {}

  private lanePoint(from: RoadNode, to: RoadNode, s: number, out: THREE.Vector3): THREE.Vector3 {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // right of travel = forward × up = (−uz, ux). Pakistan drives on the left, so we sit
    // on the opposite side of the centre line. The offset scales with the carriageway so
    // cars keep left on a 30ft scheme street as well as on a city arterial.
    const off = (LEFT_HAND_TRAFFIC ? -1 : 1) * laneOffsetFor(from, to);
    const t = clamp(s, 0, len);
    return out.set(from.x + ux * t + -uz * off, 0, from.z + uz * t + ux * off);
  }

  private edgeLen(l: Lane): number {
    return Math.hypot(l.to.x - l.from.x, l.to.z - l.from.z);
  }

  /**
   * Pick the next edge out of a junction, preferring to carry straight on. This is
   * geometric rather than grid-index based, so it works for the housing scheme's
   * irregular streets as well as the city grid.
   */
  private chooseNext(from: RoadNode, to: RoadNode): RoadNode {
    const options = to.nb.filter((n) => n !== from);
    if (!options.length) return from;
    const ix = to.x - from.x, iz = to.z - from.z;
    const il = Math.hypot(ix, iz) || 1;
    let straight: RoadNode | null = null, best = 0.7;   // ≈45° cone
    for (const n of options) {
      const ox = n.x - to.x, oz = n.z - to.z;
      const ol = Math.hypot(ox, oz) || 1;
      const dot = (ix * ox + iz * oz) / (il * ol);
      if (dot > best) { best = dot; straight = n; }
    }
    if (straight && this.rng() < 0.62) return straight;
    return pick(this.rng, options);
  }

  spawn(count: number): void {
    const n = this.city.nodes;
    for (let i = 0; i < count; i++) {
      const from = pick(this.rng, n);
      if (!from.nb.length) continue;
      const to = pick(this.rng, from.nb);
      const v = createVehicle(pick(this.rng, CIVILIAN), pick(this.rng, CAR_COLOURS));
      this.scene.add(v.group);
      const s = this.rng() * this.edgeLenRaw(from, to);
      this.lanePoint(from, to, s, this.tmp);
      placeVehicle(v, this.tmp.x, this.tmp.z, Math.atan2(to.x - from.x, to.z - from.z));
      v.ai = { from: 0, to: 0, t: 0, wait: 0, chase: false };
      this.lanes.set(v, { from, to, next: this.chooseNext(from, to), s, stuck: 0 });
      this.cars.push(v);
    }
  }

  private edgeLenRaw(a: RoadNode, b: RoadNode): number {
    return Math.hypot(b.x - a.x, b.z - a.z);
  }

  /** Parked, unlocked cars scattered in driveways and car parks. */
  spawnParked(count: number): Vehicle[] {
    const out: Vehicle[] = [];
    const spots = this.city.parkSpots.slice();
    for (let i = 0; i < count && spots.length; i++) {
      const idx = Math.floor(this.rng() * spots.length);
      const spot = spots.splice(idx, 1)[0];
      const v = createVehicle(pick(this.rng, CIVILIAN), pick(this.rng, CAR_COLOURS));
      this.scene.add(v.group);
      placeVehicle(v, spot.x, spot.z, spot.yaw);
      updateVehicleBox(v);
      this.cars.push(v);
      out.push(v);
    }
    return out;
  }

  spawnPolice(x: number, z: number, yaw: number): Vehicle {
    const v = createVehicle('police', 0x1b3f7a);
    this.scene.add(v.group);
    placeVehicle(v, x, z, yaw);
    v.siren = true;
    v.ai = { from: 0, to: 0, t: 0, wait: 0, chase: true };
    updateVehicleBox(v);
    this.cars.push(v);
    return v;
  }

  /** Hand a traffic car over to the player. */
  release(v: Vehicle): void {
    this.lanes.delete(v);
    v.ai = null;
  }

  remove(v: Vehicle): void {
    this.lanes.delete(v);
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    v.group.removeFromParent();
  }

  update(
    dt: number, t: number,
    playerVeh: Vehicle | null,
    px: number, pz: number,
    chase: { x: number; z: number } | null,
  ): void {
    for (const v of this.cars) {
      updateSiren(v, t);
      if (v.isPlayer) continue;

      const lane = this.lanes.get(v);
      if (v.ai?.chase && chase) {
        this.drivePursuit(v, chase.x, chase.z, dt);
      } else if (lane) {
        this.driveLane(v, lane, dt, px, pz, playerVeh);
      } else {
        // parked: brake and stay put
        v.ctrl.throttle = 0;
        v.ctrl.brake = 1;
        v.ctrl.steer = 0;
        v.ctrl.handbrake = true;
      }
      stepVehicle(v, dt, this.phys);
    }
  }

  private drivePursuit(v: Vehicle, tx: number, tz: number, dt: number): void {
    const dx = tx - v.x, dz = tz - v.z;
    const d = Math.hypot(dx, dz);
    // +err means the target is to the left (yaw must increase), so steer negative
    const err = wrapPi(Math.atan2(dx, dz) - v.yaw);
    v.ctrl.steer = clamp(-err * 1.9, -1, 1);
    const want = d > 22 ? 26 : d > 10 ? 15 : 4;
    const over = v.speed > want;
    v.ctrl.throttle = over ? 0 : 1;
    v.ctrl.brake = over ? clamp((v.speed - want) * 0.25, 0, 1) : 0;
    v.ctrl.handbrake = Math.abs(err) > 1.9 && v.speed > 9;
    void dt;
  }

  private driveLane(v: Vehicle, lane: Lane, dt: number, px: number, pz: number, playerVeh: Vehicle | null): void {
    const len = this.edgeLen(lane);
    // advance our position along the edge by the distance actually travelled
    const ahead = 7 + Math.abs(v.speed) * 0.55;
    let target: THREE.Vector3;
    if (lane.s + ahead <= len) {
      target = this.lanePoint(lane.from, lane.to, lane.s + ahead, this.tmp);
    } else {
      target = this.lanePoint(lane.to, lane.next, lane.s + ahead - len, this.tmp);
    }
    const dx = target.x - v.x, dz = target.z - v.z;
    const err = wrapPi(Math.atan2(dx, dz) - v.yaw);
    v.ctrl.steer = clamp(-err * 1.7, -1, 1);

    // progress: project our movement onto the edge direction
    const edx = (lane.to.x - lane.from.x) / (len || 1), edz = (lane.to.z - lane.from.z) / (len || 1);
    lane.s += (v.vx * edx + v.vz * edz) * dt;
    if (lane.s >= len - 1.5) {
      lane.s -= len;
      lane.from = lane.to;
      lane.to = lane.next;
      lane.next = this.chooseNext(lane.from, lane.to);
      if (lane.s < 0) lane.s = 0;
    }

    // How long have we been stationary? Counted regardless of *why*, otherwise a car that
    // yields to a queue never registers as stuck and the whole junction deadlocks.
    if (Math.abs(v.speed) < 0.35) lane.stuck += dt;
    else lane.stuck = 0;
    const jammed = lane.stuck > 5;

    // speed target: slow for corners, stop for obstacles
    let want = 13.5 - Math.abs(err) * 7;
    if (!jammed) {
      if (this.blocked(v, playerVeh)) want = 0;
      // don't mow down the player standing on the kerb
      if (dist2(v.x, v.z, px, pz) < 42 && this.aheadOf(v, px, pz, 0.75)) want = 0;
    } else {
      want = Math.min(want, 4);   // nudge through the jam
    }
    want = Math.max(0, want);

    const over = v.speed > want;
    v.ctrl.throttle = over ? 0 : clamp((want - v.speed) * 0.5, 0, 1);
    v.ctrl.brake = over ? clamp((v.speed - want) * 0.4, 0, 1) : 0;
    v.ctrl.handbrake = false;

    // still wedged after twelve seconds → move it somewhere useful
    if (lane.stuck > 12) {
      lane.stuck = 0;
      this.recycle(v, lane, px, pz);
    }
  }

  private aheadOf(v: Vehicle, x: number, z: number, minDot: number): boolean {
    const dx = x - v.x, dz = z - v.z;
    const l = Math.hypot(dx, dz) || 1;
    return (dx / l) * Math.sin(v.yaw) + (dz / l) * Math.cos(v.yaw) > minDot;
  }

  private blocked(v: Vehicle, playerVeh: Vehicle | null): boolean {
    for (const o of this.cars) {
      if (o === v) continue;
      const d2 = dist2(v.x, v.z, o.x, o.z);
      if (d2 > 13 * 13) continue;
      if (this.aheadOf(v, o.x, o.z, 0.82)) return true;
    }
    if (playerVeh && playerVeh !== v) {
      if (dist2(v.x, v.z, playerVeh.x, playerVeh.z) < 13 * 13 && this.aheadOf(v, playerVeh.x, playerVeh.z, 0.82)) return true;
    }
    return false;
  }

  /**
   * Put a car back into the flow somewhere the player will actually see it: out of the
   * current view but close enough that the streets never look deserted.
   */
  private recycle(v: Vehicle, lane: Lane, px: number, pz: number): void {
    const n = this.city.nodes;
    for (let i = 0; i < 40; i++) {
      const from = pick(this.rng, n);
      if (!from.nb.length) continue;
      const to = pick(this.rng, from.nb);
      const s = this.rng() * this.edgeLenRaw(from, to);
      this.lanePoint(from, to, s, this.tmp);
      const d2 = dist2(this.tmp.x, this.tmp.z, px, pz);
      if (d2 < 55 * 55 || d2 > 190 * 190) continue;
      lane.from = from; lane.to = to; lane.next = this.chooseNext(from, to); lane.s = s;
      placeVehicle(v, this.tmp.x, this.tmp.z, Math.atan2(to.x - from.x, to.z - from.z));
      v.health = 100;
      return;
    }
  }

  /** Traffic streaming: pull far-away cars back towards the player. */
  streamTo(px: number, pz: number, keepWithin = 230): void {
    for (const [v, lane] of this.lanes) {
      if (v.isPlayer) continue;
      if (dist2(v.x, v.z, px, pz) <= keepWithin * keepWithin) continue;
      this.recycle(v, lane, px, pz);
    }
  }

  nearest(x: number, z: number, maxDist: number, skip?: Vehicle): Vehicle | null {
    let best: Vehicle | null = null, bd = maxDist * maxDist;
    for (const v of this.cars) {
      if (v === skip) continue;
      const d = dist2(v.x, v.z, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  dispose(): void {
    for (const v of this.cars) v.group.removeFromParent();
    this.cars.length = 0;
    this.lanes.clear();
  }
}
