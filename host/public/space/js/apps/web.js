// WEB — websites and YouTube, in the space. Pages run in a browser on your PC (Edge, in the
// background) and stream in. Pinch to click; drag up or down to scroll; drag sideways to drag (a
// video's progress bar). The keyboard comes up when you tap a text field. Sound plays in the headset.
// Without the PC, it offers to open the Quest Browser instead.
import * as THREE from 'three';
import { App } from '../panels.js';
import { T, text, button, cutPath, icon, PX_PER_M } from '../theme.js';
import { api, tokenSync, pcToken } from '../api.js';
import { PcSound } from './screens.js';

const PAGE = { x: 2, y: 100, w: 1316, h: 740 }; // the page, 16:9, edge to edge under the bar
const SIZE = [(PAGE.x * 2 + PAGE.w) / PX_PER_M, (PAGE.y + PAGE.h + 2) / PX_PER_M];
const HOME = 'https://www.youtube.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** On the Quest alone: the Quest app's own browser, asked for pictures and its state in turn. */
class QuestWebStream {
  constructor(onFrame, onState) {
    this.onFrame = onFrame;
    this.onState = onState;
  }

  async start() {
    const r = await fetch('/api/space/web/state');
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `The Quest said ${r.status}`);
    this.on = true;
    this.onState(await r.json());
    this.pictures();
    this.status();
  }

  async pictures() {
    let seq = -1;
    while (this.on) {
      try {
        const r = await fetch(`/api/space/web/frame?after=${seq}`);
        if (r.status === 200) {
          seq = Number(r.headers.get('X-Seq')) || seq + 1;
          this.onFrame(new Uint8Array(await r.arrayBuffer()));
        } else if (r.status !== 204) await sleep(600);
      } catch {
        await sleep(1000);
      }
    }
  }

  async status() {
    while (this.on) {
      await sleep(600);
      try {
        this.onState(await (await fetch('/api/space/web/state')).json());
      } catch {}
    }
  }

  stop() {
    this.on = false;
  }
}

/** Reads the host's stream: [type 1 byte][length 4 bytes][payload] — 1 = JPEG frame, 2 = state. */
class WebStream {
  constructor(onFrame, onState) {
    this.onFrame = onFrame;
    this.onState = onState;
  }

  async start() {
    await pcToken();
    this.abort = new AbortController();
    const res = await fetch('/api/pc/web/stream', { headers: { 'X-QM-Token': tokenSync() || '' }, signal: this.abort.signal });
    if (!res.ok) {
      let msg = `The PC said ${res.status}`;
      try {
        msg = (await res.json()).error || msg;
      } catch {}
      throw new Error(msg);
    }
    this.read(res.body.getReader());
  }

  async read(reader) {
    let buf = new Uint8Array(1 << 20);
    let len = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (len + value.length > buf.length) {
          const bigger = new Uint8Array(Math.max(buf.length * 2, len + value.length));
          bigger.set(buf.subarray(0, len));
          buf = bigger;
        }
        buf.set(value, len);
        len += value.length;
        let off = 0;
        while (len - off >= 5) {
          const n = ((buf[off + 1] << 24) >>> 0) + (buf[off + 2] << 16) + (buf[off + 3] << 8) + buf[off + 4];
          if (len - off < 5 + n) break;
          const type = buf[off];
          const payload = buf.slice(off + 5, off + 5 + n);
          off += 5 + n;
          if (type === 1) this.onFrame(payload);
          else if (type === 2) this.onState(JSON.parse(new TextDecoder().decode(payload)));
        }
        if (off) {
          buf.copyWithin(0, off, len);
          len -= off;
        }
      }
    } catch {}
    if (this.onEnd) this.onEnd();
  }

  stop() {
    if (this.abort) this.abort.abort();
    this.abort = null;
  }
}

export class Web extends App {
  constructor() {
    super('web', 'Web', '', SIZE);
    this.state = { url: '', title: '', loading: false, back: false, fwd: false, running: false };
    this.live = false; // frames are coming
    this.error = null;
    this.editing = false;
    this.addr = '';
    this.soundOn = true;
    this.queue = [];
    this.busy = false;
    this.lastMove = 0;
  }

  // ------------------------------------------------------------------ life

  opened() {
    if (!this.page) {
      this.tex = new THREE.Texture();
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.tex.flipY = false;
      this.tex.generateMipmaps = false;
      this.tex.minFilter = THREE.LinearFilter;
      const w = PAGE.w / PX_PER_M;
      const h = PAGE.h / PX_PER_M;
      this.page = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
      const W = SIZE[0] * PX_PER_M;
      const H = SIZE[1] * PX_PER_M;
      this.page.position.set((PAGE.x + PAGE.w / 2 - W / 2) / PX_PER_M, (H / 2 - PAGE.y - PAGE.h / 2) / PX_PER_M, -0.002);
      this.page.visible = false;
    }
    this.panel.group.add(this.page);
    this.connect();
  }

  async connect() {
    this.error = null;
    this.live = false;
    this.invalidate();
    if (this.stream) this.stream.stop();
    const s = new (this.world.standalone ? QuestWebStream : WebStream)(
      (jpeg) => this.frame(jpeg),
      (st) => this.onState(st)
    );
    s.onEnd = () => {
      if (this.stream === s && this.panel && this.panel.state === 'open') {
        this.live = false;
        this.error = 'The connection to the PC ended.';
        this.invalidate();
      }
    };
    this.stream = s;
    try {
      await s.start();
      if (this.soundOn && !this.world.standalone) this.startSound(); // on the Quest, its browser plays sound itself
    } catch (e) {
      this.error = this.world.standalone || e.name === 'TypeError' ? 'No PC is connected, so use the Quest Browser for now.' : e.message;
      this.invalidate();
    }
  }

  closed() {
    if (this.stream) this.stream.stop();
    this.stream = null;
    this.stopSound();
    this.live = false;
    if (this.page) this.page.visible = false;
    if (this.world.keyboard.target === this) this.world.keyboard.hide();
  }

  startSound() {
    if (this.audio) return;
    this.audio = new PcSound(this.world.sound);
    this.audio.start();
  }

  stopSound() {
    if (this.audio) this.audio.stop();
    this.audio = null;
  }

  frame(jpeg) {
    if (this.decoding) {
      this.pending = jpeg; // keep only the newest
      return;
    }
    this.decoding = true;
    createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }), { imageOrientation: 'flipY' }).then(
      (bmp) => {
        this.decoding = false;
        if (!this.panel || this.panel.state !== 'open') return bmp.close();
        const old = this.tex.image;
        this.tex.image = bmp;
        this.tex.needsUpdate = true;
        if (old && old.close) setTimeout(() => old.close(), 100);
        this.page.visible = true;
        if (!this.live) {
          this.live = true;
          this.invalidate();
        }
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          this.frame(p);
        }
      },
      () => (this.decoding = false)
    );
  }

  onState(st) {
    const before = this.state;
    this.state = st;
    if (st.typing && st.focusAt !== before.focusAt && !this.editing) this.world.keyboard.showFor(this);
    this.invalidate();
  }

  // ------------------------------------------------------------------ input

  send(ev) {
    if (ev.t === 'move') {
      const last = this.queue[this.queue.length - 1];
      if (last && last.t === 'move' && !!last.held === !!ev.held) this.queue.pop();
    }
    this.queue.push(ev);
  }

  flush() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    api(this.world.standalone ? '/api/space/web/input' : '/api/pc/web/input', { events: this.queue.splice(0) })
      .catch(() => {})
      .finally(() => (this.busy = false));
  }

  nav(url) {
    this.editing = false;
    this.send({ t: 'nav', url });
    if (this.world.keyboard.target === this) this.world.keyboard.hide();
    this.invalidate();
  }

  pointer(kind, x, y) {
    const panel = this.panel;
    if (panel.ui.find(x, y) && !this.drag) return false; // toolbar
    const inPage = x >= PAGE.x && x <= PAGE.x + PAGE.w && y >= PAGE.y && y <= PAGE.y + PAGE.h;
    if (!this.live) return false;
    const nx = Math.min(1, Math.max(0, (x - PAGE.x) / PAGE.w));
    const ny = Math.min(1, Math.max(0, (y - PAGE.y) / PAGE.h));
    const d = this.drag;
    if (kind === 'hover' || (kind === 'move' && !d)) {
      // hover (menus, video controls) — a few times a second is plenty
      const h = this.hover;
      if (inPage && performance.now() - this.lastMove > 90 && (!h || Math.abs(h.x - nx) + Math.abs(h.y - ny) > 0.003)) {
        this.lastMove = performance.now();
        this.hover = { x: nx, y: ny };
        this.send({ t: 'move', x: nx, y: ny });
      }
      return inPage;
    }
    if (kind === 'down') {
      if (!inPage) return false;
      if (this.editing) {
        this.editing = false;
        this.invalidate();
      }
      this.drag = { x, y, nx, ny, lastY: y, mode: null, acc: 0 };
      return true;
    }
    if (kind === 'move' && d) {
      if (!d.mode && Math.hypot(x - d.x, y - d.y) > 14) {
        // the first few millimetres decide: up/down scrolls the page, sideways drags on it
        d.mode = Math.abs(y - d.y) > Math.abs(x - d.x) ? 'scroll' : 'drag';
        if (d.mode === 'drag') this.send({ t: 'down', x: d.nx, y: d.ny });
      }
      if (d.mode === 'drag') this.send({ t: 'move', x: nx, y: ny, held: true });
      else if (d.mode === 'scroll') {
        d.acc += (d.lastY - y) * 2.4;
        d.lastY = y;
        if (Math.abs(d.acc) > 12) {
          this.send({ t: 'wheel', x: d.nx, y: d.ny, dy: Math.round(d.acc) });
          d.acc = 0;
        }
      }
      return true;
    }
    if (kind === 'up' || kind === 'leave') {
      if (!d) return false;
      if (!d.mode && kind === 'up') {
        this.send({ t: 'down', x: d.nx, y: d.ny });
        this.send({ t: 'up', x: d.nx, y: d.ny });
      } else if (d.mode === 'drag') this.send({ t: 'up', x: nx, y: ny });
      this.drag = null;
      return kind === 'up';
    }
    return false;
  }

  /** Thumbstick or mouse wheel over the page. */
  wheel(dir) {
    const h = this.hover || { x: 0.5, y: 0.5 };
    this.send({ t: 'wheel', x: h.x, y: h.y, dy: dir * 180 });
  }

  key(k) {
    if (this.editing) {
      if (k === 'Enter') return this.nav(this.addr.trim() || HOME);
      if (k === 'Backspace') this.addr = this.addr.slice(0, -1);
      else if (k === 'Escape') this.editing = false;
      else if (k.length === 1) this.addr += k;
      return this.invalidate();
    }
    if (k.length === 1) {
      const last = this.queue[this.queue.length - 1];
      if (last && last.t === 'text') last.s += k;
      else this.send({ t: 'text', s: k });
    } else this.send({ t: 'key', k });
  }

  click(id) {
    const W = this.world;
    if (id === 'back' || id === 'forward' || id === 'reload') this.send({ t: id });
    else if (id === 'addr') {
      this.editing = true;
      this.addr = '';
      W.keyboard.showFor(this);
    } else if (id === 'yt') this.nav(HOME);
    else if (id === 'keys') W.keyboard.toggle(this);
    else if (id === 'sound') {
      this.soundOn = !this.soundOn;
      if (this.soundOn && this.live) this.startSound();
      else this.stopSound();
    } else if (id === 'retry') this.connect();
    else if (id === 'quest') {
      // the Quest Browser: works without the PC (the space pauses while it is open)
      window.open(this.state.url || HOME, 'utsushi-web'); // one tab, reused
      W.coreSay('Quest Browser is open next to the space.');
    }
    this.invalidate();
  }

  update() {
    this.flush();
    if (this.page && this.panel) {
      this.page.material.opacity = this.panel.surface.mat.uniforms.uOpacity.value;
      this.page.visible = this.live && this.panel.state === 'open';
    }
  }

  // ------------------------------------------------------------------ drawing

  draw(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    // borderless: only the bar on top has a body; the page runs to the edges with a hairline round it
    cutPath(g, 0, 0, W, PAGE.y + 1, 12);
    g.fillStyle = T.bg;
    g.fill();
    g.strokeStyle = T.line;
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
    const st = this.state;
    // toolbar
    const by = 20;
    const bh = 60;
    button(g, ui, 'back', 24, by, 64, bh, '', { iconName: 'back', disabled: !this.live || !st.back });
    button(g, ui, 'forward', 96, by, 64, bh, '', { iconName: 'next', disabled: !this.live || !st.fwd });
    button(g, ui, 'reload', 168, by, 64, bh, '', { iconName: 'refresh', disabled: !this.live });
    const ax = 248;
    const right = 3 * 72;
    const aw = W - ax - 24 - right;
    cutPath(g, ax, by, aw, bh, 8);
    g.fillStyle = T.bg2;
    g.fill();
    if (this.editing) {
      g.strokeStyle = T.seal;
      g.lineWidth = 2;
      g.stroke();
    }
    icon(g, 'search', ax + 18, by + bh / 2 - 11, 22, T.ink3);
    let host = '';
    try {
      host = st.url ? new URL(st.url).hostname.replace(/^www\./, '') : '';
    } catch {}
    if (this.editing) text(g, `${this.addr}▏`, ax + 54, by + bh / 2 + 7, { size: 21, color: T.ink, max: aw - 70 });
    else {
      text(g, st.title || host || 'Search or type an address', ax + 54, by + bh / 2 + 7, { size: 21, weight: st.title ? 600 : 400, color: st.title || host ? T.ink : T.ink3, max: aw - 260 });
      if (host) text(g, host, ax + aw - 18, by + bh / 2 + 6, { size: 16, family: 'mono', color: T.ink3, align: 'right', max: 200 });
    }
    if (st.loading && this.live) {
      g.fillStyle = T.seal;
      g.fillRect(ax + 8, by + bh - 3, (aw - 16) * 0.35, 3);
    }
    ui.hit('addr', ax, by, aw, bh);
    const rx = ax + aw + 8;
    button(g, ui, 'yt', rx, by, 64, bh, '', { iconName: 'play' });
    button(g, ui, 'keys', rx + 72, by, 64, bh, '', { iconName: 'keyboard', active: this.world.keyboard.visible && this.world.keyboard.target === this });
    if (!this.world.standalone) button(g, ui, 'sound', rx + 144, by, 64, bh, '', { iconName: 'sound', active: this.soundOn });
    // the page (the streamed picture shows through this hole)
    if (this.live) g.clearRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h);
    else {
      g.fillStyle = T.bg2;
      g.fillRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h);
      const cx = PAGE.x + PAGE.w / 2;
      const cy = PAGE.y + PAGE.h / 2;
      if (this.error) {
        icon(g, 'globe', cx - 26, cy - 150, 52, T.ink3);
        text(g, this.world.standalone ? 'The browser did not start' : 'Web runs through your PC', cx, cy - 50, { size: 30, weight: 600, color: T.ink, align: 'center' });
        text(g, this.error, cx, cy - 10, { size: 20, color: T.ink3, align: 'center', max: PAGE.w - 200 });
        button(g, ui, 'retry', cx - 330, cy + 40, 300, 66, 'Try again', { iconName: 'refresh', small: true });
        button(g, ui, 'quest', cx + 30, cy + 40, 300, 66, 'Quest Browser', { iconName: 'globe', small: true, primary: true });
        text(g, 'Quest Browser opens on its own; the space waits for you.', cx, cy + 150, { size: 17, color: T.ink3, align: 'center' });
      } else text(g, this.world.standalone ? 'Starting the browser…' : 'Starting the browser on your PC…', cx, cy, { size: 22, color: T.ink3, align: 'center' });
    }

  }
}
