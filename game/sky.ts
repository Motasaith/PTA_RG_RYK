import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from './mathx';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(up, 0.0, 1.0), 0.42));
  col = mix(col, uGround, clamp(-up * 3.0, 0.0, 1.0));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(s, 1200.0) * 6.0;          // disc
  col += uSunColor * pow(s, 6.0) * 0.20;            // bloom around the sun
  col += uSunColor * pow(s, 1.5) * 0.05 * clamp(1.0 - abs(up) * 2.0, 0.0, 1.0); // horizon wash
  gl_FragColor = vec4(col, 1.0);
}`;

function cloudTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rng = mulberry32(4242);
  for (let i = 0; i < 16; i++) {
    const x = 20 + rng() * 88, y = 40 + rng() * 48, r = 14 + rng() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

/** Sky dome, sun, ambient rig and drifting clouds — plus the day/night driver. */
export class Sky {
  dome: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  clouds: THREE.Sprite[] = [];
  /** 0 = full day, 1 = full night. Drives street lamps and lit windows. */
  night = 0;
  hour = 11.5;

  private uni: Record<string, THREE.IUniform>;
  private cloudGroup = new THREE.Group();

  constructor(scene: THREE.Scene, cloudCount: number, shadowSize: number, shadows: boolean) {
    this.uni = {
      uTop: { value: new THREE.Color(0x3f7fc4) },
      uHorizon: { value: new THREE.Color(0xdce8ee) },
      uGround: { value: new THREE.Color(0x94a6a8) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.2) },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uni,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    // Must stay inside the camera's far plane or it gets clipped away entirely.
    // depthTest:false + renderOrder −1 means it is painted first and everything covers it.
    this.dome.scale.setScalar(300);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xcfe4f2, 0x53483a, 0.5);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.sun = new THREE.DirectionalLight(0xfff0d4, 2.1);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const c = this.sun.shadow.camera;
    c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();   // three never recomputes this for us
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target, this.hemi, this.ambient);

    const cloudMat = new THREE.SpriteMaterial({
      map: cloudTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
    });
    const rng = mulberry32(77);
    for (let i = 0; i < cloudCount; i++) {
      const s = new THREE.Sprite(cloudMat.clone());
      const sc = 90 + rng() * 150;
      s.scale.set(sc, sc * 0.45, 1);
      // kept well inside the far plane so clouds are never clipped
      s.position.set(-420 + rng() * 840, 150 + rng() * 90, -420 + rng() * 840);
      this.cloudGroup.add(s);
      this.clouds.push(s);
    }
    this.cloudGroup.frustumCulled = false;
    scene.add(this.cloudGroup);
  }

  setHour(h: number): void {
    this.hour = ((h % 24) + 24) % 24;
    // Elevation: 0 at 06:00 and 18:00, peak at noon.
    const el = Math.sin(((this.hour - 6) / 12) * Math.PI);
    const az = ((this.hour - 6) / 24) * Math.PI * 2 + 0.6;
    const ce = Math.max(Math.cos(((this.hour - 6) / 12) * Math.PI) * 0.35 + 0.65, 0.15);
    const dir = new THREE.Vector3(Math.cos(az) * ce, el, Math.sin(az) * ce).normalize();
    (this.uni.uSunDir.value as THREE.Vector3).copy(dir);

    this.night = clamp(1 - (el + 0.12) * 3.2, 0, 1);
    const dusk = clamp(1 - Math.abs(el) * 4.5, 0, 1) * (1 - this.night * 0.6);

    const top = new THREE.Color().setRGB(
      lerp(lerp(0.16, 0.33, dusk), 0.02, this.night),
      lerp(lerp(0.42, 0.24, dusk), 0.04, this.night),
      lerp(lerp(0.78, 0.42, dusk), 0.12, this.night),
    );
    const hor = new THREE.Color().setRGB(
      lerp(lerp(0.83, 0.98, dusk), 0.05, this.night),
      lerp(lerp(0.88, 0.62, dusk), 0.07, this.night),
      lerp(lerp(0.92, 0.42, dusk), 0.15, this.night),
    );
    (this.uni.uTop.value as THREE.Color).copy(top);
    (this.uni.uHorizon.value as THREE.Color).copy(hor);
    (this.uni.uGround.value as THREE.Color).setRGB(hor.r * 0.55, hor.g * 0.55, hor.b * 0.5);
    (this.uni.uSunColor.value as THREE.Color).setRGB(
      1, lerp(0.95, 0.6, dusk), lerp(0.85, 0.35, dusk),
    );

    this.sun.intensity = lerp(2.25, 0.05, this.night) * lerp(1, 0.7, dusk);
    this.sun.color.setRGB(1, lerp(0.94, 0.66, dusk), lerp(0.84, 0.45, dusk));
    this.hemi.intensity = lerp(0.55, 0.13, this.night);
    this.hemi.color.copy(hor);
    this.ambient.intensity = lerp(0.24, 0.10, this.night);
    for (const cl of this.clouds) {
      (cl.material as THREE.SpriteMaterial).color.setRGB(
        lerp(1, 0.16, this.night), lerp(1, 0.19, this.night), lerp(1, 0.28, this.night),
      );
    }
    return;
  }

  /** Live zenith/horizon colours (no clone — these are read every frame by the water). */
  topColour(): THREE.Color {
    return this.uni.uTop.value as THREE.Color;
  }

  horizonColour(): THREE.Color {
    return this.uni.uHorizon.value as THREE.Color;
  }

  fogColor(): THREE.Color {
    return (this.uni.uHorizon.value as THREE.Color).clone();
  }

  sunDir(): THREE.Vector3 {
    return this.uni.uSunDir.value as THREE.Vector3;
  }

  /** Keeps the dome centred on the camera and the shadow frustum centred on the player. */
  update(dt: number, camX: number, camZ: number, focus: THREE.Vector3): void {
    this.dome.position.set(camX, 0, camZ);
    this.cloudGroup.position.set(camX, 0, camZ);
    for (const c of this.clouds) {
      c.position.x += dt * 1.6;
      if (c.position.x > 420) c.position.x -= 840;
    }
    const d = this.sunDir();
    this.sun.position.set(focus.x + d.x * 90, focus.y + d.y * 90 + 10, focus.z + d.z * 90);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
  }
}
