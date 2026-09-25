import * as THREE from 'three';

// Small canvas-painted textures for the room. Everything is generated at start-up so
// the repository only carries the photo-derived images.

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

function valueNoise(seed) {
  const r = rng(seed);
  const N = 256;
  const table = new Float32Array(N * N);
  for (let i = 0; i < table.length; i++) table[i] = r();
  const at = (x, y) => table[((y & (N - 1)) * N) + (x & (N - 1))];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
}

function fbm(noise, x, y, oct = 4) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x, y);
    x *= 2.03;
    y *= 2.03;
    a *= 0.5;
  }
  return s / (1 - Math.pow(0.5, oct));
}

function canvasTexture(w, h, paint, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function pixelPaint(g, w, h, fn) {
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, gg, b] = fn(x, y);
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Lime plaster: warm white with soft mottling. */
export function plasterTexture() {
  const n = valueNoise(11);
  return canvasTexture(256, 256, (g, w, h) => {
    pixelPaint(g, w, h, (x, y) => {
      const m = fbm(n, x / 48, y / 48, 4);
      const s = n(x * 0.9, y * 0.9);
      const v = 0.93 + (m - 0.5) * 0.07 + (s - 0.5) * 0.02;
      return [255 * v, 250 * v, 240 * v];
    });
  }, { repeat: true });
}

/** Carrara-like sill: cream stone, soft cloudy patches and a few thin veins. */
export function marbleTexture() {
  const n = valueNoise(23);
  const r = rng(29);
  return canvasTexture(1024, 512, (g, w, h) => {
    pixelPaint(g, w, h, (x, y) => {
      const cloud = (fbm(n, x / 160, y / 120, 5) - 0.5) * 0.07;
      const fine = (n(x * 0.6, y * 0.6) - 0.5) * 0.015;
      const base = 0.93 + cloud + fine;
      return [252 * base, 247 * base, 238 * base];
    });
    // veins: wandering hairlines
    g.lineCap = 'round';
    for (let v = 0; v < 9; v++) {
      let x = r() * w;
      let y = r() * h;
      let a = (r() - 0.5) * 1.2 + 0.4;
      g.strokeStyle = `rgba(120, 118, 124, ${0.07 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 1.3;
      g.beginPath();
      g.moveTo(x, y);
      const steps = 60 + Math.floor(r() * 80);
      for (let k = 0; k < steps; k++) {
        a += (n(x * 0.02, y * 0.02 + v * 7) - 0.5) * 0.5;
        x += Math.cos(a) * 6;
        y += Math.sin(a) * 6;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

/** Italian majolica jug: white glaze, cobalt flowers and bands. u wraps around. */
export function jugTexture() {
  const r = rng(5);
  return canvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = '#f7f4ee';
    g.fillRect(0, 0, w, h);
    const blue = (a) => `rgba(38, 72, 150, ${a})`;
    // bands (v runs from the foot at the bottom to the lip at the top)
    g.fillStyle = blue(0.9);
    g.fillRect(0, h * 0.07, w, h * 0.022);
    g.fillRect(0, h * 0.12, w, h * 0.008);
    g.fillRect(0, h * 0.9, w, h * 0.02);
    // sponge-dab flowers
    const flower = (cx, cy, s) => {
      const petals = 5 + Math.floor(r() * 2);
      const rot = r() * Math.PI;
      for (let p = 0; p < petals; p++) {
        const a = rot + (p / petals) * Math.PI * 2;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55, s * 0.42, s * 0.22, a, 0, Math.PI * 2);
        g.fillStyle = blue(0.75 + r() * 0.2);
        g.fill();
      }
      g.beginPath();
      g.arc(cx, cy, s * 0.16, 0, Math.PI * 2);
      g.fillStyle = '#f7f4ee';
      g.fill();
    };
    const leaf = (cx, cy, s, a) => {
      g.beginPath();
      g.ellipse(cx, cy, s * 0.5, s * 0.16, a, 0, Math.PI * 2);
      g.fillStyle = blue(0.55 + r() * 0.2);
      g.fill();
    };
    for (let i = 0; i < 26; i++) {
      const cx = r() * w;
      const cy = h * (0.22 + r() * 0.6);
      const s = 26 + r() * 30;
      for (let k = 0; k < 3; k++) leaf(cx + (r() - 0.5) * s * 2.2, cy + (r() - 0.5) * s * 1.6, s * 0.9, r() * Math.PI);
      flower(cx, cy, s);
      if (cx < s * 2) flower(cx + w, cy, s);
      if (cx > w - s * 2) flower(cx - w, cy, s);
    }
    // speckles of the sponge
    for (let i = 0; i < 900; i++) {
      g.fillStyle = blue(0.12 + r() * 0.25);
      g.fillRect(r() * w, h * (0.16 + r() * 0.7), 2 + r() * 3, 2 + r() * 3);
    }
  });
}

/** Weathered paint on the frame. */
export function paintTexture() {
  const n = valueNoise(41);
  return canvasTexture(256, 256, (g, w, h) => {
    pixelPaint(g, w, h, (x, y) => {
      const grain = n(x * 0.08, y * 1.3);
      const chip = fbm(n, x / 18 + 3, y / 18, 3);
      let v = 0.97 - grain * 0.035;
      if (chip > 0.74) v -= 0.1;
      return [252 * v, 250 * v, 244 * v];
    });
  }, { repeat: true });
}

/** Cloth weave for the curtain. */
export function linenTexture() {
  const n = valueNoise(57);
  return canvasTexture(256, 256, (g, w, h) => {
    pixelPaint(g, w, h, (x, y) => {
      const weave = 0.5 + 0.25 * Math.sin(x * 1.6) + 0.25 * Math.sin(y * 1.6);
      const slub = n(x * 0.05, y * 0.9);
      const v = 0.9 + weave * 0.06 + (slub - 0.5) * 0.06;
      return [255 * v, 252 * v, 245 * v];
    });
  }, { repeat: true });
}

/** Four-band toon ramp. */
export function toonRamp(levels = [0.36, 0.58, 0.82, 1.0]) {
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((l, i) => {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(l * 255);
    data[i * 4 + 3] = 255;
  });
  const t = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
