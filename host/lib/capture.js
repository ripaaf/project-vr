'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

// Capture size is a fraction of the Quest's native (both-eyes) framebuffer.
const QUALITY = {
  low: { scale: 0.5, bitrate: '6M', outW: 960, q: 7 },
  medium: { scale: 0.75, bitrate: '10M', outW: 1280, q: 5 },
  high: { scale: 1.0, bitrate: '16M', outW: 1920, q: 4 },
};
const EYE_FRACTION = 0.8; // at zoom 1 the crop covers 80% of one eye's width
const LENS = { k1: -0.28, k2: 0.05 }; // undo the lens pre-distortion (tuned on Quest 3)
const SOURCE_FPS = 60; // the Quest compositor delivers ~55-70 fps
const NO_FRAME_TIMEOUT = 7000;

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const mult = (n, m) => Math.max(m, Math.round(n / m) * m);

/** Splits a concatenated MJPEG byte stream into individual JPEG frames. */
class JpegSplitter {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.parts = [];
    this.size = 0;
    this.lastByte = 0;
  }

  push(chunk) {
    let segStart = 0;
    let search = 0;
    while (search < chunk.length) {
      const idx = chunk.indexOf(0xd9, search);
      if (idx === -1) break;
      const prev = idx > 0 ? chunk[idx - 1] : this.lastByte;
      search = idx + 1;
      if (prev !== 0xff) continue;
      this.parts.push(chunk.subarray(segStart, idx + 1));
      const frame = Buffer.concat(this.parts);
      this.parts = [];
      this.size = 0;
      segStart = idx + 1;
      if (frame[0] === 0xff && frame[1] === 0xd8) this.onFrame(frame);
    }
    if (segStart < chunk.length) {
      this.parts.push(chunk.subarray(segStart));
      this.size += chunk.length - segStart;
      if (this.size > 16 * 1024 * 1024) {
        this.parts = [];
        this.size = 0;
      }
    }
    this.lastByte = chunk[chunk.length - 1];
  }
}

/** Works out screenrecord size and the ffmpeg filter graph for the current settings. */
function plan(settings, display, { wireless = false } = {}) {
  const qp = QUALITY[settings.quality] || QUALITY.medium;
  // ADB over Wi-Fi has far less headroom than USB; a lighter stream keeps the frame rate up.
  const bitrate = wireless ? `${Math.max(3, Math.round(parseInt(qp.bitrate, 10) * 0.6))}M` : qp.bitrate;
  const W = mult(display.w * qp.scale, 16);
  const H = mult(display.h * qp.scale, 8);
  const eyeW = W / 2;
  const outW = even(qp.outW);
  const steps = [];
  let outH;

  // Keep every k-th frame so the PC only encodes what viewers can use.
  const keep = Math.max(1, Math.round(SOURCE_FPS / settings.maxFps));
  if (keep > 1) steps.push(`select='not(mod(n\\,${keep}))'`);

  if (settings.view === 'both') {
    outH = even((outW * H) / W);
    steps.push(`scale=${outW}:${outH}`);
  } else {
    outH = even((outW * 9) / 16);
    const eyeX = settings.view === 'right' ? eyeW : 0;
    const cropW = (eyeW * EYE_FRACTION) / settings.zoom;
    const s = outW / cropW; // eye pixels -> output pixels
    const SW = even(eyeW * s);
    const SH = even(H * s);
    steps.push(`crop=${eyeW}:${H}:${eyeX}:0`);
    steps.push(`scale=${SW}:${SH}`);
    if (settings.lensFix) steps.push(`lenscorrection=cx=0.5:cy=0.5:k1=${LENS.k1}:k2=${LENS.k2}`);
    const cx = SW * (0.5 + settings.offsetX);
    const cy = SH * (0.5 + settings.offsetY);
    const x = Math.round(Math.min(SW - outW, Math.max(0, cx - outW / 2)));
    const y = Math.round(Math.min(SH - outH, Math.max(0, cy - outH / 2)));
    steps.push(`crop=${outW}:${Math.min(outH, SH)}:${x}:${y}`);
  }
  return { W, H, outW, outH, bitrate, q: qp.q, filter: steps.join(',') };
}

/**
 * Runs `screenrecord` on the Quest (raw H.264 over adb) into ffmpeg, which crops
 * one eye and re-encodes MJPEG. Emits 'frame' with each JPEG Buffer.
 */
class Capture extends EventEmitter {
  constructor({ adbBin, ffmpegBin }) {
    super();
    this.adbBin = adbBin;
    this.ffmpegBin = ffmpegBin;
    this.procs = null;
    this.state = 'idle'; // idle | starting | live | error
    this.message = '';
    this.plan = null;
    this.lastFrameAt = 0;
    this.frameTimes = [];
    this.restartTimer = null;
    this.failures = 0;
    this.wanted = null; // { serial, settings, display } while capture should be running
    setInterval(() => this.watchdog(), 1000);
  }

  get fps() {
    const now = Date.now();
    this.frameTimes = this.frameTimes.filter((t) => now - t < 2000);
    return Math.round(this.frameTimes.length / 2);
  }

  /** Start (or restart with new settings) if not already running with the same parameters. */
  ensure(serial, settings, display, opts = {}) {
    const key = JSON.stringify([serial, plan(settings, display, opts)]);
    if (this.wanted && this.wantedKey === key) return; // already running or recovering on its own
    this.wanted = { serial, settings, display, opts };
    this.wantedKey = key;
    this.failures = 0;
    this.restart('settings');
  }

  stop() {
    if (!this.wanted && !this.procs) return;
    this.wanted = null;
    this.wantedKey = null;
    this.gen = (this.gen || 0) + 1;
    clearTimeout(this.restartTimer);
    this.kill();
    this.setState('idle', '');
  }

  restart(reason) {
    clearTimeout(this.restartTimer);
    const gen = (this.gen = (this.gen || 0) + 1);
    this.kill().then(() => {
      if (!this.wanted || gen !== this.gen) return;
      const delay = reason === 'settings' ? 0 : Math.min(5000, 800 * this.failures);
      this.restartTimer = setTimeout(() => gen === this.gen && this.spawn(), delay);
    });
  }

  setState(state, message) {
    if (state !== this.state || message !== this.message) {
      this.state = state;
      this.message = message;
      this.emit('state', state, message);
    }
  }

  spawn() {
    const { serial, settings, display, opts } = this.wanted;
    const p = plan(settings, display, opts);
    this.plan = p;
    this.setState('starting', `Starting ${p.W}x${p.H} capture...`);

    const rec = `screenrecord --output-format=h264 --size ${p.W}x${p.H} --bit-rate ${p.bitrate} --time-limit 0 -`;
    const adb = spawn(this.adbBin, ['-s', serial, 'exec-out', rec], { windowsHide: true });
    const ff = spawn(
      this.ffmpegBin,
      [
        '-hide_banner', '-loglevel', 'error', '-nostats',
        '-probesize', '32', '-analyzeduration', '0', '-flags', 'low_delay',
        '-f', 'h264', '-i', 'pipe:0',
        '-vf', p.filter,
        '-fps_mode', 'passthrough',
        '-f', 'mjpeg', '-q:v', String(p.q), 'pipe:1',
      ],
      { windowsHide: true }
    );
    const procs = { adb, ff, serial, startedAt: Date.now() };
    this.procs = procs;
    this.lastFrameAt = 0;

    // An all-black picture compresses to almost nothing; that's the headset idling (not worn / lying still).
    const darkLimit = p.outW * p.outH * 0.008;
    const splitter = new JpegSplitter((frame) => {
      if (this.procs !== procs) return;
      const now = Date.now();
      this.lastFrameAt = now;
      this.frameTimes.push(now);
      this.failures = 0;
      if (frame.length < darkLimit) {
        if (!this.darkSince) this.darkSince = now;
        this.dark = now - this.darkSince > 2500;
      } else {
        this.darkSince = 0;
        this.dark = false;
      }
      if (this.state !== 'live') this.setState('live', '');
      this.emit('frame', frame);
    });

    adb.stdout.pipe(ff.stdin);
    ff.stdin.on('error', () => {});
    ff.stdout.on('data', (c) => splitter.push(c));

    let errText = '';
    const collect = (d) => {
      errText = (errText + d.toString()).slice(-600);
    };
    adb.stderr.on('data', collect);
    ff.stderr.on('data', collect);

    const onExit = (who) => () => {
      if (this.procs !== procs) return;
      this.failures++;
      let why = errText.trim().split(/\r?\n/).pop() || `${who} stopped`;
      // An empty stream means the headset isn't drawing anything (asleep / not worn).
      if (/codec parameters|Invalid data|No start code|stopped$/.test(why)) why = 'No picture from the headset. Is it asleep? Put it on, or turn on "Keep awake".';
      console.warn(`[capture] ${who} exited: ${why}`);
      this.setState('error', why);
      this.restart('exit');
    };
    adb.on('exit', onExit('screenrecord'));
    ff.on('exit', onExit('ffmpeg'));
    adb.on('error', (e) => this.setState('error', `adb: ${e.message}`));
    ff.on('error', (e) => this.setState('error', `ffmpeg: ${e.message}`));
  }

  /** Stops local processes and the recorder on the headset; resolves once the headset side is gone. */
  kill() {
    const procs = this.procs;
    this.procs = null;
    if (!procs) return Promise.resolve();
    for (const p of [procs.adb, procs.ff]) {
      try {
        p.kill();
      } catch {}
    }
    return new Promise((resolve) => {
      const k = spawn(this.adbBin, ['-s', procs.serial, 'shell', 'pkill -x screenrecord'], { windowsHide: true, stdio: 'ignore' });
      k.on('exit', resolve);
      k.on('error', resolve);
      setTimeout(resolve, 3000);
    });
  }

  watchdog() {
    if (!this.procs || !this.wanted) return;
    const since = Date.now() - (this.lastFrameAt || this.procs.startedAt);
    if (since > NO_FRAME_TIMEOUT) {
      this.failures++;
      this.setState('error', 'No picture from the headset. Is it asleep? Put it on, or turn on "Keep awake".');
      this.restart('stall');
    }
  }

  status() {
    return {
      state: this.state,
      message: this.message,
      dark: this.state === 'live' && !!this.dark,
      fps: this.fps,
      size: this.plan ? `${this.plan.W}x${this.plan.H}` : null,
      out: this.plan ? `${this.plan.outW}x${this.plan.outH}` : null,
    };
  }
}

module.exports = { Capture, JpegSplitter, plan, QUALITY };
