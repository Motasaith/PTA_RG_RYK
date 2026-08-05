'use client';

import { useState } from 'react';
import { ACTION_LABEL, ACTIONS, Action, DEFAULT_BINDS, keyLabel, QUALITY, Quality, Settings } from '@/game/settings';

/* ── loading + title ──────────────────────────────────────────────────────── */

export function Loader({ pct, msg }: { pct: number; msg: string }) {
  return (
    <div className="screen loader">
      <div className="loadbox">
        <div className="spinner" />
        <h1 className="brand">
          RAHIM GARDEN CITY
          <small>lost &amp; found · r.y. khan</small>
        </h1>
        <div className="loadmsg">{msg}</div>
        <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
        <div className="loadnote">
          the whole city is generated in your browser — no downloads, no textures to fetch
        </div>
      </div>
    </div>
  );
}

export function Title({ onStart, onSettings }: { onStart: () => void; onSettings: () => void }) {
  return (
    <div className="screen title">
      <div className="titlecard">
        <div className="eyebrow">OPEN WORLD · RAHIM YAR KHAN</div>
        <h1>
          LOST &amp;<br /><span>FOUND</span>
        </h1>
        <p>
          Mom&apos;s list has eight things on it and they are scattered across the whole city.
          Walk, sprint, jump, drive anything with wheels, shop, fight, shoot — and try not to
          collect five stars while you are at it.
        </p>
        <div className="keys">
          <span><b>WASD</b> move</span>
          <span><b>SHIFT</b> sprint</span>
          <span><b>SPACE</b> jump / handbrake</span>
          <span><b>MOUSE</b> look</span>
          <span><b>RMB</b> aim</span>
          <span><b>LMB</b> fire</span>
          <span><b>1–4</b> fists · pistol · smg · shotgun</span>
          <span><b>E</b> enter car / interact</span>
          <span><b>R</b> reload</span>
          <span><b>TAB</b> map</span>
          <span><b>ESC</b> pause</span>
        </div>
        <div className="row">
          <button className="btn primary" onClick={onStart}>PLAY</button>
          <button className="btn" onClick={onSettings}>SETTINGS</button>
        </div>
        <div className="fineprint">Click the game to capture the mouse. Press ESC to release it.</div>
      </div>
    </div>
  );
}

/* ── pause + settings ─────────────────────────────────────────────────────── */

type Tab = 'display' | 'controls' | 'audio' | 'game';

export function PauseMenu({
  settings, onChange, onResume, onRestart, capture,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onResume: () => void;
  onRestart: () => void;
  capture: (cb: (code: string) => void) => void;
}) {
  const [tab, setTab] = useState<Tab>('display');
  const [listening, setListening] = useState<string | null>(null);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  const rebind = (a: Action, slot: number) => {
    setListening(`${a}:${slot}`);
    capture((code) => {
      const binds = { ...settings.binds };
      const list = [...binds[a]];
      list[slot] = code;
      binds[a] = list;
      onChange({ ...settings, binds });
      setListening(null);
    });
  };

  return (
    <div className="screen pause">
      <div className="panel">
        <div className="panelhead">
          <h2>PAUSED</h2>
          <div className="tabs">
            {(['display', 'controls', 'audio', 'game'] as Tab[]).map((t) => (
              <button key={t} className={t === tab ? 'tab on' : 'tab'} onClick={() => setTab(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="panelbody">
          {tab === 'display' && (
            <>
              <Row label="Quality preset" hint="Biggest single lever on frame rate.">
                <div className="seg">
                  {(Object.keys(QUALITY) as Quality[]).map((q) => (
                    <button key={q} className={settings.quality === q ? 'segbtn on' : 'segbtn'} onClick={() => set('quality', q)}>
                      {q.toUpperCase()}
                    </button>
                  ))}
                </div>
              </Row>
              <div className="hintline">{QUALITY[settings.quality].label}</div>
              <Slider label="Field of view" value={settings.fov} min={50} max={90} step={1} onChange={(v) => set('fov', v)} suffix="°" />
              <Toggle label="Adaptive resolution" value={settings.adaptiveRes} onChange={(v) => set('adaptiveRes', v)} hint="Drops pixels instead of frames when the GPU struggles." />
              <Toggle label="Camera shake" value={settings.cameraShake} onChange={(v) => set('cameraShake', v)} />
              <Toggle label="Show performance" value={settings.showFps} onChange={(v) => set('showFps', v)} />
            </>
          )}

          {tab === 'controls' && (
            <>
              <Slider label="Mouse sensitivity" value={settings.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => set('sensitivity', v)} />
              <Slider label="Aim sensitivity ×" value={settings.aimSensitivity} min={0.2} max={1.5} step={0.02} onChange={(v) => set('aimSensitivity', v)} />
              <Toggle label="Invert vertical look" value={settings.invertY} onChange={(v) => set('invertY', v)} />
              <div className="binds">
                {ACTIONS.map((a) => (
                  <div className="bindrow" key={a}>
                    <span className="bindname">{ACTION_LABEL[a]}</span>
                    {[0, 1].map((slot) => {
                      const code = settings.binds[a][slot];
                      const key = `${a}:${slot}`;
                      return (
                        <button
                          key={slot}
                          className={`bindkey ${listening === key ? 'listening' : ''}`}
                          onClick={() => rebind(a, slot)}
                        >
                          {listening === key ? 'press a key…' : code ? keyLabel(code) : '—'}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <button className="btn small" onClick={() => onChange({ ...settings, binds: structuredClone(DEFAULT_BINDS) })}>
                RESET KEYS
              </button>
            </>
          )}

          {tab === 'audio' && (
            <>
              <Slider label="Master volume" value={settings.master} min={0} max={1} step={0.02} onChange={(v) => set('master', v)} pct />
              <Slider label="Effects" value={settings.sfx} min={0} max={1} step={0.02} onChange={(v) => set('sfx', v)} pct />
              <Slider label="City ambience" value={settings.music} min={0} max={1} step={0.02} onChange={(v) => set('music', v)} pct />
            </>
          )}

          {tab === 'game' && (
            <>
              <Toggle label="Blood and gore" value={settings.blood} onChange={(v) => set('blood', v)} />
              <Toggle label="Day / night cycle" value={settings.dayNight} onChange={(v) => set('dayNight', v)} hint="Off pins the clock at noon." />
              <div className="hintline">
                Wanted level rises when you fire in public, hit someone, or run people over. Lose
                the cops by breaking line of sight for about fifteen seconds.
              </div>
            </>
          )}
        </div>

        <div className="panelfoot">
          <button className="btn primary" onClick={onResume}>RESUME</button>
          <button className="btn" onClick={onRestart}>RESTART CITY</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setrow">
      <div className="setlabel">
        {label}
        {hint && <small>{hint}</small>}
      </div>
      <div className="setctl">{children}</div>
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, suffix, pct,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix?: string; pct?: boolean;
}) {
  return (
    <Row label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="val">{pct ? `${Math.round(value * 100)}%` : value.toFixed(step < 0.1 ? 2 : 0) + (suffix ?? '')}</span>
    </Row>
  );
}

function Toggle({
  label, value, onChange, hint,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      <button className={value ? 'switch on' : 'switch'} onClick={() => onChange(!value)}>
        <i />
        <span>{value ? 'ON' : 'OFF'}</span>
      </button>
    </Row>
  );
}

/* ── death + win ──────────────────────────────────────────────────────────── */

export function Wasted() {
  return (
    <div className="screen wasted">
      <h1>WASTED</h1>
      <p>The clinic will patch you up… for a fee.</p>
    </div>
  );
}

export function Won({ money, clock, onRestart }: { money: number; clock: string; onRestart: () => void }) {
  return (
    <div className="screen title">
      <div className="titlecard">
        <div className="eyebrow">MOM&apos;S LIST — COMPLETE</div>
        <h1>SHA<span>BASH</span></h1>
        <p>
          All eight things recovered in {clock} with Rs.{money.toLocaleString()} in your pocket.
          The whole society is talking about you.
        </p>
        <div className="row">
          <button className="btn primary" onClick={onRestart}>PLAY AGAIN</button>
        </div>
      </div>
    </div>
  );
}

export function MapOverlay({ mapRef, onClose }: { mapRef: React.RefObject<HTMLCanvasElement>; onClose: () => void }) {
  return (
    <div className="screen mapscreen" onClick={onClose}>
      <div className="mapwrap">
        <div className="maptag">RAHIM GARDEN CITY</div>
        <canvas ref={mapRef} width={860} height={860} />
        <div className="maplegend">
          <span><i className="dot obj" /> Mom&apos;s things</span>
          <span><i className="dot shop" /> shops</span>
          <span><i className="dot pickup" /> pickups</span>
          <span><i className="dot cop" /> police</span>
          <span>TAB / M — close</span>
        </div>
      </div>
    </div>
  );
}
