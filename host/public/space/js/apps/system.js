// SYSTEM 系 — the core's HUD: time in big quiet type, gauges for the headset and the PC, the
// link, the mirror, the device link. Refreshes every few seconds.
import { App } from '../panels.js';
import { T, chrome, text, mono, ring, section, enso, sparkle } from '../theme.js';
import { api } from '../api.js';

export class System extends App {
  constructor() {
    super('sys', 'System', '系', [0.86, 0.74]);
    this.fps = 1;
    this.s = null;
    this.err = null;
    this.next = 0;
    this.cpuHist = [];
  }

  async refresh() {
    try {
      this.s = await api('/api/space/stats');
      this.err = null;
      this.cpuHist.push(this.s.pc.cpu);
      if (this.cpuHist.length > 40) this.cpuHist.shift();
    } catch (e) {
      this.err = e.message;
    }
    this.invalidate();
  }

  update(t) {
    if (this.panel.state === 'open' && t > this.next) {
      this.next = t + 3;
      this.refresh();
    }
  }

  draw(g, ui, W, H, t) {
    const top = chrome(g, ui, W, H, { title: 'System', kanji: '系', sub: 'core · live' });
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    text(g, `${hh}:${mm}`, 40, top + 128, { size: 150, family: 'display', weight: 400, color: T.ink, spacing: -2 });
    mono(g, d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), 44, top + 168, { size: 22, color: T.ink2 });
    enso(g, W - 150, top + 86, 74, { seed: 5, width: 9, color: T.ink3, progress: 1, alpha: 0.7 });
    sparkle(g, W - 150, top + 86, 12, T.gold);
    const s = this.s;
    if (!s) {
      text(g, this.err || 'reading the core…', 44, top + 240, { size: 28, color: this.err ? T.seal : T.ink2 });
      return;
    }
    const q = s.quest || {};
    // gauges
    const gy = top + 300;
    const gauge = (cx, label, frac, value, color) => {
      ring(g, cx, gy, 72, frac, { color, width: 9 });
      text(g, value, cx, gy + 14, { size: 40, family: 'display', color: T.ink, align: 'center' });
      mono(g, label, cx, gy + 112, { size: 20, align: 'center' });
    };
    gauge(120, 'quest battery', (q.battery ?? 0) / 100, q.battery != null ? `${q.battery}%` : '—', (q.battery ?? 100) < 20 ? T.seal : T.gold);
    gauge(310, 'pc cpu', (s.pc.cpu || 0) / 100, `${s.pc.cpu}%`, T.moss);
    const memFrac = q.memTotal ? 1 - q.memAvail / q.memTotal : 0;
    gauge(500, 'quest memory', memFrac, q.memTotal ? `${Math.round(memFrac * 100)}%` : '—', T.ink2);
    // cpu sparkline
    const sx = 640;
    const sw = W - sx - 44;
    const sy = gy - 50;
    g.strokeStyle = T.line2;
    g.lineWidth = 2;
    g.strokeRect(sx, sy, sw, 100);
    g.beginPath();
    this.cpuHist.forEach((c, i) => {
      const x = sx + (i / 39) * sw;
      const y = sy + 100 - (c / 100) * 96 - 2;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = T.moss;
    g.lineWidth = 3;
    g.stroke();
    mono(g, 'pc cpu · 2 min', sx, sy + 130, { size: 18 });
    // facts
    let y = gy + 160;
    section(g, 40, y, W - 80, '01', 'links');
    y += 44;
    const row = (k, v, x, warn) => {
      mono(g, k, x, y, { size: 20, color: T.ink3 });
      text(g, v, x + 170, y, { size: 26, color: warn ? T.seal : T.ink, max: W / 2 - 210 });
    };
    const fmtUp = (sec) => (sec ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : '—');
    row('headset', q.connected ? `${q.model || 'Quest'} · ${q.transport === 'wifi' ? 'Wi-Fi' : 'cable'}` : 'not connected', 40, !q.connected);
    row('pc', `${s.pc.name} · ${s.pc.cores} cores`, W / 2 + 10);
    y += 40;
    row('temp', q.tempC != null ? `${q.tempC}°C${q.charging ? ' · charging' : ''}` : '—', 40, q.tempC > 42);
    row('uptime', fmtUp(q.uptime), W / 2 + 10);
    y += 40;
    row('mirror', s.mirror.paused ? 'paused' : s.mirror.viewers ? `${s.mirror.viewers} watching` : 'nobody watching', 40);
    row('device', s.serial && s.serial.open ? `${s.serial.port} · ${s.serial.baud}` : 'none', W / 2 + 10);
    y += 40;
    row('address', (s.urls && s.urls[0]) || '—', 40);
    row('pc link', s.link.linked ? (s.link.online ? 'linked · online' : 'linked') : 'not linked', W / 2 + 10, !s.link.linked);
  }
}
