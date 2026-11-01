// The quick ring: raise your palm (or press A / X on a controller) and six tiles fan out on an arc
// above your hand — Camera · New note · All apps · Gather charms · Center · Room/Void. Point at one (or touch it) —
// it fills with ink and its name shows at the hub; pinch / trigger to choose. It stays where it opened
// until you choose, point elsewhere and pinch, or leave it for a few seconds.
import * as THREE from 'three';
import { Surface } from './surface.js';
import { Spring, dampVec } from './spring.js';
import { T, icon, hudTag, mono, cutPath, FONT } from './theme.js';

const ITEMS = [
  { id: 'camera', icon: 'camera', label: 'Camera' },
  { id: 'note', icon: 'notes', label: 'New note' },
  { id: 'apps', icon: 'apps', label: 'All apps' },
  { id: 'gather', icon: 'gather', label: 'Gather charms' },
  { id: 'center', icon: 'center', label: 'Center' },
  { id: 'room', icon: 'room', label: 'Room / void' },
];
const UP = new THREE.Vector3(0, 1, 0);
const SIZE = [0.4, 0.26];

export class QuickRing {
  constructor(world) {
    this.world = world;
    this.surface = new Surface(world, {
      size: SIZE,
      ss: 2,
      name: 'quick',
      draw: (g, ui, W, H) => this.draw(g, ui, W, H),
      click: (id, data) => this.choose(data),
    });
    this.mesh = this.surface.mesh;
    this.mesh.visible = false;
    this.mesh.renderOrder = 22;
    world.scene.add(this.mesh);
    this.open_ = false;
    this.show = new Spring(0, { stiffness: 320, damping: 24 });
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.lastHover = null;
    this.openedAt = 0;
  }

  get isOpen() {
    return this.open_;
  }

  /** Open just above `at` (your palm or controller), facing you, never closer than 0.45 m. */
  open(at) {
    const head = this.world.camera.getWorldPosition(new THREE.Vector3());
    const p = (at ? at.clone() : head.clone().add(new THREE.Vector3(0, -0.2, -0.5).applyQuaternion(this.world.camera.getWorldQuaternion(new THREE.Quaternion())))).add(new THREE.Vector3(0, 0.1, 0));
    // never closer than 0.45 m: slide it away from your eyes along the line through your hand
    const off = p.clone().sub(head);
    if (off.length() < 0.45) p.copy(head).add(off.lengthSq() > 1e-6 ? off.setLength(0.45) : new THREE.Vector3(0, -0.15, -0.42).applyQuaternion(this.world.camera.getWorldQuaternion(new THREE.Quaternion())));
    this.pos.copy(p);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(head, p, UP));
    this.mesh.position.copy(p);
    this.mesh.quaternion.copy(this.quat);
    this.show.set(0);
    this.open_ = true;
    this.openedAt = performance.now();
    this.surface.dirty = true;
    this.world.sound.open(p);
  }

  close() {
    if (!this.open_) return;
    this.open_ = false;
    this.world.sound.close(this.pos);
  }

  toggle(at) {
    if (this.open_) this.close();
    else this.open(at);
  }

  choose(id) {
    const W = this.world;
    this.close();
    if (id === 'camera') W.cameraBox.open();
    else if (id === 'note') {
      const notes = W.apps.notes;
      if (W.panels.isOpen(notes)) notes.create();
      else {
        notes.newOnOpen = true;
        W.panels.open(notes);
      }
    } else if (id === 'apps') W.launcher.open(this.pos);
    else if (id === 'gather') W.charms.gather();
    else if (id === 'center') W.recenter();
    else if (id === 'room') W.setMode(W.env.mode === 'void' ? 'room' : 'void');
  }

  /** Tile centres on an arc (canvas pixels). */
  layout(W, H) {
    const cx = W / 2;
    const cy = H - 34;
    const r = 186;
    return ITEMS.map((it, i) => {
      const a = Math.PI * (0.92 - (i / (ITEMS.length - 1)) * 0.84);
      return { ...it, x: cx + Math.cos(a) * r, y: cy - Math.sin(a) * r };
    });
  }

  draw(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H - 34;
    const tiles = this.layout(W, H);
    const hover = this.surface.hoverId ? this.surface.hoverId.slice(2) : null;
    // the arcs: reach (dashed), track, and the seal arc under the pointed tile
    g.strokeStyle = T.line;
    g.lineWidth = 1.5;
    g.setLineDash([3, 9]);
    g.beginPath();
    g.arc(cx, cy, 214, Math.PI * 1.04, Math.PI * 1.96);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = T.line2;
    g.beginPath();
    g.arc(cx, cy, 186, Math.PI * 1.06, Math.PI * 1.94);
    g.stroke();
    tiles.forEach((t, i) => {
      if (t.id !== hover) return;
      const a = Math.PI * (0.92 - (i / (ITEMS.length - 1)) * 0.84);
      // a seal arc inside the ring, under the tile you point at
      g.strokeStyle = T.seal;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(cx, cy, 128, -a - 0.2, -a + 0.2);
      g.stroke();
    });
    g.fillStyle = T.ink;
    g.fillRect(cx - 5, cy - 5, 10, 10);
    // tiles
    const s = 74;
    for (const t of tiles) {
      const on = t.id === hover;
      cutPath(g, t.x - s / 2, t.y - s / 2, s, s, 8);
      g.fillStyle = on ? T.ink : T.chip;
      g.fill();
      g.strokeStyle = on ? T.ink : T.line2;
      g.lineWidth = 1.5;
      g.stroke();
      if (t.iconName === 'apps') {
        // a 2 × 2 grid for "all apps"
        g.strokeStyle = on ? T.bgSolid : T.ink;
        g.lineWidth = 2.2;
        for (const [dx, dy] of [[-10, -10], [3, -10], [-10, 3], [3, 3]]) g.strokeRect(t.x + dx, t.y + dy, 8, 8);
      } else icon(g, t.icon, t.x - 16, t.y - 16, 32, on ? T.bgSolid : T.ink);
      ui.hit(`q:${t.id}`, t.x - s / 2 - 4, t.y - s / 2 - 4, s + 8, s + 8, t.id);
    }
    // hub: the name of what you point at
    const label = hover ? ITEMS.find((i) => i.id === hover).label : 'quick';
    g.font = `600 17px ${FONT.mono}`;
    const tw = g.measureText(label.toUpperCase()).width + 19;
    hudTag(g, cx - tw / 2, cy - 74, label, { variant: hover ? 'ink' : 'line', size: 17 });
  }

  interactives() {
    return this.open_ ? [this.mesh] : [];
  }

  surfaces() {
    return this.open_ && this.show.value > 0.5 ? [this.surface] : [];
  }

  update(t, dt) {
    this.show.target = this.open_ ? 1 : 0;
    const s = this.show.step(dt);
    if (!this.open_ && s < 0.02) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.scale.setScalar(0.8 * (0.7 + 0.3 * Math.min(1.05, s))); // a little smaller than a window
    this.surface.mat.uniforms.uOpacity.value = Math.max(0, Math.min(1, s));
    // redraw when the pointed tile changes (the hub label follows it)
    if (this.surface.hoverId !== this.lastHover) {
      this.lastHover = this.surface.hoverId;
      this.surface.dirty = true;
    }
    if (this.surface.hovers > 0) this.openedAt = performance.now();
    if (this.open_ && performance.now() - this.openedAt > 6000) this.close();
    this.surface.update(t, dt);
  }
}
