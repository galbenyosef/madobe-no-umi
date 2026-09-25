import * as THREE from 'three';
import { jugTexture } from './textures.js';

const deg = THREE.MathUtils.degToRad;

// A young olive tree in a majolica jug. Leaves are instanced; one vertex function moves
// branches, leaves and their shadows together in the breeze.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIND_GLSL = /* glsl */ `
uniform float uWindTime;
uniform float uWindAmp;
uniform float uFlutter;
vec3 windOffset(vec3 p) {
  float h = max(p.y - 0.2, 0.0);
  float w = h * h * 3.2;
  float ph = p.x * 5.0 + p.z * 3.0;
  float s = sin(uWindTime * 1.05 + ph) * 0.55 + sin(uWindTime * 2.4 + ph * 1.9) * 0.25 + sin(uWindTime * 0.33 + 1.0) * 0.45;
  return vec3(s * 0.85, s * 0.1, s * 0.35) * w * uWindAmp;
}
`;

function patchWind(material, { instanced = false, flutter = false, uniforms }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${flutter ? `{
          float ph = 0.0;
          #ifdef USE_INSTANCING
            ph = instanceMatrix[3].x * 37.0 + instanceMatrix[3].y * 23.0 + instanceMatrix[3].z * 11.0;
          #endif
          float a = uFlutter * (sin(uWindTime * 5.3 + ph) * 0.6 + sin(uWindTime * 8.1 + ph * 1.3) * 0.4) * clamp(transformed.x / 0.05, 0.0, 1.0);
          float cy = cos(a), sy = sin(a);
          transformed = vec3(transformed.x, transformed.y * cy - transformed.z * sy, transformed.y * sy + transformed.z * cy);
        }` : ''}`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        ${instanced ? '#ifdef USE_INSTANCING\n mvPosition = instanceMatrix * mvPosition;\n#endif' : ''}
        mvPosition.xyz += windOffset(mvPosition.xyz);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    if (instanced) {
      // worldpos for shadow lookups on the leaves themselves
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `
        vec4 worldPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          worldPosition = instanceMatrix * worldPosition;
        #endif
        worldPosition.xyz += windOffset(worldPosition.xyz);
        worldPosition = modelMatrix * worldPosition;`);
    }
  };
  material.customProgramCacheKey = () => `wind-${instanced}-${flutter}`;
}

/** Tube along a curve whose radius tapers from r0 to r1. */
function taperedTube(curve, r0, r1, segs = 16, radial = 6) {
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function leafGeometry(L = 0.058, W = 0.0062) {
  const segs = 7;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const x = (i / segs) * L;
    const t = i / segs;
    const hw = W * Math.pow(Math.sin(Math.PI * Math.min(t * 1.05, 1)), 0.75) * (1 - 0.25 * t);
    const fold = hw * 0.35;
    const droop = -Math.pow(t, 2) * L * 0.12;
    pos.push(x, droop + fold, hw, x, droop, 0, x, droop + fold, -hw);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    idx.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function jugGeometry() {
  // outer profile foot -> lip, then the inner wall back down to the soil
  const pts = [
    [0.0, 0.0], [0.062, 0.0], [0.068, 0.006], [0.08, 0.03], [0.093, 0.075], [0.095, 0.1], [0.09, 0.135],
    [0.078, 0.172], [0.074, 0.198], [0.079, 0.225], [0.087, 0.242], [0.085, 0.247], [0.075, 0.236],
    [0.069, 0.215], [0.068, 0.2], [0.0, 0.2],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 48);
  return geo;
}

export function createOlive({ ramp, uniforms }) {
  const group = new THREE.Group();
  const r = rng(7);

  // --- jug -------------------------------------------------------------------------
  const jugMat = new THREE.MeshToonMaterial({ map: jugTexture(), gradientMap: ramp });
  const jug = new THREE.Mesh(jugGeometry(), jugMat);
  jug.castShadow = true;
  jug.receiveShadow = true;
  group.add(jug);
  // handle on the viewer's right
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.076, 0.19, 0), new THREE.Vector3(0.118, 0.19, 0),
    new THREE.Vector3(0.132, 0.14, 0), new THREE.Vector3(0.112, 0.085, 0), new THREE.Vector3(0.09, 0.07, 0),
  ]);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 24, 0.009, 8, false), jugMat);
  handle.rotation.y = deg(-35);
  handle.castShadow = true;
  group.add(handle);
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(0.069, 32).rotateX(-Math.PI / 2),
    new THREE.MeshToonMaterial({ color: '#4a3a2c', gradientMap: ramp }),
  );
  soil.position.y = 0.205;
  soil.receiveShadow = true;
  group.add(soil);

  // --- trunk & branches -------------------------------------------------------------
  const barkMat = new THREE.MeshToonMaterial({ color: '#76685a', gradientMap: ramp });
  patchWind(barkMat, { uniforms });
  const barkDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchWind(barkDepth, { uniforms });

  const woods = [];
  const leafMats = [];
  const trunkPts = [
    new THREE.Vector3(0.0, 0.2, 0.0), new THREE.Vector3(0.006, 0.28, 0.004),
    new THREE.Vector3(-0.004, 0.36, -0.006), new THREE.Vector3(0.01, 0.44, 0.0), new THREE.Vector3(0.004, 0.52, 0.006),
  ];
  const trunk = new THREE.CatmullRomCurve3(trunkPts);
  woods.push(taperedTube(trunk, 0.011, 0.005, 20, 7));

  const nodes = []; // {p, dir} where leaves attach
  const addLeafRun = (curve, t0, t1, spacing, len) => {
    const count = Math.max(2, Math.floor((len * (t1 - t0)) / spacing));
    for (let i = 0; i < count; i++) {
      const t = t0 + (t1 - t0) * ((i + 0.5) / count);
      nodes.push({ p: curve.getPointAt(t), dir: curve.getTangentAt(t), k: i });
    }
  };
  addLeafRun(trunk, 0.72, 1.0, 0.016, 0.34);

  const branches = [];
  const nb = 7;
  for (let b = 0; b < nb; b++) {
    const t = 0.42 + (b / (nb - 1)) * 0.5 + (r() - 0.5) * 0.05;
    const base = trunk.getPointAt(Math.min(t, 0.98));
    const ang = b * 2.4 + r() * 0.8;
    const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang) * 0.7);
    const up = 0.5 + r() * 0.7;
    const len = 0.1 + r() * 0.1 * (1.2 - t * 0.5);
    const p1 = base.clone().addScaledVector(out, len * 0.45).add(new THREE.Vector3(0, len * up * 0.4, 0));
    const p2 = base.clone().addScaledVector(out, len).add(new THREE.Vector3((r() - 0.5) * 0.03, len * up, (r() - 0.5) * 0.03));
    const curve = new THREE.CatmullRomCurve3([base, p1, p2]);
    woods.push(taperedTube(curve, 0.0045, 0.0015, 10, 5));
    branches.push(curve);
    addLeafRun(curve, 0.25, 1.0, 0.015, len * 1.1);
    // a twig or two
    for (let k = 0; k < 2; k++) {
      const tt = 0.45 + r() * 0.4;
      const tb = curve.getPointAt(tt);
      const dir = curve.getTangentAt(tt).clone();
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(k ? 1 : -1);
      const tl = 0.05 + r() * 0.05;
      const q1 = tb.clone().addScaledVector(dir, tl * 0.5).addScaledVector(side, tl * 0.4).add(new THREE.Vector3(0, tl * 0.25, 0));
      const q2 = tb.clone().addScaledVector(dir, tl).addScaledVector(side, tl * 0.7).add(new THREE.Vector3(0, tl * 0.35, 0));
      const tw = new THREE.CatmullRomCurve3([tb, q1, q2]);
      woods.push(taperedTube(tw, 0.0018, 0.0008, 6, 4));
      addLeafRun(tw, 0.2, 1.0, 0.013, tl * 1.1);
    }
  }
  const woodGeo = mergeGeometries(woods);
  const wood = new THREE.Mesh(woodGeo, barkMat);
  wood.customDepthMaterial = barkDepth;
  wood.castShadow = true;
  wood.receiveShadow = true;
  group.add(wood);

  // --- leaves -------------------------------------------------------------------------
  const leafGeo = leafGeometry();
  const leafMat = new THREE.MeshToonMaterial({ color: '#667a4c', gradientMap: ramp, side: THREE.DoubleSide });
  patchWind(leafMat, { instanced: true, flutter: true, uniforms });
  // silvery underside
  const baseCompile = leafMat.onBeforeCompile;
  leafMat.onBeforeCompile = (shader) => {
    baseCompile(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.56, 0.46), 0.6);`);
  };
  leafMats.push(leafMat);
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  patchWind(leafDepth, { instanced: true, flutter: true, uniforms });

  const count = nodes.length * 2;
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
  leaves.customDepthMaterial = leafDepth;
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  let li = 0;
  for (const n of nodes) {
    const d = n.dir.clone().normalize();
    const side0 = new THREE.Vector3().crossVectors(d, up);
    if (side0.lengthSq() < 1e-4) side0.set(1, 0, 0);
    side0.normalize();
    const roll = (n.k % 2) * Math.PI * 0.5 + (r() - 0.5) * 0.5;
    side0.applyAxisAngle(d, roll);
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const spread = 0.75 + r() * 0.35;
      const x = d.clone().multiplyScalar(Math.cos(spread)).addScaledVector(side0, Math.sin(spread) * sgn).normalize();
      // leaves tilt slightly upward towards the light
      x.y += 0.25;
      x.normalize();
      const zAxis = new THREE.Vector3().crossVectors(x, up);
      if (zAxis.lengthSq() < 1e-4) zAxis.set(0, 0, 1);
      zAxis.normalize().applyAxisAngle(x, (r() - 0.5) * 0.9);
      const yAxis = new THREE.Vector3().crossVectors(zAxis, x).normalize();
      m.makeBasis(x, yAxis, zAxis);
      q.setFromRotationMatrix(m);
      const sc = 0.8 + r() * 0.45;
      s.set(sc, sc, sc);
      m.compose(n.p, q, s);
      leaves.setMatrixAt(li, m);
      color.setHSL(0.21 + (r() - 0.5) * 0.04, 0.24 + r() * 0.1, 0.33 + r() * 0.1);
      leaves.setColorAt(li, color);
      li++;
    }
  }
  leaves.count = li;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  leaves.frustumCulled = false;
  group.add(leaves);

  return { group, height: 0.52 };
}

function mergeGeometries(geos) {
  // small local merge (position/normal/uv + index) to avoid another import
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
