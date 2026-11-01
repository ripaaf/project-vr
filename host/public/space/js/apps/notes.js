// NOTES — capture anything, in 2D and in 3D. Saved on the PC as you go.
//   Type     the keyboard writes into the page
//   Pencil   write or sketch on the page with a fingertip (or pinch and drag from afar)
//   3D       pinch in the air and move: an ink line stays in space, around this note's window
//   Photo    put one of your photos on the page · Snap: take one now, it lands here
//   Text     a paper card in the space: drag it anywhere, pull its corner to resize, tap to edit
//   Undo     takes back the last line, card or photo
// Your 3D lines belong to the note: they appear around its window whenever you open it.
import * as THREE from 'three';
import { App } from '../panels.js';
import { T, chrome, text, mono, button, cutPath, hairline, paragraph, segmented, icon } from '../theme.js';
import { Notes3D, PALETTE, inkOf } from './notes3d.js';

const hslHex = (h, sat, l) => {
  const c = new THREE.Color().setHSL(h / 360, sat / 100, l / 100, THREE.SRGBColorSpace);
  return `#${c.getHexString()}`;
};
import { api } from '../api.js';
import { ImageView } from './viewer.js';

const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const when = (ms) => {
  const d = new Date(ms);
  const today = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === today.toDateString() ? `Today ${time}` : `${d.toLocaleDateString('en', { day: 'numeric', month: 'short' })} ${time}`;
};
const thumbs = new Map();
const measureTitle = (g, t) => {
  g.font = '600 30px Roboto, "Noto Sans", sans-serif';
  return g.measureText(t).width;
};

export class Notes extends App {
  constructor() {
    super('notes', 'Notes', '', [1.32, 0.86]);
    this.list = null;
    this.note = null;
    this.tool = 'type';
    this.picker = null; // photos to choose from
    this.editing = null; // 'title' | 'text'
    this.stroke2d = null;
    this.stroke3d = null;
    this.n3d = null; // the 3D side (lines, cards, pencil), attached to the window
    this.saveTimer = null;
    this.confirmDelete = false;
  }

  async opened() {
    this.world.keyTarget = this;
    if (!this.n3d) {
      this.n3d = new Notes3D(this.world, this);
      this.panel.group.add(this.n3d.group);
      this.world.on('pinch', (e) => this.onPinch(e));
      this.world.on('photoSaved', (r) => {
        if (this.waitingSnap) {
          this.waitingSnap = false;
          this.attachPhoto(r.name);
        }
      });
    }
    await this.loadList();
    if (this.newOnOpen) {
      this.newOnOpen = false;
      this.create();
    } else if (!this.note) {
      if (this.list && this.list.length) await this.load(this.list[0].id);
      else this.create();
    }
  }

  closed() {
    // back to Type for next time, without calling the keyboard up as the note goes away
    this.tool = 'type';
    this.editing = null;
    if (this.world.drawMode === this) this.world.drawMode = null;
    if (this.n3d) this.n3d.endEdit();
    this.flush();
  }

  async loadList() {
    try {
      this.list = (await api('/api/space/notes')).notes;
    } catch {
      this.list = [];
    }
    this.invalidate();
  }

  async load(id) {
    this.flush();
    try {
      this.note = await api(`/api/space/note/${id}`);
    } catch (e) {
      this.world.coreSay(e.message);
      return;
    }
    this.note.strokes = this.note.strokes || [];
    this.note.ink3d = this.note.ink3d || [];
    this.note.photos = this.note.photos || [];
    this.history = [];
    this.confirmDelete = false;
    this.rebuildInk();
    this.invalidate();
  }

  create() {
    this.flush();
    this.note = { id: newId(), title: 'Untitled', text: '', strokes: [], ink3d: [], photos: [], created: Date.now(), updated: Date.now() };
    this.history = [];
    this.rebuildInk();
    // not saved until you write, sketch or attach something (no empty notes piling up)
    this.setTool('type');
    this.editing = 'title';
    this.note.title = '';
    this.world.keyboard.showFor(this);
  }

  /** Save soon (typing, drawing) or now. */
  save(now) {
    clearTimeout(this.saveTimer);
    const run = () => {
      this.saveTimer = null;
      const n = this.note;
      if (!n) return;
      // an untitled note with nothing in it is not worth keeping (and goes if it was kept before)
      const empty = !n.title && !(n.text || '').trim() && !(n.strokes || []).length && !(n.ink3d || []).length && !(n.cards || []).length && !(n.photos || []).length;
      if (empty) {
        if ((this.list || []).some((x) => x.id === n.id)) api(`/api/space/note/${n.id}`, undefined, { method: 'DELETE' }).then(() => this.loadList(), () => {});
        return;
      }
      api(`/api/space/note/${n.id}`, { ...n, title: n.title || 'Untitled' })
        .then((r) => {
          n.updated = r.updated;
          this.loadList();
          this.world.emit('noteSaved', n.id);
        })
        .catch(() => {});
    };
    if (now) run();
    else this.saveTimer = setTimeout(run, 800);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.save(true);
    }
  }

  async remove() {
    const n = this.note;
    if (!n) return;
    this.confirmDelete = false;
    try {
      await api(`/api/space/note/${n.id}`, undefined, { method: 'DELETE' });
      this.world.coreSay('Note moved to the Recycle Bin.');
    } catch (e) {
      this.world.coreSay(e.message);
    }
    this.note = null;
    await this.loadList();
    if (this.list.length) await this.load(this.list[0].id);
    else this.create();
  }

  attachPhoto(name) {
    if (!this.note) this.create();
    if (!this.note.photos.includes(name)) this.note.photos.push(name);
    this.history.push('photo');
    this.picker = null;
    this.save();
    this.invalidate();
  }

  setTool(id) {
    this.tool = id;
    this.world.drawMode = id === 'draw3d' ? this : null;
    if (id === 'type') {
      this.editing = 'text';
      this.world.keyboard.showFor(this);
    } else this.editing = null;
    if (id === 'draw3d') this.world.coreSay('Pinch in the air and move to draw. Tap 3D again to stop.');
    this.invalidate();
  }

  // ------------------------------------------------------------------ typing

  key(k) {
    const n = this.note;
    if (!n) return;
    if (this.n3d && this.n3d.typeInto(k)) return; // a card is being edited
    const field = this.editing === 'title' ? 'title' : 'text';
    if (k === 'Enter') {
      if (field === 'title') {
        this.editing = 'text';
        this.tool = 'type';
      } else n.text += '\n';
    } else if (k === 'Backspace') n[field] = n[field].slice(0, -1);
    else if (k.length === 1) n[field] += k;
    this.save();
    this.invalidate();
  }

  // ------------------------------------------------------------------ pencil (2D, on the page)

  pointer(kind, x, y) {
    // the colour bar (3D): press and slide; the colour follows, and where you let go is kept
    const hr = this.hueRect;
    if (hr && this.tool === 'draw3d') {
      const on = x >= hr.x - 6 && x <= hr.x + hr.w + 6 && y >= hr.y - 4 && y <= hr.y + hr.h + 4;
      if ((kind === 'down' && on) || (kind === 'move' && this.hueDrag)) {
        this.hueDrag = true;
        const f = Math.max(0, Math.min(1, (x - hr.x) / hr.w));
        const deep = y > hr.y + hr.h / 2;
        const c = hslHex(f * 360, deep ? 60 : 72, deep ? 32 : 58);
        this.lastCustom = c;
        if (c !== this.n3d.color || this.n3d.mode === 'select') this.n3d.setColor(c);
        this.invalidate();
        return true;
      }
      if ((kind === 'up' || kind === 'leave') && this.hueDrag) {
        this.hueDrag = false;
        return true;
      }
    }
    const pg = this.page;
    if (this.tool !== 'pencil' || !pg || !this.note) return false;
    const inside = x >= pg.x && x <= pg.x + pg.w && y >= pg.y && y <= pg.y + pg.h;
    if (kind === 'down' && inside) {
      this.stroke2d = [(x - pg.x) / pg.w, (y - pg.y) / pg.h];
      this.note.strokes.push(this.stroke2d);
      this.history.push('2d');
      this.invalidate();
      return true;
    }
    if (kind === 'move' && this.stroke2d) {
      const s = this.stroke2d;
      const nx = (x - pg.x) / pg.w;
      const ny = (y - pg.y) / pg.h;
      const lx = s[s.length - 2];
      const ly = s[s.length - 1];
      if (Math.hypot((nx - lx) * pg.w, (ny - ly) * pg.h) > 3) {
        s.push(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)));
        this.invalidate();
      }
      return true;
    }
    if ((kind === 'up' || kind === 'leave') && this.stroke2d) {
      this.stroke2d = null;
      this.save();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ 3D (lines, cards, pencil: notes3d.js)

  onPinch(e) {
    if (this.world.drawMode !== this || e.target || !this.note || !this.panel || this.panel.state !== 'open') return;
    this.n3d.start(e.pointer);
  }

  rebuildInk() {
    if (this.n3d) this.n3d.rebuild(this.note);
  }

  undo() {
    const n = this.note;
    const last = this.history.pop() || (n.ink3d.length ? '3d' : n.strokes.length ? '2d' : null);
    if (last === '2d') n.strokes.pop();
    else if (last === '3d') {
      n.ink3d.pop();
      this.rebuildInk();
    } else if (last === 'photo') n.photos.pop();
    else if (last === 'card' && n.cards && n.cards.length) {
      n.cards.pop();
      this.rebuildInk();
    }
    this.save();
    this.invalidate();
  }

  update(t, dt) {
    if (this.n3d) this.n3d.update(t, dt, !!this.panel && this.panel.state === 'open');
  }

  /** Cards in the space are touchable like windows. */
  interactives3d() {
    return this.n3d && this.panel && this.panel.state === 'open' ? this.n3d.interactives() : [];
  }

  surfaces3d() {
    return this.n3d && this.panel && this.panel.state === 'open' ? this.n3d.surfaces() : [];
  }

  // ------------------------------------------------------------------ clicks

  async click(id, data) {
    const W = this.world;
    if (id === 'new') this.create();
    else if (id === 'pick') await this.load(data);
    else if (id.startsWith('mode:')) {
      this.n3d && this.n3d.endEdit();
      this.setTool(data);
    }
    else if (id === 'del') this.confirmDelete = true;
    else if (id === 'delNo') this.confirmDelete = false;
    else if (id === 'delYes') return this.remove();
    else if (id === 'title') {
      this.n3d.endEdit();
      this.editing = 'title';
      W.keyboard.showFor(this);
    } else if (id.startsWith('src:')) this.n3d.source = data;
    else if (id.startsWith('ink:')) this.n3d.setColor(data);
    else if (id.startsWith('mode3d:')) this.n3d.setMode(data);
    else if (id === 'del3d') this.n3d.deleteSelected();
    else if (id.startsWith('w:')) this.n3d.width = data;
    else if (id === 'clear3d') this.n3d.clear3d();
    else if (id === 'tool') {
      if (data !== 'card') this.n3d.endEdit();
      if (data === 'undo') this.undo();
      else if (data === 'card') {
        this.n3d.newCard();
        this.history.push('card');
        this.save();
      }
      else if (data === 'snap') {
        this.waitingSnap = true;
        W.cameraBox.open();
        W.coreSay('Snap a photo: it lands in this note.');
      } else if (data === 'photo') {
        this.picker = this.picker ? null : [];
        if (this.picker) {
          try {
            this.picker = (await api('/api/space/photos')).photos.slice(0, 12);
          } catch {
            this.picker = [];
          }
        }
      } else this.setTool(this.tool === data && data === 'draw3d' ? 'type' : data);
    } else if (id === 'attach') this.attachPhoto(data);
    else if (id === 'photoOpen') {
      if (!W.apps.img) {
        W.apps.img = new ImageView();
        W.apps.img.world = W;
      }
      W.apps.img.show(`/api/space/photo/${encodeURIComponent(data)}`, data);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ draw

  draw(g, ui, W, H) {
    const n = this.note;
    const top = chrome(g, ui, W, H, { title: 'Notes', sub: this.world.standalone ? 'Saved on the Quest as you go' : 'Saved on the PC as you go' });
    // ---- the side: a new note, then your notes (the chosen one can be deleted)
    const lx = 24;
    const lw = 300;
    button(g, ui, 'new', lx, top + 4, lw, 56, 'New note', { iconName: 'plus', small: true });
    const list = this.list || [];
    const rowH = 70;
    list.slice(0, 8).forEach((it, i) => {
      const y = top + 74 + i * (rowH + 4);
      const on = n && it.id === n.id;
      if (on) {
        cutPath(g, lx, y, lw, rowH, 7);
        g.fillStyle = T.bg2;
        g.fill();
        g.fillStyle = T.seal;
        g.fillRect(lx, y + 14, 4, rowH - 28);
      }
      text(g, (on ? n.title : it.title) || 'Untitled', lx + 20, y + 31, { size: 19, weight: 600, color: on ? T.ink : T.ink2, max: lw - (on ? 84 : 36) });
      text(g, `${when(it.updated)}${it.photos ? ` · ${it.photos} photo${it.photos === 1 ? '' : 's'}` : ''}`, lx + 20, y + 55, { size: 14, color: T.ink3, max: lw - 84 });
      ui.hit('pick', lx, y, lw, rowH, it.id);
      if (on) {
        icon(g, 'trash', lx + lw - 46, y + rowH / 2 - 11, 22, T.ink3);
        ui.hit('del', lx + lw - 62, y, 62, rowH);
      }
    });
    if (!list.length) text(g, 'Your notes appear here.', lx + 20, top + 110, { size: 17, color: T.ink3 });
    g.fillStyle = T.line;
    g.fillRect(lx + lw + 20, top, 1, H - top - 24);
    const ex = lx + lw + 44;
    const ew = W - ex - 32;
    if (!n) {
      text(g, 'No note open', ex, top + 60, { size: 26, weight: 600, color: T.ink });
      text(g, 'Start one with New note, or pick one on the left.', ex, top + 96, { size: 18, color: T.ink3 });
      return;
    }

    // ---- the note: its title, then two clear groups — how you write, and what you add
    let y = top + 4;
    const editingTitle = this.editing === 'title';
    text(g, (n.title || (editingTitle ? '' : 'Untitled')) + (editingTitle ? '▏' : ''), ex, y + 38, { size: 30, weight: 600, color: n.title ? T.ink : T.ink3, max: ew - 40 });
    if (!editingTitle) icon(g, 'pencil', ex + Math.min(ew - 40, measureTitle(g, n.title || 'Untitled')) + 14, y + 18, 18, T.ink3);
    ui.hit('title', ex, y, ew, 56);
    y += 66;
    mono(g, 'write with', ex, y + 14, { size: 13, color: T.ink3 });
    mono(g, 'add', ex + 424, y + 14, { size: 13, color: T.ink3 });
    y += 22;
    segmented(g, ui, 'mode', ex, y, 400, 58, [{ id: 'type', label: 'Keys' }, { id: 'pencil', label: 'Sketch' }, { id: 'draw3d', label: 'In the air' }], this.tool);
    const adds = [
      { id: 'card', icon: 'notes', label: 'Card' },
      { id: 'photo', icon: 'image', label: 'Photo' },
      { id: 'snap', icon: 'snap', label: 'Snap' },
    ];
    const aw = Math.min(150, (ew - 424 - 84 - 2 * 8) / 3);
    adds.forEach((t, i) => button(g, ui, 'tool', ex + 424 + i * (aw + 8), y, aw, 58, t.label, { iconName: t.icon, small: true, active: t.id === 'photo' && !!this.picker, data: t.id }));
    button(g, ui, 'tool', ex + ew - 68, y, 68, 58, '', { iconName: 'undo', data: 'undo' });
    y += 72;
    // the page
    const pg = { x: ex, y, w: ew, h: H - y - 62 };
    this.page = pg;
    cutPath(g, pg.x, pg.y, pg.w, pg.h, 10);
    g.fillStyle = T.bg2;
    g.fill();
    if (this.tool === 'pencil') {
      g.strokeStyle = T.line2;
      g.lineWidth = 1.5;
      g.stroke();
    }
    const photoH = n.photos.length ? 150 : 0;
    // text
    const ty = paragraph(g, n.text.replace(/\n/g, ' ¶ ') + (this.editing === 'text' ? '▏' : ''), pg.x + 24, pg.y + 42, pg.w - 48, { size: 22, lh: 1.5, color: T.ink, maxLines: 9 });
    if (!n.text && this.editing !== 'text' && this.tool !== 'draw3d') text(g, this.tool === 'pencil' ? 'Draw on this page with your finger or a pinch.' : 'Tap here and type. Sketch draws on the page; In the air draws around you.', pg.x + 24, pg.y + 42, { size: 19, color: T.ink3, max: pg.w - 48 });
    // pencil strokes
    g.strokeStyle = T.ink;
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const s of n.strokes) {
      g.beginPath();
      for (let i = 0; i < s.length; i += 2) {
        const px = pg.x + s[i] * pg.w;
        const py = pg.y + s[i + 1] * pg.h;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      if (s.length === 2) g.lineTo(pg.x + s[0] * pg.w + 0.5, pg.y + s[1] * pg.h);
      g.stroke();
    }
    // status: what is in this note
    {
      const bits = [];
      if (n.text) bits.push(`${n.text.trim().split(/\s+/).length} words`);
      if (n.strokes.length) bits.push(`${n.strokes.length} sketch line${n.strokes.length === 1 ? '' : 's'}`);
      if ((n.ink3d || []).length) bits.push(`${n.ink3d.length} drawing${n.ink3d.length === 1 ? '' : 's'} in the air`);
      if ((n.cards || []).length) bits.push(`${n.cards.length} card${n.cards.length === 1 ? '' : 's'}`);
      if (n.photos.length) bits.push(`${n.photos.length} photo${n.photos.length === 1 ? '' : 's'}`);
      text(g, bits.length ? bits.join('  ·  ') : 'Empty note', pg.x, pg.y + pg.h + 36, { size: 15, family: 'mono', color: T.ink3 });
      text(g, n.updated ? `saved ${when(n.updated)}` : '', pg.x + pg.w, pg.y + pg.h + 36, { size: 15, family: 'mono', color: T.ink3, align: 'right' });
    }
    // photos along the bottom of the page
    if (photoH) {
      const py = pg.y + pg.h - photoH - 12;
      hairline(g, pg.x + 16, py - 10, pg.w - 32);
      n.photos.slice(-6).forEach((name, i) => {
        const x = pg.x + 16 + i * 196;
        if (x + 180 > pg.x + pg.w) return;
        const url = `/api/space/photo-thumb/${encodeURIComponent(name)}`;
        let im = thumbs.get(url);
        if (!im) {
          im = new Image();
          im.onload = () => this.invalidate();
          im.src = url;
          thumbs.set(url, im);
        }
        g.fillStyle = T.bg3;
        g.fillRect(x, py, 180, photoH);
        if (im.complete && im.naturalWidth) {
          const k = Math.max(180 / im.naturalWidth, photoH / im.naturalHeight);
          const sw = 180 / k;
          const sh = photoH / k;
          g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, py, 180, photoH);
        }
        ui.hit('photoOpen', x, py, 180, photoH, name);
      });
    }
    // 3D drawing: what draws (hand or pencil), the ink, the width, clear
    if (this.tool === 'draw3d') {
      const ox = pg.x + 16;
      const oy = pg.y + 16;
      cutPath(g, ox, oy, pg.w - 32, 204, 8);
      g.fillStyle = T.bgSolid;
      g.fill();
      const n3 = this.n3d;
      const sel = n3.mode === 'select' ? n.ink3d[n3.sel] : null;
      // row 1: draw or select · pencil or hand (draw) / delete (select) · width · clear
      segmented(g, ui, 'mode3d', ox + 14, oy + 14, 230, 54, [{ id: 'draw', label: 'Draw' }, { id: 'select', label: 'Select' }], n3.mode);
      if (n3.mode === 'draw') {
        segmented(g, ui, 'src', ox + 258, oy + 14, 230, 54, [{ id: 'pencil', label: 'Pencil' }, { id: 'hand', label: 'Hand' }], n3.source);
        segmented(g, ui, 'w', ox + 502, oy + 14, 190, 54, [{ id: 's', label: 'S' }, { id: 'm', label: 'M' }, { id: 'l', label: 'L' }], n3.width);
      } else button(g, ui, 'del3d', ox + 258, oy + 14, 230, 54, 'Delete line', { iconName: 'trash', small: true, disabled: !sel });
      button(g, ui, 'clear3d', ox + pg.w - 32 - 164, oy + 14, 150, 54, 'Clear 3D', { iconName: 'trash', small: true, disabled: !n.ink3d.length });
      // row 2: the colour (of the next line, or of the chosen one): twelve swatches, then any hue
      const cur = sel ? sel.c : n3.color;
      const sw = 40;
      PALETTE.forEach((c, i) => {
        const x = ox + 14 + i * (sw + 6);
        const y = oy + 82;
        g.fillStyle = `#${inkOf(c).toString(16).padStart(6, '0')}`;
        g.fillRect(x + 4, y + 4, sw - 8, sw - 8);
        if (c === cur) {
          g.strokeStyle = T.ink;
          g.lineWidth = 2;
          g.strokeRect(x + 0.5, y + 0.5, sw - 1, sw - 1);
        }
        ui.hit(`ink:${c}`, x, y, sw, sw, c);
      });
      const hx = ox + 14 + PALETTE.length * (sw + 6) + 10;
      const hw = ox + pg.w - 32 - 14 - hx;
      if (hw > 120) {
        // any colour: tap along the bar (hue), the band below is darker
        // any colour: press on the bar and slide; light on top, deep below. The swatch at its end
        // shows your own colour
        const bw = hw - 54;
        for (let i = 0; i < 48; i++) {
          const hue = (i / 48) * 360;
          g.fillStyle = `hsl(${hue}, 72%, 58%)`;
          g.fillRect(hx + (i * bw) / 48, oy + 82, bw / 48 + 1, 20);
          g.fillStyle = `hsl(${hue}, 60%, 32%)`;
          g.fillRect(hx + (i * bw) / 48, oy + 102, bw / 48 + 1, 20);
        }
        this.hueRect = { x: hx, y: oy + 82, w: bw, h: 40 };
        ui.hit('huebar', hx, oy + 82, bw, 40);
        const custom = typeof cur === 'string' && cur.startsWith('#') && !PALETTE.includes(cur);
        const own = custom ? cur : this.lastCustom;
        const cx = hx + bw + 10;
        g.fillStyle = own || T.bg3;
        g.fillRect(cx, oy + 82, 40, 40);
        if (own) ui.hit(`ink:custom`, cx, oy + 82, 40, 40, own);
        if (custom) {
          g.strokeStyle = T.ink;
          g.lineWidth = 2;
          g.strokeRect(cx + 0.5, oy + 82.5, 39, 39);
        }
        mono(g, 'custom', cx + 20, oy + 140, { size: 11, color: T.ink3, align: 'center' });
      }
      // row 3: how it works
      const hint = n3.mode === 'draw'
        ? n3.source === 'pencil' ? 'Pinch in the air: the pencil’s tip draws, in the colour it shows.' : 'Pinch in the air and move: the line follows your pinch.'
        : sel ? 'Carry it by the line or its grip, pull the red corner to size it, ✕ removes it. Colours change it.' : 'Pinch a line to choose it.';
      text(g, hint, ox + 14, oy + 172, { size: 17, color: T.ink3, max: pg.w - 60 });
    }
    // photo picker
    if (this.picker) {
      const px = pg.x + 16;
      const py = pg.y + 90;
      cutPath(g, px, py, pg.w - 32, 260, 10);
      g.fillStyle = T.bgSolid;
      g.fill();
      g.strokeStyle = T.line2;
      g.lineWidth = 1.5;
      g.stroke();
      mono(g, this.picker.length ? 'choose a photo' : 'no photos yet · try snap', px + 20, py + 32);
      this.picker.slice(0, 6).forEach((ph, i) => {
        const x = px + 20 + i * ((pg.w - 72) / 6);
        const w = (pg.w - 72) / 6 - 12;
        const url = `/api/space/photo-thumb/${encodeURIComponent(ph.name)}`;
        let im = thumbs.get(url);
        if (!im) {
          im = new Image();
          im.onload = () => this.invalidate();
          im.src = url;
          thumbs.set(url, im);
        }
        g.fillStyle = T.bg3;
        g.fillRect(x, py + 52, w, 180);
        if (im.complete && im.naturalWidth) {
          const k = Math.max(w / im.naturalWidth, 180 / im.naturalHeight);
          g.drawImage(im, (im.naturalWidth - w / k) / 2, (im.naturalHeight - 180 / k) / 2, w / k, 180 / k, x, py + 52, w, 180);
        }
        ui.hit('attach', x, py + 52, w, 180, ph.name);
      });
    }
    // delete question
    if (this.confirmDelete) {
      const dx = ex + ew - 520;
      cutPath(g, dx, top + 64, 520, 120, 10);
      g.fillStyle = T.bgSolid;
      g.fill();
      g.strokeStyle = T.line2;
      g.lineWidth = 1.5;
      g.stroke();
      text(g, 'Delete this note?', dx + 24, top + 104, { size: 21, weight: 600, color: T.ink });
      text(g, this.world.standalone ? 'It is deleted from the Quest.' : 'It goes to the Recycle Bin on the PC.', dx + 24, top + 134, { size: 16, color: T.ink3 });
      button(g, ui, 'delNo', dx + 290, top + 84, 100, 60, 'Keep', { small: true });
      button(g, ui, 'delYes', dx + 400, top + 84, 100, 60, 'Delete', { small: true, primary: true });
    }
  }
}
