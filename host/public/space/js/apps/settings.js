// SETTINGS — every option of the space in one place, one section at a time: a sidebar on the left,
// roomy rows on the right (what it is, one line on what it does, the control).
import { App } from '../panels.js';
import { T, chrome, text, mono, glyph, button, segmented, settingRow, toggle, hairline, meter, cutPath, paragraph } from '../theme.js';
import { GESTURES } from '../hands.js';

const SECTIONS = [
  { id: 'space', label: 'Space' },
  { id: 'display', label: 'Display' },
  { id: 'sound', label: 'Sound' },
  { id: 'gestures', label: 'Gestures' },
  { id: 'status', label: 'Status' },
  { id: 'about', label: 'About' },
];
const GLASS = [
  { id: '1', label: 'Solid' },
  { id: '0.9', label: '90%' },
  { id: '0.8', label: '80%' },
  { id: '0.7', label: '70%' },
];

export class Settings extends App {
  constructor() {
    super('set', 'Settings', '', [1.25, 0.86]);
    this.fps = 2; // status and the gesture lamps stay live
    this.section = 'space';
  }

  click(id, data) {
    const W = this.world;
    const s = W.settings;
    if (id.startsWith('nav:')) this.section = data;
    else if (id.startsWith('env:')) W.setMode(data);
    else if (id.startsWith('theme:')) W.setTheme(data);
    else if (id.startsWith('glass:')) W.setGlass(Number(data));
    else if (id.startsWith('sharp:')) {
      s.sharp = data;
      W.coreSay('Applies the next time you enter the space.');
    } else if (id === 'charms') {
      W.charms.setOn(s.charms === false);
    } else if (id === 'gather') {
      W.charms.gather();
    } else if (id === 'keepApps') {
      s.keepApps = !s.keepApps;
    } else if (id.startsWith('win:')) {
      s.winSize = data;
      // open windows take the new size too
      const k = { compact: 0.68, normal: 0.85, large: 1 }[data] || 0.68;
      for (const p of W.panels.openWindows()) p.scale = k;
    } else if (id.startsWith('fps:')) {
      s.fps = Number(data);
      W.applyFrameRate();
    } else if (id.startsWith('vol:')) {
      s.volume = Number(data);
      W.sound.setVolume(s.volume);
    } else if (id === 'sound') {
      s.sound = !s.sound;
      W.sound.enabled = s.sound;
    } else if (id === 'ambient') {
      s.ambient = !s.ambient;
      W.sound.ambient(s.ambient);
    } else if (id === 'voice') {
      s.voice = !s.voice;
      W.sound.voiceOn = s.voice;
      if (s.voice) W.coreSay('Voice on.');
    } else if (id === 'skeleton') {
      s.skeleton = !s.skeleton;
      W.hands.show = s.skeleton;
    } else if (id === 'gesture') {
      const g = GESTURES.find((x) => x.id === data);
      if (g && !g.fixed) {
        s.gestures = s.gestures || {};
        s.gestures[g.id] = !W.hands.enabled(g.id);
      }
    } else if (id === 'center') W.recenter();
    else if (id === 'tour') W.startTour(true);
    else if (id === 'exit') W.exit();
    W.saveSettings();
    this.invalidate();
  }

  draw(g, ui, W, H) {
    const top = chrome(g, ui, W, H, { title: 'Settings', sub: 'Everything about the space, in one place' });
    // ---- sidebar
    const sx = 24;
    const sw = 270;
    SECTIONS.forEach((sec, i) => {
      const y = top + 8 + i * 70;
      const on = this.section === sec.id;
      if (on) {
        cutPath(g, sx, y, sw, 60, 8);
        g.fillStyle = T.bg2;
        g.fill();
        g.fillStyle = T.seal;
        g.fillRect(sx, y + 16, 4, 28);
      }
      text(g, sec.label, sx + 24, y + 39, { size: 22, weight: on ? 600 : 400, color: on ? T.ink : T.ink2 });
      ui.hit('nav:' + sec.id, sx, y, sw, 60, sec.id);
    });
    g.fillStyle = T.line;
    g.fillRect(sx + sw + 24, top, 1.5, H - top - 24);
    // ---- content
    const x = sx + sw + 60;
    const w = W - x - 48;
    let y = top + 4;
    const s = this.world.settings;
    const seg = (id, opts, value, rowY) => segmented(g, ui, id, x + w - 380, rowY + 22, 380, 52, opts, value);
    const head = (title, line) => {
      text(g, title, x, y + 34, { size: 30, weight: 600, color: T.ink });
      if (line) text(g, line, x, y + 64, { size: 18, color: T.ink3, max: w });
      y += line ? 90 : 60;
      hairline(g, x, y, w);
    };
    if (this.section === 'space') {
      head('Space', 'Where your windows live and how they look.');
      settingRow(g, ui, 'env', x, y, w, 'Surroundings', 'Room shows your real room · Void is a quiet night garden', { ctlW: 410 });
      seg('env', [{ id: 'room', label: 'Room' }, { id: 'void', label: 'Void' }], this.world.env.mode, y);
      y += 92;
      settingRow(g, ui, 'theme', x, y, w, 'Look', 'Night (dark ink) or Paper (light)', { ctlW: 410 });
      seg('theme', [{ id: 'night', label: 'Night' }, { id: 'paper', label: 'Paper' }], T.name, y);
      y += 92;
      settingRow(g, ui, 'glass', x, y, w, 'Window transparency', 'See a little of your room through the windows', { ctlW: 410 });
      seg('glass', GLASS, String(s.glass ?? 1), y);
      y += 92;
      settingRow(g, ui, 'centerRow', x, y, w, 'Windows in front of you', 'Same as raising both palms, or double pinching', { ctlW: 250 });
      button(g, ui, 'center', x + w - 220, y + 20, 220, 56, 'Center now', { iconName: 'center', small: true });
      y += 92;
      settingRow(g, ui, 'charms', x, y, w, 'App charms', 'Your apps float around you as small tiles · pinch to open, move them anywhere', { on: s.charms !== false });
      y += 92;
      settingRow(g, ui, 'gatherRow', x, y, w, 'Charms back around you', 'If you moved them somewhere out of reach', { ctlW: 250 });
      button(g, ui, 'gather', x + w - 220, y + 20, 220, 56, 'Gather', { iconName: 'apps', small: true });
    } else if (this.section === 'display') {
      head('Display', 'Sharpness and smoothness.');
      settingRow(g, ui, 'sharpRow', x, y, w, 'Sharpness', 'High renders more pixels: crisper text · applies next time you enter', { ctlW: 410 });
      seg('sharp', [{ id: 'normal', label: 'Normal' }, { id: 'high', label: 'High' }], s.sharp || 'high', y);
      y += 92;
      const now = this.world.session && this.world.session.frameRate;
      settingRow(g, ui, 'fpsRow', x, y, w, 'Refresh rate', now ? `Running at ${now} Hz now · the headset may keep 72 Hz` : 'How often the space redraws per second', { ctlW: 410 });
      seg('fps', [{ id: '72', label: '72 Hz' }, { id: '90', label: '90 Hz' }, { id: '120', label: '120 Hz' }], String(s.fps), y);
      y += 92;
      settingRow(g, ui, 'winRow', x, y, w, 'Window size', 'How big windows open in front of you', { ctlW: 410 });
      seg('win', [{ id: 'compact', label: 'Compact' }, { id: 'normal', label: 'Normal' }, { id: 'large', label: 'Large' }], s.winSize || 'compact', y);
      y += 92;
      settingRow(g, ui, 'keepApps', x, y, w, 'Keep Apps open', 'The Apps menu stays until you close it', { on: !!s.keepApps });
      y += 92;
      settingRow(g, ui, 'skeleton', x, y, w, 'Hand outline', 'Small dots on your fingers so you see what the headset tracks', { on: !!s.skeleton });
    } else if (this.section === 'sound') {
      head('Sound', 'Every sound is soft, short and comes from where it happens.');
      settingRow(g, ui, 'sound', x, y, w, 'Interface sounds', 'Clicks, opens, the shutter', { on: !!s.sound });
      y += 92;
      settingRow(g, ui, 'ambient', x, y, w, 'Ambience', 'Wind and a low drone in the background', { on: !!s.ambient });
      y += 92;
      settingRow(g, ui, 'voice', x, y, w, 'Spoken messages', 'Messages are always written as captions too', { on: !!s.voice });
      y += 92;
      settingRow(g, ui, 'volRow', x, y, w, 'Volume', '', { ctlW: 410 });
      seg('vol', [{ id: '0.4', label: 'Quiet' }, { id: '0.8', label: 'Normal' }, { id: '1.2', label: 'Loud' }], String(s.volume), y);
    } else if (this.section === 'gestures') {
      head('Gestures', 'Switch off any gesture that gets in your way. The square lights while you make it.');
      const hands = this.world.hands;
      const list = GESTURES.filter((ge) => !ge.fixed);
      const colW = (w - 32) / 2;
      const rh = 96;
      list.forEach((ge, i) => {
        const cx = x + (i % 2) * (colW + 32);
        const cy = y + Math.floor(i / 2) * rh;
        const on = hands ? hands.enabled(ge.id) : ge.on;
        const live = hands && hands.active.has(ge.id);
        g.globalAlpha = on ? 1 : 0.45;
        glyph(g, ge.glyph, cx + 20, cy + 54, { size: 26, color: T.ink, align: 'center' });
        text(g, ge.name, cx + 52, cy + 40, { size: 21, weight: 600, color: live ? T.seal : T.ink, max: colW - 160 });
        text(g, ge.does, cx + 52, cy + 66, { size: 16, color: T.ink3, max: colW - 160 });
        g.globalAlpha = 1;
        g.fillStyle = live ? T.seal : T.line2;
        g.fillRect(cx + colW - 104, cy + 40, 8, 8);
        toggle(g, cx + colW - 80, cy + 28, on);
        ui.hit('gesture', cx + colW - 120, cy + 10, 120, rh - 20, ge.id);
        hairline(g, cx, cy + rh - 1, colW);
      });
    } else if (this.section === 'status') {
      head('Status', 'Live, every few seconds.');
      const st = this.world.lastStats;
      if (!st) {
        text(g, 'Asking the PC…', x, y + 50, { size: 21, color: T.ink2 });
        return;
      }
      const q = st.quest || {};
      const pc = st.pc || {};
      const half = (w - 48) / 2;
      const block = (bx, title, rows) => {
        let by = y + 30;
        mono(g, title, bx, by);
        by += 20;
        for (const [label, value, frac] of rows) {
          text(g, label, bx, by + 32, { size: 19, color: T.ink2 });
          text(g, value, bx + half, by + 32, { size: 19, family: 'mono', color: T.ink, align: 'right' });
          if (frac != null) meter(g, bx, by + 46, half, frac, { color: frac > 0.85 ? T.seal : T.ink2, h: 3 });
          by += 66;
        }
      };
      const memQ = q.memTotal ? 1 - q.memAvail / q.memTotal : null;
      block(x, 'headset', [
        ['Battery', q.battery != null ? `${q.battery}%${q.charging ? ' · charging' : ''}` : '—', q.battery != null ? q.battery / 100 : null],
        ['Memory in use', memQ != null ? `${Math.round(memQ * 100)}%` : '—', memQ],
        ['Temperature', q.tempC != null ? `${q.tempC} °C` : '—', null],
        ['Connection', st.standalone ? 'On its own' : q.connected ? (q.transport === 'wifi' ? 'Wi-Fi' : 'Cable') : 'Not connected', null],
        ['Up for', q.uptime ? `${Math.floor(q.uptime / 3600)} h ${Math.floor((q.uptime % 3600) / 60)} min` : '—', null],
      ]);
      const memP = pc.memTotal ? pc.memUsed / pc.memTotal : null;
      if (!st.pc) {
        mono(g, 'this pc', x + half + 48, y + 30);
        text(g, 'Not connected', x + half + 48, y + 82, { size: 21, weight: 600, color: T.ink });
        paragraph(g, 'The space is running on the Quest by itself. Notes, models and scans stay on the headset. Connect the cable to the PC for photos, files, the PC screen, the web and the shell.', x + half + 48, y + 116, half, { size: 18, color: T.ink3, maxLines: 6 });
      } else block(x + half + 48, 'this pc', [
        ['Name', pc.name || '—', null],
        ['Processor', pc.cpu != null ? `${pc.cpu}%` : '—', pc.cpu != null ? pc.cpu / 100 : null],
        ['Memory in use', memP != null ? `${Math.round(memP * 100)}%` : '—', memP],
        ['Board on USB', st.serial && st.serial.open ? `${st.serial.port} @ ${st.serial.baud}` : 'None', null],
        ['Watching the mirror', st.mirror ? String(st.mirror.viewers || 0) : '—', null],
      ]);
    } else if (this.section === 'about') {
      head('About', '');
      text(g, 'UTSUSHI', x, y + 70, { size: 44, family: 'display', weight: 700, color: T.ink });
      text(g, '写し — a reflection', x, y + 108, { size: 19, color: T.ink3 });
      paragraph(g, 'Your Quest, your PC and your boards in one quiet space. Everything runs on your own PC; nothing goes to the cloud.', x, y + 160, Math.min(w, 760), { size: 20, color: T.ink2 });
      const by = y + 260;
      button(g, ui, 'tour', x, by, 260, 64, 'Replay the tour', { small: true });
      button(g, ui, 'exit', x + 280, by, 220, 64, 'Leave the space', { small: true });
    }
  }
}
