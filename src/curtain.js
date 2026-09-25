import * as THREE from 'three';

// A sheer linen curtain hanging on the right. Pleats are fixed; the breeze lifts the
// hem into the room and lets light through where the cloth is thin.

export function createCurtain({ map, ramp, width = 0.6, height = 1.3 }) {
  const geo = new THREE.PlaneGeometry(width, height, 36, 60);
  geo.translate(width / 2, -height / 2, 0); // hang from the top-left corner
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uWidth: { value: width },
    uHeight: { value: height },
  };
  const mat = new THREE.MeshToonMaterial({
    color: '#fbf8f2',
    map,
    gradientMap: ramp,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uWind, uWidth, uHeight;
        varying float vThin;
        vec3 drape(vec3 p) {
          float u = p.x / uWidth;           // 0 at the inner (left) edge
          float v = -p.y / uHeight;         // 0 at the rod, 1 at the hem
          // gathered pleats, deeper towards the wall side
          float pleat = sin(u * 6.2831 * 5.5) * (0.018 + 0.014 * u);
          float hang = v * v;
          // breeze: the hem swings into the room and towards the view
          float g = uWind * (0.55 + 0.45 * sin(uTime * 0.61 + u * 1.7) + 0.25 * sin(uTime * 1.37 + v * 3.0));
          // capped so even a strong gust keeps the hem clear of the cup and the candle
          float billow = min(g, 1.1) * hang * 0.2;
          float ripple = sin(v * 7.0 - uTime * 2.1 + u * 4.0) * 0.012 * g * v;
          vec3 q = p;
          q.z += pleat + billow + ripple;
          q.x -= billow * 0.4 * (1.0 - u * 0.6);
          q.y += billow * 0.12;
          return q;
        }`)
      .replace('#include <begin_vertex>', `vec3 transformed = drape(position);
        vThin = 0.5 + 0.5 * sin((position.x / uWidth) * 6.2831 * 5.5);`)
      .replace('#include <beginnormal_vertex>', `
        vec3 e = vec3(0.004, 0.0, 0.0);
        vec3 f = vec3(0.0, 0.004, 0.0);
        vec3 pa = drape(position);
        vec3 objectNormal = normalize(cross(drape(position + e) - pa, drape(position + f) - pa));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vThin;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.a *= mix(0.72, 1.0, vThin);`);
  };
  mat.customProgramCacheKey = () => 'curtain';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 8;
  mesh.frustumCulled = false;

  // wooden rod
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, width + 0.12, 12).rotateZ(Math.PI / 2),
    new THREE.MeshToonMaterial({ color: '#8a6a4a', gradientMap: ramp }),
  );
  rod.position.set(width / 2, 0.012, 0);
  mesh.add(rod);

  return {
    mesh,
    update(t, wind) {
      uniforms.uTime.value = t;
      uniforms.uWind.value = 0.25 + wind * 0.9;
    },
  };
}
