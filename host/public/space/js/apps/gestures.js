// HANDS 手 — every gesture, how to do it, what it does, and a switch to turn it off if it ever
// gets in your way. The lamp lights while your hands are making that gesture right now, so this
// doubles as a practice mirror.
import { App } from '../panels.js';
import { T, chrome, text, mono, cutPath } from '../theme.js';
import { GESTURES } from '../hands.js';

export class Gestures extends App {
  constructor() {
    super('ges', 'Hands', '手', [1.24, 0.84]);
    this.fps = 4;
  }

  click(id, data) {
    if (id !== 'toggle') return;
    const W = this.world;
    const g = GESTURES.find((x) => x.id === data);
    if (!g || g.fixed) return;
    W.settings.gestures = W.settings.gestures || {};
    W.settings.gestures[g.id] = !W.hands.enabled(g.id);
    W.saveSettings();
    W.coreSay(`${g.name} ${W.settings.gestures[g.id] ? 'on' : 'off'}.`);
  }

  draw(g, ui, W, H) {
    const top = chrome(g, ui, W, H, { title: 'Hands', kanji: '手', sub: 'gestures · tap one to switch it on or off' });
    const hands = this.world.hands;
    const live = hands ? hands.active : new Set();
    const arming = this.world.armingNames || new Set();
    const colW = (W - 100) / 2;
    const rowH = 104;
    const perCol = Math.ceil(GESTURES.length / 2);
    GESTURES.forEach((ge, i) => {
      const col = i < perCol ? 0 : 1;
      const row = i < perCol ? i : i - perCol;
      const x = 40 + col * (colW + 20);
      const y = top + 6 + row * rowH;
      const enabled = hands ? hands.enabled(ge.id) : ge.on;
      const now = live.has(ge.id);
      const arm = arming.has(ge.id);
      cutPath(g, x, y, colW, rowH - 10, 10);
      g.fillStyle = now ? T.bg3 : 'transparent';
      g.fill();
      g.globalAlpha = enabled ? 1 : 0.4;
      text(g, ge.glyph, x + 46, y + 58, { size: 36, family: 'display', color: T.ink, align: 'center' });
      text(g, ge.name, x + 100, y + 36, { size: 25, family: 'ui', weight: 700, color: now ? T.seal : T.ink, max: colW - 230 });
      text(g, ge.how, x + 100, y + 62, { size: 18, color: T.ink2, max: colW - 230 });
      mono(g, `→ ${ge.does}`, x + 100, y + 84, { size: 14, color: T.gold, max: colW - 230 });
      g.globalAlpha = 1;
      // lamp + switch
      g.fillStyle = now ? T.seal : arm ? T.gold : T.line2;
      g.fillRect(x + colW - 116, y + 40, 10, 10);
      const sx = x + colW - 86;
      const sy = y + 30;
      if (ge.fixed) mono(g, 'always', sx + 36, sy + 22, { size: 13, color: T.ink3, align: 'center' });
      else {
        cutPath(g, sx, sy, 72, 30, 6);
        g.fillStyle = enabled ? T.ink : T.bg3;
        g.fill();
        g.fillStyle = enabled ? T.seal : T.ink3;
        g.fillRect(enabled ? sx + 42 : sx + 5, sy + 5, 25, 20);
        ui.hit('toggle', sx - 24, y + 6, 120, rowH - 22, ge.id); // the switch itself (≥ 64 mm), not the whole row
      }
    });
  }
}
