// Windows of the space, made to behave like Quest / visionOS windows:
//   - flat, crisp, facing you; they open and close on springs (a little rise, a soft settle)
//   - a grab bar and a close dot float under each window; they light up when you point at it
//   - grab the bar to move: the window follows your hand smoothly, and keeps its apparent size as it
//     comes closer or goes further (pull it near to touch it, push it away to park it)
//   - pull a bottom corner to make it bigger or smaller
//   - within reach, touch it with your fingertip (handled by input.js through Surface.locate)
// New windows line up on an arc around you, each taking its real width.
import * as THREE from 'three';
import { Surface } from './surface.js';
import { T, cutPath, icon } from './theme.js';
import { Spring, dampVec } from './spring.js';

export { setMaxAnisotropy } from './surface.js';
export const RADIUS = 1.0; // where windows open (m): within easy reading distance
// Window size (Settings › Display): compact fits comfortably in front of your face
export const WIN_SIZES = { compact: 0.68, normal: 0.85, large: 1 };
export const winScale = (world) => WIN_SIZES[(world.settings && world.settings.winSize) || 'compact'] || 0.68;
const SLOT_DEG = 31;
const GAP = 0.034; // window bottom → bar
const UP = new THREE.Vector3(0, 1, 0);

/** Base class for everything that lives in a window. */
/** The strip under a window (and under the launcher): ✕ on the left, a grip to move it. */
export function drawStrip(g, ui, W, H) {
  g.clearRect(0, 0, W, H);
  cutPath(g, 0, 0, W, H, 7);
  g.fillStyle = T.chip;
  g.fill();
  g.strokeStyle = T.line2;
  g.lineWidth = 1;
  g.stroke();
  // close
  icon(g, 'close', 15, H / 2 - 9, 18, T.ink2);
  ui.hit('close', 0, 0, 46, H);
  g.fillStyle = T.line2;
  g.fillRect(46, 9, 1, H - 18);
  // grip: two short rows of ticks, centred in the move area
  const cx = 46 + (W - 46) / 2;
  g.fillStyle = T.ink2;
  for (let i = -3; i <= 3; i++) {
    g.fillRect(cx + i * 9 - 1.5, H / 2 - 5, 3, 3);
    g.fillRect(cx + i * 9 - 1.5, H / 2 + 2, 3, 3);
  }
  ui.hit('grip', 48, 0, W - 48, H);
}

export class App {
  constructor(id, title, kanji, size = [1.0, 0.62]) {
    this.id = id;
    this.title = title;
    this.kanji = kanji;
    this.size = size;
    this.fps = 0; // > 0: redraw continuously at this rate
    this.panel = null;
    this.world = null;
  }
  draw() {}
  click() {}
  pointer() {
    return false;
  }
  opened() {}
  closed() {}
  update() {}
  invalidate() {
    if (this.panel) this.panel.surface.dirty = true;
  }
}

function pillGeometry(w, h) {
  const r = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5);
  return new THREE.ShapeGeometry(s, 10);
}

let closeTex = null;
function closeTexture() {
  if (closeTex) return closeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const cut = (k) => {
    g.beginPath();
    g.moveTo(k, 2);
    g.lineTo(126, 2);
    g.lineTo(126, 126 - k);
    g.lineTo(126 - k, 126);
    g.lineTo(2, 126);
    g.lineTo(2, k);
    g.closePath();
  };
  cut(22);
  g.fillStyle = T.chip;
  g.fill();
  g.strokeStyle = T.line2;
  g.lineWidth = 3;
  g.stroke();
  g.strokeStyle = '#ece5d6';
  g.lineWidth = 6;
  g.lineCap = 'square';
  g.beginPath();
  g.moveTo(48, 48);
  g.lineTo(80, 80);
  g.moveTo(80, 48);
  g.lineTo(48, 80);
  g.stroke();
  closeTex = new THREE.CanvasTexture(c);
  return closeTex;
}

const hidden = () => new THREE.MeshBasicMaterial({ visible: false });

export class Window {
  constructor(app, world) {
    this.app = app;
    this.world = world;
    const [w, h] = app.size;
    this.w = w;
    this.h = h;
    this.surface = new Surface(world, {
      size: app.size,
      canvasPx: app.canvasPx,
      mipmaps: app.mipmaps !== false,
      fps: app.fps,
      name: app.id,
      draw: (g, ui, W, H, t) => app.draw(g, ui, W, H, t),
      click: (id, data, p) => (id === 'close' ? world.panels.close(app) : app.click(id, data, p)),
      pointer: (kind, x, y, p) => app.pointer(kind, x, y, p),
    });
    this.surface.mesh.userData.interactive = { kind: 'surface', surface: this.surface, panel: this };
    this.group = new THREE.Group();
    this.group.add(this.surface.mesh);

    // ---- the strip under the window: ✕ on the left, a grip to move it, drawn like every surface
    // (same hover light, works with touch or pinch). Pull the grip to move the window.
    const y = -h / 2 - GAP;
    this.moveHandle = {
      kind: 'handle',
      panel: this,
      begin: (p, point) => this.beginMove(point),
      drag: (p, point) => this.dragMove(point),
      end: () => this.endMove(),
    };
    this.barHit = { userData: { interactive: this.moveHandle } }; // (older callers grab through this)
    this.strip = new Surface(world, {
      size: [0.2, 0.038],
      ss: 3,
      name: 'window-strip',
      draw: (g, ui, W, H) => this.drawStrip(g, ui, W, H),
      click: (id) => id === 'close' && world.panels.close(app),
    });
    this.strip.movable = {
      zone: (x) => x > 48,
      begin: (pt) => this.beginMove(pt),
      drag: (pt) => this.dragMove(pt),
      end: () => this.endMove(),
    };
    this.strip.mesh.position.set(0, y, 0.002);
    this.group.add(this.strip.mesh);
    // corner arcs (resize), hugging the two bottom corners from outside
    this.corners = [];
    for (const side of [-1, 1]) {
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(0.031, 0.037, 20, 1, side > 0 ? -Math.PI / 2 : Math.PI, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
      );
      arc.position.set(side * (w / 2 - 0.024), -h / 2 + 0.024, 0.002);
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), hidden());
      hit.position.set(side * (w / 2 + 0.006), -h / 2 - 0.006, 0.001);
      hit.userData.interactive = {
        kind: 'handle',
        panel: this,
        corner: true,
        begin: (p, point) => this.beginResize(point, hit),
        drag: (p, point) => this.dragResize(point),
        end: () => this.endResize(),
      };
      this.group.add(arc, hit);
      this.corners.push({ arc, hit, glow: new Spring(0, { stiffness: 240, damping: 26 }) });
    }

    // ---- motion
    this.openS = new Spring(0, { stiffness: 190, damping: 19 }); // a hint of overshoot
    this.fade = new Spring(0, { stiffness: 210, damping: 29 });
    this.engageS = new Spring(0, { stiffness: 200, damping: 26 });
    this.scale = winScale(world); // your size choice (and distance compensation)
    this.target = new THREE.Vector3();
    this.targetQ = new THREE.Quaternion();
    this.state = 'closed';
    this.slot = 0;
    this.yaw = 0;
    this.dist = RADIUS;
    this.height = 1.5;
    this.free = false; // moved by you: stays where you put it
    this.pinned = false; // not part of the arc (the tour, for example)
    this.dragging = false;
    this.resizing = false;
    this.hoverCorner = null;
    app.panel = this;
    app.world = world;
  }

  // apps reach these
  get ui() {
    return this.surface.ui;
  }
  get W() {
    return this.surface.W;
  }
  get H() {
    return this.surface.H;
  }
  set dirty(v) {
    this.surface.dirty = v;
  }
  get dirty() {
    return this.surface.dirty;
  }

  headPos() {
    return this.world.camera.getWorldPosition(new THREE.Vector3());
  }

  /** Where the window should be, facing `head` (+z toward your eyes). */
  setTarget(pos, head) {
    this.target.copy(pos);
    const m = new THREE.Matrix4().lookAt(head, pos, UP);
    this.targetQ.setFromRotationMatrix(m);
  }

  snapToTarget() {
    this.group.position.copy(this.target);
    this.group.quaternion.copy(this.targetQ);
  }

  // ---- move: grab the bar
  /** Grab at `point` (the bar, or anywhere on the title area): that spot stays under your hand. */
  beginMove(point) {
    const head = this.headPos();
    this.dragging = true;
    this.free = true;
    const inv = this.group.quaternion.clone().invert();
    this.mv = {
      s0: this.scale,
      d0: Math.max(0.15, point.distanceTo(head)),
      off: this.group.position.clone().sub(point).applyQuaternion(inv).divideScalar(this.scale),
    };
    this.world.sound.click(point);
  }
  dragMove(point) {
    const head = this.headPos();
    const d = Math.max(0.15, point.distanceTo(head));
    // same apparent size at any distance (visionOS): closer = smaller, further = bigger
    this.scale = THREE.MathUtils.clamp((this.mv.s0 * d) / this.mv.d0, 0.22, 3);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(head, point, UP));
    const center = point.clone().add(this.mv.off.clone().multiplyScalar(this.scale).applyQuaternion(q));
    this.setTarget(center, head);
  }
  endMove() {
    this.dragging = false;
    this.dist = this.target.distanceTo(this.headPos());
  }

  // ---- resize: pull a bottom corner
  beginResize(point, hit) {
    this.resizing = true;
    this.rsCorner = hit;
    this.rs = { s0: this.scale, r0: Math.max(0.03, point.distanceTo(this.group.position)) };
    this.world.sound.click(point);
  }
  dragResize(point) {
    const r = point.distanceTo(this.group.position);
    this.scale = THREE.MathUtils.clamp((this.rs.s0 * r) / this.rs.r0, 0.22, 3);
    this.world.panels.layoutSoon();
  }
  endResize() {
    this.resizing = false;
    this.rsCorner = null;
  }

  drawStrip(g, ui, W, H) {
    drawStrip(g, ui, W, H);
  }


  interactives() {
    // an app may float extra parts with its window (the PC screen's bar)
    const extra = this.app.extraSurfaces ? this.app.extraSurfaces().map((s) => s.mesh) : [];
    return [this.surface.mesh, this.strip.mesh, this.corners[0].hit, this.corners[1].hit, ...extra];
  }

  update(t, dt) {
    const open = this.state === 'open';
    this.openS.target = open ? 1 : 0;
    this.fade.target = open ? 1 : 0;
    const e = this.openS.step(dt);
    const f = Math.max(0, Math.min(1, this.fade.step(dt)));
    dampVec(this.group.position, this.target, this.dragging ? 18 : 9, dt);
    this.group.quaternion.slerp(this.targetQ, 1 - Math.exp(-(this.dragging ? 16 : 9) * dt));
    this.group.scale.setScalar(this.scale * (0.88 + 0.12 * e));
    this.surface.mat.uniforms.uOpacity.value = f;
    // chrome: faint at rest, clear when you point at the window or hold it
    const engaged = this.surface.hovers > 0 || this.strip.hovers > 0 || this.dragging || this.resizing || this.chromeHover > 0;
    this.engageS.target = engaged ? 1 : 0;
    const k = Math.max(0, this.engageS.step(dt)) * f;
    // the strip: quiet at rest, clear when the window is in use
    this.strip.mat.uniforms.uOpacity.value = (0.45 + 0.55 * Math.max(k, this.dragging ? 1 : 0)) * f;
    this.strip.update(t, dt);
    for (const c of this.corners) {
      c.glow.target = this.hoverCorner === c.hit || this.rsCorner === c.hit ? 1 : 0;
      c.arc.material.opacity = Math.max(0, c.glow.step(dt)) * 0.9 * f;
    }
    this.surface.update(t, dt);
    this.app.update(t, dt);
    if (this.state === 'closing' && f < 0.02) {
      this.state = 'closed';
      this.group.removeFromParent();
    }
  }
}

/** Opens, places, moves and closes windows. */
export class Panels {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.panels = new Map();
    this.head = new THREE.Vector3(0, 1.55, 0);
    this.baseYaw = 0;
    this.needLayout = false;
  }

  get(app) {
    if (!this.panels.has(app.id)) this.panels.set(app.id, new Window(app, this.world));
    return this.panels.get(app.id);
  }

  isOpen(app) {
    const p = this.panels.get(app.id);
    return !!p && p.state === 'open';
  }

  /** The arc's centre: where your head is, facing where you look (yaw only). */
  anchorTo(camera) {
    const e = camera.matrixWorld.elements;
    this.head.set(e[12], e[13], e[14]);
    this.baseYaw = Math.atan2(e[8], e[10]);
  }

  arcPoint(yaw, dist, height) {
    return new THREE.Vector3(this.head.x - Math.sin(yaw) * dist, height, this.head.z - Math.cos(yaw) * dist);
  }

  place(panel, slot, { height = 0, dist = RADIUS } = {}) {
    panel.slot = slot;
    panel.yaw = this.baseYaw - THREE.MathUtils.degToRad(SLOT_DEG * slot);
    panel.dist = dist;
    panel.height = this.head.y - 0.08 + height;
    panel.free = false;
    panel.setTarget(this.arcPoint(panel.yaw, dist, panel.height), this.head);
  }

  layoutSoon() {
    this.needLayout = true;
  }

  /** Windows on the arc sit side by side in slot order, each taking its real (scaled) width. */
  layout(snap = []) {
    this.needLayout = false;
    const arc = [...this.panels.values()].filter((p) => p.state === 'open' && !p.pinned && !p.free);
    const gap = THREE.MathUtils.degToRad(2.5);
    const cell = THREE.MathUtils.degToRad(SLOT_DEG);
    const half = (p) => (p.w * p.scale) / (2 * p.dist);
    const at = new Map(arc.map((p) => [p.slot, p]));
    const centre = at.get(0);
    if (centre) centre.yaw = this.baseYaw;
    for (const side of [1, -1]) {
      let edge = centre ? half(centre) : cell / 2;
      const far = Math.max(0, ...[...at.keys()].filter((k) => Math.sign(k) === side).map(Math.abs));
      for (let i = 1; i <= far; i++) {
        const p = at.get(i * side);
        if (!p) {
          edge += gap + cell;
          continue;
        }
        const off = edge + gap + half(p);
        p.yaw = this.baseYaw - side * off;
        edge = off + half(p);
      }
    }
    for (const p of arc) p.setTarget(this.arcPoint(p.yaw, p.dist, p.height), this.head);
    for (const p of snap) p.snapToTarget();
  }

  freeSlot(except) {
    const open = [...this.panels.values()].filter((p) => p !== except && p.state === 'open' && !p.pinned && !p.free);
    const used = new Set(open.map((p) => p.slot));
    for (const s of [0, -1, 1, -2, 2, -3, 3]) if (!used.has(s)) return s;
    const oldest = open.sort((a, b) => a.openedAt - b.openedAt)[0];
    this.close(oldest.app);
    return oldest.slot;
  }

  freeSlotExcept(taken) {
    const used = new Set([...this.panels.values()].filter((p) => p.state === 'open' && !p.pinned && !p.free).map((p) => p.slot));
    used.add(taken);
    for (const s of [0, -1, 1, -2, 2, -3, 3]) if (!used.has(s)) return s;
    return taken + 1;
  }

  /** opts: slot, height, dist, pinned, scale, at (a world point: open right there, facing you). */
  open(app, opts = {}) {
    const p = this.get(app);
    if (p.state === 'open') {
      this.world.sound.tick(p.group.position);
      return p;
    }
    const wasClosed = p.state === 'closed';
    if (!p.group.parent) this.root.add(p.group);
    p.state = 'open'; // before the layout, so it takes its place among the others
    p.pinned = !!opts.pinned;
    p.scale = opts.scale || winScale(this.world); // the size chosen in Settings
    if (opts.at) {
      p.free = true;
      p.setTarget(opts.at, this.world.camera.getWorldPosition(new THREE.Vector3()));
    } else {
      const slot = opts.slot ?? this.freeSlot(p);
      if (opts.slot !== undefined && !opts.pinned) for (const q of this.panels.values()) if (q !== p && q.state === 'open' && q.slot === slot && !q.pinned && !q.free) q.slot = this.freeSlotExcept(slot);
      this.place(p, slot, opts);
      if (!p.pinned) this.layout();
    }
    if (wasClosed) {
      // rise softly into place
      p.snapToTarget();
      p.group.position.y -= 0.04;
      p.openS.set(0);
      p.fade.set(0);
    }
    p.openedAt = performance.now();
    p.surface.dirty = true;
    app.opened();
    this.world.sound.open(p.target);
    return p;
  }

  close(app) {
    const p = this.panels.get(app.id);
    if (!p || p.state !== 'open') return;
    p.state = 'closing';
    p.dragging = p.resizing = false;
    app.closed();
    // a keyboard typing into this window goes with it
    const kb = this.world.keyboard;
    if (kb && kb.target === app) kb.hide();
    this.world.sound.close(p.group.position);
  }

  toggle(app, opts) {
    return this.isOpen(app) ? this.close(app) : this.open(app, opts);
  }

  /** Bring a window to the centre of the arc. */
  focus(app) {
    const p = this.open(app);
    if (p.free || p.slot !== 0) {
      for (const q of this.panels.values()) if (q !== p && q.state === 'open' && q.slot === 0 && !q.pinned && !q.free) q.slot = p.slot;
      p.slot = 0;
      p.free = false;
      p.dist = RADIUS;
      p.height = this.head.y - 0.08;
    }
    this.layout();
    return p;
  }

  /** Swipe: turn everything around you by one window's width (placed windows turn with it). */
  rotate(dir) {
    const head = this.world.camera.getWorldPosition(new THREE.Vector3());
    const a = -THREE.MathUtils.degToRad(SLOT_DEG) * dir;
    for (const p of this.panels.values()) {
      if (p.state !== 'open' || p.pinned) continue;
      if (p.free) {
        const pos = p.target.clone().sub(head).applyAxisAngle(UP, a).add(head);
        p.setTarget(pos, head);
      } else p.slot += dir;
    }
    this.layout();
  }

  /** Everything back in front of you, at a comfortable distance and size. */
  recenter(camera) {
    this.anchorTo(camera);
    const arc = this.openWindows().filter((p) => !p.pinned);
    // keep their left-to-right order, centred in front of you, one slot each
    const yawOf = (p) => Math.atan2(-(p.target.x - this.head.x), -(p.target.z - this.head.z));
    const rel = (p) => Math.atan2(Math.sin(yawOf(p) - this.baseYaw), Math.cos(yawOf(p) - this.baseYaw));
    arc.sort((a, b) => rel(b) - rel(a));
    const start = -Math.floor((arc.length - 1) / 2);
    arc.forEach((p, i) => {
      p.slot = start + i;
      p.free = false;
      p.dist = RADIUS;
      p.height = this.head.y - 0.08;
      if (p.scale < 0.6) p.scale = winScale(this.world);
    });
    this.layout();
  }

  /** The window you are pushing toward: the one closest to the push direction (within ~25°). */
  pushTarget(from, dir) {
    let best = null;
    let bestAng = THREE.MathUtils.degToRad(25);
    for (const p of this.openWindows()) {
      if (p.pinned) continue;
      const to = p.group.position.clone().sub(from);
      if (to.length() > 5) continue;
      const ang = to.angleTo(dir);
      if (ang < bestAng) {
        bestAng = ang;
        best = p;
      }
    }
    return best;
  }

  /** Pushed away: the window glides off in the push direction while it fades and closes. */
  pushAway(app, dir) {
    const p = this.panels.get(app.id);
    if (!p || p.state !== 'open') return;
    p.free = true;
    p.target.addScaledVector(dir, 0.9);
    this.close(app);
  }

  closeAll(except) {
    for (const p of this.panels.values()) if (p.state === 'open' && p.app !== except) this.close(p.app);
  }

  openWindows() {
    return [...this.panels.values()].filter((p) => p.state === 'open');
  }

  interactives() {
    const out = [];
    for (const p of this.openWindows()) out.push(...p.interactives());
    return out;
  }

  /** Surfaces you can touch with a fingertip. */
  surfaces() {
    const out = [];
    for (const p of this.openWindows()) {
      out.push(p.surface, p.strip);
      if (p.app.extraSurfaces) out.push(...p.app.extraSurfaces());
    }
    return out;
  }

  update(t, dt) {
    if (this.needLayout) this.layout();
    for (const p of this.panels.values()) if (p.state !== 'closed') p.update(t, dt);
  }
}
