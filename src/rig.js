import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;

// Head-coupled view. The interior camera moves by the real head offset; the exterior
// camera moves by an exaggerated amount so the village shows a little depth too
// (the two scenes never share geometry, so the mismatch is invisible).
export class ViewRig {
  constructor({ origin, basePitch, interiorCam, exteriorCam, element }) {
    this.origin = origin.clone();
    this.basePitch = basePitch;
    this.int = interiorCam;
    this.ext = exteriorCam;
    this.el = element;
    this.exaggeration = 3.2;
    this.pointer = new THREE.Vector2();
    this.cur = new THREE.Vector2();
    this.lean = 0.24;
    this.leanTarget = 0.24;
    this.leanMin = 0.1;
    this.leanMax = 0.62;
    this.yawBias = 0;
    this.yawBiasTarget = 0;
    this.panRange = 0;
    this.touch = null;
    this.lastInput = performance.now();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._bind();
  }

  _bind() {
    const el = this.el;
    const onMove = (e) => {
      if (e.pointerType === 'touch') return;
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
      this.lastInput = performance.now();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', () => this.pointer.set(0, 0));
    window.addEventListener('blur', () => this.pointer.set(0, 0));

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touch = { id: e.pointerId, x: e.clientX, y: e.clientY, px: this.pointer.x, py: this.pointer.y, bias: this.yawBiasTarget };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.touch || e.pointerId !== this.touch.id) return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - this.touch.x) / r.width;
      const dy = (e.clientY - this.touch.y) / r.height;
      if (this.panRange > 0) {
        this.yawBiasTarget = THREE.MathUtils.clamp(this.touch.bias + dx * 1.6 * this.panRange, -this.panRange, this.panRange);
        this.pointer.set(0, THREE.MathUtils.clamp(this.touch.py + dy * 2.2, -1, 1));
      } else {
        this.pointer.set(
          THREE.MathUtils.clamp(this.touch.px - dx * 2.2, -1, 1),
          THREE.MathUtils.clamp(this.touch.py + dy * 2.2, -1, 1),
        );
      }
      this.lastInput = performance.now();
    }, { passive: true });
    const end = (e) => { if (this.touch && e.pointerId === this.touch.id) this.touch = null; };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.leanTarget = THREE.MathUtils.clamp(this.leanTarget + e.deltaY * 0.0006, this.leanMin, this.leanMax);
      this.lastInput = performance.now();
    }, { passive: false });
  }

  /** Fit both cameras to the canvas: keep ~72 deg across on landscape screens. */
  resize(aspect) {
    const hfov = deg(72);
    let vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    vfov = THREE.MathUtils.clamp(vfov, deg(36), deg(62));
    const hNow = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // on narrow screens let the viewer pan across the view with a swipe
    const range = Math.max(0, (hfov - hNow) / 2) * 0.85;
    if (Math.abs(range - this.panRange) > 1e-3) {
      this.panRange = range;
      this.yawBiasTarget = range > 0 ? deg(-4) : 0;
      this.yawBias = this.yawBiasTarget;
    }
    for (const cam of [this.int, this.ext]) {
      cam.fov = THREE.MathUtils.radToDeg(vfov);
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  }

  update(dt, t) {
    const idleFor = (performance.now() - this.lastInput) / 1000;
    if (idleFor > 6 && !this.touch) this.pointer.multiplyScalar(Math.exp(-dt * 0.4));
    const k = 1 - Math.exp(-dt * 1.9);
    this.cur.lerp(this.pointer, k);
    this.lean += (this.leanTarget - this.lean) * (1 - Math.exp(-dt * 3));
    this.yawBias += (this.yawBiasTarget - this.yawBias) * (1 - Math.exp(-dt * 4));

    const m = this.reduced ? 0.35 : 1;
    const drift = this.reduced ? 0 : 1;
    const bx = (0.013 * Math.sin(t * 0.19) + 0.006 * Math.sin(t * 0.41 + 1.3)) * drift;
    const by = (0.008 * Math.sin(t * 0.16 + 0.4) + 0.004 * Math.sin(t * 0.47)) * drift;
    const hx = this.cur.x * 0.075 * m + bx;
    const hy = -this.cur.y * 0.042 * m + by;

    this.int.position.set(this.origin.x + hx, this.origin.y + hy, this.origin.z + this.lean);
    const e = this.exaggeration;
    this.ext.position.set(this.origin.x + hx * e, this.origin.y + hy * e, this.origin.z + this.lean);

    const yaw = -this.cur.x * deg(2.2) * m + this.yawBias + deg(0.25) * Math.sin(t * 0.11) * drift;
    const pitch = this.basePitch + this.cur.y * deg(1.4) * m + deg(0.15) * Math.sin(t * 0.09 + 2) * drift;
    this.int.rotation.set(-pitch, yaw, 0, 'YXZ');
    this.ext.rotation.copy(this.int.rotation);
    this.int.updateMatrixWorld();
    this.ext.updateMatrixWorld();
  }
}
