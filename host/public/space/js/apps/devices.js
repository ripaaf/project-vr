// DEVICES 機器 — control an ESP32 / M5Stack Cardputer (or any USB-serial board) plugged into the PC.
// With the UTSUSHI-LINK firmware (devices/ folder) the quick buttons drive LEDs, RGB, the buzzer and
// the Cardputer's screen; any other firmware still gets a raw serial console.
import { App } from '../panels.js';
import { T, chrome, text, mono, button, section, segmented, cutPath, font } from '../theme.js';
import { api, events } from '../api.js';

const SWATCHES = [
  ['seal', [226, 71, 44]],
  ['gold', [208, 170, 95]],
  ['moss', [140, 152, 116]],
  ['sky', [120, 200, 255]],
  ['lilac', [190, 160, 255]],
  ['off', [0, 0, 0]],
];

export class Devices extends App {
  constructor() {
    super('dev', 'Devices', '機器', [1.08, 0.72]);
    this.ports = null;
    this.sel = null;
    this.baud = '115200';
    this.state = { open: false };
    this.lines = [];
    this.input = '';
    this.board = null; // from "info ..." reply
    this.err = null;
  }

  async opened() {
    this.refresh();
    if (!this.stop) {
      this.stop = events('/api/serial/stream', (m) => {
        if (m.kind === 'hello') {
          this.state = m.state;
          this.lines = m.lines || [];
        } else if (m.kind === 'state') {
          this.state = m.state;
          if (m.state.open) setTimeout(() => this.send('info'), 600);
        } else if (m.kind === 'line') {
          this.lines.push(m.line);
          if (this.lines.length > 200) this.lines.shift();
          this.onLine(m.line);
        }
        this.invalidate();
      });
    }
  }

  onLine(l) {
    if (l.dir !== 'in') return;
    const t = l.text.trim();
    if (t.startsWith('info ')) {
      const kv = Object.fromEntries(t.slice(5).split(/\s+/).map((p) => p.split('=')));
      this.board = { name: kv.board || 'board', fw: kv.fw || '', caps: (kv.caps || '').split(',').filter(Boolean) };
      this.world.coreSay(`${this.board.name} is online.`);
    } else if (t.startsWith('key ')) {
      // Cardputer keyboard → whatever is listening in the space (terminal by default)
      const k = t.slice(4);
      const target = this.world.keyTarget;
      if (target && target !== this && target.key) target.key(k === 'enter' ? 'Enter' : k === 'del' ? 'Backspace' : k === 'space' ? ' ' : k);
    }
  }

  async refresh() {
    this.err = null;
    try {
      const r = await api('/api/serial/ports');
      this.ports = r.ports;
      this.state = r.state;
      if (!this.sel) {
        const best = this.ports.find((p) => p.likelyBoard) || null;
        this.sel = best ? best.port : null;
      }
    } catch (e) {
      this.err = e.message;
    }
    this.invalidate();
  }

  async send(line) {
    try {
      await api('/api/serial/send', { text: line });
    } catch (e) {
      this.err = e.message;
      this.world.sound.error(this.panel.group.position);
      this.invalidate();
    }
  }

  key(k) {
    if (k === 'Enter') {
      if (this.input.trim()) this.send(this.input.trim());
      this.input = '';
    } else if (k === 'Backspace') this.input = this.input.slice(0, -1);
    else if (k.length === 1) this.input += k;
    this.invalidate();
  }

  async click(id, data) {
    const W = this.world;
    if (id === 'port') {
      this.sel = data;
    } else if (id.startsWith('baud:')) this.baud = data;
    else if (id === 'refresh') return this.refresh();
    else if (id === 'connect') {
      if (this.state.open) await api('/api/serial/close', {}).catch(() => {});
      else if (this.sel) {
        this.board = null;
        await api('/api/serial/open', { port: this.sel, baud: Number(this.baud) }).catch((e) => (this.err = e.message));
      }
    } else if (id === 'cmd') this.send(data);
    else if (id === 'rgb') this.send(`rgb ${data.join(' ')}`);
    else if (id === 'type') {
      W.keyTarget = this;
      W.keyboard.toggle(this);
    } else if (id === 'sendInput') this.key('Enter');
    this.invalidate();
  }

  draw(g, ui, W, H) {
    const top = chrome(g, ui, W, H, { title: 'Devices', kanji: '機器', sub: 'esp32 · cardputer · any usb-serial board on the pc' });
    const colW = 380;
    // ---- left: ports
    section(g, 40, top + 26, colW - 20, '01', 'port');
    let y = top + 48;
    if (this.err) {
      text(g, this.err, 40, y + 30, { size: 22, color: T.seal, max: colW - 30 });
      y += 44;
    }
    if (!this.ports) text(g, 'looking…', 40, y + 30, { size: 26, color: T.ink2 });
    else if (!this.ports.length) text(g, 'no serial ports — plug a board into the PC', 40, y + 30, { size: 22, color: T.ink2, max: colW - 30 });
    for (const p of (this.ports || []).slice(0, 4)) {
      const on = this.sel === p.port;
      button(g, ui, 'port', 40, y, colW - 20, 72, '', { active: on, data: p.port });
      text(g, `${p.likelyBoard ? '◆ ' : ''}${p.port}`, 60, y + 32, { size: 26, family: 'mono', weight: 700, color: on ? T.bgSolid : T.ink });
      text(g, p.chip || p.name, 60, y + 58, { size: 18, color: on ? T.bgSolid : T.ink3, max: colW - 70 });
      y += 80;
    }
    y = Math.max(y, top + 250);
    segmented(g, ui, 'baud', 40, y + 6, colW - 20, 66, [{ id: '9600', label: '9600' }, { id: '115200', label: '115200' }, { id: '921600', label: '921600' }], this.baud);
    button(g, ui, 'connect', 40, y + 86, colW - 120, 76, this.state.open ? 'disconnect' : 'connect', { primary: !this.state.open, disabled: !this.state.open && !this.sel });
    button(g, ui, 'refresh', colW - 70, y + 86, 70, 76, '', { glyph: '↻' });
    mono(g, this.state.open ? `● ${this.state.port} @ ${this.state.baud}` : '○ not connected', 40, y + 200, { size: 20, color: this.state.open ? T.moss : T.ink3 });
    if (this.board) text(g, `${this.board.name} · ${this.board.fw}`, 40, y + 236, { size: 22, color: T.gold, max: colW - 30 });

    // ---- right: console + quick actions
    const x0 = colW + 40;
    const cw = W - x0 - 40;
    section(g, x0, top + 26, cw, '02', 'console');
    const cy0 = top + 46;
    const ch = 196;
    cutPath(g, x0, cy0, cw, ch, 12);
    g.fillStyle = T.bg2;
    g.fill();
    font(g, 21, 'mono', 500);
    const rows = Math.floor((ch - 16) / 28);
    this.lines.slice(-rows).forEach((l, i) => {
      const color = l.dir === 'in' ? T.ink : l.dir === 'out' ? T.gold : T.ink3;
      text(g, `${l.dir === 'in' ? '‹' : l.dir === 'out' ? '›' : '·'} ${l.text}`, x0 + 16, cy0 + 30 + i * 28, { size: 21, family: 'mono', color, max: cw - 32 });
    });
    // input
    const iy = cy0 + ch + 12;
    cutPath(g, x0, iy, cw - 300, 72, 12);
    g.strokeStyle = T.line2;
    g.lineWidth = 2;
    g.stroke();
    text(g, this.input || 'type a line for the board', x0 + 16, iy + 46, { size: 24, family: 'mono', color: this.input ? T.ink : T.ink3, max: cw - 330 });
    button(g, ui, 'type', x0 + cw - 290, iy, 130, 72, '', { glyph: '⌨' });
    button(g, ui, 'sendInput', x0 + cw - 150, iy, 150, 72, 'send', { primary: true, small: true, disabled: !this.state.open });
    // quick actions (UTSUSHI-LINK firmware)
    const qy = iy + 92;
    mono(g, 'quick · utsushi-link firmware', x0, qy, { size: 18, color: T.ink3 });
    const acts = [['ping', 'ping'], ['info', 'info'], ['hello', 'print hello from utsushi'], ['led on', 'led on'], ['led off', 'led off'], ['beep', 'beep 880 120']];
    const aw = (cw - 2 * 8) / 3;
    acts.forEach(([label, cmd], i) => button(g, ui, 'cmd', x0 + (i % 3) * (aw + 8), qy + 12 + Math.floor(i / 3) * 76, aw, 70, label, { small: true, data: cmd, disabled: !this.state.open }));
    const sw = (cw - 5 * 8) / 6;
    SWATCHES.forEach(([name, rgb], i) => {
      const x = x0 + i * (sw + 8);
      const yy = qy + 168;
      button(g, ui, 'rgb', x, yy, sw, 70, '', { data: rgb, disabled: !this.state.open });
      g.fillStyle = name === 'off' ? T.bg3 : `rgb(${rgb.join(',')})`;
      g.fillRect(x + 12, yy + 14, sw - 24, 42);
      mono(g, name, x + sw / 2, yy + 96, { size: 16, align: 'center', color: T.ink3 });
    });
  }
}
