// UTSUSHI sound: everything is synthesised (no files), soft, short and placed in 3D where it
// happens. Pentatonic notes keep it calm (wabi); a tiny room reverb keeps it from sounding dry.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic steps

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.ambientOn = false;
    this.voiceOn = false;
    this.lastTick = 0;
  }

  /** Must run inside a user gesture (the ENTER pinch/click). */
  init() {
    if (this.ctx) return this.ctx.resume();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // small room: generated impulse response
    this.verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.verb.buffer = ir;
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.22;
    this.verbSend.connect(this.verb).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Keep the listener on the head so sounds come from where things are. */
  listen(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(e[12], t);
      l.positionY.setValueAtTime(e[13], t);
      l.positionZ.setValueAtTime(e[14], t);
      l.forwardX.setValueAtTime(-e[8], t);
      l.forwardY.setValueAtTime(-e[9], t);
      l.forwardZ.setValueAtTime(-e[10], t);
      l.upX.setValueAtTime(e[4], t);
      l.upY.setValueAtTime(e[5], t);
      l.upZ.setValueAtTime(e[6], t);
    } else if (l.setPosition) {
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  /** Output node for one sound: panned to `pos` (a Vector3) or centred. */
  out(pos, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1;
      p.rolloffFactor = 0.6;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      p.connect(this.master);
      p.connect(this.verbSend);
    } else {
      g.connect(this.master);
      g.connect(this.verbSend);
    }
    return g;
  }

  ok() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  tone(dest, freq, t0, dur, { type = 'sine', attack = 0.004, gain = 0.3, bend = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * bend), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  hiss(dest, t0, dur, { from = 2000, to = 6000, q = 0.8, gain = 0.2, type = 'bandpass' } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------ the kit

  /** Hover: barely there. */
  tick(pos) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTick < 0.045) return;
    this.lastTick = now;
    this.hiss(this.out(pos, 0.35), now, 0.025, { from: 5000, to: 7000, q: 4, gain: 0.25, type: 'bandpass' });
  }

  /** Select: a dry two-tone "tik". */
  click(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 0.9);
    this.tone(d, 1568, t, 0.07, { gain: 0.22, bend: 0.8 });
    this.tone(d, 2349, t + 0.012, 0.05, { gain: 0.08, type: 'triangle' });
  }

  key(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.tone(this.out(pos, 0.6), 900 + Math.random() * 300, t, 0.035, { gain: 0.12, type: 'triangle', bend: 0.7 });
  }

  /** Panel opens: breath of air + two pentatonic notes rising. */
  open(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 0.8);
    this.hiss(d, t, 0.32, { from: 600, to: 4200, q: 0.6, gain: 0.12 });
    this.tone(d, 659.25, t + 0.04, 0.5, { gain: 0.1 });
    this.tone(d, 987.77, t + 0.11, 0.6, { gain: 0.08 });
  }

  close(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 0.7);
    this.hiss(d, t, 0.26, { from: 4000, to: 500, q: 0.6, gain: 0.1 });
    this.tone(d, 739.99, t, 0.35, { gain: 0.07, bend: 0.75 });
  }

  /** Gesture recognised: a small FM bell. */
  chime(pos, step = 0) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = 523.25 * Math.pow(2, PENTA[step % 5] / 12);
    const d = this.out(pos, 0.9);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const g = ctx.createGain();
    car.frequency.value = base;
    mod.frequency.value = base * 3.5;
    mg.gain.setValueAtTime(base * 1.2, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    mod.connect(mg).connect(car.frequency);
    car.connect(g).connect(d);
    car.start(t);
    mod.start(t);
    car.stop(t + 1.3);
    mod.stop(t + 1.3);
  }

  /** Hold-to-confirm progress blip. */
  blip(pos, frac) {
    if (!this.ok()) return;
    this.tone(this.out(pos, 0.4), 440 + frac * 440, this.ctx.currentTime, 0.04, { gain: 0.06, type: 'triangle' });
  }

  shutter(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 1);
    this.hiss(d, t, 0.03, { from: 3000, to: 1500, q: 1.2, gain: 0.5, type: 'bandpass' });
    this.hiss(d, t + 0.07, 0.04, { from: 2500, to: 1200, q: 1.2, gain: 0.4, type: 'bandpass' });
    this.tone(d, 110, t, 0.12, { gain: 0.25, bend: 0.6 });
    this.tone(d, 1318.5, t + 0.16, 0.9, { gain: 0.06 });
  }

  error(pos) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const d = this.out(pos, 0.8);
    this.tone(d, 311.13, t, 0.18, { gain: 0.14, type: 'triangle' });
    this.tone(d, 233.08, t + 0.12, 0.3, { gain: 0.14, type: 'triangle' });
  }

  /** Arrival: low swell and a slow pentatonic arpeggio. */
  boot() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const d = this.out(null, 0.9);
    this.tone(d, 65.41, t, 3.2, { gain: 0.16, attack: 0.9 });
    this.tone(d, 98, t + 0.2, 3, { gain: 0.08, attack: 0.9 });
    [0, 2, 4, 7, 9, 12].forEach((s, i) => this.tone(d, 392 * Math.pow(2, s / 12), t + 0.5 + i * 0.16, 1.4, { gain: 0.06 }));
    this.hiss(d, t, 2.4, { from: 300, to: 2400, q: 0.4, gain: 0.05 });
  }

  /** Wind over sand + a low drone, very quiet. */
  ambient(on) {
    this.ambientOn = on;
    if (!this.ctx) return;
    if (on && !this.amb) {
      const ctx = this.ctx;
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 420;
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.07;
      lg.gain.value = 260;
      lfo.connect(lg).connect(f.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.05, ctx.currentTime, 1.5);
      const drone = ctx.createOscillator();
      drone.frequency.value = 55;
      const dg = ctx.createGain();
      dg.gain.value = 0.025;
      drone.connect(dg).connect(g);
      s.connect(f).connect(g).connect(this.master);
      s.start();
      lfo.start();
      drone.start();
      this.amb = { s, lfo, drone, g };
    } else if (!on && this.amb) {
      const a = this.amb;
      this.amb = null;
      a.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
      setTimeout(() => [a.s, a.lfo, a.drone].forEach((n) => n.stop()), 1500);
    }
  }

  /** The core's voice (off by default). Captions are always shown by the caller. */
  say(text) {
    if (!this.voiceOn || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 0.92;
      u.volume = Math.min(1, this.volume + 0.1);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
  }
}
