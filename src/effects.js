import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Small living details on the sill: tea steam, a candle flame and dust in the sunbeam.

function yBillboard(mesh) {
  const w = new THREE.Vector3();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mesh.getWorldPosition(w);
    const parent = mesh.parent;
    const pr = parent ? parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const yaw = Math.atan2(camera.position.x - w.x, camera.position.z - w.z);
    mesh.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0)).premultiply(pr.invert());
    mesh.updateMatrixWorld();
  };
}

export function createSteam() {
  const uniforms = { uTime: { value: 0 }, uLevel: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime, uLevel;
      ${NOISE}
      float wisp(vec2 uv, float seed, float t) {
        float y = uv.y;
        float sway = snoise(vec2(y * 1.4 - t * 0.22, seed)) * 0.24 * y + sin(y * 6.0 - t * 1.3 + seed) * 0.06 * y;
        float d = abs(uv.x - 0.5 - sway);
        float width = mix(0.02, 0.12, y);
        float body = smoothstep(width, width * 0.1, d);
        // the plume breaks into drifting puffs as it rises
        float n = snoise(vec2(uv.x * 7.0 + seed, y * 5.0 - t * 0.9));
        float breakup = smoothstep(-0.1 + y * 0.5, 0.5 + y * 0.4, n * 0.5 + 0.5 + (1.0 - y) * 0.35);
        return body * breakup;
      }
      void main() {
        float t = uTime;
        float a = wisp(vUv, 1.3, t) + wisp(vUv + vec2(0.05, 0.0), 7.1, t * 0.85 + 3.0) * 0.7;
        a *= smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
        gl_FragColor = vec4(vec3(1.0, 0.99, 0.97), a * 0.13 * uLevel);
      }`,
  });
  const geo = new THREE.PlaneGeometry(0.14, 0.22);
  geo.translate(0, 0.11, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  yBillboard(mesh);
  return {
    mesh,
    setLevel(l) { uniforms.uLevel.value = l; },
    update(t) { uniforms.uTime.value = t; },
  };
}

export function createFlame() {
  const uniforms = { uTime: { value: 0 }, uLevel: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime, uLevel;
      void main() {
        vec2 p = vUv - vec2(0.5, 0.28);
        float sway = sin(uTime * 7.0) * 0.03 + sin(uTime * 11.3) * 0.02;
        p.x -= sway * (p.y + 0.3);
        float r = length(vec2(p.x * 2.4, p.y > 0.0 ? p.y * 0.85 : p.y * 2.2));
        float core = smoothstep(0.22, 0.0, r);
        float glow = smoothstep(0.5, 0.0, length(vec2(p.x, p.y * 0.6))) * 0.35;
        vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.9, 0.62), core);
        gl_FragColor = vec4(col * (core * 1.7 + glow * 0.6) * uLevel, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.05), mat);
  mesh.renderOrder = 6;
  yBillboard(mesh);
  return {
    mesh,
    update(t, level) {
      uniforms.uTime.value = t;
      uniforms.uLevel.value = level;
      mesh.visible = level > 0.02;
    },
  };
}

// Specks drift everywhere but only light up where the sun comes through the opening.
export function createDust({ box, count = 220, aperture }) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new THREE.Vector3();
  box.getSize(size);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = box.min.x + Math.random() * size.x;
    pos[i * 3 + 1] = box.min.y + Math.random() * size.y;
    pos[i * 3 + 2] = box.min.z + Math.random() * size.z;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.5, -0.8) },
    uBoxMin: { value: box.min.clone() },
    uBoxSize: { value: size.clone() },
    uAperture: { value: aperture || new THREE.Vector4(-0.48, 0.57, -0.61, 0.58) },
    uApertureZ: { value: -0.9 },
    uPixelRatio: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uPixelRatio;
      uniform vec3 uSunDir, uBoxMin, uBoxSize;
      uniform vec4 uAperture;
      uniform float uApertureZ;
      varying float vLit;
      varying float vSeed;
      void main() {
        vec3 p = position;
        float t = uTime * 0.02;
        p += vec3(sin(t * 3.1 + aSeed * 40.0), sin(t * 2.3 + aSeed * 17.0) + t * 0.6, cos(t * 2.7 + aSeed * 23.0)) * vec3(0.12, 0.08, 0.1);
        p = uBoxMin + mod(p - uBoxMin, uBoxSize);
        // follow the ray back to the sun: does it pass through the window?
        float s = (uApertureZ - p.z) / uSunDir.z;
        vec3 q = p + uSunDir * s;
        float inside = step(uAperture.x, q.x) * step(q.x, uAperture.y) * step(uAperture.z, q.y) * step(q.y, uAperture.w);
        vLit = inside * step(0.0, s);
        vSeed = aSeed;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min((1.2 + aSeed * 1.8) * uPixelRatio * (0.9 / -mv.z), 6.0 * uPixelRatio);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLevel;
      varying float vLit;
      varying float vSeed;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c));
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + vSeed * 2.0) + vSeed * 30.0);
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a * vLit * tw * uLevel * 0.9, 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  points.onBeforeRender = (renderer) => { uniforms.uPixelRatio.value = renderer.getPixelRatio(); };
  return {
    points,
    uniforms,
    setLevel(l) { uniforms.uLevel.value = l; },
    setSun(dir) { uniforms.uSunDir.value.copy(dir); },
    update(dt, t) { uniforms.uTime.value = t; },
  };
}
