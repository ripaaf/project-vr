// UTSUSHI design system — sumi ink on dark paper, one red seal for what matters.
// Rules: one accent colour (the seal), hairline borders instead of decoration, small cut corners
// (no pills), sentence-case labels, generous spacing, content first. No gradients, no rainbows.
// Sizes are design pixels: 1100 per metre of window (28 px text ≈ 1° at 1.45 m).

export const PX_PER_M = 1100;

const NIGHT = {
  name: 'night',
  rgb: [18, 18, 19],
  bg: 'rgba(18,18,19,0.94)', // window body (alpha follows the transparency setting)
  bgSolid: '#121213',
  chip: 'rgba(18,18,19,0.92)', // small floating things: strips, tags, bars, the quick ring
  bg2: '#1a1a1c', // fields, rows, wells
  bg3: '#242427', // buttons
  ink: '#ece5d6',
  ink2: '#a8a194',
  ink3: '#6f6a61',
  line: 'rgba(236,229,214,0.10)',
  line2: 'rgba(236,229,214,0.22)',
  gold: '#c9a35a',
  seal: '#e2472c',
  moss: '#8c9874',
  onSeal: '#fff4ec',
};

const PAPER = {
  name: 'paper',
  rgb: [236, 231, 220],
  bg: 'rgba(236,231,220,0.95)',
  bgSolid: '#ece7dc',
  chip: 'rgba(236,231,220,0.95)',
  bg2: '#e2dccf',
  bg3: '#d6cfc0',
  ink: '#161615',
  ink2: '#4b4842',
  ink3: '#8a857b',
  line: 'rgba(22,22,21,0.12)',
  line2: 'rgba(22,22,21,0.26)',
  gold: '#99702a',
  seal: '#cf3a1f',
  moss: '#5f6b4c',
  onSeal: '#fff4ec',
};

export const T = { ...NIGHT };
let glass = 0.94;
export function setTheme(name) {
  Object.assign(T, name === 'paper' ? PAPER : NIGHT);
  setGlass(glass);
}
/** Window transparency (Settings): 1 = solid … 0.6 = see-through. */
export function setGlass(a) {
  glass = a;
  T.bg = `rgba(${T.rgb.join(',')},${a})`;
}

export const FONT = {
  display: '"Noto Serif","Noto Serif CJK JP","Noto Serif JP","Yu Mincho",Georgia,serif',
  ui: 'Roboto,"Noto Sans","Segoe UI",system-ui,sans-serif',
  mono: '"Roboto Mono","Droid Sans Mono","Cascadia Mono",Consolas,monospace',
};

// ------------------------------------------------------------------ primitives

export function font(g, size, family = 'ui', weight = 400, spacing = 0) {
  g.font = `${weight} ${size}px ${FONT[family] || family}`;
  if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
}

export function text(g, s, x, y, { size = 22, family = 'ui', weight = 400, color = T.ink, align = 'left', base = 'alphabetic', spacing = 0, max } = {}) {
  font(g, size, family, weight, spacing);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = base;
  let str = String(s);
  if (max && g.measureText(str).width > max) {
    while (str.length > 1 && g.measureText(`${str}…`).width > max) str = str.slice(0, -1);
    str += '…';
  }
  g.fillText(str, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}

/** Emoji / symbol glyphs in ink only (no yellow hands): drawn through a grayscale filter. */
export function glyph(g, s, x, y, opts = {}) {
  g.save();
  g.filter = T.name === 'paper' ? 'grayscale(1) brightness(0.5) contrast(1.4)' : 'grayscale(1) brightness(1.25) contrast(0.9)';
  text(g, s, x, y, opts);
  g.restore();
}

/** HUD tag — the system's voice: mono caps in a block. variant: seal | ink | line.
 *  Returns its width. `chars` limits how many characters show (for the type-in reveal). */
export function hudTag(g, x, y, s, { variant = 'seal', size = 15, chars } = {}) {
  const full = String(s).toUpperCase();
  const str = chars != null && full.length > chars ? `${full.slice(0, chars - 1)}…` : full;
  font(g, size, 'mono', 600, size * 0.12);
  const w = g.measureText(str).width + size * 1.1;
  const h = size * 1.75;
  if (variant === 'line') {
    g.strokeStyle = T.line2;
    g.lineWidth = 1.5;
    g.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
  } else {
    g.fillStyle = variant === 'ink' ? T.ink : T.seal;
    g.fillRect(x, y, w, h);
  }
  text(g, str, x + size * 0.55, y + h / 2 + 1, { size, family: 'mono', weight: 600, spacing: size * 0.12, base: 'middle', color: variant === 'seal' ? T.onSeal : variant === 'ink' ? T.bgSolid : T.ink });
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return w;
}

/** Small caps label (section names, metadata keys). */
export function mono(g, s, x, y, opts = {}) {
  text(g, String(s).toUpperCase(), x, y, { size: 15, family: 'mono', weight: 600, spacing: 1.6, color: T.ink3, ...opts });
}

/** Wrap text into lines that fit `w`; returns the y after the last line. */
export function paragraph(g, s, x, y, w, { size = 20, lh = 1.45, color = T.ink2, family = 'ui', weight = 400, maxLines = 99 } = {}) {
  font(g, size, family, weight);
  const words = String(s).split(/\s+/);
  let line = '';
  let n = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > w && line) {
      text(g, n === maxLines - 1 ? `${line}…` : line, x, y, { size, color, family, weight });
      y += size * lh;
      line = word;
      if (++n >= maxLines) return y;
    } else line = test;
  }
  if (line) {
    text(g, line, x, y, { size, color, family, weight });
    y += size * lh;
  }
  return y;
}

/** The brand's cut corners (top-left and bottom-right), kept small. */
export function cutPath(g, x, y, w, h, k = 10) {
  g.beginPath();
  g.moveTo(x + k, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h - k);
  g.lineTo(x + w - k, y + h);
  g.lineTo(x, y + h);
  g.lineTo(x, y + k);
  g.closePath();
}

export function hairline(g, x, y, w, color = T.line) {
  g.fillStyle = color;
  g.fillRect(x, y, w, 1.5);
}

/** Kept for older callers: now a plain short rule in the seal colour (no rainbow). */
export function iridLine(g, x, y, w, h = 2) {
  g.fillStyle = T.seal;
  g.fillRect(x, y, Math.min(w, 40), h);
}
export function iridGradient() {
  return T.seal;
}
export function grain() {}

/** Seeded random, so wabi imperfections stay the same between redraws. */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

let brushCanvas = null;
/** Ensō: one solid brush stroke, heavy start, dry tail, never closed. */
export function enso(g, cx, cy, r, { seed = 7, width = 10, color = T.ink, gap = 0.16, progress = 1, alpha = 1 } = {}) {
  const k = Math.max(0, Math.min(1, progress));
  if (k <= 0) return;
  const rand = seeded(seed);
  const start = -Math.PI * 0.62 + rand() * 0.3;
  const full = Math.PI * 2 * (1 - gap);
  const ph = [rand() * 6.28, rand() * 6.28];
  const N = Math.max(2, Math.ceil(180 * k));
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * k;
    const a = start + full * t;
    const rr = r * (1 + Math.sin(t * 9 + seed) * 0.018 + Math.sin(t * 23 + ph[0]) * 0.006);
    const press = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - t * 0.55);
    let bw = width * (0.3 + press * 1.1) * (1 + Math.sin(t * 31 + ph[1]) * 0.07);
    if (t > 0.9) bw *= 1 - ((t - 0.9) / 0.1) * 0.75;
    pts.push([a, rr, bw, t]);
  }
  const pad = width * 2;
  const size = Math.ceil(2 * (r * 1.03 + pad));
  if (!brushCanvas) brushCanvas = document.createElement('canvas');
  const c = brushCanvas;
  if (c.width < size || c.height < size) c.width = c.height = size;
  const b = c.getContext('2d');
  b.clearRect(0, 0, size, size);
  const o = size / 2;
  b.fillStyle = color;
  b.beginPath();
  pts.forEach(([a, rr, bw], i) => {
    const x = o + Math.cos(a) * (rr + bw / 2);
    const y = o + Math.sin(a) * (rr + bw / 2);
    if (i) b.lineTo(x, y);
    else b.moveTo(x, y);
  });
  for (let i = pts.length - 1; i >= 0; i--) {
    const [a, rr, bw] = pts[i];
    b.lineTo(o + Math.cos(a) * (rr - bw / 2), o + Math.sin(a) * (rr - bw / 2));
  }
  b.closePath();
  b.fill();
  const [a0, r0, w0] = pts[0];
  b.beginPath();
  b.arc(o + Math.cos(a0) * r0, o + Math.sin(a0) * r0, w0 / 2, 0, Math.PI * 2);
  b.fill();
  b.globalCompositeOperation = 'destination-out';
  b.strokeStyle = '#000';
  for (let s = 0; s < 8; s++) {
    const across = rand() - 0.5;
    const from = 0.3 + rand() * 0.4;
    b.lineWidth = Math.max(0.6, width * (0.025 + rand() * 0.045));
    b.globalAlpha = 0.45 + rand() * 0.55;
    b.beginPath();
    let on = false;
    for (const [a, rr, bw, t] of pts) {
      if (t < from) continue;
      const q = rr + across * bw * 0.85;
      if (on) b.lineTo(o + Math.cos(a) * q, o + Math.sin(a) * q);
      else b.moveTo(o + Math.cos(a) * q, o + Math.sin(a) * q);
      on = true;
    }
    b.stroke();
  }
  b.globalCompositeOperation = 'source-over';
  b.globalAlpha = 1;
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(c, 0, 0, size, size, cx - o, cy - o, size, size);
  g.restore();
}

/** The red hanko seal with one character (used sparingly: the wordmark, the tour). */
export function seal(g, x, y, size, ch = '映') {
  g.save();
  g.fillStyle = T.seal;
  g.fillRect(x, y, size, size);
  text(g, ch, x + size / 2, y + size * 0.74, { size: size * 0.66, family: 'display', weight: 700, color: T.onSeal, align: 'center' });
  g.restore();
}

/** Thin gauge ring. */
export function ring(g, cx, cy, r, frac, { color = T.ink, width = 6, track = T.line } = {}) {
  g.save();
  g.lineCap = 'butt';
  g.lineWidth = width;
  g.strokeStyle = track;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = color;
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, frac)));
  g.stroke();
  g.restore();
}

/** A thin meter bar (battery, CPU, memory). */
export function meter(g, x, y, w, frac, { color = T.ink, h = 6 } = {}) {
  g.fillStyle = T.line2;
  g.fillRect(x, y, w, h);
  g.fillStyle = color;
  g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}

export function sparkle(g, x, y, s, color = T.ink) {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x + s * 0.12, y - s * 0.12, x + s, y);
  g.quadraticCurveTo(x + s * 0.12, y + s * 0.12, x, y + s);
  g.quadraticCurveTo(x - s * 0.12, y + s * 0.12, x - s, y);
  g.quadraticCurveTo(x - s * 0.12, y - s * 0.12, x, y - s);
  g.fill();
  g.restore();
}

export function crosshair(g, x, y, s = 10, color = T.line2) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x - s, y);
  g.lineTo(x + s, y);
  g.moveTo(x, y - s);
  g.lineTo(x, y + s);
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------------ icons (single-weight line art)

/** Line icons for apps and actions, drawn in a s×s box at (x, y). */
export function icon(g, name, x, y, s, color = T.ink) {
  const u = s / 24;
  const P = (px, py) => [x + px * u, y + py * u];
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = Math.max(1.5, 1.8 * u);
  g.lineJoin = 'miter';
  g.lineCap = 'square';
  const path = (pts, close) => {
    g.beginPath();
    pts.forEach(([a, b], i) => (i ? g.lineTo(...P(a, b)) : g.moveTo(...P(a, b))));
    if (close) g.closePath();
    g.stroke();
  };
  const rect = (a, b, w, h) => {
    g.strokeRect(...P(a, b), w * u, h * u);
  };
  switch (name) {
    case 'notes':
      path([[5, 3], [16, 3], [19, 6], [19, 21], [5, 21]], true);
      path([[8, 9], [16, 9]]);
      path([[8, 13], [16, 13]]);
      path([[8, 17], [12, 17]]);
      break;
    case 'files':
      path([[3, 6], [9, 6], [11, 8], [21, 8], [21, 19], [3, 19]], true);
      break;
    case 'photos':
      rect(3, 5, 18, 14);
      path([[3, 16], [9, 11], [13, 14], [16, 12], [21, 16]]);
      break;
    case 'camera':
      path([[3, 8], [3, 4], [7, 4]]);
      path([[17, 4], [21, 4], [21, 8]]);
      path([[21, 16], [21, 20], [17, 20]]);
      path([[7, 20], [3, 20], [3, 16]]);
      g.fillRect(...P(10.5, 10.5), 3 * u, 3 * u);
      break;
    case 'terminal':
      rect(3, 4, 18, 16);
      path([[7, 9], [10, 12], [7, 15]]);
      path([[12, 15], [17, 15]]);
      break;
    case 'pc':
      rect(3, 4, 18, 12);
      path([[12, 16], [12, 20]]);
      path([[8, 20], [16, 20]]);
      break;
    case 'devices':
      rect(7, 7, 10, 10);
      for (const t of [9, 12, 15]) {
        path([[t, 3], [t, 7]]);
        path([[t, 17], [t, 21]]);
        path([[3, t], [7, t]]);
        path([[17, t], [21, t]]);
      }
      break;
    case 'settings':
      path([[4, 7], [20, 7]]);
      path([[4, 12], [20, 12]]);
      path([[4, 17], [20, 17]]);
      g.fillRect(...P(13, 5), 3 * u, 4 * u);
      g.fillRect(...P(7, 10), 3 * u, 4 * u);
      g.fillRect(...P(15, 15), 3 * u, 4 * u);
      break;
    case 'room':
      path([[4, 20], [4, 9], [12, 4], [20, 9], [20, 20]], true);
      break;
    case 'center':
      rect(8, 8, 8, 8);
      path([[3, 12], [6, 12]]);
      path([[18, 12], [21, 12]]);
      path([[12, 3], [12, 6]]);
      path([[12, 18], [12, 21]]);
      break;
    case 'pencil':
      path([[5, 19], [5, 15], [15, 5], [19, 9], [9, 19]], true);
      break;
    case 'type':
      path([[6, 6], [18, 6]]);
      path([[12, 6], [12, 19]]);
      break;
    case 'draw3d':
      path([[4, 18], [9, 8], [14, 15], [20, 5]]);
      rect(3, 3, 3, 3);
      break;
    case 'plus':
      path([[12, 5], [12, 19]]);
      path([[5, 12], [19, 12]]);
      break;
    case 'trash':
      path([[5, 7], [19, 7]]);
      path([[7, 7], [8, 20], [16, 20], [17, 7]]);
      path([[10, 4], [14, 4]]);
      break;
    case 'undo':
      path([[8, 5], [4, 9], [8, 13]]);
      path([[4, 9], [15, 9], [19, 13], [15, 17], [9, 17]]);
      break;
    case 'back':
      path([[15, 5], [8, 12], [15, 19]]);
      break;
    case 'next':
      path([[9, 5], [16, 12], [9, 19]]);
      break;
    case 'close':
      path([[6, 6], [18, 18]]);
      path([[18, 6], [6, 18]]);
      break;
    case 'keyboard':
      rect(3, 7, 18, 11);
      path([[7, 14], [17, 14]]);
      break;
    case 'snap':
      rect(3, 7, 18, 12);
      path([[8, 7], [10, 4], [14, 4], [16, 7]]);
      g.beginPath();
      g.arc(...P(12, 13), 3.5 * u, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'image':
      rect(3, 5, 18, 14);
      g.beginPath();
      g.arc(...P(9, 10), 2 * u, 0, Math.PI * 2);
      g.stroke();
      path([[3, 17], [10, 13], [21, 18]]);
      break;
    case 'spin':
      g.beginPath();
      g.arc(...P(12, 12), 7 * u, Math.PI * 0.15, Math.PI * 1.75);
      g.stroke();
      path([[17, 3], [18.5, 7.5], [14, 8.5]]);
      break;
    case 'info':
      rect(4, 4, 16, 16);
      path([[12, 11], [12, 17]]);
      g.fillRect(...P(11, 7), 2 * u, 2 * u);
      break;
    case 'cube':
      path([[12, 3], [20, 7.5], [20, 16.5], [12, 21], [4, 16.5], [4, 7.5]], true);
      path([[4, 7.5], [12, 12], [20, 7.5]]);
      path([[12, 12], [12, 21]]);
      break;
    case 'scan':
      path([[3, 8], [3, 3], [8, 3]]);
      path([[16, 3], [21, 3], [21, 8]]);
      path([[21, 16], [21, 21], [16, 21]]);
      path([[8, 21], [3, 21], [3, 16]]);
      path([[7, 12], [17, 12]]);
      break;
    case 'globe':
      g.beginPath();
      g.arc(...P(12, 12), 8.5 * u, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(...P(12, 12), 3.6 * u, 8.5 * u, 0, 0, Math.PI * 2);
      g.stroke();
      path([[3.5, 12], [20.5, 12]]);
      break;
    case 'gather':
      rect(2, 2, 6, 6);
      rect(16, 2, 6, 6);
      rect(2, 16, 6, 6);
      rect(16, 16, 6, 6);
      path([[9, 9], [11, 11]]);
      path([[15, 9], [13, 11]]);
      path([[9, 15], [11, 13]]);
      path([[15, 15], [13, 13]]);
      break;
    case 'apps':
      rect(4, 4, 6.5, 6.5);
      rect(13.5, 4, 6.5, 6.5);
      rect(4, 13.5, 6.5, 6.5);
      rect(13.5, 13.5, 6.5, 6.5);
      break;
    case 'refresh':
      g.beginPath();
      g.arc(...P(12, 12), 7 * u, -Math.PI * 0.35, Math.PI * 1.35);
      g.stroke();
      path([[14, 2.5], [17.5, 5.5], [13.5, 8]]);
      break;
    case 'guide':
      path([[12, 6], [12, 20]]);
      path([[12, 6], [4, 4], [4, 18], [12, 20], [20, 18], [20, 4]], true);
      break;
    case 'search':
      g.beginPath();
      g.arc(...P(10.5, 10.5), 6 * u, 0, Math.PI * 2);
      g.stroke();
      path([[15, 15], [20, 20]]);
      break;
    case 'home':
      path([[4, 11], [12, 4], [20, 11]]);
      path([[6, 9.5], [6, 20], [18, 20], [18, 9.5]]);
      break;
    case 'sound':
      path([[4, 9], [8, 9], [13, 5], [13, 19], [8, 15], [4, 15]], true);
      g.beginPath();
      g.arc(...P(13, 12), 4.5 * u, -Math.PI / 4, Math.PI / 4);
      g.stroke();
      g.beginPath();
      g.arc(...P(13, 12), 8 * u, -Math.PI / 4, Math.PI / 4);
      g.stroke();
      break;
    case 'play':
      path([[8, 5], [19, 12], [8, 19]], true);
      break;
    default:
      rect(5, 5, 14, 14);
  }
  g.restore();
}

// ------------------------------------------------------------------ immediate-mode UI

/** Hit regions for one surface: draw code registers rectangles, pointers hover/press them. */
export class UI {
  constructor() {
    this.hits = [];
    this.hover = null;
    this.press = null;
  }
  begin() {
    this.hits.length = 0;
  }
  hit(id, x, y, w, h, data) {
    this.hits.push({ id, x, y, w, h, data });
  }
  find(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }
  state(id) {
    return this.press === id ? 'press' : this.hover === id ? 'hover' : 'idle';
  }
}

/** Button: solid block with small cut corners, sentence-case label (≥ 64 mm tall for hands).
 *  Hover is drawn by the surface (a soft light + an ink underline). */
export function button(g, ui, id, x, y, w, h, label, { primary = false, glyph = null, iconName = null, small = false, disabled = false, active = false, data, sub } = {}) {
  const pressed = !disabled && ui.state(id) === 'press';
  cutPath(g, x, y, w, h, Math.min(8, h * 0.16));
  let bg = primary ? T.seal : T.bg3;
  let fg = primary ? T.onSeal : T.ink;
  if (active) {
    bg = T.ink;
    fg = T.bgSolid;
  }
  if (pressed) {
    bg = primary ? '#b8341b' : T.line2;
  }
  g.fillStyle = bg;
  g.fill();
  g.globalAlpha = disabled ? 0.35 : 1;
  const size = small ? 18 : 21;
  const lead = iconName || glyph;
  let tx = x + w / 2;
  if (iconName) {
    const s = Math.min(30, h * 0.46);
    icon(g, iconName, label ? x + 22 : x + (w - s) / 2, y + (h - s) / 2, s, fg);
    if (label) tx = x + 22 + s + (w - 22 - s) / 2;
  } else if (glyph) {
    text(g, glyph, x + (label ? 32 : w / 2), y + h / 2 + 1, { size: size + 6, family: 'ui', color: fg, align: 'center', base: 'middle' });
    if (label) tx = x + 32 + (w - 32) / 2;
  }
  if (label) text(g, label, tx, sub ? y + h / 2 - 7 : y + h / 2 + 1, { size, family: 'ui', weight: 600, color: fg, align: 'center', base: 'middle', max: w - (lead ? 60 : 20) });
  if (sub) text(g, sub, tx, y + h / 2 + 16, { size: 14, color: primary ? 'rgba(255,246,238,0.75)' : T.ink3, align: 'center', base: 'middle', max: w - 20 });
  g.globalAlpha = 1;
  if (!disabled) ui.hit(id, x, y, w, h, data);
}

/** Segmented control: one well, the chosen option filled with ink. */
export function segmented(g, ui, idPrefix, x, y, w, h, options, value) {
  cutPath(g, x, y, w, h, 8);
  g.fillStyle = T.bg2;
  g.fill();
  const each = (w - 8) / options.length;
  options.forEach((o, i) => {
    const sx = x + 4 + i * each;
    const on = o.id === value;
    if (on) {
      cutPath(g, sx, y + 4, each, h - 8, 6);
      g.fillStyle = T.ink;
      g.fill();
    }
    text(g, o.label, sx + each / 2, y + h / 2 + 1, { size: 19, family: 'ui', weight: 600, color: on ? T.bgSolid : T.ink2, align: 'center', base: 'middle', max: each - 12 });
    ui.hit(`${idPrefix}:${o.id}`, sx, y, each, h, o.id);
  });
}

/** A toggle switch (rectangular, like the rest). */
export function toggle(g, x, y, on) {
  cutPath(g, x, y, 70, 34, 6);
  g.fillStyle = on ? T.seal : T.bg3;
  g.fill();
  g.fillStyle = on ? T.onSeal : T.ink3;
  g.fillRect(on ? x + 40 : x + 6, y + 6, 24, 22);
}

/** Setting row: label + one-line description on the left, control on the right, hairline below.
 *  The whole row is the target for switches. Returns the row height. */
export function settingRow(g, ui, id, x, y, w, label, sub, { on, value, ctlW } = {}) {
  const h = 92;
  const room = ctlW ?? (on !== undefined ? 110 : 260); // keep text clear of the control on the right
  text(g, label, x, y + (sub ? 40 : 54), { size: 23, weight: 500, color: T.ink, max: w - room });
  if (sub) text(g, sub, x, y + 70, { size: 17, color: T.ink3, max: w - room });
  if (on !== undefined) {
    toggle(g, x + w - 70, y + 29, on);
    ui.hit(id, x - 10, y + 6, w + 20, h - 12);
  } else if (value !== undefined) text(g, value, x + w, y + 54, { size: 21, family: 'mono', color: T.ink2, align: 'right' });
  hairline(g, x, y + h - 1, w);
  return h;
}

/** Old switch row API, drawn the new way. */
export function switchRow(g, ui, id, x, y, w, label, on, sub) {
  settingRow(g, ui, id, x, y, w, label, sub, { on });
}

/** Section label: small caps + hairline. (`num` is ignored: no decoration.) */
export function section(g, x, y, w, num, title) {
  mono(g, title, x, y, { size: 15, color: T.ink3 });
  font(g, 15, 'mono', 600, 1.6);
  const tw = g.measureText(String(title).toUpperCase()).width;
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  hairline(g, x + tw + 16, y - 6, Math.max(0, w - tw - 16));
}

/** Window chrome: body with a hairline edge, header with the seal mark, the app name and one
 *  line of context, then a divider. Close and move live under the window. Returns content top. */
export function chrome(g, ui, W, H, { title, sub }) {
  g.clearRect(0, 0, W, H);
  cutPath(g, 0, 0, W, H, 16);
  g.fillStyle = T.bg;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = T.line2;
  cutPath(g, 0.75, 0.75, W - 1.5, H - 1.5, 16);
  g.stroke();
  g.fillStyle = T.seal;
  g.fillRect(40, 38, 10, 10);
  text(g, title, 62, 50, { size: 26, weight: 600, color: T.ink });
  if (sub) text(g, sub, 62, 80, { size: 17, color: T.ink3, max: W - 420 });
  hairline(g, 0, 104, W);
  return 124;
}
