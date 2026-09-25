import * as THREE from 'three';
import { NOISE, COLOR, SKY_GRADIENT } from './glsl.js';

export const MAX_BOATS = 6;

// The sea is a real plane at y = 0. Its base colour is the painted photo projected
// from the original camera; waves, glitter, strokes, foam and wakes are drawn on top.

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform sampler2D uSeaTex;
uniform sampler2D uSeaAux;
uniform mat4 uPhotoVP;
uniform float uTime;
uniform vec3 uSeaTint;
uniform float uSeaSat;
uniform float uReflect;
uniform float uGlitter;
uniform vec3 uGlitterColor;
uniform vec3 uGlitterDir;
uniform float uGlitterSigma;
uniform float uStrokes;
uniform vec3 uFoamColor;
uniform float uFogAmt;
uniform vec4 uBoats[${MAX_BOATS}];   // x, z, heading (rad), speed (m/s)
uniform float uBoatWake[${MAX_BOATS}];
${NOISE}
${COLOR}
${SKY_GRADIENT}

#define PI 3.14159265

// Sum of directional waves, returns the surface gradient (dh/dx, dh/dz).
vec2 waveGrad(vec2 p, float t, float fp) {
  vec2 g = vec2(0.0);
  // gusts: patches of rougher and calmer water
  float gust = 0.65 + 0.55 * snoise(p * 0.004 + vec2(t * 0.01, -t * 0.006));
  const int N = 6;
  float lam[6]; lam[0] = 38.0; lam[1] = 19.0; lam[2] = 8.5; lam[3] = 4.1; lam[4] = 2.0; lam[5] = 1.1;
  float ang[6]; ang[0] = -0.38; ang[1] = 0.05; ang[2] = -0.72; ang[3] = 0.4; ang[4] = -0.2; ang[5] = 0.85;
  float stp[6]; stp[0] = 0.07; stp[1] = 0.065; stp[2] = 0.06; stp[3] = 0.055; stp[4] = 0.05; stp[5] = 0.045;
  for (int i = 0; i < N; i++) {
    float k = 2.0 * PI / lam[i];
    vec2 dir = vec2(sin(ang[i]), cos(ang[i]));
    float w = sqrt(9.81 * k);
    float ph = dot(p, dir) * k - w * t + float(i) * 1.7;
    float lod = 1.0 - smoothstep(lam[i] * 0.12, lam[i] * 0.45, fp);
    float amp = stp[i] * lod * (i > 2 ? gust : 1.0);
    g += dir * cos(ph) * amp;
  }
  return g;
}

float sparkleCells(vec2 p, float t, float prob, float fp) {
  float cs = 1.1;
  vec2 g = p / cs;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id);
  float rate = 0.7 + h * 1.6;
  float tt = t * rate + h * 13.0;
  float slot = floor(tt);
  float env = sin(fract(tt) * PI);
  float on = step(1.0 - prob, hash12(id + slot * 1.37 + 0.5));
  vec2 c = vec2(hash12(id + 3.1), hash12(id + 7.7)) * 0.6 + 0.2;
  float r = length((f - c) * cs);
  float size = max(fp * 1.35, 0.03);
  return on * env * smoothstep(size, size * 0.2, r);
}

void main() {
  vec3 P = vWorld;
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fp = max(max(length(dFdx(P.xz)), length(dFdy(P.xz))), 1e-4);

  vec2 grad = waveGrad(P.xz, uTime, fp);
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec4 clip = uPhotoVP * vec4(P, 1.0);
  vec2 uv = clamp(clip.xy / clip.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));
  vec4 aux = texture2D(uSeaAux, uv);
  float shore = aux.r;
  float shallow = aux.g;
  float open = aux.b;

  // painted base, gently wobbled by the waves so the brush strokes breathe
  vec2 wob = grad * 0.0035 * clamp(60.0 / dist, 0.12, 1.0);
  vec3 base = texture2D(uSeaTex, uv + wob).rgb;
  base = saturateColor(base, uSeaSat) * uSeaTint;

  // sky reflection (Fresnel) on top of the painted colour
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(base, skyGradient(R), clamp(fres * uReflect, 0.0, 1.0));

  // sunlight netting over the sandy shallows of the cove
  if (shallow > 0.02 && uGlitterDir.y > 0.0) {
    vec2 cp = P.xz * 0.7;
    float c1 = snoise(cp + vec2(uTime * 0.21, uTime * 0.13));
    float c2 = snoise(cp * 1.37 - vec2(uTime * 0.17, -uTime * 0.19) + 4.1);
    float net = smoothstep(0.16, 0.0, abs(c1 + c2 * 0.8));
    float fade = 1.0 - smoothstep(0.3, 1.2, fp);
    col += uGlitterColor * net * shallow * fade * smoothstep(0.0, 0.3, uGlitterDir.y) * 0.16 * uGlitter;
  }

  // brush-like wave crests drifting towards the shore
  if (uStrokes > 0.0) {
    vec2 dir = normalize(vec2(-0.38, 1.0));
    vec2 perp = vec2(dir.y, -dir.x);
    float along = dot(P.xz, dir);
    float across = dot(P.xz, perp);
    float lam = 7.5;
    float w = along / lam - uTime * 0.16 + 0.9 * snoise(vec2(across * 0.018, along * 0.006) + uTime * 0.01);
    float fw = fwidth(w);
    float dd = abs(fract(w) - 0.5);
    float line = smoothstep(0.5 - 0.06 - fw, 0.5 - 0.06 + fw, dd);
    float dash = smoothstep(0.15, 0.55, snoise(vec2(across / (lam * 3.5), floor(w) * 3.1) + vec2(uTime * 0.02, 0.0)));
    float fade = (1.0 - smoothstep(0.08, 0.35, fw)) * smoothstep(900.0, 120.0, dist);
    float s = line * dash * fade * open * (1.0 - shore * 0.8) * uStrokes;
    col = mix(col, col * 1.28 + vec3(0.05, 0.07, 0.08), s * 0.55);
  }

  // glitter along the reflection of the sun (or moon)
  if (uGlitter > 0.0) {
    vec3 L = uGlitterDir;
    vec3 H = normalize(V + L);
    float tanT2 = max(1.0 - H.y * H.y, 0.0) / max(H.y * H.y, 1e-4);
    float dens = exp(-tanT2 / (2.0 * uGlitterSigma * uGlitterSigma));
    dens *= smoothstep(-0.02, 0.06, L.y);
    // near: discrete sparkles in world cells; far: shimmering sheen
    float nearW = 1.0 - smoothstep(0.25, 0.9, fp / 1.1);
    float sp = sparkleCells(P.xz, uTime, dens * 0.42, fp) * nearW;
    vec2 pix = floor(gl_FragCoord.xy * 0.5);
    float hp = hash12(pix);
    float tw = sin(fract(uTime * (0.35 + hp) + hp * 7.0) * PI);
    float farSp = step(1.0 - dens * 0.2, hash12(pix + floor(uTime * (0.35 + hp) + hp * 7.0) * 17.0)) * tw * (1.0 - nearW);
    float sheen = dens * (0.16 + 0.1 * snoise(P.xz * 0.05 + uTime * 0.2));
    float spec = pow(max(dot(R, L), 0.0), 300.0) * 1.5;
    col += uGlitterColor * uGlitter * (sheen + spec * dens + (sp + farSp) * 2.4) * open;
  }

  // foam breathing along rocks: a metre or so wide whatever the distance
  float pxPerM = 1193.9 / max(dist, 1.0);
  float band = clamp(0.9 * pxPerM / 28.0, 0.025, 0.35);
  float breath = 0.5 + 0.5 * sin(uTime * 0.7 - shore * 12.0 + snoise(P.xz * 0.04) * 3.0);
  float sEdge = shore - (1.0 - band * (0.75 + 0.5 * breath));
  float fn = snoise(P.xz * vec2(0.9, 0.7) + vec2(uTime * 0.12, 0.0)) * 0.5 + 0.5;
  float fn2 = snoise(P.xz * 2.3 - vec2(0.0, uTime * 0.2)) * 0.5 + 0.5;
  float foam = smoothstep(0.0, band * 0.25, sEdge) * smoothstep(0.5, 0.78, fn * 0.7 + fn2 * 0.5 + breath * 0.1);
  col = mix(col, uFoamColor, clamp(foam, 0.0, 1.0) * 0.55 * open);

  // a soft darker patch under each hull grounds the boats on the water
  for (int i = 0; i < ${MAX_BOATS}; i++) {
    vec4 b = uBoats[i];
    vec2 fwd = vec2(sin(b.z), cos(b.z));
    vec2 rel = P.xz - b.xy;
    vec2 loc = vec2(dot(rel, vec2(fwd.y, -fwd.x)), dot(rel, fwd));
    vec2 q = loc / vec2(2.2, 4.8);
    col *= 1.0 - 0.28 * exp(-dot(q, q) * 1.6);
  }

  // wakes
  for (int i = 0; i < ${MAX_BOATS}; i++) {
    vec4 b = uBoats[i];
    float wk = uBoatWake[i];
    if (wk <= 0.0) continue;
    vec2 fwd = vec2(sin(b.z), cos(b.z));
    vec2 rel = P.xz - b.xy;
    float along = -dot(rel, fwd);
    float side = dot(rel, vec2(fwd.y, -fwd.x));
    if (along < -4.0 || along > 160.0) continue;
    float fadeL = smoothstep(-4.0, 0.0, along) * (1.0 - smoothstep(20.0, 150.0, along));
    float arm = abs(abs(side) - along * 0.34);
    float armF = exp(-arm * arm / (0.5 + along * 0.05)) * (0.6 + 0.4 * snoise(vec2(along * 0.4, side * 0.4) - uTime));
    float trail = exp(-side * side / (1.2 + along * 0.08)) * (0.5 + 0.5 * snoise(vec2(along * 0.25, side) - uTime * 1.3));
    float bow = exp(-dot(rel, rel) / 10.0) * 0.6;
    float wake = (armF * 0.55 + trail * 0.75) * fadeL + bow;
    col = mix(col, uFoamColor, clamp(wake * wk, 0.0, 0.85));
  }

  // atmosphere towards the horizon
  float fog = 1.0 - exp(-dist / 16000.0);
  col = mix(col, uHaze, fog * uFogAmt);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createSea(uniforms) {
  const geo = new THREE.PlaneGeometry(70000, 70000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
