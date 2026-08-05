import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Mats, uvScale, uvScaleBox } from './materials';
import { KIND, Physics } from './physics';
import { Rng } from './mathx';

/**
 * Shared layout toolkit: the geometry batcher, the street furniture and the data types
 * that both the invented city grid (city.ts) and the real Rahim Garden scheme (scheme.ts)
 * are built from.
 */

/** feet → metres. The housing scheme's plan is dimensioned in feet, so we keep it honest. */
export const FT = 0.3048;

export const ROAD_Y = 0.02;
export const PAINT_Y = 0.045;
export const WALK_Y = 0.16;
export const LOT_Y = 0.17;

/** Pakistan drives on the left — flip this for right-hand traffic. */
export const LEFT_HAND_TRAFFIC = true;
/** Default lane offset from a centre line; narrow streets scale this down by width. */
export const LANE_OFF = 4;

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoadNode {
  x: number;
  z: number;
  nb: RoadNode[];
  /** carriageway width of the edge to the matching entry in `nb` */
  nbWidth: number[];
}

export function connect(a: RoadNode, b: RoadNode, width: number): void {
  if (a === b || a.nb.includes(b)) return;
  a.nb.push(b);
  a.nbWidth.push(width);
  b.nb.push(a);
  b.nbWidth.push(width);
}

export function laneOffsetFor(from: RoadNode, to: RoadNode): number {
  const i = from.nb.indexOf(to);
  const w = i >= 0 ? from.nbWidth[i] : 16;
  return Math.min(LANE_OFF, w / 4);
}

export interface Poi {
  name: string;
  x: number;
  z: number;
  kind: 'mosque' | 'market' | 'police' | 'park' | 'plaza' | 'shop' | 'home' | 'gate';
}

export interface Shop {
  x: number;
  z: number;
  yaw: number;
  name: string;
  kind: 'food' | 'ammo' | 'health';
}

export interface MinimapData {
  roads: { x1: number; z1: number; x2: number; z2: number; w: number }[];
  blocks: { x: number; z: number; s: number }[];
  buildings: { x: number; z: number; w: number; d: number }[];
  parks: { x: number; z: number; w: number; d: number }[];
  water: { x: number; z: number; w: number; d: number }[];
  labels: { t: string; x: number; z: number }[];
}

export interface City {
  root: THREE.Group;
  nodes: RoadNode[];
  pedLoops: { x: number; z: number }[][];
  parkSpots: { x: number; z: number; yaw: number }[];
  roadSpawns: { x: number; z: number; yaw: number }[];
  shops: Shop[];
  pois: Poi[];
  minimap: MinimapData;
  itemSpots: { x: number; y: number; z: number }[];
  pickupSpots: { x: number; z: number }[];
  playerStart: { x: number; z: number; yaw: number };
  policeStation: { x: number; z: number };
  hospital: { x: number; z: number };
  bounds: WorldBounds;
  lampGlow: THREE.Points;
  setNight(n: number): void;
  triangles: number;
}

/** Everything the district builders write into. */
export interface Collect {
  minimap: MinimapData;
  pedLoops: { x: number; z: number }[][];
  parkSpots: { x: number; z: number; yaw: number }[];
  roadSpawns: { x: number; z: number; yaw: number }[];
  shops: Shop[];
  pois: Poi[];
  itemSpots: { x: number; y: number; z: number }[];
  pickupSpots: { x: number; z: number }[];
  lampPts: number[];
  signs: THREE.Mesh[];
  nodes: RoadNode[];
}

export function newCollect(): Collect {
  return {
    minimap: { roads: [], blocks: [], buildings: [], parks: [], water: [], labels: [] },
    pedLoops: [], parkSpots: [], roadSpawns: [], shops: [], pois: [],
    itemSpots: [], pickupSpots: [], lampPts: [], signs: [], nodes: [],
  };
}

/* ── geometry batcher ─────────────────────────────────────────────────────── */

export class Builder {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  triangles = 0;

  push(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0): void {
    this.q.setFromEuler(this.e.set(rotX, rotY, rotZ));
    this.m.compose(this.v.set(x, y, z), this.q, this.one);
    geo.applyMatrix4(this.m);
    geo.deleteAttribute('uv1');
    let list = this.groups.get(mat);
    if (!list) this.groups.set(mat, (list = []));
    list.push(geo);
    this.triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  }

  /** Box with world-space-constant texture tiling. */
  box(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, tile = 4): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tile > 0) uvScaleBox(g, w, h, d, tile);
    this.push(mat, g, x, y, z, rotY);
  }

  /** Flat horizontal quad (roads, lot ground, paint). */
  quad(mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, tile = 4, rotY = 0): void {
    const g = new THREE.PlaneGeometry(w, d);
    if (tile > 0) uvScale(g, w / tile, d / tile);
    this.push(mat, g, x, y, z, rotY, -Math.PI / 2);
  }

  cyl(mat: THREE.Material, x: number, y: number, z: number, rt: number, rb: number, h: number, seg = 8, rotX = 0): void {
    this.push(mat, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, 0, rotX);
  }

  /** Half-cylinder cap, used for the rounded ends of the scheme's park. */
  halfCyl(mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, rotY: number, seg = 14): void {
    this.push(mat, new THREE.CylinderGeometry(r, r, h, seg, 1, false, 0, Math.PI), x, y, z, rotY);
  }

  sphere(mat: THREE.Material, x: number, y: number, z: number, r: number, w = 10, h = 7, sy = 1): void {
    const g = new THREE.SphereGeometry(r, w, h);
    if (sy !== 1) g.scale(1, sy, 1);
    this.push(mat, g, x, y, z);
  }

  cone(mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, seg = 8, rotY = 0): void {
    this.push(mat, new THREE.ConeGeometry(r, h, seg), x, y, z, rotY);
  }

  /**
   * Gable roof from two slabs. `w` is the ridge length, `d` the span being sloped.
   * The tilt is applied on the correct world axis instead of composing Euler angles.
   */
  gable(mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, rise: number, slopeAlongX = false): void {
    const slope = Math.atan2(rise, d / 2);
    const len = Math.hypot(d / 2, rise) + 0.25;
    const off = d / 4, cy = rise / 2;
    if (!slopeAlongX) {
      const a = new THREE.BoxGeometry(w + 0.5, 0.16, len);
      uvScaleBox(a, w, 0.16, len, 3);
      const b = a.clone();
      this.push(mat, a, x, y + cy, z + off, 0, slope, 0);
      this.push(mat, b, x, y + cy, z - off, 0, -slope, 0);
    } else {
      const a = new THREE.BoxGeometry(len, 0.16, w + 0.5);
      uvScaleBox(a, len, 0.16, w, 3);
      const b = a.clone();
      this.push(mat, a, x + off, y + cy, z, 0, 0, -slope);
      this.push(mat, b, x - off, y + cy, z, 0, 0, slope);
    }
  }

  finish(root: THREE.Group): void {
    for (const [mat, list] of this.groups) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      list.length = 0;
    }
    this.groups.clear();
  }
}

/* ── street furniture ─────────────────────────────────────────────────────── */

let M: Mats | null = null;

/** Called once before any district is built so prop helpers can stay terse. */
export function bindProps(mats: Mats): void {
  M = mats;
}

export function tree(B: Builder, phys: Physics, rng: Rng, x: number, z: number, s: number, baseY = WALK_Y): void {
  const m = M!;
  const h = 2.4 * s;
  B.cyl(m.trunk, x, baseY + h / 2, z, 0.13 * s, 0.2 * s, h, 7);
  const top = baseY + h;
  B.sphere(m.foliage, x, top + 0.75 * s, z, 1.35 * s, 9, 7, 0.92);
  B.sphere(m.foliage, x + 0.5 * s, top + 1.5 * s, z + 0.3 * s, 0.9 * s, 8, 6, 0.9);
  B.sphere(m.foliage, x - 0.55 * s, top + 1.35 * s, z - 0.4 * s, 0.8 * s, 8, 6, 0.9);
  if (rng() > 0.5) B.sphere(m.foliage, x + 0.1 * s, top + 2.1 * s, z - 0.1 * s, 0.7 * s, 8, 6, 0.9);
  phys.addCentered(x, z, 0.3 * s, 0.3 * s, 0, baseY + h * 0.8, KIND.Prop);
}

export function lamp(
  B: Builder, phys: Physics, x: number, z: number, ax: number, az: number,
  lampPts: number[], baseY = WALK_Y, h = 5.4,
): void {
  const m = M!;
  B.cyl(m.metal, x, baseY + h / 2, z, 0.08, 0.13, h, 6);
  const armX = ax * 0.9, armZ = az * 0.9;
  B.box(m.metal, x + armX / 2, baseY + h, z + armZ / 2, ax ? 0.9 : 0.14, 0.14, az ? 0.9 : 0.14, 0, 2);
  B.box(m.metal, x + armX, baseY + h - 0.16, z + armZ, 0.5, 0.2, 0.34, 0, 2);
  lampPts.push(x + armX, baseY + h - 0.3, z + armZ);
  phys.addCentered(x, z, 0.2, 0.2, 0, baseY + 1.2, KIND.Prop);
}

export function bench(B: Builder, phys: Physics, x: number, z: number, rotY: number, baseY = WALK_Y): void {
  const m = M!;
  B.box(m.wood, x, baseY + 0.45, z, 1.9, 0.1, 0.55, rotY, 2);
  B.box(m.wood, x - Math.sin(rotY) * 0.24, baseY + 0.78, z - Math.cos(rotY) * 0.24, 1.9, 0.55, 0.09, rotY, 2);
  B.box(m.metal, x - Math.cos(rotY) * 0.82, baseY + 0.22, z + Math.sin(rotY) * 0.82, 0.1, 0.44, 0.5, rotY, 2);
  B.box(m.metal, x + Math.cos(rotY) * 0.82, baseY + 0.22, z - Math.sin(rotY) * 0.82, 0.1, 0.44, 0.5, rotY, 2);
  phys.addCentered(x, z, 1, 0.4, 0, baseY + 0.5, KIND.Prop);
}

export function cart(B: Builder, phys: Physics, x: number, z: number, yaw: number): void {
  const m = M!;
  B.box(m.wood, x, LOT_Y + 0.78, z, 1.5, 0.7, 0.85, yaw, 2);
  B.cyl(m.metal, x - 0.6, LOT_Y + 0.3, z + 0.5, 0.3, 0.3, 0.08, 10, Math.PI / 2);
  B.cyl(m.metal, x + 0.6, LOT_Y + 0.3, z + 0.5, 0.3, 0.3, 0.08, 10, Math.PI / 2);
  B.cyl(m.metal, x, LOT_Y + 1.7, z, 0.04, 0.04, 1.8, 5);
  B.cone(m.roof, x, LOT_Y + 2.45, z, 1.25, 0.5, 8, yaw);
  for (let i = 0; i < 8; i++) {
    B.sphere(m.foliage, x - 0.5 + (i % 4) * 0.33, LOT_Y + 1.2, z + (i < 4 ? -0.18 : 0.18), 0.11, 7, 5);
  }
  phys.addCentered(x, z, 0.85, 0.6, 0, LOT_Y + 1.1, KIND.Prop);
}

/* ── plot number plates ───────────────────────────────────────────────────── */

let plateMat: THREE.MeshBasicMaterial | null = null;

/**
 * One 16×16 atlas holds plot numbers 0–255, so every gate plate in the scheme merges into
 * a single draw call instead of needing its own texture.
 */
function plateMaterial(): THREE.MeshBasicMaterial {
  if (plateMat) return plateMat;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  const cell = 64;
  g.fillStyle = '#14335e';
  g.fillRect(0, 0, 1024, 1024);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 256; i++) {
    const cx = (i % 16) * cell, cy = Math.floor(i / 16) * cell;
    g.fillStyle = '#eef3f8';
    g.fillRect(cx + 4, cy + 4, cell - 8, cell - 8);
    g.fillStyle = '#14335e';
    g.font = `bold ${i > 99 ? 30 : 38}px "Trebuchet MS", system-ui, sans-serif`;
    g.fillText(String(i), cx + cell / 2, cy + cell / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  plateMat = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
  return plateMat;
}

export function numberPlate(B: Builder, n: number, x: number, y: number, z: number, rotY: number, size = 0.34): void {
  const g = new THREE.PlaneGeometry(size, size);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const idx = ((n % 256) + 256) % 256;
  const col = idx % 16, row = Math.floor(idx / 16);
  for (let i = 0; i < uv.count; i++) {
    // canvas row 0 is the top; three flips Y, so v runs from (15−row)/16 upwards
    uv.setXY(i, (col + uv.getX(i)) / 16, (15 - row + uv.getY(i)) / 16);
  }
  uv.needsUpdate = true;
  B.push(plateMaterial(), g, x, y, z, rotY);
}
