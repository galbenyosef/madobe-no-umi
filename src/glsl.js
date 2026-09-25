// Shared GLSL snippets.

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 permute3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * snoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`;

// Colour helpers shared by the exterior shaders.
export const COLOR = /* glsl */ `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 saturateColor(vec3 c, float s) { float l = luma(c); return mix(vec3(l), c, s); }
`;

// Sky colour as a function of direction; the sea reuses it for reflections.
export const SKY_GRADIENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uSkyMid;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform vec3 uMoonDir;
uniform vec3 uMoonGlow;
vec3 skyGradient(vec3 d) {
  float h = d.y;
  vec3 c = mix(uHorizon, uSkyMid, smoothstep(0.0, 0.16, h));
  c = mix(c, uZenith, smoothstep(0.1, 0.75, h));
  c = mix(c, uHaze, exp(-max(h, 0.0) * 34.0) * 0.75);
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.55 + pow(sd, 600.0) * 1.2);
  float md = max(dot(d, uMoonDir), 0.0);
  c += uMoonGlow * (pow(md, 40.0) * 0.35 + pow(md, 900.0) * 0.8);
  return c;
}
`;
