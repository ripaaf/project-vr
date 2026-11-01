// The launcher. A small "Apps" tab rests below your windows, 1.25 m away — out of your hands' way,
// so you never press it by accident; it stays put (it moves only when you center the windows).
// Pinch it (or raise a palm, or tap your watch) and the launcher opens in front of you, within reach:
// eight apps, each with a plain icon, its name and one line saying what it is for.
import * as THREE from 'three';
import { Surface } from '../surface.js';
import { Spring, dampVec } from '../spring.js';
import { T, text, mono, cutPath, icon, button, hairline, paragraph } from '../theme.js';
import { drawStrip } from '../panels.js';

export const APPS = [
  { app: 'notes', icon: 'notes', label: 'Notes', desc: 'Write, sketch, 3D' },
  { app: 'files', icon: 'files', label: 'Files', desc: 'Quest and PC' },
  { app: 'gal', icon: 'photos', label: 'Photos', desc: 'What you captured' },
  { action: 'camera', icon: 'camera', label: 'Camera', desc: 'Frame and snap' },
  { app: 'models', icon: 'cube', label: 'Studio', desc: 'Models and scans' },
  { app: 'web', icon: 'globe', label: 'Web', desc: 'Sites and YouTube' },
  { app: 'pc', icon: 'pc', label: 'PC screen', desc: 'Your desktop', pc: true },
  { app: 'term', icon: 'terminal', label: 'Terminal', desc: 'Headset shell' },
  { app: 'dev', icon: 'devices', label: 'Devices', desc: 'ESP32, Cardputer', pc: true },
  { app: 'set', icon: 'settings', label: 'Settings', desc: 'Space, gestures' },
];
/** The small keys in the header (their name shows while you point at them). */
const HEAD = [
  { id: 'room', icon: 'room' },
  { id: 'center', icon: 'center' },
  { id: 'guide', icon: 'guide', tip: 'Guide: how everything works' },
  { id: 'close', icon: 'close', tip: 'Close' },
];
const UP = new THREE.Vector3(0, 1, 0);
const PANEL = [0.6, 0.37];

export class Launcher {
  constructor(world) {
    this.world = world;
    // the resting tab
    this.tab = new Surface(world, { size: [0.16, 0.04], ss: 3, name: 'home', fps: 0.5, draw: (g, ui, W, H) => this.drawTab(g, ui, W, H), click: () => this.toggle() });
    this.group = new THREE.Group();
    this.group.add(this.tab.mesh);
    this.group.visible = false;
    world.scene.add(this.group);
    // the launcher itself
    this.panel = new Surface(world, { size: PANEL, ss: 2, name: 'launcher', fps: 0.5, draw: (g, ui, W, H) => this.drawPanel(g, ui, W, H), click: (id, data) => this.choose(id, data) });
    this.panelGroup = new THREE.Group();
    this.panelGroup.add(this.panel.mesh);
    this.panelGroup.visible = false;
    world.scene.add(this.panelGroup);
    // the same strip as under every window: ✕ closes the launcher, the grip moves it
    this.strip = new Surface(world, { size: [0.2, 0.038], ss: 3, name: 'launcher-strip', draw: (g, ui, W, H) => drawStrip(g, ui, W, H), click: (id) => id === 'close' && this.collapse() });
    this.strip.mesh.position.set(0, -PANEL[1] / 2 - 0.032, 0.002);
    this.panelGroup.add(this.strip.mesh);
    // the size corner (bottom right): pull it to make the menu smaller or a little bigger
    this.userScale = (world.settings && world.settings.appsScale) || 0.8;
    this.corner = new THREE.Group();
    const cornerLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.04, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.04, 0)]),
      new THREE.LineBasicMaterial({ color: 0xe2472c })
    );
    this.cornerHit = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.corner.add(cornerLine, this.cornerHit);
    this.corner.position.set(PANEL[0] / 2 + 0.008, -PANEL[1] / 2 - 0.008, 0.003);
    this.panelGroup.add(this.corner);
    this.cornerHit.userData.interactive = {
      kind: 'handle',
      begin: (p, pt) => {
        const c = this.panelGroup.getWorldPosition(new THREE.Vector3());
        this.sizing = { c, s0: this.userScale, d0: Math.max(0.03, pt.distanceTo(c)) };
      },
      drag: (p, pt) => {
        const z = this.sizing;
        if (z) this.userScale = THREE.MathUtils.clamp((z.s0 * pt.distanceTo(z.c)) / z.d0, 0.6, 1.05);
        this.lastTouch = performance.now();
      },
      end: () => {
        this.sizing = null;
        if (this.world.settings) {
          this.world.settings.appsScale = Math.round(this.userScale * 100) / 100;
          this.world.saveSettings && this.world.saveSettings();
        }
      },
    };
    // drag the tab anywhere; drag the launcher by its header
    this.tab.movable = {
      begin: (pt) => (this.grab = { off: this.group.position.clone().sub(pt) }),
      drag: (pt) => this.moveGroup(this.group, pt.clone().add(this.grab.off)),
      end: () => (this.tabMoved = true),
    };
    this.panel.movable = {
      zone: (x, y) => y < 64 && x < 660 - HEAD.length * 54 - 20,
      begin: (pt) => (this.grab = { off: this.panelGroup.position.clone().sub(pt) }),
      drag: (pt) => {
        this.pos.copy(pt).add(this.grab.off);
        this.moveGroup(this.panelGroup, this.pos);
      },
      end: () => {},
    };
    this.strip.movable = { zone: (x) => x > 48, begin: this.panel.movable.begin, drag: this.panel.movable.drag, end: () => {} };
    this.expanded = false;
    this.openS = new Spring(0, { stiffness: 260, damping: 24 });
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.anchorYaw = null; // (kept for older callers)
    this.atHand = null;
    this.lastTouch = 0;
  }

  start() {
    this.group.visible = true;
    this.place();
  }

  stop() {
    this.group.visible = false;
    this.expanded = false;
    this.panelGroup.visible = false;
  }

  moveGroup(group, pos) {
    const head = this.headPos();
    group.position.copy(pos);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(head, pos, UP));
    if (group === this.panelGroup) this.quat.copy(group.quaternion);
  }

  /** The tab rests under the centre of your windows (unless you moved it). */
  place(force) {
    if (this.tabMoved && !force) return;
    this.tabMoved = false;
    const P = this.world.panels;
    const dir = new THREE.Vector3(-Math.sin(P.baseYaw), 0, -Math.cos(P.baseYaw));
    const pos = P.head.clone().addScaledVector(dir, 1.0).add(new THREE.Vector3(0, -0.55, 0));
    this.group.position.copy(pos);
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(P.head, pos, UP));
  }

  headPos() {
    return this.world.camera.getWorldPosition(new THREE.Vector3());
  }

  /** Open in front of you (toward `at`, your hand, when given), within reach. */
  open(at) {
    const head = this.headPos();
    let dir;
    if (at) dir = new THREE.Vector3(at.x - head.x, 0, at.z - head.z);
    else dir = new THREE.Vector3(0, 0, -1).transformDirection(this.world.camera.matrixWorld).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const y = at ? THREE.MathUtils.clamp(at.y + 0.1, head.y - 0.36, head.y - 0.06) : head.y - 0.17;
    this.pos.copy(head).addScaledVector(dir, 0.62).setY(y);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(head, this.pos, UP));
    this.panelGroup.position.copy(this.pos).add(new THREE.Vector3(0, -0.03, 0));
    this.panelGroup.quaternion.copy(this.quat);
    this.openS.set(0);
    this.expanded = true;
    this.lastTouch = performance.now();
    this.panel.dirty = true;
    this.world.sound.open(this.pos);
    this.world.emit('launcher', {});
  }

  toggle(at) {
    if (this.expanded) this.collapse();
    else this.open(at);
  }

  summon(at) {
    this.open(at);
  }

  collapse() {
    if (!this.expanded) return;
    this.expanded = false;
    this.world.sound.close(this.pos);
  }

  choose(id, data) {
    const W = this.world;
    this.lastTouch = performance.now();
    if (id === 'close') return this.collapse();
    if (id === 'guide') {
      W.panels.open(W.apps.tour, { pinned: false });
      return this.collapse();
    }
    if (id === 'room') {
      W.setMode(W.env.mode === 'void' ? 'room' : 'void');
      this.panel.dirty = true;
      return;
    }
    if (id === 'center') {
      W.recenter();
      return this.collapse();
    }
    if (!data) return;
    if (data.action === 'camera') W.cameraBox.open();
    else if (data.action === 'scan') {
      if (W.scanner) W.scanner.open();
    } else if (data.app && W.apps[data.app]) {
      const app = W.apps[data.app];
      if (W.panels.isOpen(app)) W.panels.focus(app);
      else W.panels.open(app, data.app === 'tour' ? { pinned: false } : undefined);
    }
    if (!W.settings.keepApps) this.collapse();
  }

  clock() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  drawTab(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 7);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = this.expanded ? T.ink2 : T.line2;
    g.lineWidth = 1;
    g.stroke();
    // a 2 × 2 grid mark, "Apps", a hairline, the time
    g.strokeStyle = this.expanded ? T.seal : T.ink;
    g.lineWidth = 1.6;
    for (const [dx, dy] of [[0, 0], [9, 0], [0, 9], [9, 9]]) g.strokeRect(16 + dx, H / 2 - 8 + dy, 6, 6);
    text(g, 'Apps', 44, H / 2 + 7, { size: 19, weight: 600, color: T.ink });
    g.fillStyle = T.line2;
    g.fillRect(W - 66, 10, 1, H - 20);
    text(g, this.clock(), W - 12, H / 2 + 6, { size: 15, family: 'mono', color: T.ink3, align: 'right' });
    ui.hit('tab', 0, 0, W, H);
  }

  drawPanel(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 12);
    g.fillStyle = T.bg;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = T.line2;
    g.stroke();
    const W_ = this.world;
    // header: name and status (or the name of the key you point at), then the small keys
    g.fillStyle = T.seal;
    g.fillRect(22, 27, 8, 8);
    text(g, 'Apps', 40, 38, { size: 21, weight: 600, color: T.ink });
    const hov = HEAD.find((h) => h.id === this.panel.hoverId);
    const tipOf = (h) => h.tip || (h.id === 'room' ? (W_.env.mode === 'void' ? 'Show my room' : 'Hide my room (void)') : 'Bring windows in front');
    const q = W_.lastStats && W_.lastStats.quest;
    const status = hov ? tipOf(hov) : [this.clock(), q && q.battery != null ? `${q.battery}%` : null].filter(Boolean).join('  ·  ');
    text(g, status, 102, 37, { size: 15, family: hov ? 'ui' : 'mono', weight: hov ? 600 : 400, color: hov ? T.ink : T.ink3, max: W - HEAD.length * 54 - 130 });
    HEAD.forEach((h, i) => {
      const x = W - 14 - (HEAD.length - i) * 54;
      const on = this.panel.hoverId === h.id;
      if (on) {
        cutPath(g, x + 2, 10, 50, 44, 5);
        g.fillStyle = T.bg3;
        g.fill();
      }
      icon(g, h.icon, x + 15, 20, 24, h.id === 'room' && W_.env.mode === 'void' ? T.seal : on ? T.ink : T.ink2);
      ui.hit(h.id, x, 6, 54, 52);
    });
    hairline(g, 0, 64, W);
    // apps: 5 × 2
    const cols = 5;
    const pad = 16;
    const gap = 8;
    const tw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const th = (H - 64 - pad * 2 - gap) / 2;
    APPS.forEach((a, i) => {
      const x = pad + (i % cols) * (tw + gap);
      const y = 64 + pad + Math.floor(i / cols) * (th + gap);
      cutPath(g, x, y, tw, th, 7);
      g.fillStyle = T.bg2;
      g.fill();
      // without the PC, what needs it is quieter (it still explains itself)
      const away = W_.standalone && a.pc;
      g.globalAlpha = away ? 0.4 : 1;
      icon(g, a.icon, x + 14, y + 16, 26, T.ink);
      if (a.app && W_.apps[a.app] && W_.panels.isOpen(W_.apps[a.app])) {
        g.fillStyle = T.seal;
        g.fillRect(x + tw - 16, y + 12, 6, 6);
      }
      text(g, a.label, x + 14, y + th - 34, { size: 18, weight: 600, color: T.ink, max: tw - 22 });
      text(g, away ? 'Needs your PC' : a.desc, x + 14, y + th - 13, { size: 13, color: T.ink3, max: tw - 22 });
      g.globalAlpha = 1;
      ui.hit(`app:${i}`, x, y, tw, th, a);
    });
  }

  interactives() {
    if (!this.group.visible) return [];
    return this.expanded ? [this.tab.mesh, this.panel.mesh, this.strip.mesh, this.cornerHit] : [this.tab.mesh];
  }

  surfaces() {
    if (!this.group.visible) return [];
    return this.expanded && this.openS.value > 0.6 ? [this.tab, this.panel, this.strip] : [this.tab];
  }

  update(t, dt) {
    if (!this.group.visible) return;
    this.openS.target = this.expanded ? 1 : 0;
    const e = Math.max(0, this.openS.step(dt));
    this.panelGroup.visible = e > 0.01;
    if (this.panelGroup.visible) {
      dampVec(this.panelGroup.position, this.pos, 12, dt);
      this.panelGroup.scale.setScalar(this.userScale * (0.92 + 0.08 * Math.min(1.04, e))); // your size (corner), easing in
      this.panel.mat.uniforms.uOpacity.value = Math.min(1, e);
      if (this.panel.hoverId !== this.lastHover) {
        this.lastHover = this.panel.hoverId;
        this.panel.dirty = true;
      }
      this.panel.update(t, dt);
      this.strip.mat.uniforms.uOpacity.value = Math.min(1, e) * (this.strip.hovers > 0 ? 1 : 0.75);
      this.strip.update(t, dt);
      if (this.panel.hovers > 0 || this.strip.hovers > 0) this.lastTouch = performance.now();
      // a launcher you forgot about folds away by itself
      if (this.expanded && !this.world.settings.keepApps && performance.now() - this.lastTouch > 20000) this.collapse();
    }
    this.tab.mat.uniforms.uOpacity.value = this.tab.hovers > 0 || this.expanded ? 1 : 0.7;
    this.tab.update(t, dt);
  }
}
