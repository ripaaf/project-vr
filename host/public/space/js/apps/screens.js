// PC SCREEN — your PC's monitors inside the space, decoded with WebCodecs. Point = mouse,
// pinch / touch = click, long pinch = right click, pinch-and-drag = drag (or scroll in scroll mode).
// Decoded frames go straight into a GPU texture (no canvas copy) and are released right after use,
// so the stream stays light; the toolbar sits on its own layer above the picture.
import * as THREE from 'three';
import { App } from '../panels.js';
import { Surface } from '../surface.js';
import { T, chrome, text, mono, button, cutPath, icon, hairline, settingRow } from '../theme.js';
import { api, pcToken, tokenSync } from '../api.js';

// ------------------------------------------------------------------ H.264 (Annex B) → VideoFrames

function codecFromSps(nal) {
  const h = (b) => b.toString(16).padStart(2, '0');
  return `avc1.${h(nal[1])}${h(nal[2])}${h(nal[3])}`;
}

class H264Player {
  constructor(onFrame, onState) {
    this.onFrame = onFrame;
    this.onState = onState;
    this.ts = 0;
    this.configured = false;
    this.gotKey = false;
  }

  async start(url) {
    this.stop();
    if (!('VideoDecoder' in window)) return this.onState('This browser cannot decode video');
    const abort = (this.abort = new AbortController());
    this.decoder = new VideoDecoder({
      output: (f) => (this.abort === abort ? this.onFrame(f) : f.close()),
      error: (e) => this.onState(`decoder: ${e.message}`),
    });
    this.configured = false;
    this.gotKey = false;
    let res;
    try {
      res = await fetch(url, { headers: { 'X-QM-Token': tokenSync() || '' }, signal: abort.signal });
    } catch (e) {
      return this.onState(e.name === 'AbortError' ? null : `stream: ${e.message}`);
    }
    if (!res.ok) return this.onState(res.status === 401 ? 'Not linked with this PC' : res.status === 403 ? 'Sharing is off on the PC' : `stream: HTTP ${res.status}`);
    this.onState('waiting for the first picture…');
    const reader = res.body.getReader();
    // one growing buffer, scanned only where new bytes arrived (linear, no copies per chunk)
    let buf = new Uint8Array(1 << 20);
    let len = 0;
    let scan = 0;
    let start = -1;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (len + value.length > buf.length) {
          let cap = buf.length;
          while (cap < len + value.length) cap *= 2;
          if (cap > 16 << 20) {
            len = scan = 0;
            start = -1;
            continue;
          }
          const nb = new Uint8Array(cap);
          nb.set(buf.subarray(0, len));
          buf = nb;
        }
        buf.set(value, len);
        len += value.length;
        // access units start at each AUD: 00 00 00 01 09
        let i = scan;
        while (i + 4 < len) {
          if (buf[i + 2] !== 0) {
            i += 3;
            continue;
          }
          if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 3] === 1 && (buf[i + 4] & 0x1f) === 9) {
            if (start >= 0) this.au(buf.subarray(start, i));
            start = i;
            i += 5;
          } else i++;
        }
        scan = Math.max(0, len - 4);
        if (start > 0) {
          buf.copyWithin(0, start, len);
          len -= start;
          scan = Math.max(0, scan - start);
          start = 0;
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') this.onState(`stream: ${e.message}`);
      return;
    }
    this.onState('the stream ended');
  }

  au(data) {
    let key = false;
    let sps = null;
    const n = Math.min(data.length, 4096); // parameter sets and the slice header come first
    for (let i = 0; i + 4 < n; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
        const type = data[i + 3] & 0x1f;
        if (type === 5) key = true;
        if (type === 7) sps = data.subarray(i + 3, i + 8);
        i += 3;
      }
    }
    if (!this.configured) {
      if (!sps) return;
      this.decoder.configure({ codec: codecFromSps(sps), optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
      this.configured = true;
    }
    if (!this.gotKey && !key) return;
    this.gotKey = true;
    if (this.decoder.decodeQueueSize > 4 && !key) return; // behind: skip to the next keyframe
    this.ts += 33333;
    this.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: this.ts, data: data.slice() }));
  }

  stop() {
    if (this.abort) this.abort.abort();
    this.abort = null;
    try {
      if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    } catch {}
    this.decoder = null;
  }
}

// ------------------------------------------------------------------ PC sound (raw s16le stereo 48 kHz)

export class PcSound {
  constructor(sound) {
    this.sound = sound;
  }
  async start() {
    this.stop();
    const ctx = this.sound.ctx;
    if (!ctx) return;
    this.abort = new AbortController();
    let res;
    try {
      res = await fetch('/api/pc/audio', { headers: { 'X-QM-Token': tokenSync() || '' }, signal: this.abort.signal });
    } catch {
      return;
    }
    if (!res.ok) return;
    const reader = res.body.getReader();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.9;
    this.gain.connect(ctx.destination);
    let next = 0;
    let rest = new Uint8Array(0);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const all = new Uint8Array(rest.length + value.length);
        all.set(rest);
        all.set(value, rest.length);
        const frames = Math.floor(all.length / 4);
        rest = all.slice(frames * 4);
        if (frames < 1) continue;
        const dv = new DataView(all.buffer, 0, frames * 4);
        const b = ctx.createBuffer(2, frames, 48000);
        const L = b.getChannelData(0);
        const R = b.getChannelData(1);
        for (let i = 0; i < frames; i++) {
          L[i] = dv.getInt16(i * 4, true) / 32768;
          R[i] = dv.getInt16(i * 4 + 2, true) / 32768;
        }
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(this.gain);
        const now = ctx.currentTime;
        if (next < now + 0.03 || next > now + 0.4) next = now + 0.06; // low latency, recover from gaps
        src.start(next);
        next += b.duration;
      }
    } catch {}
  }
  stop() {
    if (this.abort) this.abort.abort();
    this.abort = null;
    if (this.gain) this.gain.disconnect();
    this.gain = null;
  }
}

// ------------------------------------------------------------------ one monitor

const VK = { Enter: 13, Backspace: 8, ArrowUp: 38, ArrowDown: 40, Tab: 9, Escape: 27 };

export class ScreenView extends App {
  constructor(mon) {
    const ar = mon.w / mon.h || 16 / 9;
    const w = 1.5;
    super(`screen-${mon.id}`, mon.name, '', [w, w / ar]);
    this.mon = mon;
    this.canvasPx = [1280, Math.round(1280 / ar)];
    this.mipmaps = false;
    this.state = 'connecting…';
    this.scrollMode = false;
    this.queue = [];
    this.lastMove = 0;
    this.current = null;
    this.player = new H264Player((f) => this.frame(f), (s) => {
      if (s) this.state = s;
      this.invalidate();
    });
  }

  opened() {
    this.world.keyTarget = this;
    if (!this.video) {
      this.videoTex = new THREE.Texture();
      this.videoTex.colorSpace = THREE.SRGBColorSpace;
      this.videoTex.generateMipmaps = false;
      this.videoTex.minFilter = THREE.LinearFilter;
      this.video = new THREE.Mesh(new THREE.PlaneGeometry(this.size[0], this.size[1]), new THREE.MeshBasicMaterial({ map: this.videoTex, transparent: true, toneMapped: false }));
      this.video.position.z = -0.002;
      this.bar = new Surface(this.world, { size: [0.4, 0.06], ss: 2.6, name: 'screen-bar', draw: (g, ui, W, H) => this.drawBar(g, ui, W, H), click: (id) => this.click(id) });
      this.bar.mesh.position.set(-this.size[0] / 2 + 0.2, this.size[1] / 2 + 0.045, 0);
      this.panel.group.add(this.bar.mesh);
      this.video.visible = false;
      this.panel.group.add(this.video);
    }
    this.state = 'connecting…';
    pcToken().then(() => this.player.start(`/api/pc/stream?id=${encodeURIComponent(this.mon.id)}&maxw=1440&fps=30&kbps=8000`));
    this.world.apps.pc.screenOpened(this);
    this.flusher = setInterval(() => this.flush(), 33);
  }

  closed() {
    this.player.stop();
    clearInterval(this.flusher);
    if (this.current) this.current.close();
    this.current = null;
    if (this.video) this.video.visible = false;
    this.world.apps.pc.screenClosed(this);
  }

  /** A decoded frame: hand it to the GPU texture, release the previous one. */
  frame(f) {
    if (!this.panel || this.panel.state !== 'open' || !this.videoTex) return f.close();
    if (this.current) this.current.close();
    this.current = f;
    this.videoTex.image = f;
    this.videoTex.needsUpdate = true;
    this.video.visible = true;
    if (this.state !== 'live') {
      this.state = 'live';
      this.invalidate();
    }
  }

  update() {
    if (this.video) this.video.material.opacity = this.panel.surface.mat.uniforms.uOpacity.value;
    if (this.bar) {
      this.bar.mat.uniforms.uOpacity.value = this.panel.surface.mat.uniforms.uOpacity.value;
      this.bar.update(performance.now() / 1000, 1 / 72);
    }
  }

  draw(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    if (this.state !== 'live') {
      cutPath(g, 0, 0, W, H, 14);
      g.fillStyle = T.bgSolid;
      g.fill();
      icon(g, 'pc', W / 2 - 30, H / 2 - 110, 60, T.ink3);
      text(g, this.mon.name, W / 2, H / 2 + 10, { size: 40, weight: 600, color: T.ink, align: 'center' });
      text(g, this.state, W / 2, H / 2 + 56, { size: 22, color: T.ink3, align: 'center', max: W - 80 });
    }
  }

  send(line) {
    this.queue.push(line);
  }

  flush() {
    if (!this.queue.length) return;
    const lines = this.queue.splice(0);
    const lastMove = lines.filter((l) => l.startsWith('m ')).pop(); // keep only the newest mouse move
    const out = lines.filter((l) => !l.startsWith('m ') || l === lastMove);
    api('/api/pc/input-batch', { lines: out }).catch(() => {});
  }

  pointer(kind, x, y) {
    const panel = this.panel;
    if (panel.ui.find(x, y)) return false; // toolbar buttons
    const fx = x / panel.W;
    const fy = y / panel.H;
    const move = () => this.send(`m ${this.mon.id} ${fx.toFixed(4)} ${fy.toFixed(4)}`);
    if (kind === 'hover' || kind === 'move') {
      if (kind === 'move' && this.down && this.scrollMode) {
        const notches = Math.trunc(((y - this.down.y) / panel.H) * 18);
        if (notches) {
          this.send(`w ${notches}`);
          this.down.y = y;
        }
        return true;
      }
      if (this.down && !this.down.dragging && Math.hypot(x - this.down.x, y - this.down.y) > 18) {
        this.down.dragging = true;
        clearTimeout(this.down.timer);
      }
      if (performance.now() - this.lastMove > 25) {
        this.lastMove = performance.now();
        move();
      }
      return true;
    }
    if (kind === 'down') {
      move();
      this.down = { x, y, dragging: false, right: false };
      if (!this.scrollMode) {
        this.send('d l');
        this.down.timer = setTimeout(() => {
          // a long pinch without moving = right click
          if (this.down && !this.down.dragging) {
            this.send('u l');
            this.send('d r');
            this.send('u r');
            this.down.right = true;
            this.world.sound.click(panel.group.position);
          }
        }, 650);
      }
      return true;
    }
    if (kind === 'up' || kind === 'leave') {
      if (this.down) {
        clearTimeout(this.down.timer);
        if (!this.scrollMode && !this.down.right) this.send('u l');
        this.down = null;
      }
      return kind === 'up';
    }
    return false;
  }

  wheel(d) {
    this.send(`w ${-d}`);
  }

  /** The controls float on their own bar just above the screen, so nothing covers your desktop. */
  drawBar(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 7);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = T.line2;
    g.lineWidth = 1;
    g.stroke();
    button(g, ui, 'close', 6, 6, 54, H - 12, '', { iconName: 'close' });
    button(g, ui, 'scroll', 66, 6, 150, H - 12, this.scrollMode ? 'Scrolling' : 'Scroll', { small: true, active: this.scrollMode });
    button(g, ui, 'keys', 222, 6, W - 228, H - 12, 'Keyboard', { iconName: 'keyboard', small: true });
  }

  extraSurfaces() {
    return this.bar && this.panel && this.panel.state === 'open' ? [this.bar] : [];
  }

  click(id) {
    if (id === 'close') {
      this.world.panels.close(this);
      return;
    }
    if (id === 'scroll') {
      this.scrollMode = !this.scrollMode;
      this.invalidate();
      if (this.bar) this.bar.dirty = true;
    } else if (id === 'keys') this.world.keyboard.toggle(this);
  }

  key(k) {
    if (VK[k]) {
      this.send(`k ${VK[k]} 1`);
      this.send(`k ${VK[k]} 0`);
    } else if (k.length === 1) this.send(`t ${btoa(unescape(encodeURIComponent(k)))}`);
  }
}

// ------------------------------------------------------------------ the list

export class Screens extends App {
  constructor() {
    super('pc', 'PC screen', '', [0.96, 0.7]);
    this.monitors = null;
    this.err = null;
    this.views = new Map();
    this.open = new Set();
    this.soundOn = true;
  }

  async opened() {
    this.err = null;
    try {
      await pcToken();
      this.monitors = (await api('/api/pc/monitors')).monitors;
    } catch (e) {
      this.err = e.status === 401 ? 'This headset is not linked with the PC yet. Link it in the UTSUSHI app.' : e.message;
    }
    this.invalidate();
  }

  view(m) {
    if (!this.views.has(m.id)) this.views.set(m.id, new ScreenView(m));
    return this.views.get(m.id);
  }

  screenOpened(v) {
    this.open.add(v);
    if (this.soundOn && !this.audio) {
      this.audio = new PcSound(this.world.sound);
      this.audio.start();
    }
    this.invalidate();
  }

  screenClosed(v) {
    this.open.delete(v);
    if (!this.open.size && this.audio) {
      this.audio.stop();
      this.audio = null;
    }
    this.invalidate();
  }

  click(id, data) {
    const W = this.world;
    if (id === 'open') {
      const m = this.monitors.find((x) => x.id === data);
      const v = this.view(m);
      if (W.panels.isOpen(v)) W.panels.close(v);
      else W.panels.open(v, { slot: 0, dist: 1.25, height: 0.08 }); // a desktop: a little further than a window, still close
    } else if (id === 'all') {
      this.monitors.forEach((m, i) => W.panels.open(this.view(m), { slot: i === 0 ? 0 : i % 2 ? i : -i, dist: 1.3, height: 0.08 }));
    } else if (id === 'sound') {
      this.soundOn = !this.soundOn;
      if (!this.soundOn && this.audio) {
        this.audio.stop();
        this.audio = null;
      } else if (this.soundOn && this.open.size && !this.audio) {
        this.audio = new PcSound(W.sound);
        this.audio.start();
      }
    } else if (id === 'retry') this.opened();
    this.invalidate();
  }

  draw(g, ui, W, H) {
    const top = chrome(g, ui, W, H, { title: 'PC screen', sub: 'Your monitors, live, with sound' });
    const x = 40;
    const w = W - 80;
    if (this.err) {
      text(g, 'Can’t reach the PC screen', x, top + 50, { size: 26, weight: 600, color: T.ink });
      text(g, this.err, x, top + 86, { size: 19, color: T.ink2, max: w });
      button(g, ui, 'retry', x, top + 116, 220, 64, 'Try again', { primary: true, small: true });
      return;
    }
    if (!this.monitors) return text(g, 'Asking the PC…', x, top + 50, { size: 21, color: T.ink2 });
    mono(g, `${this.monitors.length} monitor${this.monitors.length === 1 ? '' : 's'}`, x, top + 26);
    let y = top + 42;
    for (const m of this.monitors.slice(0, 3)) {
      const isOpen = this.world.panels.isOpen(this.view(m));
      cutPath(g, x, y, w, 96, 8);
      g.fillStyle = T.bg2;
      g.fill();
      icon(g, 'pc', x + 22, y + 26, 40, isOpen ? T.seal : T.ink2);
      text(g, m.name, x + 84, y + 44, { size: 23, weight: 600, color: T.ink });
      text(g, `${m.w} × ${m.h}${isOpen ? ' · showing' : ''}`, x + 84, y + 72, { size: 17, family: 'mono', color: T.ink3 });
      button(g, ui, 'open', x + w - 170, y + 18, 150, 60, isOpen ? 'Close' : 'Open', { small: true, primary: !isOpen, data: m.id });
      y += 108;
    }
    if (this.monitors.length > 1) button(g, ui, 'all', x, y + 4, 220, 60, 'Open all', { small: true });
    const sy = H - 196;
    hairline(g, x, sy, w);
    settingRow(g, ui, 'sound', x, sy, w, 'PC sound in the headset', 'Plays while a screen is open', { on: this.soundOn });
    text(g, 'Point = mouse · pinch or touch = click · hold = right click', x, H - 44, { size: 16, color: T.ink3 });
  }
}
