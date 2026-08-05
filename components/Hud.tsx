'use client';

import { HudState } from '@/game/hudstore';
import { WEAPONS } from '@/game/weapons';

const WEAPON_KEY: Record<string, string> = { fists: '1', pistol: '2', smg: '3', shotgun: '4' };

export function Hud({
  hud, radarRef, showPerf,
}: {
  hud: HudState;
  radarRef: React.RefObject<HTMLCanvasElement>;
  showPerf: boolean;
}) {
  const playing = hud.phase === 'playing' || hud.phase === 'dead';
  const spec = WEAPONS[hud.weapon];
  // free-aim reticle is always up with a gun out, just dimmer until you actually aim
  const showCross = hud.phase === 'playing' && !hud.inVehicle && !spec.melee;

  return (
    <div className="hud" aria-hidden={!playing}>
      {/* crosshair */}
      <div className={`cross ${showCross ? 'on' : ''} ${showCross && !hud.aiming ? 'dim' : ''} ${hud.crosshairHot ? 'hot' : ''} ${hud.hitMarker > 0 ? 'hit' : ''}`}>
        <i className="dot" />
        <i className="t t1" />
        <i className="t t2" />
        <i className="t t3" />
        <i className="t t4" />
      </div>

      {/* objective + toast */}
      <div className="topcentre">
        {hud.objective && <div className="objective">{hud.objective}</div>}
        {hud.toast && <div className="toast">{hud.toast}</div>}
      </div>

      {/* money / clock / stars */}
      <div className="topright">
        <div className="money">Rs.{hud.money.toLocaleString()}</div>
        <div className="clockrow">
          <span className="clock">{hud.clock}</span>
          <span className="hour">{String(hud.hour).padStart(2, '0')}:00</span>
        </div>
        <div className="stars">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i < hud.wanted ? 'star lit' : 'star'}>★</span>
          ))}
        </div>
        <div className="found">
          MOM&apos;S LIST <b>{hud.found}</b>/{hud.total}
        </div>
      </div>

      {/* radar + bars */}
      <div className="bottomleft">
        <div className="radarwrap">
          <canvas ref={radarRef} width={340} height={340} className="radar" />
          <svg className="rings" viewBox="0 0 100 100">
            <circle className="ringbg" cx="50" cy="50" r="47" />
            <circle
              className="ringhp" cx="50" cy="50" r="47"
              style={{ strokeDasharray: `${(hud.health / 100) * 295} 999` }}
            />
            <circle
              className="ringar" cx="50" cy="50" r="43"
              style={{ strokeDasharray: `${(hud.armour / 100) * 270} 999` }}
            />
          </svg>
        </div>
        <div className="statrow">
          <span className="hp">♥ {hud.health}</span>
          {hud.armour > 0 && <span className="ar">⛨ {hud.armour}</span>}
        </div>
      </div>

      {/* weapon / speedo */}
      <div className="bottomright">
        {hud.inVehicle ? (
          <div className="speedo">
            <div className="kmh">{hud.speed}</div>
            <div className="kmhlabel">KM/H · {hud.vehicleName}</div>
          </div>
        ) : (
          <div className="weapon">
            <div className="wname">{spec.name}</div>
            <div className="ammo">
              {spec.melee ? '—' : (
                <>
                  <b>{hud.mag}</b>
                  <span>/{hud.reserve}</span>
                </>
              )}
            </div>
            {hud.reloading && <div className="reloading">RELOADING…</div>}
          </div>
        )}
        <div className="wheel">
          {(['fists', 'pistol', 'smg', 'shotgun'] as const).map((w) => (
            <span key={w} className={w === hud.weapon ? 'slot on' : 'slot'}>
              {WEAPON_KEY[w]}
            </span>
          ))}
        </div>
      </div>

      {/* interaction prompt */}
      {hud.prompt && <div className="prompt">{hud.prompt}</div>}

      {showPerf && (
        <div className="perf">
          {hud.fps} FPS · {hud.drawCalls} draws · {(hud.triangles / 1000).toFixed(0)}k tris
        </div>
      )}

      <div className="vignette" />
      {hud.health < 32 && hud.phase === 'playing' && <div className="lowhp" />}
    </div>
  );
}
