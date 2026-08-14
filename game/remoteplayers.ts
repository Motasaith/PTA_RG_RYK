import * as THREE from 'three';
import {
  createHumanoid, disposeHumanoid, HAIRS, Humanoid, PANTS, poseHumanoid, setHumanoidDetail,
  SHIRTS, SKINS,
} from './humanoid';
import { NetClient } from './netclient';
import { F_AIMING, F_DEAD, F_GROUNDED, F_SPRINT, F_VEHICLE, PlayerState } from './protocol';
import { mulberry32 } from './mathx';

interface Remote {
  id: number;
  h: Humanoid;
  plate: THREE.Sprite;
  last: PlayerState | null;
}

/**
 * Draws the other players. They use the same 11-joint rig and the same procedural animation
 * as the local character, driven from interpolated network state instead of input — so a
 * friend running past looks exactly like you do, including the walk cycle and head tracking.
 */
export class RemotePlayers {
  private list = new Map<number, Remote>();
  private group = new THREE.Group();

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Reconcile our visuals with the client's peer list, then pose everyone. */
  update(net: NetClient, dt: number, t: number, now: number, camX: number, camZ: number, drawDist: number): void {
    // remove anyone who left
    for (const [id, r] of this.list) {
      if (!net.peers.has(id)) {
        disposeHumanoid(r.h);
        this.group.remove(r.plate);
        (r.plate.material as THREE.SpriteMaterial).map?.dispose();
        (r.plate.material as THREE.SpriteMaterial).dispose();
        this.list.delete(id);
      }
    }

    for (const peer of net.peers.values()) {
      let r = this.list.get(peer.id);
      if (!r) {
        r = this.spawn(peer.id, peer.name);
        this.list.set(peer.id, r);
      }
      const s = peer.buf.sample(now);
      if (!s) {
        r.h.root.visible = false;
        r.plate.visible = false;
        continue;
      }
      r.last = s;

      // A player in a car is drawn by the car, not here.
      const hidden = (s.flags & F_VEHICLE) !== 0;
      const far = (s.x - camX) ** 2 + (s.z - camZ) ** 2 > drawDist * drawDist;
      r.h.root.visible = !hidden && !far;
      r.plate.visible = r.h.root.visible;
      if (!r.h.root.visible) continue;

      r.h.root.position.set(s.x, s.y, s.z);
      r.h.root.rotation.y = s.yaw;
      setHumanoidDetail(r.h, true, (s.x - camX) ** 2 + (s.z - camZ) ** 2 < 900);

      poseHumanoid(r.h, {
        dt, t,
        speed: s.speed,
        runSpeed: 6.1,
        grounded: (s.flags & F_GROUNDED) !== 0,
        airVy: 0,
        aiming: (s.flags & F_AIMING) !== 0,
        aimPitch: 0,
        dead: (s.flags & F_DEAD) !== 0 ? 1 : 0,
        seated: false,
        punch: 0,
        flinch: 0,
        steer: 0,
      });

      r.plate.position.set(s.x, s.y + 2.12, s.z);
    }
  }

  /** Positions for the radar. */
  forEach(cb: (x: number, z: number) => void): void {
    for (const r of this.list.values()) {
      if (r.last && r.h.root.visible) cb(r.last.x, r.last.z);
    }
  }

  private spawn(id: number, name: string): Remote {
    // deterministic outfit from the id, so a given player looks the same to everyone
    const rng = mulberry32(id * 2654435761);
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
    const h = createHumanoid({
      skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS),
      hair: pick(HAIRS), shoes: 0x2b2f33, scale: 1,
    });
    this.group.add(h.root);
    const plate = nameplate(name);
    this.group.add(plate);
    return { id, h, plate, last: null };
  }

  dispose(): void {
    for (const r of this.list.values()) {
      disposeHumanoid(r.h);
      (r.plate.material as THREE.SpriteMaterial).map?.dispose();
      (r.plate.material as THREE.SpriteMaterial).dispose();
    }
    this.list.clear();
    this.group.removeFromParent();
  }
}

/** Floating name tag. One small canvas per player, capped at 8, so the cost is trivial. */
function nameplate(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 64);
  g.font = 'bold 30px ui-monospace, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.72)';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#7df3ff';
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  }));
  sp.scale.set(2.2, 0.55, 1);
  sp.renderOrder = 10;
  return sp;
}

/** Pack the local player's animation state into protocol flags. */
export function packFlags(o: {
  sprint: boolean; aiming: boolean; inVehicle: boolean; dead: boolean; grounded: boolean;
}): number {
  return (o.sprint ? F_SPRINT : 0)
    | (o.aiming ? F_AIMING : 0)
    | (o.inVehicle ? F_VEHICLE : 0)
    | (o.dead ? F_DEAD : 0)
    | (o.grounded ? F_GROUNDED : 0);
}
