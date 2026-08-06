import { Box } from './physics';
import { WorldBounds } from './layout';

/**
 * Baked ambient occlusion.
 *
 * Real AO means casting rays per vertex, which for a 200k-triangle city is far too slow to
 * do at load. Instead we voxelise the collision boxes into a coarse occupancy grid and ask
 * it, per vertex, "how enclosed is this spot?". Three cheap terms do almost all the work:
 *
 *   1. neighbourhood occupancy — inside corners and alleys go dark
 *   2. downward-facing normals — undersides of eaves, balconies and sunshades go dark
 *   3. contact darkening near the ground — the single strongest cue that an object is
 *      actually *sitting on* the ground rather than floating above it
 *
 * The result is written into the merged geometry's vertex colours, so it costs exactly
 * nothing at runtime — no extra pass, no extra texture, no shader work.
 */
export class AoGrid {
  private cell: number;
  private nx: number;
  private ny: number;
  private nz: number;
  private minX: number;
  private minZ: number;
  private occ: Uint8Array;

  constructor(bounds: WorldBounds, maxHeight = 60, cell = 3) {
    this.cell = cell;
    this.minX = bounds.minX - cell;
    this.minZ = bounds.minZ - cell;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 2;
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 2;
    this.ny = Math.ceil(maxHeight / cell) + 1;
    this.occ = new Uint8Array(this.nx * this.ny * this.nz);
  }

  private idx(ix: number, iy: number, iz: number): number {
    return (iy * this.nz + iz) * this.nx + ix;
  }

  /** Mark every cell a box covers. Ground slabs are skipped — they are not occluders. */
  addBox(b: Box): void {
    if (b.top - b.bottom < 0.4) return;           // kerbs and slabs: too thin to occlude
    const c = this.cell;
    const x0 = Math.floor((b.minX - this.minX) / c), x1 = Math.floor((b.maxX - this.minX) / c);
    const z0 = Math.floor((b.minZ - this.minZ) / c), z1 = Math.floor((b.maxZ - this.minZ) / c);
    const y0 = Math.floor(b.bottom / c), y1 = Math.floor(b.top / c);
    for (let iy = Math.max(0, y0); iy <= Math.min(this.ny - 1, y1); iy++) {
      for (let iz = Math.max(0, z0); iz <= Math.min(this.nz - 1, z1); iz++) {
        for (let ix = Math.max(0, x0); ix <= Math.min(this.nx - 1, x1); ix++) {
          this.occ[this.idx(ix, iy, iz)] = 1;
        }
      }
    }
  }

  private occupied(x: number, y: number, z: number): number {
    const ix = Math.floor((x - this.minX) / this.cell);
    const iz = Math.floor((z - this.minZ) / this.cell);
    const iy = Math.floor(y / this.cell);
    if (ix < 0 || iz < 0 || iy < 0 || ix >= this.nx || iz >= this.nz || iy >= this.ny) return 0;
    return this.occ[this.idx(ix, iy, iz)];
  }

  /**
   * Occlusion factor for a vertex: 1 = fully lit, lower = more enclosed.
   * `nx,ny,nz` is the vertex normal.
   */
  sample(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    // Probe up the normal and out to the sides of it. Two tangents are enough at this
    // resolution; more samples do not survive the 3m grid.
    const t1x = -nz, t1z = nx;                    // horizontal tangent
    let hits = 0;
    const probe = (px: number, py: number, pz: number) => {
      hits += this.occupied(px, py, pz);
    };
    probe(x + nx * 3, y + ny * 3 + 0.5, z + nz * 3);
    probe(x + nx * 6, y + ny * 6 + 1, z + nz * 6);
    probe(x + (nx + t1x) * 3, y + ny * 3 + 0.5, z + (nz + t1z) * 3);
    probe(x + (nx - t1x) * 3, y + ny * 3 + 0.5, z + (nz - t1z) * 3);
    probe(x, y + 3.5, z);                         // is something directly overhead?
    const frac = hits / 5;

    let ao = 1 - 0.52 * frac;
    // undersides
    ao -= 0.3 * Math.max(0, -ny);
    // contact darkening: strong right at the ground line, gone by ~2.5m
    const contact = Math.exp(-Math.max(0, y) / 0.85);
    // flat upward faces (roads, pavements) take it gently or they go blotchy
    const up = Math.max(0, ny);
    ao *= 1 - 0.34 * contact * (1 - up * 0.45);
    return ao < 0.34 ? 0.34 : ao > 1 ? 1 : ao;
  }
}
