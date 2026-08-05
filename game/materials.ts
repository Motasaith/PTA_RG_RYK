import * as THREE from 'three';
import { mulberry32, Rng } from './mathx';

/**
 * Every surface in the game is generated on a <canvas> at load time. No image downloads,
 * no GLTFs — the whole deploy is ~600KB gzipped and there is nothing to stall on.
 */

let maxAniso = 4;
const cache = new Map<string, THREE.Texture>();

export function initTextures(renderer: THREE.WebGLRenderer): void {
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function make(key: string, size: number, draw: (g: CanvasRenderingContext2D, rng: Rng, s: number) => void, repeat = true): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, mulberry32(hash(key)), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  cache.set(key, t);
  return t;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function speckle(g: CanvasRenderingContext2D, rng: Rng, s: number, n: number, colors: string[], min = 1, max = 3): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rng() * colors.length) | 0];
    const w = min + rng() * (max - min);
    g.fillRect(rng() * s, rng() * s, w, w);
  }
}

export const tex = {
  asphalt: () => make('asphalt', 256, (g, rng, s) => {
    g.fillStyle = '#2e3135';
    g.fillRect(0, 0, s, s);
    speckle(g, rng, s, 5000, ['#3a3e43', '#26292c', '#43474d', '#1f2225'], 1, 3);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(20,22,25,${0.1 + rng() * 0.2})`;
      g.lineWidth = 0.6 + rng() * 1.6;
      g.beginPath();
      g.moveTo(rng() * s, rng() * s);
      g.lineTo(rng() * s, rng() * s);
      g.stroke();
    }
  }),

  concrete: () => make('concrete', 256, (g, rng, s) => {
    g.fillStyle = '#9c9a92';
    g.fillRect(0, 0, s, s);
    speckle(g, rng, s, 3400, ['#a8a69d', '#918f87', '#b2b0a6', '#87857e'], 1, 4);
    // slab joints every 64px
    g.strokeStyle = 'rgba(80,78,72,.55)';
    g.lineWidth = 2;
    for (let i = 0; i <= s; i += 64) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke();
    }
  }),

  grass: () => make('grass', 256, (g, rng, s) => {
    g.fillStyle = '#5f8b46';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4200; i++) {
      g.fillStyle = `hsla(${92 + rng() * 34},${34 + rng() * 22}%,${26 + rng() * 20}%,.6)`;
      g.fillRect(rng() * s, rng() * s, 1.5, 2 + rng() * 4);
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(255,255,255,${0.012 + rng() * 0.02})`;
      g.beginPath(); g.arc(rng() * s, rng() * s, 20 + rng() * 50, 0, 7); g.fill();
    }
  }),

  dirt: () => make('dirt', 128, (g, rng, s) => {
    g.fillStyle = '#8d7550';
    g.fillRect(0, 0, s, s);
    speckle(g, rng, s, 2200, ['#7d6644', '#9c8460', '#6d5a3c'], 1, 4);
  }),

  plaster: (variant: number) => make('plaster' + variant, 128, (g, rng, s) => {
    const base = ['#e2d7c3', '#d8ccc0', '#e8ded0', '#cdd6d4', '#e6d2c0', '#dcd8cc'][variant % 6];
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    speckle(g, rng, s, 1500, ['rgba(255,255,255,.25)', 'rgba(0,0,0,.06)', 'rgba(120,100,80,.08)'], 1, 5);
  }),

  brick: () => make('brick', 256, (g, rng, s) => {
    g.fillStyle = '#8d5a48';
    g.fillRect(0, 0, s, s);
    const bh = 16, bw = 34;
    for (let y = 0, row = 0; y < s; y += bh, row++) {
      for (let x = (row % 2) * -bw / 2; x < s; x += bw) {
        g.fillStyle = `hsl(${8 + rng() * 12},${28 + rng() * 16}%,${32 + rng() * 12}%)`;
        g.fillRect(x + 1.4, y + 1.4, bw - 2.8, bh - 2.8);
      }
    }
  }),

  roofTile: () => make('rooftile', 128, (g, rng, s) => {
    g.fillStyle = '#7c4436';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = `hsl(${10 + rng() * 8},34%,${24 + rng() * 12}%)`;
      g.fillRect(0, y, s, 13);
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(0, y + 13, s, 3);
    }
  }),

  metal: () => make('metal', 128, (g, rng, s) => {
    g.fillStyle = '#8d949b';
    g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 8) {
      g.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.08})`;
      g.fillRect(x, 0, 3, s);
    }
  }),

  wood: () => make('wood', 128, (g, rng, s) => {
    g.fillStyle = '#a8763f';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 12) {
      g.fillStyle = `hsl(28,${34 + rng() * 14}%,${30 + rng() * 14}%)`;
      g.fillRect(0, y, s, 11);
      g.fillStyle = 'rgba(50,30,12,.4)';
      g.fillRect(0, y + 11, s, 1.5);
    }
  }),

  /** One 14m × 14m block of facade: 4×4 windows with mullions and sills. */
  facade: (variant: number) => make('facade' + variant, 512, (g, rng, s) => {
    const wall = ['#c9c2b4', '#b9c3c8', '#d6c8b2', '#a9b3bd'][variant % 4];
    const glass = ['#38596e', '#2f4c60', '#41627a', '#2a4457'][variant % 4];
    g.fillStyle = wall;
    g.fillRect(0, 0, s, s);
    speckle(g, rng, s, 2000, ['rgba(255,255,255,.16)', 'rgba(0,0,0,.05)'], 1, 4);
    const cell = s / 4;
    for (let iy = 0; iy < 4; iy++) {
      for (let ix = 0; ix < 4; ix++) {
        const x = ix * cell, y = iy * cell;
        const pad = cell * 0.18;
        g.fillStyle = '#6c665c';
        g.fillRect(x + pad - 3, y + pad - 3, cell - pad * 2 + 6, cell - pad * 2 + 6);
        g.fillStyle = glass;
        g.fillRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
        // reflection streak
        g.fillStyle = 'rgba(255,255,255,.10)';
        g.beginPath();
        g.moveTo(x + pad, y + cell - pad);
        g.lineTo(x + cell - pad, y + pad);
        g.lineTo(x + cell - pad, y + pad + cell * 0.2);
        g.lineTo(x + pad, y + cell - pad + cell * 0.2);
        g.fill();
        // mullion
        g.fillStyle = 'rgba(40,38,34,.75)';
        g.fillRect(x + cell / 2 - 1.5, y + pad, 3, cell - pad * 2);
        // sill
        g.fillStyle = 'rgba(0,0,0,.18)';
        g.fillRect(x + pad - 4, y + cell - pad, cell - pad * 2 + 8, 5);
      }
    }
  }),

  /** Matching emissive mask — only some windows are lit, so nights look inhabited. */
  facadeLit: (variant: number) => make('facadeLit' + variant, 512, (g, rng, s) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, s, s);
    const cell = s / 4;
    for (let iy = 0; iy < 4; iy++) {
      for (let ix = 0; ix < 4; ix++) {
        if (rng() > 0.42) continue;
        const pad = cell * 0.18;
        g.fillStyle = rng() > 0.3 ? '#ffdca6' : '#cfe4ff';
        g.fillRect(ix * cell + pad, iy * cell + pad, cell - pad * 2, cell - pad * 2);
      }
    }
  }),

  water: () => make('water', 256, (g, rng, s) => {
    g.fillStyle = '#2f7fa8';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 200; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.05 + rng() * 0.12})`;
      g.lineWidth = 1 + rng() * 2;
      const y = rng() * s;
      g.beginPath();
      g.moveTo(rng() * s, y);
      g.lineTo(rng() * s, y + rng() * 4);
      g.stroke();
    }
  }),

  foliage: () => make('foliage', 128, (g, rng, s) => {
    g.fillStyle = '#3f7238';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `hsl(${86 + rng() * 40},${32 + rng() * 26}%,${18 + rng() * 26}%)`;
      g.beginPath(); g.arc(rng() * s, rng() * s, 2 + rng() * 6, 0, 7); g.fill();
    }
  }),
};

/** Soft radial sprite used for muzzle flash, lamp glow, blood mist and dust. */
export function glowTexture(): THREE.Texture {
  const hit = cache.get('glow');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  cache.set('glow', t);
  return t;
}

/** Irregular splat for blood decals. */
export function splatTexture(): THREE.Texture {
  const hit = cache.get('splat');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rng = mulberry32(9182);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 9; i++) {
    const a = rng() * 7, r = 10 + rng() * 22;
    g.beginPath();
    g.arc(64 + Math.cos(a) * rng() * 20, 64 + Math.sin(a) * rng() * 20, r, 0, 7);
    g.fill();
  }
  for (let i = 0; i < 26; i++) {
    const a = rng() * 7, d = 26 + rng() * 34;
    g.beginPath();
    g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1.5 + rng() * 4.5, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  cache.set('splat', t);
  return t;
}

/** Shop signs, road signs, number plates. */
export function signTexture(text: string, bg: string, fg: string, w = 512, h = 128, font = 'bold'): THREE.Texture {
  const key = `sign:${text}:${bg}:${fg}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.25)';
  g.lineWidth = 6;
  g.strokeRect(4, 4, w - 8, h - 8);
  let size = Math.floor(h * 0.52);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  do {
    g.font = `${font} ${size}px "Trebuchet MS", system-ui, sans-serif`;
    size -= 2;
  } while (g.measureText(text).width > w * 0.88 && size > 8);
  g.fillStyle = fg;
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  cache.set(key, t);
  return t;
}

/**
 * Scale a geometry's UVs so a tiling texture keeps a constant world-space size no matter
 * how big the box is. Without this you get stretched bricks and windows of random sizes.
 */
export function uvScale(geo: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

/** Per-face UV scaling for boxes: three.js box faces are ordered +X −X +Y −Y +Z −Z. */
export function uvScaleBox(geo: THREE.BufferGeometry, w: number, h: number, d: number, tile: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const per = 4;
  const scales: [number, number][] = [
    [d / tile, h / tile], [d / tile, h / tile],
    [w / tile, d / tile], [w / tile, d / tile],
    [w / tile, h / tile], [w / tile, h / tile],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = scales[f];
    for (let i = 0; i < per; i++) {
      const idx = f * per + i;
      if (idx >= uv.count) break;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

export interface Mats {
  asphalt: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  dirt: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial[];
  facade: THREE.MeshStandardMaterial[];
}

export function buildMaterials(): Mats {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  return {
    asphalt: std({ map: tex.asphalt(), roughness: 0.95, metalness: 0.02 }),
    paint: std({ color: 0xd8cf9a, roughness: 0.7 }),
    concrete: std({ map: tex.concrete(), roughness: 0.9 }),
    curb: std({ color: 0xbdb8ad, roughness: 0.85 }),
    grass: std({ map: tex.grass(), roughness: 1 }),
    dirt: std({ map: tex.dirt(), roughness: 1 }),
    brick: std({ map: tex.brick(), roughness: 0.92 }),
    roof: std({ map: tex.roofTile(), roughness: 0.85 }),
    metal: std({ map: tex.metal(), roughness: 0.45, metalness: 0.6 }),
    wood: std({ map: tex.wood(), roughness: 0.8 }),
    glass: std({ color: 0x8fbcd4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42 }),
    water: std({ map: tex.water(), roughness: 0.15, metalness: 0.25, transparent: true, opacity: 0.82 }),
    trunk: std({ color: 0x6b4a2f, roughness: 0.95 }),
    foliage: std({ map: tex.foliage(), roughness: 0.9 }),
    plaster: [0, 1, 2, 3, 4, 5].map((v) => std({ map: tex.plaster(v), roughness: 0.85 })),
    facade: [0, 1, 2, 3].map((v) => std({
      map: tex.facade(v),
      emissiveMap: tex.facadeLit(v),
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
      roughness: 0.62,
      metalness: 0.08,
    })),
  };
}
