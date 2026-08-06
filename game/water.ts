import * as THREE from 'three';
import { rippleNormal } from './materials';

/**
 * Cheap, good-looking water.
 *
 * Deliberately NOT a planar reflection: that means rendering the scene a second time, which
 * is the single most expensive thing you can do to a browser game, for a couple of small
 * ponds and a fountain. Everything here is per-pixel maths in one pass:
 *
 *   · two scrolling samples of a procedural ripple normal map, at different scales
 *   · Fresnel — nearly transparent looking straight down, mirror-like at grazing angles
 *   · the sky colour as the "reflection", handed in from the sky dome so it matches
 *   · a tight sun glint plus a wide sheen, so it reads as wet across the whole surface
 *   · depth-based colour: shallow at the rim, deeper towards the middle
 *
 * Total cost: two texture samples and a dozen instructions per water pixel.
 */

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uRipple;
uniform float uTime;
uniform float uNight;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uShallow;
uniform vec3 uDeep;
varying vec3 vWorld;

void main() {
  // Two layers at different scales and drift directions: one set of ripples looks like a
  // sliding texture, two crossing sets look like water.
  vec2 uv1 = vWorld.xz * 0.115 + vec2(uTime * 0.014, uTime * 0.022);
  vec2 uv2 = vWorld.xz * 0.048 - vec2(uTime * 0.019, uTime * 0.010);
  vec2 n1 = texture2D(uRipple, uv1).xy * 2.0 - 1.0;
  vec2 n2 = texture2D(uRipple, uv2).xy * 2.0 - 1.0;
  vec2 slope = n1 * 0.65 + n2 * 0.5;
  // tangent space (x, y) maps to world (x, z) because the surface normal is +Y
  vec3 N = normalize(vec3(slope.x, 2.3, slope.y));

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.2);

  vec3 sky = mix(uSkyHorizon, uSkyTop, 0.5);
  vec3 body = mix(uShallow, uDeep, 0.55);
  vec3 col = mix(body, sky, clamp(0.07 + fres * 0.9, 0.0, 1.0));

  // sun: a tight glint plus a broad sheen
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  col += uSunColour * pow(nh, 230.0) * 2.4;
  col += uSunColour * pow(nh, 16.0) * 0.11;

  // crest sparkle where the two ripple sets pile up
  float crest = smoothstep(0.55, 1.05, length(slope));
  col += vec3(0.09) * crest * (1.0 - uNight * 0.7);

  float alpha = mix(0.74, 0.97, fres);
  gl_FragColor = vec4(col, alpha);
}`;

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uRipple: { value: rippleNormal() },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
      uSunColour: { value: new THREE.Color(0xfff0d4) },
      uSkyTop: { value: new THREE.Color(0x3f7fc4) },
      uSkyHorizon: { value: new THREE.Color(0xdce8ee) },
      uShallow: { value: new THREE.Color(0x3f8fa8) },
      uDeep: { value: new THREE.Color(0x14384f) },
    },
  });
}

export interface WaterEnv {
  time: number;
  night: number;
  sunDir: THREE.Vector3;
  sunColour: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
}

/** One uniform write per frame — the water reflects whatever the sky is currently doing. */
export function updateWater(m: THREE.ShaderMaterial, e: WaterEnv): void {
  const u = m.uniforms;
  u.uTime.value = e.time;
  u.uNight.value = e.night;
  (u.uSunDir.value as THREE.Vector3).copy(e.sunDir);
  (u.uSunColour.value as THREE.Color).copy(e.sunColour);
  (u.uSkyTop.value as THREE.Color).copy(e.skyTop);
  (u.uSkyHorizon.value as THREE.Color).copy(e.skyHorizon);
}
