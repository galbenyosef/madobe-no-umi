import * as THREE from 'three';
import { NOISE, SKY_GRADIENT } from './glsl.js';

// Painted sky: gradient, a bank of towering clouds on the horizon, thin streaks,
// sun and moon discs and stars. Everything is a function of view direction, so the
// dome is drawn at infinity around whichever camera renders it.

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform float uStars;
uniform float uSunDisk;
uniform vec3 uSunDiskColor;
uniform float uMoonDisk;
uniform vec3 uMoonColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uCloudRim;
uniform float uCloudBank;
uniform float uStreaks;
${NOISE}
${SKY_GRADIENT}

// Anime cumulus on the horizon: a pile of spheres seen from the side, each lobe shaded
// on its own with a cel step and a bright rim towards the sun. az / el in degrees.
float bankEnv(float x) {
  // a few cloud piles at chosen bearings (x wraps around the horizon)
  // (squares written out: pow() of a negative base is NaN on some GPUs)
  x = mod(x + 180.0, 360.0) - 180.0;
  vec4 d1 = (vec4(x) - vec4(13.0, -31.0, 47.0, 118.0)) / vec4(8.5, 6.5, 7.0, 12.0);
  float d2 = (x + 110.0) / 10.0;
  vec4 g = exp(-d1 * d1);
  float e = g.x + g.y * 0.55 + g.z * 0.8 + g.w * 0.9 + exp(-d2 * d2) * 0.8;
  e *= 0.85 + 0.3 * snoise(vec2(x * 0.09, 2.3));
  return smoothstep(0.12, 0.95, e);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

vec4 cloudBank(float az, float el) {
  if (el > 11.0 || uCloudBank <= 0.0) return vec4(0.0);
  float x = az + uTime * 0.008;
  if (max(bankEnv(x), max(bankEnv(x - 3.5), bankEnv(x + 3.5))) < 0.02) return vec4(0.0);
  float sunAz = degrees(atan(uSunDir.x, -uSunDir.z));
  // low sun lights the piles from the side, high sun from above
  vec3 L = normalize(vec3(sin(radians(sunAz - az)) * 1.1, clamp(uSunDir.y * 1.9, 0.12, 0.95), 0.45));
  float aa = max(fwidth(el), 0.003) * 1.5;
  const float E = 0.06;
  // outline: a smooth union of lobes, sampled at p, p+dx, p+dy for the rim direction
  float D0 = 1e3, Dx = 1e3, Dy = 1e3;
  float front = -1e3;
  vec3 nFront = vec3(0.0, 0.0, 1.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float cell = mix(2.4, 1.3, fk * 0.5);
    float c = floor(x / cell);
    for (int j = -2; j <= 2; j++) {
      float ci = c + float(j);
      float h1 = hash12(vec2(ci, fk * 13.1 + 1.0));
      float h2 = hash12(vec2(ci, fk * 13.1 + 5.0));
      float cx = (ci + 0.5 + (h1 - 0.5) * 0.7) * cell;
      float env = bankEnv(cx);
      if (env < 0.05) continue;
      float H = mix(0.9, 5.2, env) * uCloudBank;
      float rad = cell * (0.6 + 0.45 * h2) * mix(0.5, 1.1, env);
      float cy = H * (0.18 + 0.33 * fk) * (0.85 + 0.3 * h1) + sin(uTime * 0.03 + h1 * 6.28) * 0.06;
      vec2 q = vec2(x - cx, el - cy);
      float dd = length(q);
      float sd = dd - rad;
      D0 = smin(D0, sd, 0.45);
      Dx = smin(Dx, length(q + vec2(E, 0.0)) - rad, 0.45);
      Dy = smin(Dy, length(q + vec2(0.0, E)) - rad, 0.45);
      if (sd < 0.0) {
        float z = sqrt(max(rad * rad - dd * dd, 0.0)) - fk * cell * 0.5;
        if (z > front) { front = z; nFront = vec3(q / rad, sqrt(max(1.0 - dd * dd / (rad * rad), 0.0))); }
      }
    }
  }
  // flat underside resting on the haze
  float envHere = bankEnv(x);
  float baseTop = mix(0.9, 5.2, envHere) * uCloudBank * 0.24;
  // (raised smoothly where the envelope thins out, so it has no vertical edges)
  float slab = el - baseTop + (1.0 - smoothstep(0.04, 0.2, envHere)) * 12.0;
  D0 = smin(D0, slab, 0.3);
  Dx = smin(Dx, slab, 0.3);
  Dy = smin(Dy, slab + E, 0.3);
  float cov = smoothstep(aa, -aa, D0);
  if (cov <= 0.0) return vec4(0.0);

  vec2 g = vec2(Dx - D0, Dy - D0) / E;
  // light: the pile's broad shape (from the smooth cluster envelope) first, height in the
  // pile second, single lobes last - so notches between lobes never steer the shading
  float Hloc = max(mix(0.9, 5.2, envHere) * uCloudBank, 0.4);
  float hgt = clamp((el - baseTop * 0.6) / Hloc, 0.0, 1.0);
  float slope = bankEnv(x + 0.6) - bankEnv(x - 0.6);
  vec3 nMass = normalize(vec3(-slope * 2.5, 0.25 + hgt, 0.55));
  // every puff gets a shaded underside; its light stays overhead even when the sun is low,
  // otherwise side light would carve vertical "drips" into the pile
  vec3 Llobe = normalize(vec3(L.x * 0.35, max(L.y, 0.75), 0.35));
  float lobe = front > -1e2 ? dot(nFront, Llobe) : 0.2;
  float lit = dot(nMass, L) * 0.3 + (hgt - 0.3) * 0.55 + (lobe - 0.25) * 0.6;
  float tone = smoothstep(-0.08, 0.12, lit);
  vec3 col = mix(uCloudShade, uCloudLit, tone);
  // a soft mid band where light turns to shade
  float band = (lit - 0.07) / 0.1;
  col = mix(col, mix(uCloudShade, uCloudLit, 0.62), exp(-band * band) * 0.3);
  // faint creases where a lobe sits in front of another
  float crease = (1.0 - smoothstep(0.0, 0.2, nFront.z)) * smoothstep(-0.05, -0.3, D0) * tone;
  col *= 1.0 - crease * 0.05;
  // rim light on the edge facing the sun; a low sun behind the pile gilds every edge
  float dz = (az - sunAz) / 14.0;
  float back = smoothstep(0.35, 0.0, uSunDir.y) * exp(-dz * dz);
  float rimW = mix(0.3, 0.75, back);
  float rim = smoothstep(-rimW, 0.0, D0) * max(max(dot(normalize(g + 1e-5), normalize(L.xy)), 0.0), back);
  col = mix(col, uCloudRim, clamp(rim * (0.75 + back * 0.6), 0.0, 1.0));
  col += uCloudRim * back * smoothstep(-0.12, 0.0, D0) * 0.9;
  // the underside is in shadow and melts into the haze near the sea
  col *= mix(0.9, 1.0, smoothstep(0.0, baseTop * 2.2 + 0.4, el));
  col = mix(col, uHaze, smoothstep(0.9, 0.0, el) * 0.45);
  return vec4(col, cov);
}

vec4 streaks(vec3 d) {
  if (d.y < 0.004) return vec4(0.0);
  vec2 p = d.xz / d.y * 1.4;
  p.x += uTime * 0.012;
  vec2 q = vec2(p.x * 0.3, p.y * 2.4);
  float n = fbm2(q * 0.5 + vec2(3.1, 1.3)) + 0.3 * snoise(q * 2.3);
  float cover = smoothstep(0.32, 0.7, n) * uStreaks;
  cover *= smoothstep(0.02, 0.08, d.y) * smoothstep(0.5, 0.18, d.y);
  float lit = smoothstep(0.3, 0.8, n + 0.2 * snoise(q * 4.0));
  vec3 col = mix(uCloudShade, uCloudLit, 0.6 + 0.4 * lit);
  float sd = max(dot(d, uSunDir), 0.0);
  col = mix(col, uCloudRim, pow(sd, 10.0) * 0.8);
  return vec4(col, cover * 0.6);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyGradient(d);
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float az = degrees(atan(d.x, -d.z));

  // stars
  if (uStars > 0.0 && d.y > 0.0) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    if (h > 0.972) {
      vec3 c = cell + 0.5 + (vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5) * 0.7;
      float dist = length(sp - c) / 260.0;
      float px = max(fwidth(d.y), 1e-5);
      float star = smoothstep(px * 1.6, 0.0, dist);
      float tw = 0.65 + 0.35 * sin(uTime * (1.3 + h * 3.0) + h * 40.0);
      float mag = pow((h - 0.972) / 0.028, 2.2);
      col += vec3(0.85, 0.9, 1.0) * star * tw * mag * 2.2 * uStars * smoothstep(0.0, 0.08, d.y);
    }
  }

  // moon
  if (uMoonDisk > 0.0) {
    float md = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
    float r = 0.0115;
    float px = max(fwidth(md), 1e-5);
    float disc = smoothstep(r + px, r - px, md);
    vec3 tang = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 bit = cross(tang, uMoonDir);
    vec2 mp = vec2(dot(d - uMoonDir, tang), dot(d - uMoonDir, bit)) / r;
    float maria = 0.82 + 0.18 * smoothstep(-0.2, 0.5, snoise(mp * 2.2 + 3.0));
    col = mix(col, uMoonColor * maria * 1.6, disc * uMoonDisk);
  }

  // sun disc (only reads when it is low enough to be inside the view)
  if (uSunDisk > 0.0) {
    float sdist = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    float r = 0.019;
    float px = max(fwidth(sdist), 1e-5);
    float disc = smoothstep(r + px * 1.5, r - px * 1.5, sdist);
    col = mix(col, uSunDiskColor * 3.2, disc * uSunDisk);
    col += uSunDiskColor * smoothstep(0.09, 0.0, sdist) * 0.45 * uSunDisk;
  }

  vec4 s = streaks(d);
  col = mix(col, s.rgb, s.a);
  vec4 b = cloudBank(az, el);
  col = mix(col, b.rgb, b.a);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createSky(uniforms) {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
