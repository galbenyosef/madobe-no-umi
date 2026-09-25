import * as THREE from 'three';
import { NOISE, COLOR } from './glsl.js';

// The painted village, cliffs and hills, re-projected onto a depth-displaced grid seen
// from the original camera. Small head movements then produce real parallax.

const vertexShader = /* glsl */ `
attribute float aDepth;
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vDepth = aDepth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vDepth;
uniform sampler2D uLandTex;
uniform sampler2D uLandAlpha;
uniform sampler2D uLandAux;
uniform vec2 uAuxTexel;
uniform float uTime;
uniform float uWind;
uniform vec3 uLandTint;
uniform vec3 uShadowTint;
uniform vec3 uSunTint;
uniform float uLandSat;
uniform vec3 uLandHaze;
uniform float uLandHazeAmt;
uniform float uFarHaze;
uniform sampler2D uLights;
uniform float uWindows;
${NOISE}
${COLOR}

void main() {
  vec4 aux = texture2D(uLandAux, vUv);
  float fol = aux.r;
  vec2 off = vec2(0.0);
  if (fol > 0.02) {
    // foliage rustles: neighbouring texels are pulled in, so crowns and edges sway
    float t = uTime * uWind;
    float n1 = snoise(vUv * vec2(110.0, 60.0) + vec2(t * 0.45, 0.0));
    float n2 = snoise(vUv * vec2(50.0, 90.0) - vec2(0.0, t * 0.37));
    float gust = 0.6 + 0.4 * sin(t * 0.23 + vUv.x * 9.0);
    off = vec2(n1, n2 * 0.55) * fol * uAuxTexel * 1.35 * gust;
  }
  float a = texture2D(uLandAlpha, vUv + off).r;
  if (a < 0.01) discard;
  vec3 c = texture2D(uLandTex, vUv + off).rgb;

  float l = luma(c);
  float lit = smoothstep(0.16, 0.6, l);
  c *= mix(uShadowTint, uSunTint, lit) * uLandTint;
  c = saturateColor(c, uLandSat);

  float far = smoothstep(250.0, 900.0, vDepth);
  float haze = clamp((1.0 - exp(-vDepth / 1800.0)) * uLandHazeAmt + far * uFarHaze, 0.0, 1.0);
  c = mix(c, uLandHaze, haze);

  // lit windows: lights come on one by one as the evening deepens
  if (uWindows > 0.001) {
    vec3 lt = texture2D(uLights, vUv).rgb;
    float id = lt.g;
    float on = smoothstep(id - 0.04, id + 0.04, uWindows * 1.08 - 0.06);
    float tv = step(0.93, fract(id * 17.3)) * (0.75 + 0.25 * sin(uTime * 7.0 + id * 40.0));
    vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.82, 0.55), fract(id * 5.7));
    warm = mix(warm, vec3(0.6, 0.75, 1.0), tv);
    float flick = 0.92 + 0.08 * sin(uTime * (1.5 + id * 3.0) + id * 20.0);
    c += warm * (lt.r * 1.65 + lt.b * 0.2) * on * flick * uWindows;
  }

  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;

/**
 * @param {object} o
 * @param {Float32Array} o.depth  camera-space depth per grid vertex (metres)
 * @param {number} o.nx
 * @param {number} o.ny
 * @param {number} o.step         grid spacing in source pixels
 * @param {object} o.cam          camera model from scene.json
 * @param {object} o.image        {width, height}
 * @param {THREE.Camera} o.photoCam
 * @param {Uint8ClampedArray} o.coverage  land coverage sampled at the grid (0..255)
 */
export function createLand({ depth, nx, ny, step, cam, image, photoCam, coverage, uniforms }) {
  const W = image.width;
  const H = image.height;
  const n = nx * ny;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const dep = new Float32Array(n);
  const v = new THREE.Vector3();
  photoCam.updateMatrixWorld(true);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const gx = Math.min(i * step, W);
      const gy = Math.min(j * step, H);
      const z = depth[k];
      v.set(((gx - cam.cx) / cam.focal) * z, (-(gy - cam.cy) / cam.focal) * z, -z);
      photoCam.localToWorld(v);
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = v.y;
      pos[k * 3 + 2] = v.z;
      uv[k * 2] = gx / W;
      uv[k * 2 + 1] = 1 - gy / H;
      dep[k] = z;
    }
  }
  // only keep cells that touch land (dilated by one vertex)
  const keep = new Uint8Array(n);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (coverage[j * nx + i] > 2) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj;
            const ii = i + di;
            if (jj >= 0 && jj < ny && ii >= 0 && ii < nx) keep[jj * nx + ii] = 1;
          }
        }
      }
    }
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (keep[a] || keep[b] || keep[c] || keep[d]) idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
  geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}
