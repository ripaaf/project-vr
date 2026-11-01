// The wrist panel: on the back of your left wrist while you look at it like a watch. Time, date and
// battery, plus four tiles you touch with your other hand: Camera · New note · Center · Apps.
import * as THREE from 'three';
import { Surface } from '../surface.js';
import { Spring, dampVec } from '../spring.js';
import { T, text, cutPath, icon, FONT } from '../theme.js';

const UP = new THREE.Vector3(0, 1, 0);
const TILES = [
  { id: 'camera', icon: 'camera' },
  { id: 'note', icon: 'notes' },
  { id: 'center', icon: 'center' },
  { id: 'apps', icon: 'apps' },
];

export class Watch {
  constructor(world) {
    this.world = world;
    this.surface = new Surface(world, {
      size: [0.16, 0.1],
      ss: 2.6,
      name: 'wrist',
      fps: 0.5,
      draw: (g, ui, W, H) => this.draw(g, ui, W, H),
      click: (id, data) => this.choose(data),
    });
    this.mesh = this.surface.mesh;
    this.mesh.visible = false;
    world.scene.add(this.mesh);
    this.showS = new Spring(0, { stiffness: 300, damping: 24 });
    this.on = false;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
  }

  choose(id) {
    const W = this.world;
    if (id === 'camera') W.cameraBox.open();
    else if (id === 'note') W.quick.choose('note');
    else if (id === 'center') W.recenter();
    else if (id === 'apps') W.launcher.open(this.mesh.getWorldPosition(new THREE.Vector3()));
    this.hide();
  }

  show() {
    if (!this.on) {
      this.on = true;
      this.surface.dirty = true;
      this.place(true);
      this.world.sound.blip(this.pos, 0.6);
    }
  }

  hide() {
    this.on = false;
  }

  /** Just above the back of the left wrist, facing your eyes. */
  place(snap) {
    const hs = this.world.hands.state.left;
    if (!hs.tracked) return;
    const head = this.world.camera.getWorldPosition(new THREE.Vector3());
    const back = hs.palm.clone().negate();
    const toElbow = new THREE.Vector3().subVectors(hs.p.wrist, hs.p['middle-finger-metacarpal']).normalize();
    this.pos.copy(hs.p.wrist).addScaledVector(back, 0.03).addScaledVector(toElbow, 0.03);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(head, this.pos, UP));
    if (snap) {
      this.mesh.position.copy(this.pos);
      this.mesh.quaternion.copy(this.quat);
    }
  }

  draw(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 8);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = T.line2;
    g.lineWidth = 1;
    g.stroke();
    const d = new Date();
    text(g, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, 10, 30, { size: 26, weight: 600, color: T.ink });
    const q = this.world.lastStats && this.world.lastStats.quest;
    const bat = q && q.battery != null ? q.battery : null;
    const meta = `${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric' }).toUpperCase()}${bat != null ? ` · ${bat}%` : ''}`;
    text(g, meta, W - 10, 28, { size: 9, family: 'mono', color: (bat ?? 100) < 20 ? T.seal : T.ink3, align: 'right' });
    g.fillStyle = T.line2;
    g.fillRect(10, 40, W - 20, 2);
    g.fillStyle = (bat ?? 100) < 20 ? T.seal : T.ink2;
    g.fillRect(10, 40, (W - 20) * ((bat ?? 0) / 100), 2);
    // four touch tiles (≈ 3.5 cm each)
    const gap = 5;
    const tw = (W - 20 - gap * 3) / 4;
    const ty = 50;
    const th = H - ty - 8;
    TILES.forEach((t, i) => {
      const x = 10 + i * (tw + gap);
      cutPath(g, x, ty, tw, th, 4);
      g.fillStyle = T.bg3;
      g.fill();
      const s = 16;
      if (t.icon === 'apps') {
        g.strokeStyle = T.ink;
        g.lineWidth = 1.4;
        for (const [dx, dy] of [[-6, -6], [1, -6], [-6, 1], [1, 1]]) g.strokeRect(x + tw / 2 + dx, ty + th / 2 + dy, 5, 5);
      } else icon(g, t.icon, x + (tw - s) / 2, ty + (th - s) / 2, s, T.ink);
      ui.hit(`w:${t.id}`, x, ty, tw, th, t.id);
    });
  }

  surfaces() {
    return this.mesh.visible && this.showS.value > 0.6 ? [this.surface] : [];
  }

  interactives() {
    return this.surfaces().map((s) => s.mesh);
  }

  update(t, dt) {
    this.showS.target = this.on ? 1 : 0;
    const s = this.showS.step(dt);
    if (!this.on && s < 0.02) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.place(false);
    dampVec(this.mesh.position, this.pos, 30, dt);
    this.mesh.quaternion.slerp(this.quat, 1 - Math.exp(-24 * dt));
    this.mesh.scale.setScalar(0.6 + 0.4 * Math.min(1.05, s));
    this.surface.mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, s));
    this.surface.update(t, dt);
  }
}
