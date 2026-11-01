// Viewers the file explorer opens files in: images, text / code, and video / audio.
import { App } from '../panels.js';
import { T, chrome, text, mono, button, cutPath, enso } from '../theme.js';

/** IMAGE 画 — one picture, fitted to the window. */
export class ImageView extends App {
  constructor() {
    super('img', 'Image', '画', [1.2, 0.82]);
    this.img = null;
    this.name = '';
  }

  show(url, name) {
    this.name = name;
    this.img = null;
    this.err = null;
    const im = new Image();
    im.onload = () => {
      this.img = im;
      this.invalidate();
    };
    im.onerror = () => {
      this.err = 'Could not open this picture';
      this.invalidate();
    };
    im.src = url;
    this.world.panels.open(this);
    this.invalidate();
  }

  draw(g, ui, W, H) {
    const top = chrome(g, ui, W, H, { title: 'Image', kanji: '画', sub: this.name });
    const x0 = 40;
    const y0 = top + 10;
    const w = W - 80;
    const h = H - y0 - 40;
    if (!this.img) return text(g, this.err || 'opening…', W / 2, y0 + h / 2, { size: 26, color: this.err ? T.seal : T.ink2, align: 'center' });
    const k = Math.min(w / this.img.width, h / this.img.height);
    const dw = this.img.width * k;
    const dh = this.img.height * k;
    g.drawImage(this.img, x0 + (w - dw) / 2, y0 + (h - dh) / 2, dw, dh);
    mono(g, `${this.img.width} × ${this.img.height}`, W - 40, H - 14, { size: 14, color: T.ink3, align: 'right' });
  }
}

/** TEXT 文 — any text or code file, monospaced, scrollable. */
export class TextView extends App {
  constructor() {
    super('txt', 'Text', '文', [1.05, 0.84]);
    this.lines = [];
    this.scroll = 0;
  }

  async show(url, name) {
    this.name = name;
    this.lines = ['opening…'];
    this.scroll = 0;
    this.world.panels.open(this);
    try {
      const r = await fetch(url);
      const buf = await r.arrayBuffer();
      const s = new TextDecoder().decode(buf.slice(0, 400000));
      this.lines = s.replace(/\r/g, '').replace(/\t/g, '  ').split('\n');
      if (buf.byteLength > 400000) this.lines.push('', '… (only the first 400 KB is shown)');
    } catch {
      this.lines = ['Could not open this file.'];
    }
    this.invalidate();
  }

  wheel(dir) {
    this.scrollBy(dir * 6);
  }

  scrollBy(n) {
    this.scroll = Math.max(0, Math.min(Math.max(0, this.lines.length - this.rows + 2), this.scroll + n));
    this.invalidate();
  }

  pointer(kind, x, y) {
    if (kind === 'down') this.drag = { y, s: this.scroll, moved: false };
    else if (kind === 'move' && this.drag) {
      const d = Math.round((this.drag.y - y) / 30);
      if (Math.abs(this.drag.y - y) > 14) this.drag.moved = true;
      if (this.drag.moved) {
        this.scroll = Math.max(0, Math.min(Math.max(0, this.lines.length - this.rows + 2), this.drag.s + d));
        this.invalidate();
      }
      return this.drag.moved;
    } else if (kind === 'up' && this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      return moved;
    }
    return false;
  }

  click(id) {
    if (id === 'up') this.scrollBy(-this.rows + 2);
    else if (id === 'down') this.scrollBy(this.rows - 2);
  }

  draw(g, ui, W, H) {
    const top = chrome(g, ui, W, H, { title: 'Text', kanji: '文', sub: `${this.name || ''} · ${this.lines.length} lines` });
    const x0 = 40;
    const y0 = top + 14;
    const lh = 30;
    this.rows = Math.floor((H - y0 - 40) / lh);
    cutPath(g, x0, y0 - 6, W - 180, this.rows * lh + 12, 12);
    g.fillStyle = T.bg2;
    g.fill();
    for (let i = 0; i < this.rows; i++) {
      const n = this.scroll + i;
      if (n >= this.lines.length) break;
      text(g, String(n + 1).padStart(4), x0 + 10, y0 + 22 + i * lh, { size: 17, family: 'mono', color: T.ink3 });
      text(g, this.lines[n], x0 + 70, y0 + 22 + i * lh, { size: 20, family: 'mono', color: T.ink, max: W - 300 });
    }
    button(g, ui, 'up', W - 124, y0, 84, 120, '', { glyph: '▲' });
    button(g, ui, 'down', W - 124, y0 + 136, 84, 120, '', { glyph: '▼' });
  }
}

/** PLAYER 映 — video and audio from your files. */
export class MediaView extends App {
  constructor() {
    super('media', 'Player', '映', [1.28, 0.8]);
    this.canvasPx = [1408, 880];
    this.mipmaps = false;
    this.el = null;
    this.lastFrame = 0;
  }

  show(url, name, kind) {
    this.stop();
    this.name = name;
    this.kind = kind;
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.src = url;
    el.playsInline = true;
    el.preload = 'auto';
    el.onloadeddata = () => this.invalidate();
    el.onerror = () => {
      this.err = 'This file does not play here';
      this.invalidate();
    };
    this.el = el;
    this.err = null;
    this.world.panels.open(this);
    el.play().catch(() => {});
  }

  stop() {
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
      this.el = null;
    }
  }

  closed() {
    this.stop();
  }

  update(t) {
    // redraw at ~30 fps while it plays, otherwise only when something changes
    if (this.el && !this.el.paused && t - this.lastFrame > 1 / 30) {
      this.lastFrame = t;
      this.invalidate();
    }
  }

  click(id, data) {
    const el = this.el;
    if (!el) return;
    if (id === 'play') el.paused ? el.play().catch(() => {}) : el.pause();
    else if (id === 'back') el.currentTime = Math.max(0, el.currentTime - 10);
    else if (id === 'fwd') el.currentTime = Math.min(el.duration || 0, el.currentTime + 10);
    else if (id === 'seek' && el.duration) el.currentTime = data * el.duration;
    this.invalidate();
  }

  pointer(kind, x, y) {
    // tap anywhere on the progress bar to seek there
    if (kind === 'up' && this.bar && y >= this.bar.y - 20 && y <= this.bar.y + 30 && x >= this.bar.x && x <= this.bar.x + this.bar.w) {
      this.click('seek', (x - this.bar.x) / this.bar.w);
      return true;
    }
    return false;
  }

  draw(g, ui, W, H) {
    const el = this.el;
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 30);
    g.fillStyle = '#0b0b0c';
    g.fill();
    const vh = H - 150;
    if (el && this.kind === 'video' && el.readyState >= 2 && el.videoWidth) {
      const k = Math.min((W - 40) / el.videoWidth, vh / el.videoHeight);
      const dw = el.videoWidth * k;
      const dh = el.videoHeight * k;
      g.drawImage(el, (W - dw) / 2, 20 + (vh - dh) / 2, dw, dh);
    } else {
      enso(g, W / 2, vh / 2 + 20, 150, { seed: 3, width: 20, color: T.ink, progress: el && el.duration ? 0.2 + 0.8 * (el.currentTime / el.duration) : 1 });
      text(g, this.err || this.name || '', W / 2, vh / 2 + 240, { size: 26, color: this.err ? T.seal : T.ink2, align: 'center', max: W - 120 });
    }
    // controls
    const cy = H - 110;
    const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');
    button(g, ui, 'back', 40, cy, 100, 80, '', { glyph: '↺' });
    button(g, ui, 'play', 152, cy, 120, 80, '', { glyph: el && !el.paused ? '❚❚' : '▶', primary: true });
    button(g, ui, 'fwd', 284, cy, 100, 80, '', { glyph: '↻' });
    const bx = 420;
    const bw = W - bx - 200;
    this.bar = { x: bx, y: cy + 40, w: bw };
    g.fillStyle = T.line2;
    g.fillRect(bx, cy + 38, bw, 4);
    const f = el && el.duration ? el.currentTime / el.duration : 0;
    g.fillStyle = T.seal;
    g.fillRect(bx, cy + 36, bw * f, 8);
    mono(g, `${fmt(el ? el.currentTime : 0)} / ${fmt(el ? el.duration : NaN)}`, W - 40, cy + 48, { size: 18, color: T.ink2, align: 'right' });
    text(g, this.name || '', bx, cy + 22, { size: 18, color: T.ink3, max: bw });
  }
}
