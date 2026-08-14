import { WeaponId } from './weapons';

export interface HudState {
  phase: 'loading' | 'title' | 'playing' | 'paused' | 'dead' | 'won';
  loadPct: number;
  loadMsg: string;
  health: number;
  armour: number;
  money: number;
  wanted: number;
  weapon: WeaponId;
  mag: number;
  reserve: number;
  reloading: boolean;
  inVehicle: boolean;
  vehicleName: string;
  vehicleClass: string;
  speed: number;
  /** 0..1 nitrous remaining */
  boost: number;
  boosting: boolean;
  prompt: string;
  toast: string;
  objective: string;
  found: number;
  total: number;
  clock: string;
  hour: number;
  fps: number;
  triangles: number;
  drawCalls: number;
  aiming: boolean;
  hitMarker: number;
  crosshairHot: boolean;
  busted: boolean;
  mapOpen: boolean;
  /* multiplayer */
  netStatus: 'offline' | 'connecting' | 'online' | 'error';
  netRoom: string;
  netError: string;
  netPeers: number;
  netNames: string[];
}

const initial: HudState = {
  phase: 'loading', loadPct: 0, loadMsg: 'starting up…',
  health: 100, armour: 0, money: 500, wanted: 0,
  weapon: 'fists', mag: 0, reserve: 0, reloading: false,
  inVehicle: false, vehicleName: '', vehicleClass: '', speed: 0, boost: 1, boosting: false,
  prompt: '', toast: '', objective: '', found: 0, total: 8,
  clock: '00:00', hour: 11, fps: 0, triangles: 0, drawCalls: 0,
  aiming: false, hitMarker: 0, crosshairHot: false, busted: false, mapOpen: false,
  netStatus: 'offline', netRoom: '', netError: '', netPeers: 0, netNames: [],
};

let state: HudState = initial;
const subs = new Set<() => void>();

export function getHud(): HudState {
  return state;
}

export function subscribeHud(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Shallow-diffs before notifying, so a 60Hz game loop does not re-render React 60 times. */
export function setHud(patch: Partial<HudState>): void {
  let changed = false;
  for (const k in patch) {
    const key = k as keyof HudState;
    if (state[key] !== patch[key]) { changed = true; break; }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  for (const cb of subs) cb();
}

export function resetHud(): void {
  state = initial;
  for (const cb of subs) cb();
}
