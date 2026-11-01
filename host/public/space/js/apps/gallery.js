// PHOTOS — everything you captured (saved on the PC). A grid of previews; tap one to see it large
// with its date, step through with ‹ ›, add it to a note, or delete it (it goes to the Recycle Bin).
import { App } from '../panels.js';
import { T, chrome, text, mono, button, cutPath, hairline } from '../theme.js';
import { api } from '../api.js';

const cache = new Map();
function img(url, onload) {
  if (cache.has(url)) return cache.get(url);
  const im = new Image();
  im.onload = onload;
  im.src = url;
  cache.set(url, im);
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return im;
}
const thumbUrl = (p) => `/api/space/photo-thumb/${encodeURIComponent(p.name)}`;
const when = (ms) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export class Gallery extends App {
  constructor() {
    super('gal', 'Photos', '', [1.25, 0.84]);
    this.photos = null;
    this.page = 0;
    this.open = -1; // index shown large, -1 = the grid
    this.confirm = false;
  }

  async opened() {
    await this.refresh();
  }

  async refresh() {
    try {
      this.photos = (await api('/api/space/photos')).photos;
    } catch {
      this.photos = [];
    }
    if (this.open >= this.photos.length) this.open = this.photos.length - 1;
    this.invalidate();
  }

  async remove() {
    const p = this.photos[this.open];
    if (!p) return;
    try {
      await api('/api/space/photo-delete', { name: p.name });
      this.world.coreSay('Photo moved to the Recycle Bin.');
    } catch (e) {
      this.world.coreSay(e.message);
    }
    this.confirm = false;
    await this.refresh();
    if (!this.photos.length) this.open = -1;
  }

  click(id, data) {
    const W = this.world;
    const n = this.photos ? this.photos.length : 0;
    if (id === 'pic') {
      this.open = data;
      this.confirm = false;
    } else if (id === 'grid') this.open = -1;
    else if (id === 'prev' && this.open > 0) this.open--;
    else if (id === 'next' && this.open < n - 1) this.open++;
    else if (id === 'del') this.confirm = true;
    else if (id === 'cancel') this.confirm = false;
    else if (id === 'delYes') return this.remove();
    else if (id === 'toNote' && this.photos[this.open]) {
      W.apps.notes.attachPhoto(this.photos[this.open].name);
      W.coreSay('Added to your note.');
    } else if (id === 'snap') W.photo(null, null);
    else if (id === 'camera') W.cameraBox.open();
    else if (id === 'pageL') this.page = Math.max(0, this.page - 1);
    else if (id === 'pageR') this.page++;
    this.invalidate();
  }

  draw(g, ui, W, H) {
    const n = this.photos ? this.photos.length : 0;
    const top = chrome(g, ui, W, H, { title: 'Photos', sub: `${n ? `${n} photo${n === 1 ? '' : 's'} · ` : ''}${this.world.standalone ? 'saved on the Quest' : 'saved on the PC'}` });
    if (this.open >= 0 && this.photos && this.photos[this.open]) return this.drawOne(g, ui, W, H, top);
    // header actions
    button(g, ui, 'camera', W - 420, 26, 190, 56, 'Camera', { iconName: 'camera', small: true });
    button(g, ui, 'snap', W - 220, 26, 190, 56, 'Snap view', { iconName: 'snap', small: true, primary: true });
    if (!this.photos) return text(g, 'Loading…', 40, top + 50, { size: 21, color: T.ink2 });
    if (!n) {
      text(g, 'No photos yet', 40, top + 60, { size: 28, weight: 600, color: T.ink });
      text(g, 'Make an L with each hand to frame something, then curl one index finger to snap.', 40, top + 100, { size: 20, color: T.ink2, max: W - 80 });
      text(g, 'Or open Camera and press the shutter.', 40, top + 132, { size: 20, color: T.ink2 });
      return;
    }
    const cols = 5;
    const rows = 3;
    const per = cols * rows;
    const pages = Math.ceil(n / per);
    this.page = Math.min(this.page, pages - 1);
    const gap = 14;
    const gx = 40;
    const gw = W - 80;
    const tw = (gw - gap * (cols - 1)) / cols;
    const th = (H - top - 120 - gap * (rows - 1)) / rows;
    this.photos.slice(this.page * per, this.page * per + per).forEach((p, i) => {
      const x = gx + (i % cols) * (tw + gap);
      const y = top + 8 + Math.floor(i / cols) * (th + gap);
      g.fillStyle = T.bg2;
      g.fillRect(x, y, tw, th);
      const im = img(thumbUrl(p), () => this.invalidate());
      if (im.complete && im.naturalWidth) {
        // fill the cell (crop), like a contact sheet
        const k = Math.max(tw / im.naturalWidth, th / im.naturalHeight);
        const sw = tw / k;
        const sh = th / k;
        g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, y, tw, th);
      }
      ui.hit('pic', x, y, tw, th, this.page * per + i);
    });
    // footer: pages
    const fy = H - 92;
    hairline(g, 0, fy - 14, W);
    text(g, `Page ${this.page + 1} of ${pages}`, 40, fy + 40, { size: 19, family: 'mono', color: T.ink3 });
    button(g, ui, 'pageL', W - 220, fy, 84, 64, '', { iconName: 'back', disabled: this.page === 0 });
    button(g, ui, 'pageR', W - 124, fy, 84, 64, '', { iconName: 'next', disabled: this.page >= pages - 1 });
  }

  drawOne(g, ui, W, H, top) {
    const p = this.photos[this.open];
    const side = 330;
    const x0 = 40;
    const y0 = top + 4;
    const w = W - side - 100;
    const h = H - y0 - 40;
    const im = img(p.url, () => this.invalidate());
    g.fillStyle = T.bg2;
    g.fillRect(x0, y0, w, h);
    if (im.complete && im.naturalWidth) {
      const k = Math.min(w / im.naturalWidth, h / im.naturalHeight);
      const dw = im.naturalWidth * k;
      const dh = im.naturalHeight * k;
      g.drawImage(im, x0 + (w - dw) / 2, y0 + (h - dh) / 2, dw, dh);
    } else text(g, 'Opening…', x0 + w / 2, y0 + h / 2, { size: 21, color: T.ink3, align: 'center' });
    // side panel: what it is, what you can do
    const sx = W - side - 40;
    button(g, ui, 'grid', sx, y0, side, 60, 'All photos', { iconName: 'back', small: true });
    mono(g, 'taken', sx, y0 + 112);
    text(g, when(p.time), sx, y0 + 144, { size: 20, color: T.ink, max: side });
    if (im.naturalWidth) text(g, `${im.naturalWidth} × ${im.naturalHeight}`, sx, y0 + 174, { size: 18, family: 'mono', color: T.ink3 });
    mono(g, `${this.open + 1} of ${this.photos.length}`, sx, y0 + 224);
    button(g, ui, 'prev', sx, y0 + 244, side / 2 - 6, 64, '', { iconName: 'back', disabled: this.open === 0 });
    button(g, ui, 'next', sx + side / 2 + 6, y0 + 244, side / 2 - 6, 64, '', { iconName: 'next', disabled: this.open >= this.photos.length - 1 });
    button(g, ui, 'toNote', sx, y0 + 330, side, 64, 'Add to note', { iconName: 'notes', small: true });
    const dy = H - 136;
    if (this.confirm) {
      text(g, 'Delete this photo?', sx, dy - 14, { size: 20, weight: 600, color: T.ink });
      button(g, ui, 'cancel', sx, dy, side / 2 - 6, 64, 'Keep', { small: true });
      button(g, ui, 'delYes', sx + side / 2 + 6, dy, side / 2 - 6, 64, 'Delete', { small: true, primary: true });
    } else button(g, ui, 'del', sx, dy, side, 64, 'Delete', { iconName: 'trash', small: true });
  }
}
