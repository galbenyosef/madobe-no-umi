import * as THREE from 'three';
import { plasterTexture, marbleTexture, paintTexture, linenTexture, toonRamp } from './textures.js';
import { createOlive } from './plant.js';
import { createSteam, createFlame, createDust } from './effects.js';
import { createCurtain } from './curtain.js';

const deg = THREE.MathUtils.degToRad;

// Window geometry in metres, relative to where the photo was taken (+z = into the room).
// The clear opening is sized so that, seen from the default seat, it frames exactly the
// part of the photo that is outdoors.
export const WIN = {
  ZI: -0.62, // inner face of the wall
  ZF: -0.9, // centre of the window frame
  ZO: -1.04, // outer face of the wall
  XL: -0.479,
  XR: 0.574,
  YS: -0.66, // top of the sill
  YT: 0.58, // head of the opening
  FW: 0.065, // frame member width
  FD: 0.07, // frame depth
  SPLAY: Math.tan(deg(13)),
};

function quad(a, b, c, d, material) {
  const geo = new THREE.BufferGeometry();
  const p = [a, b, c, a, c, d].flatMap((v) => [v.x, v.y, v.z]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  // planar uv in metres along the two edges
  const u = b.clone().sub(a);
  const v = d.clone().sub(a);
  const uvs = [a, b, c, a, c, d].flatMap((q) => {
    const r = q.clone().sub(a);
    return [r.dot(u) / u.length(), r.dot(v) / v.length()];
  });
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(x0, x1, y0, y1, z0, z1, material) {
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function planeWithHole(outer, hole, z, material) {
  const [ox0, ox1, oy0, oy1] = outer;
  const [hx0, hx1, hy0, hy1] = hole;
  const s = new THREE.Shape();
  s.moveTo(ox0, oy0); s.lineTo(ox1, oy0); s.lineTo(ox1, oy1); s.lineTo(ox0, oy1); s.lineTo(ox0, oy0);
  const h = new THREE.Path();
  h.moveTo(hx0, hy0); h.lineTo(hx0, hy1); h.lineTo(hx1, hy1); h.lineTo(hx1, hy0); h.lineTo(hx0, hy0);
  s.holes.push(h);
  const geo = new THREE.ShapeGeometry(s);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.z = z;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function lathe(points, segs, material) {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createInterior({ origin }) {
  const group = new THREE.Group();
  group.position.copy(origin);
  const ramp = toonRamp([0.42, 0.62, 0.84, 1.0]);
  const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...o });
  const { ZI, ZF, ZO, XL, XR, YS, YT, FW, FD, SPLAY } = WIN;

  const plaster = plasterTexture();
  const wallMat = toon({ color: '#f1e9dc', map: plaster, side: THREE.DoubleSide });
  const revealMat = toon({ color: '#f4ede2', map: plaster, side: THREE.DoubleSide });
  const outerMat = toon({ color: '#e9b99c', side: THREE.DoubleSide }); // the peach facade outside
  const paint = paintTexture();
  const frameMat = toon({ color: '#f6f3ee', map: paint });
  const marble = marbleTexture();
  const sillMat = toon({ color: '#ffffff', map: marble });

  // --- wall and splayed reveals ---------------------------------------------------------
  const zFi = ZF + FD / 2; // room side of the frame
  const zFo = ZF - FD / 2;
  const d = zFi - ZI; // negative: depth of the inner reveal
  const spl = Math.abs(d) * SPLAY;
  const xiL = XL - FW - spl;
  const xiR = XR + FW + spl;
  const yiT = YT + FW + spl;
  group.add(planeWithHole([-3.2, 3.2, -1.6, 2.0], [xiL, xiR, YS, yiT], ZI, wallMat));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  group.add(quad(V(XL - FW, YS, zFi), V(XL - FW, YT + FW, zFi), V(xiL, yiT, ZI), V(xiL, YS, ZI), revealMat));
  group.add(quad(V(XR + FW, YS, zFi), V(xiR, YS, ZI), V(xiR, yiT, ZI), V(XR + FW, YT + FW, zFi), revealMat));
  group.add(quad(V(XL - FW, YT + FW, zFi), V(XR + FW, YT + FW, zFi), V(xiR, yiT, ZI), V(xiL, yiT, ZI), revealMat));
  // straight outer reveals and the facade
  group.add(quad(V(XL - FW, YS - 0.03, ZO), V(XL - FW, YT + FW, ZO), V(XL - FW, YT + FW, zFo), V(XL - FW, YS - 0.03, zFo), outerMat));
  group.add(quad(V(XR + FW, YS - 0.03, ZO), V(XR + FW, YS - 0.03, zFo), V(XR + FW, YT + FW, zFo), V(XR + FW, YT + FW, ZO), outerMat));
  group.add(quad(V(XL - FW, YT + FW, ZO), V(XR + FW, YT + FW, ZO), V(XR + FW, YT + FW, zFo), V(XL - FW, YT + FW, zFo), outerMat));
  group.add(planeWithHole([-4, 4, -3, 3], [XL - FW, XR + FW, YS - 0.03, YT + FW], ZO, outerMat));

  // --- frame ----------------------------------------------------------------------------
  group.add(box(XL - FW, XL, YS, YT + FW, zFo, zFi, frameMat));
  group.add(box(XR, XR + FW, YS, YT + FW, zFo, zFi, frameMat));
  group.add(box(XL - FW, XR + FW, YT, YT + FW, zFo, zFi, frameMat));
  group.add(box(XL, XR, YS, YS + 0.05, zFo, zFi, frameMat));

  // --- sills ----------------------------------------------------------------------------
  const sillShape = new THREE.Shape();
  const over = 0.05;
  // drawn in (x, z); after rotateX(+90deg) shape-y becomes world z and the extrusion goes down
  sillShape.moveTo(XL - FW, zFo);
  sillShape.lineTo(XR + FW, zFo);
  sillShape.lineTo(XR + FW, zFi);
  sillShape.lineTo(xiR, ZI);
  sillShape.lineTo(xiR + 0.03, ZI);
  sillShape.lineTo(xiR + 0.03, ZI + over);
  sillShape.lineTo(xiL - 0.03, ZI + over);
  sillShape.lineTo(xiL - 0.03, ZI);
  sillShape.lineTo(xiL, ZI);
  sillShape.lineTo(XL - FW, zFi);
  sillShape.lineTo(XL - FW, zFo);
  const sillGeo = new THREE.ExtrudeGeometry(sillShape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
  sillGeo.rotateX(Math.PI / 2);
  // uv in metres for the marble
  const sp = sillGeo.attributes.position;
  const suv = new Float32Array(sp.count * 2);
  for (let i = 0; i < sp.count; i++) {
    suv[i * 2] = sp.getX(i) * 0.7 + 0.5;
    suv[i * 2 + 1] = sp.getZ(i) * 1.4 + sp.getY(i) * 1.4;
  }
  sillGeo.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
  const sill = new THREE.Mesh(sillGeo, sillMat);
  sill.position.y = YS - 0.004; // the bevel lifts the top face by its thickness
  sill.castShadow = true;
  sill.receiveShadow = true;
  group.add(sill);
  group.add(box(XL - FW - 0.04, XR + FW + 0.04, YS - 0.075, YS - 0.03, ZO - 0.05, zFo, sillMat));

  // --- glass casements folded back against the reveals -----------------------------------
  const glassMat = new THREE.MeshBasicMaterial({ color: '#d6e6ee', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const sashW = (XR - XL) / 2;
  const sashH = YT - (YS + 0.05);
  const makeSash = (sign) => {
    const g = new THREE.Group();
    const w = sashW;
    const s = 0.05;
    const x0 = sign > 0 ? 0 : -w;
    const x1 = sign > 0 ? w : 0;
    g.add(box(x0, x0 + s, 0, sashH, -0.02, 0.02, frameMat));
    g.add(box(x1 - s, x1, 0, sashH, -0.02, 0.02, frameMat));
    g.add(box(x0, x1, 0, s, -0.02, 0.02, frameMat));
    g.add(box(x0, x1, sashH - s, sashH, -0.02, 0.02, frameMat));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * s, sashH - 2 * s), glassMat);
    glass.position.set((x0 + x1) / 2, sashH / 2, 0);
    g.add(glass);
    return g;
  };
  const sashL = makeSash(1);
  sashL.position.set(XL, YS + 0.05, zFi + 0.025);
  sashL.rotation.y = deg(-101);
  group.add(sashL);
  const sashR = makeSash(-1);
  sashR.position.set(XR, YS + 0.05, zFi + 0.025);
  sashR.rotation.y = deg(101);
  group.add(sashR);

  // --- things on the sill ---------------------------------------------------------------
  // [x, z] of each thing. The left casement folds back along the reveal and the curtain
  // swings in from the right, so everything keeps clear of both - the candle most of all.
  const SPOT = {
    olive: [-0.38, -0.67],
    book: [-0.07, -0.7],
    candle: [0.1, -0.81],
    cup: [0.25, -0.7],
  };
  const windU = {
    uWindTime: { value: 0 },
    uWindAmp: { value: 0.02 },
    uFlutter: { value: 0.12 },
  };
  const olive = createOlive({ ramp, uniforms: windU });
  olive.group.position.set(SPOT.olive[0], YS, SPOT.olive[1]);
  olive.group.rotation.y = deg(20);
  group.add(olive.group);

  // cup and saucer
  const china = toon({ color: '#f8f5ef' });
  const rimMat = toon({ color: '#2f5aa3' });
  const cup = new THREE.Group();
  cup.position.set(SPOT.cup[0], YS, SPOT.cup[1]);
  const saucer = lathe([[0, 0.002], [0.03, 0.002], [0.034, 0.0], [0.066, 0.006], [0.078, 0.013], [0.079, 0.016], [0.075, 0.015], [0.064, 0.01], [0.036, 0.007], [0, 0.007]], 48, china);
  cup.add(saucer);
  const body = lathe([[0, 0.008], [0.026, 0.008], [0.029, 0.01], [0.036, 0.03], [0.042, 0.058], [0.044, 0.068], [0.0415, 0.068], [0.039, 0.058], [0.033, 0.03], [0.026, 0.014], [0, 0.014]], 48, china);
  cup.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0428, 0.0016, 6, 48).rotateX(Math.PI / 2), rimMat);
  rim.position.y = 0.0675;
  cup.add(rim);
  const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0038, 8, 24, Math.PI * 1.25), china);
  cupHandle.position.set(0.046, 0.04, 0);
  cupHandle.rotation.set(0, 0, deg(-112));
  cupHandle.castShadow = true;
  cup.add(cupHandle);
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.039, 40).rotateX(-Math.PI / 2), toon({ color: '#8a4a1f' }));
  tea.position.y = 0.056;
  cup.add(tea);
  cup.rotation.y = deg(-30);
  group.add(cup);

  // a closed book with a ribbon marker
  const book = new THREE.Group();
  const coverMat = toon({ color: '#2f5b62' });
  const pageMat = toon({ color: '#f2ead9' });
  book.add(box(-0.075, 0.075, 0, 0.004, -0.105, 0.105, coverMat));
  book.add(box(-0.075, 0.075, 0.026, 0.03, -0.105, 0.105, coverMat));
  book.add(box(-0.075, -0.07, 0, 0.03, -0.105, 0.105, coverMat));
  book.add(box(-0.07, 0.072, 0.004, 0.026, -0.102, 0.102, pageMat));
  const ribbon = box(0.0, 0.006, -0.002, 0.004, 0.1, 0.14, toon({ color: '#b3423a' }));
  ribbon.rotation.x = deg(-35);
  book.add(ribbon);
  book.position.set(SPOT.book[0], YS, SPOT.book[1]);
  book.rotation.y = deg(18);
  group.add(book);

  // candle in a glass jar, lit in the evening (well away from the curtain)
  const jar = new THREE.Group();
  jar.position.set(SPOT.candle[0], YS, SPOT.candle[1]);
  const jarGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.034, 0.085, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: '#e7efe9', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  );
  jarGlass.position.y = 0.0425;
  jar.add(jarGlass);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.045, 24), toon({ color: '#f3ead6' }));
  wax.position.y = 0.0225;
  wax.castShadow = true;
  jar.add(wax);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.01, 6), toon({ color: '#2b2520' }));
  wick.position.y = 0.05;
  jar.add(wick);
  const flame = createFlame();
  flame.mesh.position.y = 0.064;
  jar.add(flame.mesh);
  group.add(jar);

  // steam above the cup
  const steam = createSteam();
  steam.mesh.position.set(SPOT.cup[0], YS + 0.07, SPOT.cup[1]);
  group.add(steam.mesh);

  // curtain on the right, drifting in the breeze
  // (gathered to the side on a rod across the opening, just inside the frame)
  const cw = 0.2;
  const curtain = createCurtain({ map: linenTexture(), ramp, width: cw, height: 1.3 });
  curtain.mesh.position.set(XR + FW + spl * 0.35 - cw, YT + FW + 0.02, zFi + 0.085);
  group.add(curtain.mesh);

  // dust in the sunbeam
  const dust = createDust({
    box: new THREE.Box3(new THREE.Vector3(XL - 0.1, YS + 0.02, ZF + 0.05), new THREE.Vector3(XR + 0.1, YT, ZI + 0.3)),
    aperture: new THREE.Vector4(XL, XR, YS + 0.05, YT),
  });
  dust.uniforms.uApertureZ.value = ZF;
  group.add(dust.points);

  // --- light ------------------------------------------------------------------------------
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -1.0; sc.right = 1.0; sc.top = 1.0; sc.bottom = -1.0; sc.near = 0.5; sc.far = 7;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.012;
  const target = new THREE.Object3D();
  target.position.set(0.05, YS + 0.2, -0.75);
  group.add(target);
  sun.target = target;
  group.add(sun);
  const hemi = new THREE.HemisphereLight('#dfe8ff', '#e7d2b4', 1.0);
  group.add(hemi);
  const lamp = new THREE.PointLight('#ffb468', 0, 3.2, 2);
  lamp.position.set(SPOT.candle[0], YS + 0.075, SPOT.candle[1]);
  group.add(lamp);

  const tmp = new THREE.Vector3();
  let lampLevel = 0;
  let wind = 0.02;

  return {
    group,
    applyTime(s) {
      const sunUp = THREE.MathUtils.smoothstep(s.sunDir.y, -0.03, 0.06);
      tmp.copy(s.moonDir).lerp(s.sunDir, sunUp).normalize();
      sun.position.copy(target.position).addScaledVector(tmp, 4);
      sun.color.setRGB(s.sunColor.x, s.sunColor.y, s.sunColor.z);
      sun.intensity = s.sunLight * sunUp + (1 - sunUp) * 0.35;
      hemi.color.setRGB(s.hemiSky.x, s.hemiSky.y, s.hemiSky.z);
      hemi.groundColor.setRGB(s.hemiGround.x, s.hemiGround.y, s.hemiGround.z);
      hemi.intensity = s.hemi;
      lampLevel = s.lamp;
      steam.setLevel(1 - s.lamp * 0.3);
      dust.setLevel(sunUp * (1 - s.lamp * 0.8));
      dust.setSun(s.sunDir);
    },
    setWind(w) {
      wind = w;
    },
    update(dt, t) {
      windU.uWindTime.value = t;
      windU.uWindAmp.value = 0.012 + wind * 0.03;
      windU.uFlutter.value = 0.08 + wind * 0.22;
      const flick = 0.82 + 0.1 * Math.sin(t * 13.7) + 0.06 * Math.sin(t * 23.1 + 1.3) + 0.05 * Math.sin(t * 5.3);
      lamp.intensity = lampLevel * 0.045 * flick;
      flame.update(t, lampLevel);
      steam.update(t);
      curtain.update(t, wind);
      dust.update(dt, t);
    },
  };
}
