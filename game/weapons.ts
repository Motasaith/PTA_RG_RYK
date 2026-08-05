import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  melee: boolean;
  damage: number;
  headMult: number;
  /** rounds per minute */
  rpm: number;
  auto: boolean;
  mag: number;
  reserveMax: number;
  pellets: number;
  /** cone half-angle in radians at full spread */
  spread: number;
  range: number;
  reload: number;
  recoilPitch: number;
  recoilYaw: number;
  /** camera kick + shake */
  shake: number;
  zoom: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  fists: {
    id: 'fists', name: 'FISTS', melee: true, damage: 22, headMult: 1.6, rpm: 130, auto: false,
    mag: 0, reserveMax: 0, pellets: 1, spread: 0, range: 2.1, reload: 0,
    recoilPitch: 0, recoilYaw: 0, shake: 0.1, zoom: 1,
  },
  pistol: {
    id: 'pistol', name: 'PISTOL', melee: false, damage: 32, headMult: 3, rpm: 320, auto: false,
    mag: 12, reserveMax: 84, pellets: 1, spread: 0.011, range: 95, reload: 1.5,
    recoilPitch: 0.026, recoilYaw: 0.008, shake: 0.35, zoom: 0.86,
  },
  smg: {
    id: 'smg', name: 'SMG', melee: false, damage: 21, headMult: 2.2, rpm: 720, auto: true,
    mag: 30, reserveMax: 210, pellets: 1, spread: 0.028, range: 72, reload: 2.1,
    recoilPitch: 0.019, recoilYaw: 0.011, shake: 0.28, zoom: 0.9,
  },
  shotgun: {
    id: 'shotgun', name: 'SHOTGUN', melee: false, damage: 15, headMult: 1.6, rpm: 78, auto: false,
    mag: 6, reserveMax: 42, pellets: 8, spread: 0.075, range: 34, reload: 2.8,
    recoilPitch: 0.07, recoilYaw: 0.02, shake: 0.9, zoom: 0.95,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['fists', 'pistol', 'smg', 'shotgun'];

/* ── models ───────────────────────────────────────────────────────────────── */

const GUNMETAL = 0x22262b;
const STEEL = 0x4a5158;
const POLY = 0x14171b;
const WOODC = 0x6b4423;
const BRASS = 0xb08d3f;

let gunMat: THREE.MeshStandardMaterial | null = null;
function mat(): THREE.MeshStandardMaterial {
  if (!gunMat) gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 });
  return gunMat;
}

function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function bx(w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0, rx = 0): THREE.BufferGeometry {
  const g = paint(new THREE.BoxGeometry(w, h, d), hex);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

function cy(r: number, h: number, hex: number, x = 0, y = 0, z = 0, axis: 'x' | 'y' | 'z' = 'z', seg = 10): THREE.BufferGeometry {
  const g = paint(new THREE.CylinderGeometry(r, r, h, seg), hex);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
}

/**
 * Weapons are modelled grip-at-origin with the barrel down +Z, then rotated so +Z runs
 * down the forearm. When the aim pose swings the arm forward the barrel ends up pointing
 * exactly where the camera looks.
 */
export function createWeaponModel(id: WeaponId): WeaponModel | null {
  if (id === 'fists') return null;
  const parts: THREE.BufferGeometry[] = [];
  let muzzleZ = 0.2;

  if (id === 'pistol') {
    // grip, raked back 14° like a real handgun
    parts.push(bx(0.052, 0.135, 0.075, POLY, 0, -0.075, -0.035, 0.24));
    parts.push(bx(0.04, 0.11, 0.05, GUNMETAL, 0, -0.07, -0.028, 0.24));      // magazine
    parts.push(bx(0.056, 0.05, 0.16, GUNMETAL, 0, 0.008, 0.045));            // frame
    parts.push(bx(0.05, 0.055, 0.2, STEEL, 0, 0.055, 0.05));                 // slide
    parts.push(bx(0.046, 0.02, 0.19, GUNMETAL, 0, 0.084, 0.052));            // slide top rib
    parts.push(cy(0.011, 0.06, 0.0, 0, 0.055, 0.168));                       // bore (dark)
    parts.push(bx(0.014, 0.016, 0.016, STEEL, 0, 0.094, 0.138));             // front sight
    parts.push(bx(0.03, 0.016, 0.014, STEEL, 0, 0.094, -0.038));             // rear sight
    parts.push(bx(0.012, 0.03, 0.012, STEEL, 0, -0.018, 0.002));             // trigger
    parts.push(bx(0.05, 0.012, 0.062, GUNMETAL, 0, -0.038, 0.004));          // guard bottom
    parts.push(bx(0.05, 0.03, 0.012, GUNMETAL, 0, -0.026, 0.036));           // guard front
    parts.push(bx(0.03, 0.022, 0.018, STEEL, 0, 0.05, -0.062));              // hammer
    muzzleZ = 0.2;
  } else if (id === 'smg') {
    parts.push(bx(0.058, 0.11, 0.075, POLY, 0, -0.06, -0.075, 0.2));         // pistol grip
    parts.push(bx(0.062, 0.1, 0.3, POLY, 0, 0.01, 0.06));                    // receiver
    parts.push(bx(0.05, 0.055, 0.12, GUNMETAL, 0, 0.055, 0.24));             // barrel shroud
    parts.push(cy(0.014, 0.14, STEEL, 0, 0.045, 0.33));                      // barrel
    parts.push(bx(0.04, 0.16, 0.06, GUNMETAL, 0, -0.07, 0.06));              // magazine
    parts.push(bx(0.05, 0.05, 0.09, POLY, 0, -0.03, 0.2));                   // foregrip
    parts.push(bx(0.05, 0.03, 0.16, GUNMETAL, 0, 0.075, -0.11));             // stock arm
    parts.push(bx(0.05, 0.09, 0.05, POLY, 0, 0.045, -0.2));                  // stock plate
    parts.push(bx(0.03, 0.024, 0.02, STEEL, 0, 0.098, 0.26));                // sights
    parts.push(bx(0.034, 0.026, 0.02, STEEL, 0, 0.098, -0.03));
    parts.push(bx(0.012, 0.03, 0.012, STEEL, 0, -0.02, -0.04));              // trigger
    muzzleZ = 0.41;
  } else {
    parts.push(bx(0.06, 0.11, 0.08, WOODC, 0, -0.055, -0.09, 0.18));         // grip
    parts.push(bx(0.062, 0.075, 0.34, GUNMETAL, 0, 0.02, 0.1));              // receiver
    parts.push(cy(0.019, 0.44, STEEL, 0, 0.045, 0.42));                      // barrel
    parts.push(cy(0.014, 0.4, GUNMETAL, 0, 0.005, 0.4));                     // magazine tube
    parts.push(bx(0.055, 0.055, 0.12, WOODC, 0, 0.0, 0.34));                 // pump
    parts.push(bx(0.055, 0.1, 0.2, WOODC, 0, 0.0, -0.2, -0.1));              // stock
    parts.push(bx(0.055, 0.11, 0.04, POLY, 0, -0.01, -0.3));                 // butt pad
    parts.push(bx(0.014, 0.016, 0.014, BRASS, 0, 0.075, 0.6));               // bead sight
    parts.push(bx(0.012, 0.03, 0.012, STEEL, 0, -0.012, -0.045));            // trigger
    muzzleZ = 0.64;
  }

  const merged = mergeGeometries(parts, false)!;
  const mesh = new THREE.Mesh(merged, mat());
  mesh.castShadow = true;
  const holder = new THREE.Group();
  holder.add(mesh);
  // barrel (+Z) now runs down the forearm
  holder.rotation.x = Math.PI / 2;
  holder.position.set(0.012, 0.02, 0);
  const group = new THREE.Group();
  group.add(holder);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, id === 'pistol' ? 0.055 : 0.045, muzzleZ);
  mesh.add(muzzle);
  return { group, muzzle };
}
