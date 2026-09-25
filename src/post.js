import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Final look: exposure, contrast, saturation, tinted shadows, vignette and a whisper of
// grain, applied after bloom so highlights glow like an anime "diffusion" filter.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uLift: { value: new THREE.Vector3() },
    uVignette: { value: 0.25 },
    uGrain: { value: 0.018 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure, uContrast, uSaturation, uVignette, uGrain, uTime;
    uniform vec3 uLift;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c += uLift * (1.0 - clamp(c, 0.0, 1.0));
      vec2 q = vUv - 0.5;
      q.x *= uRes.x / uRes.y;
      float v = smoothstep(1.05, 0.28, length(q));
      c *= mix(1.0 - uVignette, 1.0, v);
      c += (hash(vUv * uRes + fract(uTime) * 91.7) - 0.5) * uGrain;
      c = pow(max(c, 0.0), vec3(2.2));
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function createPost(renderer, { exterior, interior, extCam, intCam }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // on HiDPI screens the pixel density already smooths edges; MSAA would cost a third of the frame
  const samples = (window.devicePixelRatio || 1) >= 1.5 ? 0 : 4;
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  const extPass = new RenderPass(exterior, extCam);
  const intPass = new RenderPass(interior, intCam);
  intPass.clear = false;
  intPass.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 1.0);
  const grade = new ShaderPass(GradeShader);
  const output = new OutputPass();
  composer.addPass(extPass);
  composer.addPass(intPass);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(output);

  return {
    composer,
    bloom,
    grade,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      grade.uniforms.uRes.value.set(w * pr, h * pr);
    },
    render() {
      composer.render();
    },
  };
}
