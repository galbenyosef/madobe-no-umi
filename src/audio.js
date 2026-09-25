// Window ambience, synthesised: the surf far below, wind in the curtain, a glass chime
// on gusts and crickets after dark. Nothing is downloaded.

function noiseBuffer(ctx, kind, seconds = 6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
    // soften the loop seam
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) {
      const a = i / f;
      d[i] = d[i] * a + d[len - f + i] * (1 - a);
    }
  }
  return buf;
}

export class Ambience {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.wind = 0.3;
    this.night = 0;
    this._timers = [];
  }

  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.9, t, 1.2);
    this.on = true;
    this._scheduleWaves();
    this._scheduleChime();
    this._scheduleCrickets();
  }

  stop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.4);
    this.on = false;
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }

  // called every frame; the audio graph only hears about it a few times a second
  setWind(w) {
    this.wind = w;
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    if (t - (this._windAt || 0) < 0.25) return;
    this._windAt = t;
    this.windGain.gain.setTargetAtTime(0.025 + w * 0.09, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(380 + w * 650, t, 1.0);
  }

  setNight(n) {
    this.night = n;
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    if (t - (this._nightAt || 0) < 0.5) return;
    this._nightAt = t;
    this.cricketBus.gain.setTargetAtTime(Math.max(0, (n - 0.4) / 0.6) * 0.05, t, 2);
  }

  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    const brown = noiseBuffer(ctx, 'brown');
    const pink = noiseBuffer(ctx, 'pink');
    const white = noiseBuffer(ctx, 'white', 3);
    const loop = (buf, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start();
      return s;
    };

    // steady wash of the open sea
    const bed = loop(brown, 0.9);
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 320;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.18;
    bed.connect(bedLp).connect(bedGain).connect(this.master);

    // breaking waves: swell (low) + fizz (high) shaped per wave
    const surf = loop(pink, 0.8);
    this.surfLp = ctx.createBiquadFilter();
    this.surfLp.type = 'lowpass';
    this.surfLp.frequency.value = 400;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0.02;
    const surfPan = ctx.createStereoPanner();
    surfPan.pan.value = -0.15;
    surf.connect(this.surfLp).connect(this.surfGain).connect(surfPan).connect(this.master);

    const fizz = loop(white, 1);
    const fizzBp = ctx.createBiquadFilter();
    fizzBp.type = 'bandpass';
    fizzBp.frequency.value = 3200;
    fizzBp.Q.value = 0.6;
    this.fizzGain = ctx.createGain();
    this.fizzGain.gain.value = 0;
    fizz.connect(fizzBp).connect(this.fizzGain).connect(surfPan);

    // wind through the open window
    const wind = loop(pink, 0.6);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.04;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // chime and crickets buses
    this.chimeBus = ctx.createGain();
    this.chimeBus.gain.value = 0.16;
    const chimeLp = ctx.createBiquadFilter();
    chimeLp.type = 'lowpass';
    chimeLp.frequency.value = 5200;
    this.chimeBus.connect(chimeLp).connect(this.master);
    this.cricketBus = ctx.createGain();
    this.cricketBus.gain.value = 0;
    this.cricketBus.connect(this.master);
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter((x) => x !== id);
      if (this.on) fn();
    }, ms);
    this._timers.push(id);
  }

  _scheduleWaves() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const rise = 1.6 + Math.random() * 1.4;
    const fall = 3.5 + Math.random() * 2.5;
    const peak = 0.1 + Math.random() * 0.08;
    const g = this.surfGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + rise);
    g.exponentialRampToValueAtTime(0.02, t + rise + fall);
    const f = this.surfLp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(700 + Math.random() * 500, t + rise);
    f.exponentialRampToValueAtTime(380, t + rise + fall);
    const z = this.fizzGain.gain;
    z.cancelScheduledValues(t);
    z.setValueAtTime(0, t);
    z.linearRampToValueAtTime(0, t + rise * 0.8);
    z.linearRampToValueAtTime(peak * 0.16, t + rise + 0.4);
    z.exponentialRampToValueAtTime(0.0005, t + rise + fall * 0.9);
    this._later(() => this._scheduleWaves(), (rise + fall * (0.65 + Math.random() * 0.5)) * 1000);
  }

  _scheduleChime() {
    // a small glass chime on the frame: rings more often when the breeze picks up
    const wait = (14 + Math.random() * 24) / (0.5 + this.wind);
    this._later(() => {
      if (this.wind > 0.35) this._chime();
      this._scheduleChime();
    }, wait * 1000);
  }

  _chime() {
    const ctx = this.ctx;
    const notes = [1318.5, 1568, 1760, 2093, 2349.3];
    const count = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < count; k++) {
      const t = ctx.currentTime + k * (0.18 + Math.random() * 0.35);
      const f0 = notes[Math.floor(Math.random() * notes.length)];
      const pan = ctx.createStereoPanner();
      pan.pan.value = 0.35 + Math.random() * 0.3;
      pan.connect(this.chimeBus);
      [[1, 1], [2.76, 0.35], [5.4, 0.12]].forEach(([mul, amp]) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f0 * mul;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp * 0.35, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8 / mul + 0.6);
        o.connect(g).connect(pan);
        o.start(t);
        o.stop(t + 3.6);
      });
    }
  }

  _scheduleCrickets() {
    this._later(() => {
      if (this.night > 0.45) this._cricket();
      this._scheduleCrickets();
    }, 380 + Math.random() * 520);
  }

  _cricket() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const f = 4300 + Math.random() * 600;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.cricketBus);
    const pulses = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * 0.055;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.5, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, s + 0.04);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.05);
    }
  }
}
