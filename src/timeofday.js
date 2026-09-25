import * as THREE from 'three';

// Four looks for the same window. The day look follows the photo; the others keep the
// sun on the sea side (right) so the painted shading stays believable.
// `t` runs 0..4 around the loop morning -> day -> evening -> night -> morning.

const deg = THREE.MathUtils.degToRad;

export const TIMES = ['morning', 'day', 'evening', 'night'];

const P = {
  morning: {
    sun: [44, 11], moon: [-30, -10],
    sunColor: '#ffd8b4', sunLight: 2.3, sunDisk: 0,
    zenith: '#6f9fd6', skyMid: '#a7c3e4', horizon: '#f2d6cf', haze: '#f5e0d6',
    sunGlow: '#ffd2b0', moonGlow: '#000000', moonColor: '#ffffff',
    cloudLit: '#fff4ec', cloudShade: '#ddd2e2', cloudRim: '#ffe8d2', cloudBank: 0.78, streaks: 0.9,
    stars: 0, moonDisk: 0,
    landTint: [1.0, 0.97, 0.96], shadowTint: [0.86, 0.87, 1.0], sunTint: [1.07, 1.0, 0.93],
    landSat: 0.92, landHaze: '#eed9d6', landHazeAmt: 0.22, farHaze: 0.45,
    seaTint: [0.96, 0.99, 1.04], seaSat: 0.9, reflect: 0.45,
    glitter: 0.85, glitterColor: '#ffe6cc', glitterSigma: 0.1, strokes: 0.8,
    foam: '#f4f1f4', fogAmt: 0.5,
    hemiSky: '#d9e2f5', hemiGround: '#e8cdb8', hemi: 1.05,
    lamp: 0, windows: 0,
    exposure: 1.0, contrast: 0.97, saturation: 0.96, bloom: 0.42, lift: '#1a1420', vignette: 0.28,
  },
  day: {
    sun: [30, 30], moon: [-30, -10],
    sunColor: '#fff2df', sunLight: 2.9, sunDisk: 0,
    zenith: '#3d7fd4', skyMid: '#77afe6', horizon: '#d2e5f3', haze: '#e7eff4',
    sunGlow: '#fff0d4', moonGlow: '#000000', moonColor: '#ffffff',
    cloudLit: '#fffbf4', cloudShade: '#b9c6de', cloudRim: '#ffffff', cloudBank: 0.95, streaks: 1.0,
    stars: 0, moonDisk: 0,
    landTint: [1, 1, 1], shadowTint: [1, 1, 1], sunTint: [1, 1, 1],
    landSat: 1.0, landHaze: '#d7e6f0', landHazeAmt: 0.1, farHaze: 0.25,
    seaTint: [1, 1, 1], seaSat: 1.0, reflect: 0.3,
    glitter: 1.0, glitterColor: '#fff6e6', glitterSigma: 0.11, strokes: 1.0,
    foam: '#f7fbff', fogAmt: 0.35,
    hemiSky: '#d4e4fb', hemiGround: '#e9d3b5', hemi: 1.15,
    lamp: 0, windows: 0,
    exposure: 1.0, contrast: 1.0, saturation: 1.0, bloom: 0.36, lift: '#000000', vignette: 0.22,
  },
  evening: {
    sun: [16, 3.2], moon: [-30, -10],
    sunColor: '#ff9d57', sunLight: 2.1, sunDisk: 1,
    zenith: '#36498a', skyMid: '#a86d8e', horizon: '#ffae6a', haze: '#ffc387',
    sunGlow: '#ff9f55', moonGlow: '#000000', moonColor: '#ffffff',
    cloudLit: '#ffc48f', cloudShade: '#8d6f93', cloudRim: '#ffe7b0', cloudBank: 1.0, streaks: 1.1,
    stars: 0.05, moonDisk: 0,
    landTint: [1.0, 0.84, 0.74], shadowTint: [0.6, 0.53, 0.78], sunTint: [1.28, 0.9, 0.64],
    landSat: 1.06, landHaze: '#e3957c', landHazeAmt: 0.3, farHaze: 0.5,
    seaTint: [0.78, 0.66, 0.8], seaSat: 0.95, reflect: 0.7,
    glitter: 1.3, glitterColor: '#ffbf73', glitterSigma: 0.12, strokes: 0.8,
    foam: '#ffd9c2', fogAmt: 0.55,
    hemiSky: '#b9a4c8', hemiGround: '#f0b28a', hemi: 0.9,
    lamp: 0.25, windows: 0.18,
    exposure: 1.0, contrast: 1.03, saturation: 1.04, bloom: 0.55, lift: '#1c1026', vignette: 0.3,
  },
  night: {
    sun: [16, -18], moon: [5, 8.5],
    sunColor: '#7d8fc4', sunLight: 0.0, sunDisk: 0,
    zenith: '#070d24', skyMid: '#111d42', horizon: '#26375f', haze: '#2c3d66',
    sunGlow: '#000000', moonGlow: '#8ea3d8', moonColor: '#f3f1e6',
    cloudLit: '#56679a', cloudShade: '#1a2342', cloudRim: '#9fb0e0', cloudBank: 0.55, streaks: 0.7,
    stars: 1, moonDisk: 1,
    landTint: [0.21, 0.25, 0.4], shadowTint: [0.8, 0.85, 1.05], sunTint: [1.0, 1.0, 1.0],
    landSat: 0.62, landHaze: '#1c2a4c', landHazeAmt: 0.25, farHaze: 0.45,
    seaTint: [0.2, 0.26, 0.44], seaSat: 0.7, reflect: 0.55,
    glitter: 0.9, glitterColor: '#c9d6ff', glitterSigma: 0.08, strokes: 0.35,
    foam: '#56658e', fogAmt: 0.45,
    hemiSky: '#3a4a7a', hemiGround: '#20233a', hemi: 0.55,
    lamp: 1, windows: 1,
    exposure: 1.0, contrast: 1.04, saturation: 1.0, bloom: 0.75, lift: '#070b1a', vignette: 0.36,
  },
};

function toVec(c) {
  if (Array.isArray(c)) return new THREE.Vector3(c[0], c[1], c[2]);
  const col = new THREE.Color(c);
  return new THREE.Vector3(col.r, col.g, col.b);
}

// Pre-convert every preset into numbers / vectors (linear colour).
const PRE = TIMES.map((name) => {
  const src = P[name];
  const out = {};
  for (const [k, val] of Object.entries(src)) {
    if (typeof val === 'number') out[k] = val;
    else if (k === 'sun' || k === 'moon') out[k] = val.slice();
    else out[k] = toVec(val);
  }
  return out;
});

export function dirFromAzEl(azDeg, elDeg, target = new THREE.Vector3()) {
  const az = deg(azDeg);
  const el = deg(elDeg);
  return target.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

const smooth = (x) => x * x * (3 - 2 * x);

/** Blend the presets at loop position t (0..4). Returns a fresh plain object. */
export function sampleTime(t) {
  const tt = ((t % 4) + 4) % 4;
  const i = Math.floor(tt);
  const f = smooth(tt - i);
  const a = PRE[i];
  const b = PRE[(i + 1) % 4];
  const o = {};
  for (const k of Object.keys(a)) {
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'number') o[k] = va + (vb - va) * f;
    else if (Array.isArray(va)) o[k] = [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f];
    else o[k] = va.clone().lerp(vb, f);
  }
  // night -> morning: the sun climbs from below the sea on the right
  o.sunDir = dirFromAzEl(o.sun[0], o.sun[1]);
  o.moonDir = dirFromAzEl(o.moon[0], o.moon[1]);
  return o;
}
