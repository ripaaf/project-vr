'use strict';
// PC -> Quest: capture Windows monitors with the GPU (ddagrab), encode H.264 and stream it to the
// Quest app; take mouse/keyboard commands back and replay them with SendInput.
const { spawn } = require('child_process');
const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const HELPER = path.join(__dirname, 'wininput.ps1');
const DISCOVERY_PORT = 8767;

/** Long-running PowerShell helper (input injection + monitor list). */
class WinHelper extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.waiters = [];
    this.buf = '';
    this.ready = null;
  }

  start() {
    if (this.proc) return this.ready;
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.ready = new Promise((resolve) => (this._resolveReady = resolve));
    proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (line === 'ready') this._resolveReady();
        else if (this.waiters.length) this.waiters.shift()(line);
      }
    });
    proc.stderr.on('data', (d) => console.warn('[pc-input]', d.toString().trim()));
    proc.stdin.on('error', () => {});
    proc.on('exit', () => {
      this.proc = null;
      this.waiters.splice(0).forEach((w) => w(null));
    });
    return this.ready;
  }

  send(cmd) {
    if (!this.proc) this.start();
    this.proc.stdin.write(cmd + '\n');
  }

  async query(cmd, timeout = 8000) {
    await this.start();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Windows helper did not answer')), timeout);
      this.waiters.push((line) => {
        clearTimeout(t);
        resolve(line);
      });
      this.proc.stdin.write(cmd + '\n');
    });
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

// Android KeyEvent keycodes arrive already translated to Windows virtual-key codes by the Quest app.
const EXTENDED_VK = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5b, 0x5c, 0xa3, 0xa5, 0x6f]);

class PcScreens {
  constructor({ ffmpegBin, config }) {
    this.ffmpegBin = ffmpegBin;
    this.config = config;
    this.helper = new WinHelper();
    this.monitorCache = null;
    this.monitorAt = 0;
    this.encoders = new Map(); // adapter -> encoder name
    this.streams = new Set();
    this.pairCode = String(crypto.randomInt(100000, 1000000));
    this.pairFails = [];
    this.requests = new Map();
    this.inputs = new Set(); // open input request streams (closed on unlink)
    this.port = 0;
    this.inputClients = 0;
    if (!config.get().pcToken) config.update({ pcToken: crypto.randomBytes(16).toString('hex') });
  }

  get supported() {
    return process.platform === 'win32';
  }

  token() {
    return this.config.get().pcToken;
  }

  checkToken(t) {
    const a = Buffer.from(String(t || ''));
    const b = Buffer.from(this.token());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * One-tap pairing: the headset asks, the PC owner clicks Allow. Both sides show the same
   * 4-digit check code so you know you're approving your own Quest.
   */
  requestPair(device, ip) {
    const now = Date.now();
    for (const [id, r] of this.requests) if (now - r.at > 120000) this.requests.delete(id);
    const fromIp = [...this.requests.values()].filter((r) => r.ip === ip && r.state === 'pending');
    if (fromIp.length >= 3) throw Object.assign(new Error('Too many requests. Wait a moment.'), { status: 429 });
    const r = {
      id: crypto.randomBytes(8).toString('hex'),
      device: String(device || 'Quest').replace(/[^\w .()-]/g, '').slice(0, 40) || 'Quest',
      check: String(crypto.randomInt(1000, 10000)),
      ip: String(ip || '').replace(/^::ffff:/, ''),
      at: now,
      state: 'pending',
    };
    this.requests.set(r.id, r);
    console.log(`[pc] ${r.device} (${r.ip}) wants to connect. Check code ${r.check}. Approve on http://localhost:${this.port}`);
    return { id: r.id, check: r.check };
  }

  pollPair(id) {
    const r = this.requests.get(String(id));
    if (!r || Date.now() - r.at > 120000) {
      if (r) this.requests.delete(r.id);
      return { state: 'expired' };
    }
    if (r.state === 'approved') {
      this.requests.delete(r.id);
      return { state: 'approved', token: this.token() };
    }
    if (r.state === 'denied') this.requests.delete(r.id);
    return { state: r.state };
  }

  decidePair(id, allow) {
    const r = this.requests.get(String(id));
    if (!r || r.state !== 'pending') throw Object.assign(new Error('That request is gone'), { status: 404 });
    r.state = allow ? 'approved' : 'denied';
    console.log(`[pc] ${allow ? 'allowed' : 'denied'} ${r.device} (${r.ip})`);
  }

  pendingRequests() {
    const now = Date.now();
    return [...this.requests.values()]
      .filter((r) => r.state === 'pending' && now - r.at < 120000)
      .map(({ id, device, check, ip, at }) => ({ id, device, check, ip, age: Math.round((now - at) / 1000) }));
  }

  /**
   * Real disconnect: new secret (the old one stops working everywhere) and every open
   * screen / input stream is closed right now, not at the next reconnect.
   */
  revoke() {
    this.config.update({ pcToken: crypto.randomBytes(16).toString('hex'), pcLinkedAt: 0 });
    this.pairCode = String(crypto.randomInt(100000, 1000000));
    this.requests.clear();
    for (const s of this.streams) {
      try {
        s.ff.kill();
      } catch {}
    }
    for (const i of this.inputs) {
      try {
        i.destroy();
      } catch {}
    }
    this.inputs.clear();
    console.log('[pc] Quest unlinked: access revoked, open screens closed');
  }

  pair(code) {
    const now = Date.now();
    this.pairFails = this.pairFails.filter((t) => now - t < 60000);
    if (this.pairFails.length >= 8) throw Object.assign(new Error('Too many wrong codes. Wait a minute.'), { status: 429 });
    if (String(code).trim() !== this.pairCode) {
      this.pairFails.push(now);
      throw Object.assign(new Error('Wrong code'), { status: 401 });
    }
    this.pairCode = String(crypto.randomInt(100000, 1000000));
    return this.token();
  }

  /** Raises the first window whose title starts with `title` (the browser tab we just opened). */
  async bringToFront(title) {
    if (process.platform !== 'win32') return false;
    try {
      return (await this.helper.query(`front ${Buffer.from(title).toString('base64')}`, 4000)) === 'True';
    } catch {
      return false;
    }
  }

  async monitors(force) {
    if (!this.supported) return [];
    if (!force && this.monitorCache && Date.now() - this.monitorAt < 5000) return this.monitorCache;
    const line = await this.helper.query('monitors');
    let list = [];
    try {
      list = JSON.parse(line || '[]');
    } catch {}
    list.forEach((m, i) => {
      m.id = `a${m.adapter}o${m.output}`;
      m.index = i;
      m.primary = m.x === 0 && m.y === 0;
      m.name = `Screen ${i + 1}${m.primary ? ' (main)' : ''}`;
    });
    this.monitorCache = list;
    this.monitorAt = Date.now();
    return list;
  }

  async monitor(id) {
    const list = await this.monitors();
    return list.find((m) => m.id === id) || null;
  }

  /** ffmpeg arguments for one monitor with a given encoder. */
  args(mon, enc, { fps, kbps, maxW }) {
    const g = fps * 3;
    const b = `${kbps}k`;
    const needScale = mon.w > maxW;
    const outW = needScale ? maxW : mon.w;
    const outH = needScale ? Math.round((mon.h * maxW) / mon.w / 2) * 2 : mon.h;
    const src = `ddagrab=output_idx=${mon.output}:framerate=${fps}:draw_mouse=1`;
    const head = ['-hide_banner', '-loglevel', 'error', '-nostats'];
    const device = ['-init_hw_device', `d3d11va=qm:${mon.adapter}`, '-filter_hw_device', 'qm'];
    let pre, filter, codec;
    switch (enc) {
      case 'h264_nvenc':
        pre = device;
        filter = needScale ? `${src},hwdownload,format=bgra,scale=${outW}:${outH}` : src;
        codec = ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-zerolatency', '1', '-rc', 'cbr', '-b:v', b, '-maxrate', b, '-bufsize', `${Math.round(kbps / 2)}k`, '-bf', '0', '-g', String(g)];
        break;
      case 'h264_amf':
        pre = []; // AMF needs its own device; ddagrab then uses the default adapter
        filter = `${src},hwdownload,format=bgra${needScale ? `,scale=${outW}:${outH}` : ''}`;
        codec = ['-c:v', 'h264_amf', '-usage', 'ultralowlatency', '-quality', 'speed', '-rc', 'cbr', '-b:v', b, '-maxrate', b, '-bf', '0', '-g', String(g)];
        break;
      case 'h264_qsv':
        pre = [];
        filter = `${src},hwdownload,format=bgra,format=nv12${needScale ? `,scale=${outW}:${outH}` : ''}`;
        codec = ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', b, '-maxrate', b, '-bf', '0', '-g', String(g), '-async_depth', '1'];
        break;
      default:
        pre = device;
        filter = `${src},hwdownload,format=bgra${needScale ? `,scale=${outW}:${outH}` : ''},format=yuv420p`;
        codec = ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', b, '-maxrate', b, '-bufsize', `${Math.round(kbps / 4)}k`, '-bf', '0', '-g', String(g)];
    }
    return {
      outW,
      outH,
      args: [
        ...head, ...pre,
        '-filter_complex', `${filter}[v]`, '-map', '[v]',
        ...codec,
        // An access-unit delimiter before every frame lets the headset split frames without parsing slices.
        '-bsf:v', 'h264_metadata=aud=insert',
        '-flush_packets', '1', '-f', 'h264', 'pipe:1',
      ],
    };
  }

  /** Try encoders until one produces frames for this monitor's GPU; remembered per adapter. */
  async encoderFor(mon) {
    if (this.encoders.has(mon.adapter)) return this.encoders.get(mon.adapter);
    const candidates = mon.adapter === 0 ? ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'] : ['h264_nvenc', 'libx264'];
    for (const enc of candidates) {
      const ok = await new Promise((resolve) => {
        const { args } = this.args(mon, enc, { fps: 30, kbps: 4000, maxW: 1280 });
        const i = args.indexOf('pipe:1');
        const probe = [...args.slice(0, i - 2), '-frames:v', '5', '-f', 'null', '-'];
        const p = spawn(this.ffmpegBin, probe, { windowsHide: true, stdio: 'ignore' });
        const t = setTimeout(() => p.kill(), 8000);
        p.on('exit', (code) => {
          clearTimeout(t);
          resolve(code === 0);
        });
        p.on('error', () => resolve(false));
      });
      if (ok) {
        console.log(`[pc] ${mon.gpu}: using ${enc}`);
        this.encoders.set(mon.adapter, enc);
        return enc;
      }
    }
    throw new Error('No working H.264 encoder found for this screen');
  }

  /** GET /api/pc/stream: raw Annex-B H.264 for one monitor until the client disconnects. */
  async stream(req, res, id, opts) {
    const mon = await this.monitor(id);
    if (!mon) throw Object.assign(new Error('No such screen'), { status: 404 });
    const enc = await this.encoderFor(mon);
    const { args, outW, outH } = this.args(mon, enc, opts);
    const ff = spawn(this.ffmpegBin, args, { windowsHide: true });
    const entry = { id, ff, startedAt: Date.now() };
    this.streams.add(entry);
    res.writeHead(200, {
      'Content-Type': 'video/h264',
      'Cache-Control': 'no-store',
      'X-Width': String(outW),
      'X-Height': String(outH),
      'X-Encoder': enc,
    });
    if (res.socket) res.socket.setNoDelay(true);
    ff.stdout.pipe(res);
    let err = '';
    ff.stderr.on('data', (d) => (err = (err + d).slice(-400)));
    const stop = () => {
      this.streams.delete(entry);
      try {
        ff.kill();
      } catch {}
    };
    req.on('close', stop);
    ff.on('exit', (code) => {
      this.streams.delete(entry);
      if (code && err) console.warn(`[pc] stream ${id} ended: ${err.trim().split('\n').pop()}`);
      res.end();
    });
    console.log(`[pc] streaming ${mon.name} ${outW}x${outH}@${opts.fps} ${opts.kbps}kbps (${enc})`);
  }

  /**
   * One input command from the headset, e.g. "m a0o0 0.5 0.25" (move to a normalized point
   * on a screen), "d l" / "u l" (button), "w -2" (wheel notches), "k 65 1", "t <base64>".
   */
  async input(line) {
    const p = line.trim().split(/\s+/);
    switch (p[0]) {
      case 'm': {
        const mon = await this.monitor(p[1]);
        if (!mon) return;
        const fx = Math.min(1, Math.max(0, Number(p[2])));
        const fy = Math.min(1, Math.max(0, Number(p[3])));
        this.helper.send(`move ${Math.round(mon.x + fx * (mon.w - 1))} ${Math.round(mon.y + fy * (mon.h - 1))}`);
        break;
      }
      case 'd':
      case 'u':
        if (/^[lrm]$/.test(p[1])) this.helper.send(`${p[0] === 'd' ? 'down' : 'up'} ${p[1]}`);
        break;
      case 'w':
      case 'h': {
        const n = Math.round(Number(p[1]) * 120);
        if (Number.isFinite(n) && n) this.helper.send(`${p[0] === 'w' ? 'wheel' : 'hwheel'} ${n}`);
        break;
      }
      case 'k': {
        const vk = Number(p[1]);
        if (Number.isInteger(vk) && vk > 0 && vk < 256) this.helper.send(`key ${vk} ${p[2] === '1' ? 1 : 0}${EXTENDED_VK.has(vk) ? ' ext' : ''}`);
        break;
      }
      case 't':
        if (/^[A-Za-z0-9+/=]+$/.test(p[1] || '')) this.helper.send(`text ${p[1]}`);
        break;
    }
  }

  /** POST /api/pc/input: a long-lived request body of newline-separated commands. */
  inputStream(req, res) {
    this.inputClients++;
    this.inputs.add(req);
    let buf = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line) this.input(line).catch(() => {});
      }
      if (buf.length > 65536) buf = '';
    });
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      this.inputs.delete(req);
      this.inputClients = Math.max(0, this.inputClients - 1);
      if (buf.trim()) this.input(buf).catch(() => {});
      buf = '';
      try {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
        }
      } catch {}
    };
    req.on('end', done);
    req.on('error', done);
    req.on('close', done);
  }

  /** Announce this PC on the LAN so the Quest app can find it without typing an IP. */
  startDiscovery(port) {
    this.port = port;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => {});
    sock.bind(() => {
      sock.setBroadcast(true);
      const send = () => {
        const msg = Buffer.from(JSON.stringify({ app: 'quest-mirror', port, name: os.hostname() }));
        const targets = new Set(['255.255.255.255']);
        for (const addrs of Object.values(os.networkInterfaces())) {
          for (const a of addrs || []) {
            if ((a.family !== 'IPv4' && a.family !== 4) || a.internal || !a.netmask) continue;
            const ip = a.address.split('.').map(Number);
            const mask = a.netmask.split('.').map(Number);
            targets.add(ip.map((o, k) => (o | (~mask[k] & 255)) & 255).join('.'));
          }
        }
        for (const t of targets) sock.send(msg, DISCOVERY_PORT, t, () => {});
      };
      send();
      setInterval(send, 2000);
    });
  }

  status() {
    return { supported: this.supported, streams: this.streams.size, inputClients: this.inputClients };
  }

  stopAll() {
    for (const s of this.streams) s.ff.kill();
    this.helper.stop();
  }
}

module.exports = { PcScreens, DISCOVERY_PORT };
