'use strict';
// UTSUSHI Space: what the immersive world needs from the PC host — a real Linux shell on the
// headset (adb shell), live PC + headset stats, photos taken with a hand gesture, 3D models from
// a folder, and launching the space in the Quest Browser.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PHOTO_RE = /^utsushi-[\w-]+\.jpg$/;
const MODEL_RE = /^[\w .()-]+\.(glb|gltf|obj|stl|ply)$/i;
const MODEL_TYPES = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', stl: 'model/stl', ply: 'application/octet-stream' };
const LENS = { k1: -0.28, k2: 0.05 }; // same correction the mirror uses (tuned on Quest 3)

class Space {
  constructor({ adb, adbBin, ffmpegBin, devices, dataDir, port }) {
    this.adb = adb;
    this.adbBin = adbBin;
    this.ffmpegBin = ffmpegBin;
    this.devices = devices;
    this.port = port;
    this.photosDir = path.join(dataDir, 'photos');
    this.modelsDir = path.join(dataDir, 'models');
    this.shells = new Map(); // id -> { proc, clients:Set<res>, backlog:[] }
    this.cpuPrev = os.cpus();
    this.cpuPct = 0;
    this.questStats = null;
    this.questAt = 0;
    setInterval(() => this.sampleCpu(), 1500);
  }

  // ------------------------------------------------------------------ stats

  sampleCpu() {
    const now = os.cpus();
    let idle = 0;
    let total = 0;
    now.forEach((c, i) => {
      const p = this.cpuPrev[i] || c;
      for (const k of Object.keys(c.times)) total += c.times[k] - p.times[k];
      idle += c.times.idle - p.times.idle;
    });
    this.cpuPrev = now;
    if (total > 0) this.cpuPct = Math.round(100 * (1 - idle / total));
  }

  async quest() {
    if (!this.devices.current) return null;
    if (Date.now() - this.questAt < 3000 && this.questStats) return this.questStats;
    this.questAt = Date.now();
    try {
      const out = await this.devices.shell(
        'dumpsys battery | grep -E "level:|temperature:|status:|AC powered:|USB powered:"; echo ==; cat /proc/uptime; echo ==; head -3 /proc/meminfo; echo ==; cat /proc/loadavg; echo ==; getprop ro.build.version.incremental',
        { timeout: 4000 }
      );
      const [bat, up, mem, load, build] = out.split('==');
      const num = (re, s) => {
        const m = re.exec(s || '');
        return m ? Number(m[1]) : null;
      };
      this.questStats = {
        battery: num(/level:\s*(\d+)/, bat),
        tempC: num(/temperature:\s*(\d+)/, bat) != null ? num(/temperature:\s*(\d+)/, bat) / 10 : null,
        charging: /status:\s*2|AC powered: true|USB powered: true/.test(bat || ''),
        uptime: num(/([\d.]+)/, up),
        memTotal: num(/MemTotal:\s*(\d+)/, mem),
        memAvail: num(/MemAvailable:\s*(\d+)/, mem),
        load: (load || '').trim().split(/\s+/).slice(0, 3).map(Number),
        build: (build || '').trim(),
      };
    } catch {
      // keep the last good sample
    }
    return this.questStats;
  }

  async stats(extra) {
    return {
      time: Date.now(),
      pc: {
        name: os.hostname(),
        cpu: this.cpuPct,
        cores: os.cpus().length,
        memUsed: os.totalmem() - os.freemem(),
        memTotal: os.totalmem(),
        uptime: os.uptime(),
        platform: `${os.type()} ${os.release()}`,
      },
      quest: { ...(this.devices.status ? this.devices.status() : {}), ...(await this.quest()) },
      ...extra,
    };
  }

  // ------------------------------------------------------------------ shell on the headset

  /** A persistent `adb shell` on the Quest: a real, minimal Linux (toybox) running as the shell user. */
  openShell() {
    if (!this.devices.current) throw Object.assign(new Error('No headset connected'), { status: 409 });
    for (const [id, s] of this.shells) if (!s.clients.size && Date.now() - s.lastSeen > 60000) this.closeShell(id);
    const id = crypto.randomBytes(6).toString('hex');
    const proc = spawn(this.adbBin, ['-s', this.devices.current.serial, 'shell'], { windowsHide: true });
    const s = { proc, clients: new Set(), backlog: [], lastSeen: Date.now() };
    const emit = (kind, data) => {
      const msg = `data: ${JSON.stringify({ kind, data })}\n\n`;
      s.backlog.push(msg);
      if (s.backlog.length > 200) s.backlog.shift();
      for (const c of s.clients) c.write(msg);
    };
    proc.stdout.on('data', (d) => emit('out', d.toString('utf8')));
    proc.stderr.on('data', (d) => emit('err', d.toString('utf8')));
    proc.on('exit', (code) => {
      emit('exit', code);
      this.shells.delete(id);
    });
    proc.stdin.on('error', () => {});
    // A little context so prompts make sense (no TTY, so no PS1).
    proc.stdin.write('cd /sdcard 2>/dev/null\n');
    this.shells.set(id, s);
    return id;
  }

  streamShell(id, req, res) {
    const s = this.shells.get(id);
    if (!s) return false;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': open\n\n');
    for (const m of s.backlog) res.write(m);
    s.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      s.clients.delete(res);
      s.lastSeen = Date.now();
    });
    return true;
  }

  shellInput(id, line) {
    const s = this.shells.get(id);
    if (!s) return false;
    s.lastSeen = Date.now();
    s.proc.stdin.write(String(line).replace(/\r/g, '') + '\n');
    return true;
  }

  interruptShell(id) {
    // No TTY means no Ctrl+C: end the shell and let the client open a fresh one.
    this.closeShell(id);
  }

  closeShell(id) {
    const s = this.shells.get(id);
    if (!s) return;
    this.shells.delete(id);
    try {
      s.proc.kill();
    } catch {}
    for (const c of s.clients) c.end();
  }

  // ------------------------------------------------------------------ photos

  /**
   * Takes what the wearer sees (left eye, passthrough included), undoes the lens warp, and crops
   * to the framed rectangle. rect = [x0, y0, x1, y1] in 0..1 of the left eye's view (y down).
   */
  async snap(rect) {
    if (!this.devices.current) throw Object.assign(new Error('No headset connected'), { status: 409 });
    fs.mkdirSync(this.photosDir, { recursive: true });
    const png = await new Promise((resolve, reject) => {
      const p = spawn(this.adbBin, ['-s', this.devices.current.serial, 'exec-out', 'screencap', '-p'], { windowsHide: true });
      const chunks = [];
      p.stdout.on('data', (c) => chunks.push(c));
      p.on('error', reject);
      p.on('exit', () => {
        const buf = Buffer.concat(chunks);
        buf.length > 1000 ? resolve(buf) : reject(Object.assign(new Error('The headset gave no picture (asleep, or a private screen is open)'), { status: 409 }));
      });
      setTimeout(() => p.kill(), 15000);
    });
    const d = new Date(); // local time, so the name matches the clock you saw
    const two = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
    const name = `utsushi-${stamp}.jpg`;
    const out = path.join(this.photosDir, name);
    // Whole view: trim the lens's black corners. Framed: just what lies between your hands.
    let crop = ',crop=iw*0.84:ih*0.84:iw*0.08:ih*0.08';
    if (Array.isArray(rect) && rect.length === 4 && rect.every((v) => Number.isFinite(v))) {
      let [x0, y0, x1, y1] = rect.map((v) => Math.min(1, Math.max(0, v)));
      if (x1 < x0) [x0, x1] = [x1, x0];
      if (y1 < y0) [y0, y1] = [y1, y0];
      if (x1 - x0 > 0.06 && y1 - y0 > 0.06) crop = `,crop=iw*${(x1 - x0).toFixed(4)}:ih*${(y1 - y0).toFixed(4)}:iw*${x0.toFixed(4)}:ih*${y0.toFixed(4)}`;
    }
    const vf = `crop=iw/2:ih:0:0,lenscorrection=cx=0.5:cy=0.5:k1=${LENS.k1}:k2=${LENS.k2}${crop},scale='min(2048,iw)':-2`;
    await new Promise((resolve, reject) => {
      const ff = spawn(this.ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', vf, '-q:v', '3', out], { windowsHide: true });
      let err = '';
      ff.stderr.on('data', (d) => (err += d));
      ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || 'ffmpeg failed'))));
      ff.on('error', reject);
      ff.stdin.on('error', () => {});
      ff.stdin.end(png);
    });
    return { name, url: `/api/space/photo/${name}`, time: Date.now() };
  }

  photos() {
    try {
      return fs
        .readdirSync(this.photosDir)
        .filter((f) => PHOTO_RE.test(f))
        .map((f) => ({ name: f, url: `/api/space/photo/${f}`, time: fs.statSync(path.join(this.photosDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 60);
    } catch {
      return [];
    }
  }

  photoFile(name) {
    return PHOTO_RE.test(name) ? path.join(this.photosDir, name) : null;
  }

  // ------------------------------------------------------------------ 3D models

  models() {
    try {
      fs.mkdirSync(this.modelsDir, { recursive: true });
      return fs
        .readdirSync(this.modelsDir)
        .filter((f) => MODEL_RE.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(this.modelsDir, f));
          const format = f.split('.').pop().toLowerCase();
          return { file: f, name: f.replace(/\.[^.]+$/, ''), format, url: `/api/space/model/${encodeURIComponent(f)}`, bytes: st.size, time: st.mtimeMs, scan: /^scan-/.test(f) };
        })
        .sort((a, b) => b.time - a.time);
    } catch {
      return [];
    }
  }

  modelFile(name) {
    return MODEL_RE.test(name) ? path.join(this.modelsDir, name) : null;
  }

  modelType(name) {
    return MODEL_TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
  }

  /** A scan from the headset (binary PLY, base64), saved as scan-<date>-<time>.ply. */
  saveScan(b64) {
    const buf = Buffer.from(String(b64 || ''), 'base64');
    if (buf.length < 64 || buf.slice(0, 3).toString() !== 'ply') throw Object.assign(new Error('Not a PLY scan'), { status: 400 });
    fs.mkdirSync(this.modelsDir, { recursive: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const file = `scan-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.ply`;
    fs.writeFileSync(path.join(this.modelsDir, file), buf);
    return { file, url: `/api/space/model/${encodeURIComponent(file)}`, bytes: buf.length };
  }

  // ------------------------------------------------------------------ launch

  /** Opens the space in the headset's browser (over the cable/ADB tunnel, which WebXR needs: localhost is a secure origin). */
  async launch() {
    if (!this.devices.current) throw Object.assign(new Error('No headset connected'), { status: 409 });
    await this.devices.shell(`am start -a android.intent.action.VIEW -d 'http://localhost:${this.port}/space/' com.oculus.browser`);
  }
}

module.exports = { Space };
