// The keyboard, Quest-style: it floats in front of you within reach, tilted toward your eyes —
// type by touching the keys with your fingertips (a key fires the moment you touch it), or point
// and pinch from further away. Grab the bar under it to move it. Press "desk" and it lies flat on
// your real table (from the headset's Space Setup); without a table it lies flat where it is.
import * as THREE from 'three';
import { Surface } from './surface.js';
import { Spring, dampVec } from './spring.js';
import { T, text, cutPath, icon } from './theme.js';

const ROWS = {
  abc: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
    ['123', ',', ' ', '.', '⏎'],
  ],
  sym: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    ['↑', '_', '=', '+', '*', '#', '!', '?', '⌫'],
    ['abc', '↓', "'", ' ', '|', '~', '⏎'],
  ],
};
const WIDE = { ' ': 5, '⏎': 1.7, '123': 1.5, abc: 1.5, '⇧': 1.5, '⌫': 1.5 };
const SIZE = [0.37, 0.155]; // about the Quest's own: keys ~3.3 cm apart
const UP = new THREE.Vector3(0, 1, 0);

export class Keyboard {
  constructor(world) {
    this.world = world;
    this.layout = 'abc';
    this.shift = false;
    this.target = null;
    this.mode = 'float'; // float | desk
    this.state = 'hidden';
    this.group = new THREE.Group();
    this.group.visible = false;
    world.scene.add(this.group);
    this.surface = new Surface(world, {
      size: SIZE,
      ss: 2.2,
      name: 'keyboard',
      draw: (g, ui, W, H) => this.draw(g, ui, W, H),
      // keys fire on touch-down (fast typing); release does nothing
      pointer: (kind, x, y) => {
        if (kind === 'down') {
          const hit = this.surface.ui.find(x, y);
          if (hit && hit.data) this.press(hit.data);
        }
        return false;
      },
      click: (id) => {
        if (id === 'kb-close') this.hide();
        else if (id === 'kb-mode') this.toggleDesk();
      },
    });
    this.group.add(this.surface.mesh);
    // grab bar under the keyboard
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.011), new THREE.MeshBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.5, depthWrite: false }));
    this.bar.position.set(0, -SIZE[1] / 2 - 0.02, 0.002);
    this.barHit = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.06), new THREE.MeshBasicMaterial({ visible: false }));
    this.barHit.position.copy(this.bar.position);
    this.barHit.userData.interactive = {
      kind: 'handle',
      begin: (p, point) => {
        this.dragging = true;
        this.grabOff = this.group.position.clone().sub(point);
        this.world.sound.click(point);
      },
      drag: (p, point) => this.moveTo(point.clone().add(this.grabOff)),
      end: () => {
        this.dragging = false;
        if (this.mode === 'desk') this.layOnDesk();
      },
    };
    this.group.add(this.bar, this.barHit);
    this.show = new Spring(0, { stiffness: 240, damping: 24 });
    this.target = null;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
  }

  get visible() {
    return this.state === 'shown';
  }

  headPos() {
    return this.world.camera.getWorldPosition(new THREE.Vector3());
  }

  /** Float: in front, within reach, tilted toward your eyes. */
  floatPose() {
    const head = this.headPos();
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(this.world.camera.matrixWorld).setY(0).normalize();
    const pos = head.clone().addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, -0.32, 0));
    this.faceTilted(pos, head);
  }

  faceTilted(pos, head) {
    this.pos.copy(pos);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(head, pos, UP));
  }

  moveTo(point) {
    const head = this.headPos();
    if (this.mode === 'desk') {
      // stay flat while you slide it around the desk
      this.pos.copy(point);
      this.layFlat(head);
    } else this.faceTilted(point, head);
  }

  layFlat(head) {
    const toYou = new THREE.Vector3(head.x - this.pos.x, 0, head.z - this.pos.z).normalize();
    const yaw = Math.atan2(toYou.x, toYou.z);
    this.quat.setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.12, yaw, 0, 'YXZ'));
  }

  /** On the nearest table under the keyboard (Space Setup planes), else flat where it is. */
  layOnDesk() {
    const head = this.headPos();
    const table = this.world.tableUnder ? this.world.tableUnder(this.pos) : null;
    if (table != null) this.pos.y = table + 0.015;
    this.layFlat(head);
  }

  toggleDesk() {
    this.mode = this.mode === 'desk' ? 'float' : 'desk';
    if (this.mode === 'desk') {
      // find a table in front of you; else lie flat right here
      const head = this.headPos();
      const fwd = new THREE.Vector3(0, 0, -1).transformDirection(this.world.camera.matrixWorld).setY(0).normalize();
      this.pos.copy(head).addScaledVector(fwd, 0.45);
      this.pos.y = head.y - 0.5;
      this.layOnDesk();
    } else this.floatPose();
    this.surface.dirty = true;
    this.world.sound.chime(this.pos, this.mode === 'desk' ? 2 : 3);
  }

  showFor(target) {
    if (this.target !== target) this.typed = '';
    this.target = target;
    if (this.state !== 'shown') {
      if (this.mode === 'desk') this.layOnDesk();
      else this.floatPose();
      this.group.position.copy(this.pos);
      this.group.position.y -= 0.03;
      this.group.quaternion.copy(this.quat);
      this.show.set(0);
    }
    this.state = 'shown';
    this.group.visible = true;
    this.surface.dirty = true;
    this.world.sound.open(this.pos);
  }

  hide() {
    if (this.state !== 'shown') return;
    this.state = 'hidden';
    this.world.sound.close(this.pos);
  }

  toggle(target) {
    if (this.visible && this.target === target) this.hide();
    else this.showFor(target);
  }

  press(k) {
    this.world.sound.key(this.group.position);
    this.flash = { k, at: performance.now() };
    this.surface.dirty = true;
    if (k === '⌫') this.typed = (this.typed || '').slice(0, -1);
    else if (k === '⏎') this.typed = '';
    else if (k.length === 1 && k !== '⇧' && k !== '↑' && k !== '↓') this.typed = ((this.typed || '') + (this.shift ? k.toUpperCase() : k)).slice(-60);
    if (k === '⇧') {
      this.shift = !this.shift;
      this.surface.dirty = true;
      return;
    }
    if (k === '123' || k === 'abc') {
      this.layout = k === '123' ? 'sym' : 'abc';
      this.surface.dirty = true;
      return;
    }
    const out = k === '⏎' ? 'Enter' : k === '⌫' ? 'Backspace' : k === '↑' ? 'ArrowUp' : k === '↓' ? 'ArrowDown' : this.shift ? k.toUpperCase() : k;
    if (this.shift && k.length === 1) {
      this.shift = false;
      this.surface.dirty = true;
    }
    const t = this.target || this.world.keyTarget;
    if (t && t.key) t.key(out);
  }

  draw(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 14);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = T.line;
    g.lineWidth = 1.5;
    g.stroke();
    // top line: what you are typing (and where), desk / float, close
    const name = this.target && (this.target.title || this.target.name) ? this.target.title || this.target.name : 'Keyboard';
    const typed = this.typed || '';
    g.fillStyle = T.seal;
    g.fillRect(18, 19, 7, 7);
    text(g, typed ? `${typed}▏` : name, 34, 28, { size: typed ? 18 : 15, family: typed ? 'ui' : 'mono', weight: typed ? 500 : 600, color: typed ? T.ink : T.ink3, max: W - 150 });
    icon(g, this.mode === 'desk' ? 'keyboard' : 'room', W - 104, 10, 22, T.ink3);
    ui.hit('kb-mode', W - 116, 0, 48, 42);
    icon(g, 'close', W - 48, 12, 18, T.ink3);
    ui.hit('kb-close', W - 62, 0, 62, 42);
    // keys: even, quiet; letters bigger than the special keys; the one you hit flashes
    const rows = ROWS[this.layout];
    const top = 44;
    const gap = 5;
    const rh = (H - top - 10 - gap * 3) / 4;
    const flash = this.flash && performance.now() - this.flash.at < 140 ? this.flash.k : null;
    rows.forEach((row, r) => {
      // a row is never wider than the board: wide keys take their share of the same width
      const units = Math.max(10, row.reduce((sum, k) => sum + (WIDE[k] || 1), 0));
      const unit = (W - 20 - gap * (row.length - 1)) / units;
      const rowW = row.reduce((sum, k) => sum + (WIDE[k] || 1) * unit, 0) + gap * (row.length - 1);
      let x = (W - rowW) / 2;
      const y = top + r * (rh + gap);
      for (const k of row) {
        const w = (WIDE[k] || 1) * unit;
        const special = k.length > 1 || '⇧⌫⏎↑↓'.includes(k);
        const on = (k === '⇧' && this.shift) || k === flash;
        cutPath(g, x, y, w, rh, 6);
        g.fillStyle = on ? T.ink : k === '⏎' ? T.seal : special ? T.bg2 : T.bg3;
        g.fill();
        const label = k === ' ' ? '' : this.shift && k.length === 1 ? k.toUpperCase() : k;
        const fg = on ? T.bgSolid : k === '⏎' ? T.onSeal : special ? T.ink2 : T.ink;
        if (k === '⌫') icon(g, 'back', x + w / 2 - 10, y + rh / 2 - 10, 20, fg);
        else if (label) text(g, label, x + w / 2, y + rh / 2 + 1, { size: special ? 13 : 19, family: k.length > 1 ? 'mono' : 'ui', weight: special ? 700 : 500, color: fg, align: 'center', base: 'middle' });
        else {
          g.fillStyle = T.line2;
          g.fillRect(x + w / 2 - 22, y + rh / 2 + 6, 44, 2);
        }
        ui.hit(`key:${r}:${x | 0}`, x, y, w, rh, k);
        x += w + gap;
      }
    });
  }

  interactives() {
    return this.visible ? [this.surface.mesh, this.barHit] : [];
  }

  surfaces() {
    return this.visible ? [this.surface] : [];
  }

  update(t, dt) {
    if (this.flash && performance.now() - this.flash.at > 150) {
      this.flash = null;
      this.surface.dirty = true;
    }
    this.show.target = this.visible ? 1 : 0;
    const s = this.show.step(dt);
    if (!this.visible && s < 0.02) {
      this.group.visible = false;
      return;
    }
    dampVec(this.group.position, this.pos, this.dragging ? 20 : 12, dt);
    this.group.quaternion.slerp(this.quat, 1 - Math.exp(-14 * dt));
    this.group.scale.setScalar(0.9 + 0.1 * s);
    this.surface.mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, s));
    this.bar.material.opacity = 0.5 * Math.max(0, Math.min(1, s)) + (this.dragging ? 0.3 : 0);
    this.surface.update(t, dt);
  }
}
