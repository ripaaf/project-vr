// FILES 書庫 — an explorer for the headset's storage and this PC, made for hands.
//   - tap a folder to open it, tap a file to select it, tap it again to open it
//   - drag the list to scroll; ← → ↑ like Windows; the bar shows where you are, tap a part to go there
//   - QUEST ⇄ PC switch, places on the left, list or grid (pictures get thumbnails), search
//   - copy / cut / paste (also between the Quest and the PC), send to the other side, rename,
//     new folder, delete (with a question first; PC files go to the Recycle Bin)
//   - opens pictures, text and code, video and music, and 3D models (.glb) right in the space
import { App } from '../panels.js';
import { T, chrome, text, mono, button, cutPath, segmented } from '../theme.js';
import { api } from '../api.js';
import { ImageView, TextView, MediaView } from './viewer.js';

const KINDS = [
  [/\.(jpe?g|png|gif|webp|bmp)$/i, 'image', '▣'],
  [/\.(mp4|webm|mov|m4v|mkv)$/i, 'video', '▶'],
  [/\.(mp3|wav|ogg|m4a|flac)$/i, 'audio', '♪'],
  [/\.(txt|md|json|log|ini|cfg|conf|csv|xml|ya?ml|js|mjs|ts|py|ino|c|cc|cpp|h|hpp|java|kt|sh|bat|ps1|html|css|toml|gradle|properties)$/i, 'text', '≡'],
  [/\.(glb|gltf|obj|stl|ply)$/i, 'model', '◇'],
  [/\.apk$/i, 'apk', '⬡'],
  [/\.(zip|rar|7z|tar|gz)$/i, 'archive', '▤'],
];
function kindOf(e) {
  if (e.dir) return { kind: 'dir', glyph: '▸' };
  for (const [re, kind, glyph] of KINDS) if (re.test(e.name)) return { kind, glyph };
  return { kind: 'file', glyph: '·' };
}
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
const fmtDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: '2-digit' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const enc = encodeURIComponent;

export class Files extends App {
  constructor() {
    super('files', 'Files', '書庫', [1.3, 0.84]);
    this.src = 'quest';
    this.path = { quest: '/sdcard', pc: null };
    this.list = null;
    this.err = null;
    this.loading = false;
    this.back = [];
    this.ahead = [];
    this.view = 'list';
    this.sort = 'name';
    this.sel = new Set();
    this.multi = false;
    this.scroll = 0;
    this.roots = null;
    this.clip = null; // { src, paths, move, names }
    this.dialog = null; // { kind, value, title, ... }
    this.thumbs = new Map();
    this.loadingThumbs = 0;
    this.results = null; // search results replace the folder list
    this.busy = null;
  }

  opened() {
    this.world.keyTarget = this;
    if (!this.roots) this.loadRoots();
    else this.go(this.cur(), true);
  }

  cur() {
    return this.path[this.src];
  }

  say(s) {
    this.world.coreSay(s);
  }

  async loadRoots() {
    try {
      this.roots = await api('/api/files/roots');
      if (!this.path.pc && this.roots.pc.length) this.path.pc = this.roots.pc[0].path;
      if (!this.roots.questOnline && this.src === 'quest') this.src = 'pc';
    } catch (e) {
      this.err = e.message;
    }
    await this.go(this.cur(), true);
  }

  async go(p, noHistory, src = this.src) {
    this.loading = true;
    this.invalidate();
    try {
      const list = await api(`/api/files/list?src=${src}&path=${enc(p)}`);
      if (!noHistory && this.list) {
        this.back.push({ src: this.src, path: this.list.path });
        this.ahead = [];
      }
      this.src = src;
      this.list = list;
      this.path[src] = list.path;
      this.err = null;
      this.sel.clear();
      this.scroll = 0;
      this.results = null;
    } catch (e) {
      this.err = e.message;
      this.world.sound.error(this.panel && this.panel.group.position);
    }
    this.loading = false;
    this.invalidate();
  }

  refresh() {
    return this.go(this.cur(), true);
  }

  join(dir, name) {
    if (this.src === 'quest') return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
    return dir.endsWith('\\') ? dir + name : `${dir}\\${name}`;
  }

  full(e) {
    return e.full || this.join(this.list.path, e.name);
  }

  raw(full, src = this.src) {
    return `/api/files/raw?src=${src}&path=${enc(full)}`;
  }

  entries() {
    const src = this.results || (this.list ? this.list.entries : []);
    const visible = src.filter((e) => !e.name.startsWith('.'));
    const by = {
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      date: (a, b) => b.mtime - a.mtime,
      size: (a, b) => b.size - a.size,
    }[this.sort];
    return visible.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : by(a, b)));
  }

  selected() {
    return this.entries().filter((e) => this.sel.has(this.full(e)));
  }

  /** Open a file in the right viewer (or a folder). */
  open(e) {
    const W = this.world;
    const full = this.full(e);
    if (e.dir) return this.go(full);
    const { kind } = kindOf(e);
    const url = this.raw(full);
    const app = (id, Cls) => {
      if (!W.apps[id]) {
        W.apps[id] = new Cls();
        W.apps[id].world = W;
      }
      return W.apps[id];
    };
    if (kind === 'image') app('img', ImageView).show(url, e.name);
    else if (kind === 'text') app('txt', TextView).show(url, e.name);
    else if (kind === 'video' || kind === 'audio') app('media', MediaView).show(url, e.name, kind);
    else if (kind === 'model') {
      W.apps.models.openUrl(url, e.name, null, e.size);
      this.say(`${e.name} is on the stage in front of you.`);
    } else this.say('There is no viewer for this kind of file yet.');
  }

  tap(e) {
    const full = this.full(e);
    if (this.multi) {
      if (this.sel.has(full)) this.sel.delete(full);
      else this.sel.add(full);
    } else if (e.dir) this.open(e);
    else if (this.sel.has(full)) this.open(e);
    else {
      this.sel.clear();
      this.sel.add(full);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ actions

  async run(label, fn, done) {
    this.busy = label;
    this.invalidate();
    try {
      await fn();
      if (done) this.say(done);
    } catch (e) {
      this.say(e.message);
      this.world.sound.error(this.panel && this.panel.group.position);
    }
    this.busy = null;
    await this.refresh();
  }

  setClip(move) {
    const items = this.selected();
    if (!items.length) return;
    this.clip = { src: this.src, paths: items.map((e) => this.full(e)), move, names: items.map((e) => e.name) };
    this.say(`${items.length} ${items.length === 1 ? 'item' : 'items'} ${move ? 'cut' : 'copied'}. Open a folder and press paste.`);
  }

  paste() {
    const c = this.clip;
    if (!c) return;
    const dest = { src: this.src, dir: this.cur() };
    this.clip = c.move ? null : c;
    this.run(c.move ? 'moving…' : 'copying…', () => api('/api/files/copy', { src: c.src, paths: c.paths, dest, move: c.move }), `${c.paths.length} ${c.paths.length === 1 ? 'item' : 'items'} ${c.move ? 'moved' : 'copied'}.`);
  }

  sendOver() {
    const items = this.selected();
    if (!items.length || !this.roots) return;
    const to = this.src === 'quest' ? 'pc' : 'quest';
    const dir = to === 'pc' ? (this.roots.pc.find((r) => r.name === 'Downloads') || this.roots.pc[0]).path : '/sdcard/Download';
    this.run(`sending to the ${to === 'pc' ? 'PC' : 'Quest'}…`, () => api('/api/files/copy', { src: this.src, paths: items.map((e) => this.full(e)), dest: { src: to, dir } }), `Sent to ${to === 'pc' ? 'the PC (Downloads)' : 'the Quest (Download)'}.`);
  }

  ask(kind, value = '') {
    const titles = { rename: 'New name', mkdir: 'New folder', search: `Search in ${this.list ? this.list.path : ''}` };
    this.dialog = { kind, value, title: titles[kind] };
    this.world.keyboard.showFor(this);
    this.invalidate();
  }

  confirmDialog() {
    const d = this.dialog;
    if (!d) return;
    this.dialog = null;
    this.world.keyboard.hide();
    const v = d.value.trim();
    if (d.kind === 'delete') {
      const paths = this.selected().map((e) => this.full(e));
      return this.run('deleting…', () => api('/api/files/delete', { src: this.src, paths }), this.src === 'pc' ? 'Moved to the Recycle Bin.' : 'Deleted.');
    }
    if (!v) return this.invalidate();
    if (d.kind === 'rename') {
      const e = this.selected()[0];
      if (e) this.run('renaming…', () => api('/api/files/rename', { src: this.src, path: this.full(e), name: v }));
    } else if (d.kind === 'mkdir') this.run('creating…', () => api('/api/files/mkdir', { src: this.src, dir: this.cur(), name: v }));
    else if (d.kind === 'search') {
      this.busy = 'searching…';
      this.invalidate();
      api(`/api/files/search?src=${this.src}&path=${enc(this.cur())}&q=${enc(v)}`)
        .then((r) => {
          this.results = r.entries;
          this.results.q = v;
          this.scroll = 0;
          this.sel.clear();
        })
        .catch((e) => this.say(e.message))
        .finally(() => {
          this.busy = null;
          this.invalidate();
        });
    }
    this.invalidate();
  }

  key(k) {
    const d = this.dialog;
    if (!d || d.kind === 'delete') return;
    if (k === 'Enter') return this.confirmDialog();
    if (k === 'Backspace') d.value = d.value.slice(0, -1);
    else if (k.length === 1) d.value += k;
    this.invalidate();
  }

  click(id, data) {
    if (this.dialog) {
      if (id === 'dlg-ok') this.confirmDialog();
      else if (id === 'dlg-cancel') {
        this.dialog = null;
        this.world.keyboard.hide();
      } else if (id === 'dlg-keys') this.world.keyboard.showFor(this);
      return this.invalidate();
    }
    const sel = this.selected();
    if (id === 'row') this.tap(data);
    else if (id === 'back' && this.back.length) {
      const h = this.back.pop();
      this.ahead.push({ src: this.src, path: this.cur() });
      this.go(h.path, true, h.src);
    } else if (id === 'fwd' && this.ahead.length) {
      const h = this.ahead.pop();
      this.back.push({ src: this.src, path: this.cur() });
      this.go(h.path, true, h.src);
    } else if (id === 'up' && this.list && this.list.parent) this.go(this.list.parent);
    else if (id === 'crumb') this.go(data);
    else if (id === 'place') this.go(data.path, false, data.src);
    else if (id.startsWith('src:')) {
      if (data !== this.src) this.go(this.path[data] || (data === 'quest' ? '/sdcard' : this.roots.pc[0].path), false, data);
    } else if (id === 'view') this.view = this.view === 'list' ? 'grid' : 'list';
    else if (id === 'sort') this.sort = { name: 'date', date: 'size', size: 'name' }[this.sort];
    else if (id === 'search') this.results ? ((this.results = null), this.invalidate()) : this.ask('search');
    else if (id === 'mkdir') this.ask('mkdir');
    else if (id === 'refresh') this.refresh();
    else if (id === 'multi') {
      this.multi = !this.multi;
      if (!this.multi) this.sel.clear();
    } else if (id === 'open' && sel[0]) this.open(sel[0]);
    else if (id === 'copy') this.setClip(false);
    else if (id === 'cut') this.setClip(true);
    else if (id === 'paste') this.paste();
    else if (id === 'send') this.sendOver();
    else if (id === 'rename' && sel.length === 1) this.ask('rename', sel[0].name);
    else if (id === 'delete' && sel.length) this.dialog = { kind: 'delete', value: '', title: `Delete ${sel.length} ${sel.length === 1 ? 'item' : 'items'}?` };
    else if (id === 'all') {
      const all = this.entries();
      if (this.sel.size === all.length) this.sel.clear();
      else all.forEach((e) => this.sel.add(this.full(e)));
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ scrolling (drag the list)

  wheel(dir) {
    this.scrollBy(dir * 120);
  }

  scrollBy(px) {
    this.scroll = Math.max(0, Math.min(this.maxScroll || 0, this.scroll + px));
    this.invalidate();
  }

  pointer(kind, x, y) {
    const a = this.area;
    if (kind === 'down') this.drag = a && x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h ? { y, s: this.scroll, moved: false } : null;
    else if (kind === 'move' && this.drag) {
      if (Math.abs(y - this.drag.y) > 16) this.drag.moved = true;
      if (this.drag.moved) {
        this.scroll = Math.max(0, Math.min(this.maxScroll || 0, this.drag.s + (this.drag.y - y)));
        this.invalidate();
        return true;
      }
    } else if (kind === 'up' && this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      return moved;
    }
    return false;
  }

  thumb(full) {
    let t = this.thumbs.get(full);
    if (t === undefined && this.loadingThumbs < 6) {
      const im = new Image();
      this.loadingThumbs++;
      this.thumbs.set(full, 'loading');
      im.onload = () => {
        this.thumbs.set(full, im);
        this.loadingThumbs--;
        this.invalidate();
      };
      im.onerror = () => {
        this.thumbs.set(full, 'none');
        this.loadingThumbs--;
      };
      im.src = `/api/files/thumb?src=${this.src}&path=${enc(full)}`;
      t = 'loading';
      if (this.thumbs.size > 400) this.thumbs.delete(this.thumbs.keys().next().value);
    }
    return t instanceof Image ? t : null;
  }

  // ------------------------------------------------------------------ draw

  draw(g, ui, W, H) {
    const top = chrome(g, ui, W, H, { title: 'Files', kanji: '書庫', sub: this.src === 'quest' ? 'quest storage' : 'this pc' });
    const S = this.selected();
    // ---- toolbar
    const ty = top + 4;
    const b = 64;
    button(g, ui, 'back', 40, ty, b, b, '', { glyph: '←', disabled: !this.back.length });
    button(g, ui, 'fwd', 40 + b + 8, ty, b, b, '', { glyph: '→', disabled: !this.ahead.length });
    button(g, ui, 'up', 40 + (b + 8) * 2, ty, b, b, '', { glyph: '↑', disabled: !(this.list && this.list.parent) });
    const right = W - 40;
    const tools = [['refresh', '↻'], ['mkdir', '+'], ['search', this.results ? '✕' : '⌕'], ['view', this.view === 'list' ? '▦' : '≡']];
    tools.forEach(([id, glyph], i) => button(g, ui, id, right - (i + 1) * (b + 8) + 8, ty, b, b, '', { glyph }));
    const segX = right - tools.length * (b + 8) - 236;
    // on the Quest alone there is only the Quest's storage
    if (this.roots && !this.roots.pc.length) segmented(g, ui, 'src', segX, ty, 220, b, [{ id: 'quest', label: 'quest' }], 'quest');
    else segmented(g, ui, 'src', segX, ty, 220, b, [{ id: 'quest', label: 'quest' }, { id: 'pc', label: 'pc' }], this.src);
    // breadcrumb
    const bx = 40 + (b + 8) * 3 + 6;
    const bw = segX - bx - 16;
    cutPath(g, bx, ty, bw, b, 12);
    g.fillStyle = T.bg2;
    g.fill();
    if (this.results) text(g, `results for "${this.results.q || ''}" · ${this.results.length}`, bx + 20, ty + 41, { size: 20, family: 'mono', color: T.gold, max: bw - 40 });
    else if (this.list) {
      const p = this.list.path;
      const sep = this.src === 'quest' ? '/' : '\\';
      const parts = p.split(sep).filter(Boolean);
      const crumbs = parts.map((name, i) => ({ name, path: this.src === 'quest' ? `/${parts.slice(0, i + 1).join('/')}` : parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '') }));
      g.font = `600 20px Roboto, sans-serif`;
      let x = bx + bw - 16;
      const shown = [];
      for (let i = crumbs.length - 1; i >= 0; i--) {
        const w = g.measureText(crumbs[i].name).width + 34;
        if (x - w < bx + 16) break;
        x -= w;
        shown.unshift({ ...crumbs[i], x, w });
      }
      if (shown.length < crumbs.length) mono(g, '…', bx + 12, ty + 40, { size: 18, color: T.ink3 });
      shown.forEach((c, i) => {
        text(g, c.name, c.x + 10, ty + 40, { size: 20, family: 'ui', weight: 600, color: i === shown.length - 1 ? T.ink : T.ink2 });
        if (i < shown.length - 1) text(g, '›', c.x + c.w - 8, ty + 40, { size: 20, color: T.ink3, align: 'right' });
        ui.hit('crumb', c.x, ty + 6, c.w, b - 12, c.path);
      });
    }

    // ---- places
    const sy = ty + b + 22;
    const sw = 250;
    mono(g, this.src === 'quest' ? 'on the quest' : 'on this pc', 40, sy + 16, { size: 15, color: T.ink3 });
    const places = (this.roots && this.roots[this.src]) || [];
    const icon = { home: '⌂', desk: '▭', down: '↓', doc: '≡', pic: '▣', vid: '▶', music: '♪', drive: '◫' };
    places.slice(0, 10).forEach((pl, i) => {
      const y = sy + 30 + i * 54;
      const on = this.list && this.list.path === pl.path;
      cutPath(g, 40, y, sw, 48, 8);
      g.fillStyle = on ? T.bg3 : 'transparent';
      g.fill();
      text(g, icon[pl.icon] || '·', 62, y + 32, { size: 20, color: on ? T.seal : T.ink3, align: 'center' });
      text(g, pl.name, 86, y + 32, { size: 20, family: 'ui', weight: on ? 700 : 500, color: on ? T.ink : T.ink2, max: sw - 60 });
      ui.hit('place', 40, y, sw, 48, { path: pl.path, src: this.src });
    });
    if (this.src === 'quest' && this.roots && !this.roots.questOnline) text(g, 'headset not connected', 40, sy + 30, { size: 18, color: T.seal });

    // ---- the list / grid
    const mx = 40 + sw + 24;
    const my = sy;
    const mw = W - mx - 40;
    const mh = H - my - 112;
    this.area = { x: mx, y: my, w: mw, h: mh };
    const items = this.entries();
    g.save();
    cutPath(g, mx, my, mw, mh, 14);
    g.fillStyle = T.bg2;
    g.fill();
    g.clip();
    if (this.loading && !this.list) text(g, 'opening…', mx + mw / 2, my + mh / 2, { size: 24, color: T.ink2, align: 'center' });
    else if (this.err && !items.length) text(g, this.err, mx + mw / 2, my + mh / 2, { size: 22, color: T.seal, align: 'center', max: mw - 60 });
    else if (!items.length) text(g, this.results ? 'nothing found' : 'this folder is empty', mx + mw / 2, my + mh / 2, { size: 22, color: T.ink3, align: 'center' });
    const isSel = (e) => this.sel.has(this.full(e));
    if (this.view === 'list') {
      const rh = 60;
      mono(g, `name${this.sort === 'name' ? ' ↓' : ''}`, mx + 76, my + 26, { size: 14, color: T.ink3 });
      mono(g, `modified${this.sort === 'date' ? ' ↓' : ''}`, mx + mw - 330, my + 26, { size: 14, color: T.ink3 });
      mono(g, `size${this.sort === 'size' ? ' ↓' : ''}`, mx + mw - 24, my + 26, { size: 14, color: T.ink3, align: 'right' });
      ui.hit('sort', mx, my, mw, 38);
      const y0 = my + 40;
      this.maxScroll = Math.max(0, items.length * rh - (mh - 40));
      const first = Math.floor(this.scroll / rh);
      for (let i = first; i < items.length; i++) {
        const y = y0 + i * rh - this.scroll;
        if (y > my + mh) break;
        const e = items[i];
        const k = kindOf(e);
        const on = isSel(e);
        if (on) {
          cutPath(g, mx + 8, y + 2, mw - 16, rh - 4, 8);
          g.fillStyle = T.bg3;
          g.fill();
          g.fillStyle = T.seal;
          g.fillRect(mx + 8, y + 10, 4, rh - 20);
        }
        const th = k.kind === 'image' ? this.thumb(this.full(e)) : null;
        if (th) {
          const s = Math.min(44 / th.width, 44 / th.height);
          g.drawImage(th, mx + 48 - (th.width * s) / 2, y + rh / 2 - (th.height * s) / 2, th.width * s, th.height * s);
        } else text(g, k.glyph, mx + 48, y + rh / 2 + 8, { size: k.kind === 'dir' ? 24 : 22, color: k.kind === 'dir' ? T.gold : T.ink2, align: 'center' });
        text(g, e.name, mx + 76, y + (e.full ? 28 : 38), { size: 22, family: 'ui', weight: e.dir ? 600 : 400, color: T.ink, max: mw - 460 });
        if (e.full) text(g, e.full, mx + 76, y + 50, { size: 14, family: 'mono', color: T.ink3, max: mw - 120 });
        text(g, fmtDate(e.mtime), mx + mw - 330, y + 38, { size: 17, family: 'mono', color: T.ink3 });
        if (!e.dir && e.size) text(g, fmtSize(e.size), mx + mw - 24, y + 38, { size: 17, family: 'mono', color: T.ink2, align: 'right' });
        const vy = Math.max(y, y0);
        const vh = Math.min(y + rh, my + mh) - vy;
        if (vh > 20) ui.hit('row', mx, vy, mw, vh, e);
      }
    } else {
      const tw = 176;
      const thh = 190;
      const cols = Math.max(1, Math.floor((mw - 16) / (tw + 12)));
      const gx = mx + (mw - cols * (tw + 12) + 12) / 2;
      this.maxScroll = Math.max(0, Math.ceil(items.length / cols) * (thh + 12) - mh + 20);
      items.forEach((e, i) => {
        const x = gx + (i % cols) * (tw + 12);
        const y = my + 12 + Math.floor(i / cols) * (thh + 12) - this.scroll;
        if (y > my + mh || y + thh < my) return;
        const k = kindOf(e);
        const on = isSel(e);
        cutPath(g, x, y, tw, thh, 10);
        g.fillStyle = on ? T.bg3 : 'rgba(255,255,255,0.02)';
        g.fill();
        if (on) {
          g.strokeStyle = T.seal;
          g.lineWidth = 3;
          g.stroke();
        }
        const th = k.kind === 'image' ? this.thumb(this.full(e)) : null;
        if (th) {
          const s = Math.min((tw - 20) / th.width, 120 / th.height);
          g.drawImage(th, x + tw / 2 - (th.width * s) / 2, y + 70 - (th.height * s) / 2, th.width * s, th.height * s);
        } else text(g, k.glyph, x + tw / 2, y + 92, { size: 60, color: k.kind === 'dir' ? T.gold : T.ink3, align: 'center' });
        text(g, e.name, x + tw / 2, y + thh - 22, { size: 17, family: 'ui', weight: e.dir ? 600 : 400, color: T.ink, align: 'center', max: tw - 16 });
        const vy = Math.max(y, my);
        const vh = Math.min(y + thh, my + mh) - vy;
        if (vh > 30) ui.hit('row', x, vy, tw, vh, e);
      });
    }
    g.restore();
    // scroll indicator
    if (this.maxScroll > 0) {
      const frac = this.scroll / this.maxScroll;
      const bh = Math.max(40, (mh * mh) / (mh + this.maxScroll));
      g.fillStyle = T.line2;
      g.fillRect(mx + mw - 6, my + (mh - bh) * frac, 4, bh);
    }

    // ---- action bar
    const ay = H - 96;
    const n = items.length;
    const status = this.busy || (S.length ? `${S.length} of ${n} selected` : `${n} ${n === 1 ? 'item' : 'items'}`) + (this.clip ? ` · ${this.clip.paths.length} on the clipboard` : '');
    text(g, status, 40, ay + 42, { size: 18, family: 'mono', color: this.busy ? T.gold : T.ink2, max: 340 });
    const acts = [
      ['multi', this.multi ? 'done' : 'select', { active: this.multi }],
      ['all', 'all', { disabled: !this.multi }],
      ['open', 'open', { disabled: S.length !== 1 }],
      ['copy', 'copy', { disabled: !S.length }],
      ['cut', 'cut', { disabled: !S.length }],
      ['paste', 'paste', { disabled: !this.clip || !!this.results, primary: !!this.clip }],
      ['send', this.src === 'quest' ? '→ pc' : '→ quest', { disabled: !S.length }],
      ['rename', 'rename', { disabled: S.length !== 1 }],
      ['delete', 'delete', { disabled: !S.length }],
    ];
    const aw = 104;
    acts.forEach(([id, label, o], i) => button(g, ui, id, W - 40 - (acts.length - i) * (aw + 6) + 6, ay, aw, 70, label, { small: true, ...o }));

    // ---- dialog
    const d = this.dialog;
    if (d) {
      ui.hits.length = 0; // only the dialog is live
      g.fillStyle = 'rgba(8,8,9,0.72)';
      g.fillRect(0, top, W, H - top);
      const dw = 760;
      const dh = d.kind === 'delete' ? 250 : 290;
      const dx = (W - dw) / 2;
      const dy = (H - dh) / 2 + 20;
      cutPath(g, dx, dy, dw, dh, 20);
      g.fillStyle = T.bgSolid;
      g.fill();
      g.strokeStyle = T.line2;
      g.lineWidth = 2;
      g.stroke();
      text(g, d.title, dx + 40, dy + 62, { size: 30, family: 'display', weight: 700, color: T.ink, max: dw - 80 });
      if (d.kind === 'delete') text(g, this.src === 'pc' ? 'They go to the Recycle Bin, so you can bring them back.' : 'This cannot be undone on the headset.', dx + 40, dy + 110, { size: 21, color: T.ink2, max: dw - 80 });
      else {
        cutPath(g, dx + 40, dy + 96, dw - 200, 72, 12);
        g.fillStyle = T.bg2;
        g.fill();
        text(g, d.value + '▏', dx + 60, dy + 144, { size: 26, family: 'mono', color: T.ink, max: dw - 240 });
        button(g, ui, 'dlg-keys', dx + dw - 148, dy + 96, 108, 72, '', { glyph: '⌨' });
      }
      button(g, ui, 'dlg-cancel', dx + 40, dy + dh - 100, 200, 70, 'cancel', { small: true });
      button(g, ui, 'dlg-ok', dx + dw - 240, dy + dh - 100, 200, 70, d.kind === 'delete' ? 'delete' : d.kind === 'search' ? 'search' : 'ok', { primary: true, small: true });
    }
  }
}
