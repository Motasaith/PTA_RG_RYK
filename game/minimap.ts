import { City } from './city';
import { fwdX, fwdZ, rgtX, rgtZ } from './mathx';

/**
 * World → radar projection. Uses the same basis as the camera, so a car you can see on
 * the right of the screen appears on the right of the radar (getting this mirrored is a
 * classic minimap bug).
 */
export function radarProject(
  x: number, z: number, px: number, pz: number, yaw: number, scale: number, centre: number,
): [number, number] {
  const dx = x - px, dz = z - pz;
  const u = dx * rgtX(yaw) + dz * rgtZ(yaw);   // screen right
  const v = dx * fwdX(yaw) + dz * fwdZ(yaw);   // screen up
  return [centre + u * scale, centre - v * scale];
}

export type EntKind = 'ped' | 'cop' | 'car' | 'copcar' | 'objective' | 'shop' | 'pickup' | 'corpse';

export interface MapEnt {
  x: number;
  z: number;
  kind: EntKind;
}

const COL: Record<EntKind, string> = {
  ped: 'rgba(226,232,238,.75)',
  cop: '#5aa9ff',
  car: '#9aa6b2',
  copcar: '#3d7dff',
  objective: '#ffd166',
  shop: '#4be1c0',
  pickup: '#b6f36b',
  corpse: '#8b2f2f',
};

/** Canvas 2D radar + full map, drawn straight from the generator's own layout data. */
export class MapRenderer {
  constructor(private city: City) {}

  drawRadar(
    ctx: CanvasRenderingContext2D, size: number,
    px: number, pz: number, yaw: number,
    ents: MapEnt[], scale = 1.45,
  ): void {
    const c = size / 2;
    const P = (x: number, z: number): [number, number] => radarProject(x, z, px, pz, yaw, scale, c);
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, 7);
    ctx.clip();
    this.paint(ctx, P, size, size, scale, true);
    this.paintEnts(ctx, P, ents, 3.2);
    ctx.restore();

    // player arrow
    ctx.fillStyle = '#7df3ff';
    ctx.beginPath();
    ctx.moveTo(c, c - 7);
    ctx.lineTo(c - 5.2, c + 6);
    ctx.lineTo(c + 5.2, c + 6);
    ctx.closePath();
    ctx.fill();
    // compass N — north is −Z, matching the full map
    const [nx, ny] = P(px, pz - 40);
    const a = Math.atan2(ny - c, nx - c);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', c + Math.cos(a) * (c - 12), c + Math.sin(a) * (c - 12));
  }

  drawFull(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    px: number, pz: number, yaw: number,
    ents: MapEnt[], waypoint: { x: number; z: number } | null,
  ): void {
    // Fit the whole world (city + housing scheme), north up, letterboxed to the canvas.
    const b = this.city.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 1.04;
    const scale = Math.min(w, h) / span;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const P = (x: number, z: number): [number, number] => [w / 2 + (x - cx) * scale, h / 2 + (z - cz) * scale];
    ctx.clearRect(0, 0, w, h);
    this.paint(ctx, P, w, h, scale, false);

    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const l of this.city.minimap.labels) {
      const [x, y] = P(l.x, l.z);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillText(l.t, x + 1, y + 1);
      ctx.fillStyle = 'rgba(224,236,244,.9)';
      ctx.fillText(l.t, x, y);
    }

    this.paintEnts(ctx, P, ents, 4);

    if (waypoint) {
      const [x, y] = P(waypoint.x, waypoint.z);
      ctx.strokeStyle = '#ff6ad5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
    }

    const [x, y] = P(px, pz);
    ctx.save();
    ctx.translate(x, y);
    // north-up map: canvas Y grows downwards, so the arrow angle is π − yaw
    ctx.rotate(Math.PI - yaw);
    ctx.fillStyle = '#7df3ff';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(-6, 7);
    ctx.lineTo(6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private paint(
    ctx: CanvasRenderingContext2D,
    P: (x: number, z: number) => [number, number],
    w: number, h: number, scale: number, radar: boolean,
  ): void {
    const m = this.city.minimap;
    ctx.fillStyle = radar ? '#0d1318' : '#0b1116';
    ctx.fillRect(0, 0, w, h);

    const rect = (x: number, z: number, rw: number, rd: number, fill: string) => {
      ctx.fillStyle = fill;
      const [ax, ay] = P(x - rw / 2, z - rd / 2);
      const [bx, by] = P(x + rw / 2, z - rd / 2);
      const [cx2, cy2] = P(x + rw / 2, z + rd / 2);
      const [dx2, dy2] = P(x - rw / 2, z + rd / 2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(dx2, dy2);
      ctx.closePath();
      ctx.fill();
    };

    for (const b of m.blocks) rect(b.x, b.z, b.s, b.s, '#19212a');
    for (const p of m.parks) rect(p.x, p.z, p.w, p.d, '#22432c');
    for (const p of m.water) rect(p.x, p.z, p.w, p.d, '#1d4a63');

    ctx.strokeStyle = '#3d4854';
    ctx.lineCap = 'butt';
    for (const r of m.roads) {
      ctx.lineWidth = Math.max(1.5, r.w * scale);
      const [ax, ay] = P(r.x1, r.z1);
      const [bx, by] = P(r.x2, r.z2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    for (const b of m.buildings) rect(b.x, b.z, b.w, b.d, '#2f3a45');
  }

  private paintEnts(
    ctx: CanvasRenderingContext2D,
    P: (x: number, z: number) => [number, number],
    ents: MapEnt[], r: number,
  ): void {
    for (const e of ents) {
      const [x, y] = P(e.x, e.z);
      ctx.fillStyle = COL[e.kind];
      if (e.kind === 'objective') {
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.6);
        ctx.lineTo(x + r * 1.4, y);
        ctx.lineTo(x, y + r * 1.6);
        ctx.lineTo(x - r * 1.4, y);
        ctx.closePath();
        ctx.fill();
      } else if (e.kind === 'car' || e.kind === 'copcar') {
        ctx.fillRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, e.kind === 'ped' || e.kind === 'corpse' ? r * 0.6 : r * 0.85, 0, 7);
        ctx.fill();
      }
    }
  }
}
