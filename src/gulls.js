import * as THREE from 'three';

// A few gulls riding the breeze over the bay. Most glide in wide loops far out; now and
// then one sweeps past close to the window.

function wingGeometry(span, chord, tip) {
  // inner half-wing from the body (x=0) to the wrist (x=span), slightly swept
  const s = new THREE.Shape();
  s.moveTo(0, chord * 0.5);
  s.lineTo(span, chord * 0.35 - tip);
  s.lineTo(span, -chord * 0.35 - tip);
  s.lineTo(0, -chord * 0.5);
  s.lineTo(0, chord * 0.5);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  return g;
}

function makeGull(mats) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mats.white);
  body.scale.set(0.85, 0.8, 2.6);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mats.white);
  head.position.set(0, 0.04, 0.26);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.08, 5), mats.beak);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.03, 0.34);
  g.add(beak);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), mats.white);
  tail.rotation.x = -Math.PI / 2;
  tail.scale.set(1, 1, 0.25);
  tail.position.set(0, 0.0, -0.3);
  g.add(tail);
  const wings = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.06, 0.03, 0.02);
    const inner = new THREE.Mesh(wingGeometry(0.34, 0.2, 0.02), mats.wing);
    inner.scale.x = side;
    shoulder.add(inner);
    const wrist = new THREE.Group();
    wrist.position.set(side * 0.34, 0, -0.02);
    const outer = new THREE.Mesh(wingGeometry(0.3, 0.15, 0.06), mats.wing);
    outer.scale.x = side;
    wrist.add(outer);
    const tipM = new THREE.Mesh(wingGeometry(0.1, 0.08, 0.02), mats.tip);
    tipM.scale.x = side;
    tipM.position.set(side * 0.27, 0.001, -0.07);
    wrist.add(tipM);
    shoulder.add(wrist);
    g.add(shoulder);
    wings.push({ shoulder, wrist, side });
  }
  return { group: g, wings };
}

export function createGulls({ origin, ramp }) {
  const group = new THREE.Group();
  const mats = {
    white: new THREE.MeshToonMaterial({ color: '#f7f7f4', gradientMap: ramp }),
    wing: new THREE.MeshToonMaterial({ color: '#c9d0d8', gradientMap: ramp, side: THREE.DoubleSide }),
    tip: new THREE.MeshToonMaterial({ color: '#2c3036', gradientMap: ramp, side: THREE.DoubleSide }),
    beak: new THREE.MeshToonMaterial({ color: '#e8b43c', gradientMap: ramp }),
  };
  // loops: centre (relative to the window), radii, height, angular speed, direction
  const loops = [
    { c: [60, 0, -260], r: [120, 70], h: 32, w: 0.05, s: 1 },
    { c: [-40, 0, -420], r: [150, 90], h: 55, w: 0.035, s: -1 },
    { c: [180, 0, -520], r: [110, 80], h: -12, w: 0.045, s: 1 },
    { c: [10, 0, -150], r: [70, 40], h: -18, w: 0.07, s: -1 },
    // the close pass: a long ellipse that brushes past the window every minute or so
    { c: [4, 0, -40], r: [60, 26], h: -3, w: 0.1, s: 1, close: true },
  ];
  const gulls = loops.map((l, i) => {
    const m = makeGull(mats);
    m.group.scale.setScalar(l.close ? 1.0 : 1.2);
    group.add(m.group);
    return { ...m, loop: l, phase: i * 2.1, flap: Math.random() * 10 };
  });

  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  let visibleLevel = 1;
  return {
    group,
    gulls,
    setVisible(v) { visibleLevel = v; },
    update(dt, t) {
      for (const g of gulls) {
        const l = g.loop;
        const a = t * l.w * l.s + g.phase;
        const pos = (ang, out) => out.set(
          origin.x + l.c[0] + Math.cos(ang) * l.r[0],
          origin.y + l.h + Math.sin(ang * 2.0 + g.phase) * 3,
          origin.z + l.c[2] + Math.sin(ang) * l.r[1],
        );
        pos(a, p);
        pos(a + 0.01 * l.s, q);
        g.group.position.copy(p);
        g.group.lookAt(q);
        // bank into the turn
        g.group.rotateZ(-0.35 * l.s);
        // glide most of the time, flap in bursts
        const burst = Math.max(0, Math.sin(t * 0.21 + g.phase * 3.0)) ** 3;
        const f = Math.sin(t * 9 + g.flap) * (0.12 + burst * 0.75);
        const dihedral = 0.12 - burst * 0.05;
        for (const w of g.wings) {
          w.shoulder.rotation.z = w.side * (dihedral + f);
          w.wrist.rotation.z = w.side * (-0.18 + f * 0.6);
        }
        g.group.visible = visibleLevel > 0.05;
      }
    },
  };
}
