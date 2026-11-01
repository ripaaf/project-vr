// MODELS — 3D models to look at up close: a live miniature of your room, a few samples, your own
// files (GLB · glTF · OBJ · STL · PLY from the PC's models folder, or opened from Files) and your
// scans. Put one on the stage, a small plinth in front of you, to turn it, lift it, scale it and
// read its real size.
import { App } from '../panels.js';
import { T, chrome, text, mono, button, cutPath, hairline, icon, section, paragraph } from '../theme.js';
import { api } from '../api.js';
import { loadModel, formatOf, sizeLabel, countLabel, bytesLabel, measure } from './modelload.js';
import { Stage } from './stage.js';
import { makeRoom } from './miniroom.js';
import { SAMPLES } from './samples.js';

const ROOM = { id: 'room', name: 'Your room', desc: 'Live, in miniature' };
const when = (ms) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en', { day: 'numeric', month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** Scans are named by when they were made. */
const title = (f) => (f.scan && f.time ? `Scan, ${when(f.time)}` : f.name);

export class Models extends App {
  constructor() {
    super('models', 'Models', '', [1.2, 0.8]);
    this.files = null;
    this.sel = { type: 'sample', id: 'room' };
    this.page = 0;
    this.confirm = false;
    this.loading = null;
    this._stage = null;
  }

  get stage() {
    if (!this._stage) this._stage = new Stage(this.world);
    return this._stage;
  }

  async opened() {
    await this.refresh();
  }

  async refresh() {
    try {
      this.files = (await api('/api/space/models')).models;
    } catch {
      this.files = [];
    }
    this.invalidate();
  }

  key(sel) {
    return `${sel.type}:${sel.id}`;
  }

  selected() {
    const s = this.sel;
    if (s.type === 'sample') return s.id === 'room' ? ROOM : SAMPLES.find((x) => x.id === s.id);
    if (s.type === 'file') return (this.files || []).find((f) => f.file === s.id) || s.entry || null;
    return null;
  }

  onStage() {
    const st = this._stage;
    return !!st && st.on && !!st.item && st.item.key === this.key(this.sel);
  }

  /** Load the selected thing and put it on the stage. */
  async show(sel = this.sel) {
    const W = this.world;
    const key = this.key(sel);
    if (sel.type === 'sample') {
      if (sel.id === 'room') {
        const r = makeRoom(W);
        this.stage.set({ root: r.root, stats: measure(r.root), unit: 1, name: 'Your room', format: 'live', live: r.live, note: r.note, key });
      } else {
        const s = SAMPLES.find((x) => x.id === sel.id);
        const root = s.make();
        this.stage.set({ root, stats: measure(root), unit: 1, name: s.name, format: 'sample', key });
      }
      this.invalidate();
      return;
    }
    const f = this.selected();
    if (!f) return;
    this.loading = f.name;
    this.invalidate();
    try {
      const m = await loadModel(f.url, f.format || formatOf(f.file || f.name));
      this.stage.set({ ...m, name: title(f), format: f.format || formatOf(f.file || f.name), bytes: f.bytes, key });
    } catch (e) {
      W.coreSay(e.message || 'Could not open this model.');
    }
    this.loading = null;
    this.invalidate();
  }

  /** From Files (or a scan): open the window, select it, put it on the stage. */
  openUrl(url, name, format, bytes) {
    const W = this.world;
    if (!W.panels.isOpen(this)) W.panels.open(this);
    const entry = { file: name, name: name.replace(/\.[^.]+$/, ''), url, format: format || formatOf(name), bytes };
    this.sel = { type: 'file', id: name, entry };
    this.show();
  }

  /** (older callers) */
  loadUrl(url, name) {
    this.openUrl(url, name);
  }

  async remove() {
    const f = this.selected();
    if (!f) return;
    try {
      await api('/api/space/model-delete', { file: f.file });
      if (this.onStage()) this.stage.hide();
      this.world.coreSay('Model moved to the Recycle Bin.');
    } catch (e) {
      this.world.coreSay(e.message);
    }
    this.confirm = false;
    this.sel = { type: 'sample', id: 'room' };
    await this.refresh();
  }

  click(id, data) {
    const W = this.world;
    if (id === 'sample') {
      this.sel = { type: 'sample', id: data };
      this.confirm = false;
      if (this._stage && this._stage.on) this.show();
    } else if (id === 'file') {
      this.sel = { type: 'file', id: data };
      this.confirm = false;
    } else if (id === 'stage') this.show();
    else if (id === 'away') this.stage.hide();
    else if (id === 'del') this.confirm = true;
    else if (id === 'keep') this.confirm = false;
    else if (id === 'delYes') return this.remove();
    else if (id === 'refresh') return this.refresh();
    else if (id === 'scan') W.scanner ? W.scanner.open() : W.coreSay('Scanning is not available here.');
    else if (id === 'pageL') this.page = Math.max(0, this.page - 1);
    else if (id === 'pageR') this.page++;
    this.invalidate();
  }

  update() {
    // the readout on the right follows the stage (scale, live room)
    const st = this._stage;
    const sig = st && st.item ? `${st.on}${st.item.key}${st.ratioLabel()}` : '';
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.invalidate();
    }
  }

  // ------------------------------------------------------------------ drawing

  draw(g, ui, W, H) {
    const n = this.files ? this.files.length : 0;
    const top = chrome(g, ui, W, H, { title: 'Models', sub: 'Look at 3D things up close: GLB, glTF, OBJ, STL, PLY' });
    button(g, ui, 'scan', W - 300, 26, 190, 56, 'Scan', { iconName: 'scan', small: true });
    button(g, ui, 'refresh', W - 100, 26, 70, 56, '', { iconName: 'refresh' });
    const lx = 40;
    const lw = 720;
    // ---- samples: the room first, then the drawn ones
    let y = top + 22;
    section(g, lx, y, lw, '', 'Samples');
    y += 18;
    const items = [ROOM, ...SAMPLES];
    const cols = 3;
    const gap = 12;
    const tw = (lw - gap * (cols - 1)) / cols;
    const th = 78;
    items.forEach((s, i) => {
      const x = lx + (i % cols) * (tw + gap);
      const ty = y + Math.floor(i / cols) * (th + gap);
      const on = this.sel.type === 'sample' && this.sel.id === s.id;
      cutPath(g, x, ty, tw, th, 7);
      g.fillStyle = on ? T.bg3 : T.bg2;
      g.fill();
      if (on) {
        g.strokeStyle = T.ink2;
        g.lineWidth = 1.5;
        g.stroke();
      }
      icon(g, s.id === 'room' ? 'room' : 'cube', x + 16, ty + (th - 26) / 2, 26, s.id === 'room' ? T.seal : T.ink2);
      text(g, s.name, x + 56, ty + 34, { size: 20, weight: 600, color: T.ink, max: tw - 66 });
      text(g, s.desc, x + 56, ty + 60, { size: 15, color: T.ink3, max: tw - 66 });
      ui.hit('sample', x, ty, tw, th, s.id);
    });
    y += 2 * (th + gap) + 34;
    // ---- your files
    section(g, lx, y, lw, '', `Your models · ${n}`);
    y += 18;
    const rowH = 66;
    const listBottom = H - 104;
    const per = Math.max(1, Math.floor((listBottom - y) / rowH));
    const pages = Math.max(1, Math.ceil(n / per));
    this.page = Math.min(this.page, pages - 1);
    if (!this.files) text(g, 'Loading…', lx, y + 40, { size: 20, color: T.ink3 });
    else if (!n) {
      text(g, 'No models yet', lx, y + 44, { size: 22, weight: 600, color: T.ink });
      paragraph(g, 'Put .glb, .gltf, .obj, .stl or .ply files in the PC’s models folder, open one from Files, or press Scan to capture something in front of you.', lx, y + 78, lw, { size: 18, color: T.ink3, maxLines: 3 });
    } else
      this.files.slice(this.page * per, this.page * per + per).forEach((f, i) => {
        const ry = y + i * rowH;
        const on = this.sel.type === 'file' && this.sel.id === f.file;
        if (on) {
          g.fillStyle = T.bg3;
          g.fillRect(lx, ry + 2, lw, rowH - 4);
          g.fillStyle = T.seal;
          g.fillRect(lx, ry + 2, 4, rowH - 4);
        }
        // the format, as a small mono badge
        g.strokeStyle = T.line2;
        g.lineWidth = 1.2;
        g.strokeRect(lx + 16, ry + 17, 62, 32);
        text(g, f.scan ? 'SCAN' : f.format.toUpperCase(), lx + 47, ry + 34, { size: 13, family: 'mono', weight: 600, color: f.scan ? T.seal : T.ink2, align: 'center', base: 'middle' });
        text(g, title(f), lx + 96, ry + 41, { size: 20, weight: 600, color: T.ink, max: lw - 330 });
        text(g, `${bytesLabel(f.bytes)}   ${when(f.time)}`, lx + lw - 16, ry + 41, { size: 15, family: 'mono', color: T.ink3, align: 'right' });
        hairline(g, lx, ry + rowH - 1, lw);
        ui.hit('file', lx, ry, lw, rowH, f.file);
      });
    if (pages > 1) {
      text(g, `Page ${this.page + 1} of ${pages}`, lx, H - 52, { size: 17, family: 'mono', color: T.ink3 });
      button(g, ui, 'pageL', lx + lw - 172, H - 92, 80, 60, '', { iconName: 'back', disabled: this.page === 0 });
      button(g, ui, 'pageR', lx + lw - 80, H - 92, 80, 60, '', { iconName: 'next', disabled: this.page >= pages - 1 });
    }
    this.drawDetail(g, ui, W, H, top);
  }

  drawDetail(g, ui, W, H, top) {
    const x = 800;
    const w = W - x - 40;
    const y0 = top + 4;
    cutPath(g, x, y0, w, H - y0 - 40, 10);
    g.fillStyle = T.bg2;
    g.fill();
    const s = this.selected();
    const px = x + 28;
    const pw = w - 56;
    if (!s) return text(g, 'Choose a model', px, y0 + 60, { size: 22, color: T.ink3 });
    const isFile = this.sel.type === 'file';
    const st = this._stage;
    const live = this.onStage() ? st.item : null;
    mono(g, isFile ? (s.scan ? 'scan' : 'your model') : 'sample', px, y0 + 46);
    text(g, isFile ? title(s) : s.name, px, y0 + 90, { size: 30, weight: 600, color: T.ink, max: pw });
    text(g, isFile ? `${(s.format || '').toUpperCase()} · ${bytesLabel(s.bytes || 0)}${s.time ? ` · ${when(s.time)}` : ''}` : s.desc, px, y0 + 124, { size: 18, color: T.ink3, max: pw });
    // what it is, measured once it is on the stage
    let y = y0 + 166;
    const row = (k, v) => {
      text(g, k, px, y + 30, { size: 18, color: T.ink2 });
      text(g, v, px + pw, y + 30, { size: 18, family: 'mono', color: v === '—' ? T.ink3 : T.ink, align: 'right', max: pw - 150 });
      hairline(g, px, y + 48, pw);
      y += 50;
    };
    row('Real size', live ? sizeLabel(live.real) : '—');
    if (live && live.note) row('Contains', typeof live.note === 'function' ? live.note() : live.note);
    else row(live && live.points ? 'Points' : 'Triangles', live ? countLabel(live.points || live.tris) : '—');
    row('Shown at', live ? st.ratioLabel() : '—');
    if (!live) text(g, this.loading ? `Opening ${this.loading}…` : 'Measured when it is on the stage.', px, y + 30, { size: 16, color: T.ink3, max: pw });
    // actions
    let by = y + 64;
    if (live) {
      button(g, ui, 'stage', px, by, pw / 2 - 6, 64, 'On the stage', { iconName: 'cube', small: true, active: true });
      button(g, ui, 'away', px + pw / 2 + 6, by, pw / 2 - 6, 64, 'Put away', { iconName: 'close', small: true });
    } else button(g, ui, 'stage', px, by, pw, 64, this.loading ? 'Opening…' : 'Put on the stage', { iconName: 'cube', small: true, primary: true, disabled: !!this.loading });
    by += 80;
    if (isFile && s.url && s.url.startsWith('/api/space/model/')) {
      if (this.confirm) {
        text(g, 'Delete this model?', px, by + 4, { size: 18, weight: 600, color: T.ink });
        button(g, ui, 'keep', px, by + 18, pw / 2 - 6, 60, 'Keep', { small: true });
        button(g, ui, 'delYes', px + pw / 2 + 6, by + 18, pw / 2 - 6, 60, 'Delete', { small: true, primary: true });
      } else button(g, ui, 'del', px, by, pw, 60, 'Delete', { iconName: 'trash', small: true });
    }
    // how to handle it (always the same, so it is learnt once)
    const hy = H - 40 - 150;
    hairline(g, px, hy, pw);
    mono(g, 'on the stage', px, hy + 34);
    paragraph(g, 'Pull the rim to turn it. Pinch the model to lift it close and turn your hand; let go and it goes back. Two hands make it bigger or smaller. 1:1 shows its real size.', px, hy + 62, pw, { size: 16, lh: 1.4, color: T.ink3, maxLines: 4 });
  }
}
