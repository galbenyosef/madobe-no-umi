import * as THREE from 'three';
import { MAX_BOATS } from './sea.js';

// Little boats crossing the bay. Their routes are drawn in photo pixels and dropped onto
// the sea plane, so they start and end behind the window frame or the headland.

function hullGeometry(L, B, D) {
  const g = new THREE.BoxGeometry(B, D, L, 4, 2, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i);
    const t = z / L + 0.5; // 0 stern .. 1 bow
    const pinch = 1 - THREE.MathUtils.smoothstep(t, 0.45, 1.0) * 0.93;
    x *= pinch;
    if (y < 0) {
      // V bottom that rises towards the bow
      const v = (1 - Math.abs(x) / (B * 0.5 + 1e-6)) * D * 0.45;
      y = y + (1 - pinch) * D * 0.35 - v * 0.4;
    } else {
      y += THREE.MathUtils.smoothstep(t, 0.7, 1.0) * D * 0.25; // sheer rises at the bow
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function makeMotorboat(mats, { L = 7, canopy = false, stripe }) {
  const g = new THREE.Group();
  const B = L * 0.34;
  const D = L * 0.16;
  const hull = new THREE.Mesh(hullGeometry(L, B, D), mats.white);
  hull.position.y = D * 0.3;
  g.add(hull);
  const band = new THREE.Mesh(hullGeometry(L * 1.001, B * 1.02, D * 0.18), stripe);
  band.position.y = D * 0.55;
  g.add(band);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(B * 0.82, D * 0.08, L * 0.62), mats.teak);
  deck.position.set(0, D * 0.82, -L * 0.1);
  g.add(deck);
  const cons = new THREE.Mesh(new THREE.BoxGeometry(B * 0.5, D * 0.7, L * 0.14), mats.white);
  cons.position.set(0, D * 1.15, L * 0.02);
  g.add(cons);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(B * 0.52, D * 0.45, L * 0.02), mats.glass);
  glass.position.set(0, D * 1.6, L * 0.1);
  glass.rotation.x = -0.5;
  g.add(glass);
  if (canopy) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(B * 0.86, D * 0.06, L * 0.3), stripe);
    top.position.set(0, D * 2.6, -L * 0.12);
    g.add(top);
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, D * 1.8, 5), mats.steel);
      pole.position.set(sx * B * 0.38, D * 1.7, -L * 0.22);
      g.add(pole);
    }
  }
  return g;
}

function makeSailboat(mats, { L = 10 }) {
  const g = new THREE.Group();
  const B = L * 0.3;
  const D = L * 0.12;
  const hull = new THREE.Mesh(hullGeometry(L, B, D), mats.white);
  hull.position.y = D * 0.3;
  g.add(hull);
  const mastH = L * 1.35;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, mastH, 6), mats.steel);
  mast.position.set(0, D + mastH / 2, L * 0.08);
  g.add(mast);
  const sail = (pts) => {
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    s.computeVertexNormals();
    return new THREE.Mesh(s, mats.sail);
  };
  // main sail and jib, slightly bellied
  g.add(sail([0.02, D + 0.8, L * 0.08, 0.02, D + mastH * 0.97, L * 0.08, 0.35, D + 0.9, -L * 0.36]));
  g.add(sail([0.02, D + mastH * 0.86, L * 0.1, 0.0, D + 0.6, L * 0.48, 0.3, D + 0.7, L * 0.12]));
  return g;
}

function navLights() {
  const g = new THREE.Group();
  const mk = (c) => new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
  const top = mk(new THREE.Color(3, 2.7, 2.2));
  top.position.set(0, 2.4, 0);
  const red = mk(new THREE.Color(3, 0.3, 0.2));
  red.position.set(-1.0, 1.2, 1.4);
  const green = mk(new THREE.Color(0.3, 3, 0.8));
  green.position.set(1.0, 1.2, 1.4);
  g.add(top, red, green);
  return g;
}

export function createBoats({ photoCam, image, seaUniforms, ramp }) {
  const group = new THREE.Group();
  const mats = {
    white: new THREE.MeshToonMaterial({ color: '#f4f2ec', gradientMap: ramp }),
    teak: new THREE.MeshToonMaterial({ color: '#b98a5a', gradientMap: ramp }),
    steel: new THREE.MeshToonMaterial({ color: '#c9cdd2', gradientMap: ramp }),
    glass: new THREE.MeshToonMaterial({ color: '#314a5c', gradientMap: ramp }),
    sail: new THREE.MeshToonMaterial({ color: '#fbf8f0', gradientMap: ramp, side: THREE.DoubleSide }),
  };
  const stripes = ['#1f4f8f', '#2a6f86', '#b44a3c', '#1f4f8f'].map(
    (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp }),
  );

  // photo pixel -> point on the sea
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const sea = (u, v) => {
    ndc.set((u / image.width) * 2 - 1, -(v / image.height) * 2 + 1);
    ray.setFromCamera(ndc, photoCam);
    ray.ray.intersectPlane(plane, hit);
    return new THREE.Vector2(hit.x, hit.z);
  };

  // routes in photo pixels; each boat runs its route and starts over
  const specs = [
    { from: [1720, 430], to: [820, 452], speed: 4.2, L: 7, canopy: true, stripe: 0, start: 0.42 },
    { from: [690, 292], to: [1760, 240], speed: 5.5, L: 8, stripe: 1, start: 0.25 },
    { from: [1700, 612], to: [760, 600], speed: 2.6, L: 6, stripe: 2, start: 0.55 },
    { from: [840, 342], to: [1720, 322], speed: 3.4, L: 6.5, canopy: true, stripe: 3, start: 0.1 },
    { from: [770, 181], to: [1760, 186], speed: 1.6, L: 11, sail: true, start: 0.6 },
    { idle: [1105, 665], L: 5.5, stripe: 1 },
  ];

  const boats = specs.map((s, i) => {
    const mesh = s.sail
      ? makeSailboat(mats, { L: s.L })
      : makeMotorboat(mats, { L: s.L, canopy: s.canopy, stripe: stripes[s.stripe] });
    const lights = navLights();
    lights.scale.setScalar(s.L / 7);
    lights.visible = false;
    mesh.add(lights);
    group.add(mesh);
    const b = { spec: s, mesh, lights, phase: i * 1.7 };
    if (s.idle) {
      b.pos = sea(...s.idle);
      b.heading = 0.8;
      b.s = 0;
    } else {
      b.a = sea(...s.from);
      b.b = sea(...s.to);
      b.len = b.a.distanceTo(b.b);
      b.dir = b.b.clone().sub(b.a).normalize();
      b.heading = Math.atan2(b.dir.x, b.dir.y);
      b.s = s.start * b.len;
    }
    return b;
  });

  const tmp = new THREE.Vector2();
  let night = 0;
  return {
    group,
    setNight(n) { night = n; },
    update(dt, t) {
      boats.forEach((b, i) => {
        let x;
        let z;
        let speed = 0;
        if (b.spec.idle) {
          b.heading += Math.sin(t * 0.05 + i) * dt * 0.02;
          x = b.pos.x;
          z = b.pos.y;
        } else {
          b.s += b.spec.speed * dt;
          if (b.s > b.len) b.s -= b.len;
          tmp.copy(b.a).addScaledVector(b.dir, b.s);
          // gentle meander
          const side = Math.sin(b.s * 0.02 + b.phase) * 6;
          x = tmp.x + b.dir.y * side;
          z = tmp.y - b.dir.x * side;
          speed = b.spec.speed;
        }
        const m = b.mesh;
        m.position.set(x, 0.05 * b.spec.L * 0.1 + Math.sin(t * 1.3 + b.phase) * 0.08, z);
        const heading = b.heading + Math.cos(b.s * 0.02 + b.phase) * 0.12;
        m.rotation.set(Math.sin(t * 0.9 + b.phase) * 0.025 - speed * 0.006, heading, Math.sin(t * 0.7 + b.phase * 2) * 0.04, 'YXZ');
        b.lights.visible = night > 0.35;
        if (i < MAX_BOATS) {
          seaUniforms.uBoats.value[i].set(x, z, heading, speed);
          // fade the wake near the ends of the route so it never pops
          const edge = b.spec.idle ? 0 : Math.min(1, b.s / 60, (b.len - b.s) / 60);
          seaUniforms.uBoatWake.value[i] = b.spec.idle ? 0 : THREE.MathUtils.clamp(speed / 5, 0.2, 1) * edge * (b.spec.sail ? 0.5 : 1);
        }
      });
    },
  };
}
