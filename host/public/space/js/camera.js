// Camera: a viewfinder you make with your hands.
//   - make an L with each hand: a frame appears between them and follows your hands live —
//     corner brackets, a thirds grid, everything outside it dimmed, so you see exactly what you get
//   - curl one index finger (keep the thumbs up) to click the shutter
//   - or let go: the frame stays where it is; drag its corners to resize, its top edge to move it,
//     and press ◉ under it to snap (✕ to put it away)
// Photos are what the headset shows (passthrough included), cropped to the frame on the PC.
import * as THREE from 'three';
import { Surface } from './surface.js';
import { Spring, dampVec } from './spring.js';
import { T, text, mono, cutPath } from './theme.js';

const UP = new THREE.Vector3(0, 1, 0);
const quad = (color, opacity) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false }));
  m.renderOrder = 25;
  return m;
};

export class Camera {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.visible = false;
    world.scene.add(this.group);
    this.w = 0.42;
    this.h = 0.3;
    this.state = 'idle'; // idle | framing | placed
    this.show = new Spring(0, { stiffness: 260, damping: 24 });
    this.target = new THREE.Vector3();
    this.targetQ = new THREE.Quaternion();
    // dim everything outside the frame
    this.mask = [0, 1, 2, 3].map(() => quad(0x000000, 0.42));
    // hairline border, thirds grid, bold corner brackets
    this.border = [0, 1, 2, 3].map(() => quad(0xece5d6, 0.5));
    this.grid = [0, 1, 2, 3].map(() => quad(0xece5d6, 0.16));
    this.brackets = Array.from({ length: 8 }, () => quad(0xece5d6, 0.95));
    this.group.add(...this.mask, ...this.border, ...this.grid, ...this.brackets);
    // handles: four corners (resize) and the top edge (move)
    this.handles = [];
    for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.interactive = {
        kind: 'handle',
        begin: () => this.world.sound.click(hit.getWorldPosition(new THREE.Vector3())),
        drag: (p, point) => this.resizeTo(point),
        end: () => {},
      };
      hit.userData.corner = [sx, sy];
      this.handles.push(hit);
    }
    this.edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.edge.userData.interactive = {
      kind: 'handle',
      begin: (p, point) => (this.grabOff = this.group.position.clone().sub(point)),
      drag: (p, point) => this.moveTo(point.clone().add(this.grabOff)),
      end: () => {},
    };
    this.group.add(...this.handles, this.edge);
    // controls under the frame: close · shutter · whole view
    this.controls = new Surface(world, {
      size: [0.2, 0.06],
      ss: 2.2,
      name: 'camera',
      draw: (g, ui, W, H) => this.drawControls(g, ui, W, H),
      click: (id) => {
        if (id === 'snap') this.snap();
        else if (id === 'close') this.close();
        else if (id === 'full') this.world.photo(null);
      },
    });
    this.controls.mesh.renderOrder = 26;
    this.group.add(this.controls.mesh);
    // the hint above the frame
    this.hint = new Surface(world, { size: [0.46, 0.04], ss: 2, name: 'camera-hint', draw: (g, ui, W, H) => this.drawHint(g, W, H) });
    this.hint.mesh.renderOrder = 26;
    this.group.add(this.hint.mesh);
    this.idleSince = 0;
  }

  get visible() {
    return this.state !== 'idle';
  }

  drawControls(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 16);
    g.fillStyle = T.chip;
    g.fill();
    const b = (id, x, w, draw) => {
      ui.hit(id, x, 0, w, H);
      draw(x + w / 2, H / 2);
    };
    b('close', 0, 60, (cx, cy) => text(g, '✕', cx, cy + 9, { size: 26, color: T.ink2, align: 'center' }));
    b('snap', 66, 88, (cx, cy) => {
      g.strokeStyle = T.ink;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, cy, 23, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = T.seal;
      g.beginPath();
      g.arc(cx, cy, 16, 0, Math.PI * 2);
      g.fill();
    });
    b('full', 160, 60, (cx, cy) => mono(g, 'all', cx, cy + 7, { size: 17, color: T.ink2, align: 'center' }));
  }

  drawHint(g, W, H) {
    g.clearRect(0, 0, W, H);
    const s = this.state === 'framing' ? 'curl an index finger to snap' : 'drag corners · press ◉ to snap';
    mono(g, s, W / 2, H / 2 + 6, { size: 15, color: T.ink, align: 'center', spacing: 1.5 });
  }

  headPos() {
    return this.world.camera.getWorldPosition(new THREE.Vector3());
  }

  face(pos) {
    this.target.copy(pos);
    this.targetQ.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.headPos(), pos, UP));
  }

  /** Live framing from the two L corners (in the plane facing you). */
  frameFrom(a, b) {
    const cam = this.world.camera;
    const right = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(cam.matrixWorld);
    const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const d = new THREE.Vector3().subVectors(b, a);
    this.w = Math.max(0.08, Math.abs(d.dot(right)));
    this.h = Math.max(0.06, Math.abs(d.dot(up)));
    this.face(c);
  }

  begin(corners) {
    const wasIdle = this.state === 'idle';
    this.state = 'framing';
    this.frameFrom(corners[0], corners[1]);
    if (wasIdle) {
      this.group.position.copy(this.target);
      this.group.quaternion.copy(this.targetQ);
      this.show.set(0);
    }
    this.group.visible = true;
    this.hint.dirty = true;
    this.world.sound.tick(this.target);
  }

  /** Hands let go: the frame stays, now adjustable. */
  place() {
    if (this.state !== 'framing') return;
    this.state = 'placed';
    this.idleSince = performance.now();
    this.hint.dirty = true;
  }

  /** From the launcher: a frame in front of you. */
  open() {
    const head = this.headPos();
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(this.world.camera.matrixWorld).setY(0).normalize();
    this.w = 0.5;
    this.h = 0.34;
    this.face(head.clone().addScaledVector(fwd, 1.0).add(new THREE.Vector3(0, -0.05, 0)));
    this.group.position.copy(this.target);
    this.group.quaternion.copy(this.targetQ);
    this.show.set(0);
    this.state = 'placed';
    this.group.visible = true;
    this.idleSince = performance.now();
    this.hint.dirty = true;
  }

  close() {
    this.state = 'idle';
  }

  /** While the viewfinder is up (framing or placed), you see your room even in Void. */
  watchRoom() {
    const need = this.state !== 'idle';
    if (need !== this.roomNeeded) {
      this.roomNeeded = need;
      this.world.needRoom('camera', need);
    }
  }

  moveTo(point) {
    this.face(point);
    this.idleSince = performance.now();
  }

  resizeTo(point) {
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const l = point.clone().applyMatrix4(inv);
    this.w = THREE.MathUtils.clamp(Math.abs(l.x) * 2, 0.08, 1.6);
    this.h = THREE.MathUtils.clamp(Math.abs(l.y) * 2, 0.06, 1.2);
    this.idleSince = performance.now();
  }

  /** The frame as a crop of the left eye's view: [x0, y0, x1, y1] in 0..1, y down. */
  rect() {
    const xr = this.world.renderer.xr;
    const cam = xr.isPresenting && xr.getCamera().cameras && xr.getCamera().cameras[0] ? xr.getCamera().cameras[0] : this.world.camera;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const q = this.group.localToWorld(new THREE.Vector3((sx * this.w) / 2, (sy * this.h) / 2, 0)).project(cam);
      const u = (q.x + 1) / 2;
      const v = (1 - q.y) / 2;
      x0 = Math.min(x0, u);
      x1 = Math.max(x1, u);
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
    return [x0, y0, x1, y1];
  }

  async snap() {
    if (!this.visible || this.busy) return;
    this.busy = true;
    this.group.updateMatrixWorld(true);
    const rect = this.rect();
    const center = this.group.position.clone();
    this.group.visible = false; // keep the frame itself out of the picture
    await this.world.photo(rect, center);
    this.group.visible = this.visible;
    this.idleSince = performance.now();
    this.busy = false;
  }

  interactives() {
    return this.state === 'placed' ? [...this.handles, this.edge, this.controls.mesh] : [];
  }

  surfaces() {
    return this.state === 'placed' && this.group.visible ? [this.controls] : [];
  }

  layout() {
    const { w, h } = this;
    const t = 0.0015;
    const far = 3;
    // mask: four big quads around the frame
    const [mt, mb, ml, mr] = this.mask;
    mt.scale.set(w + far * 2, far, 1);
    mt.position.set(0, h / 2 + far / 2, -0.001);
    mb.scale.set(w + far * 2, far, 1);
    mb.position.set(0, -h / 2 - far / 2, -0.001);
    ml.scale.set(far, h, 1);
    ml.position.set(-w / 2 - far / 2, 0, -0.001);
    mr.scale.set(far, h, 1);
    mr.position.set(w / 2 + far / 2, 0, -0.001);
    const [bt, bb, bl, br] = this.border;
    bt.scale.set(w, t, 1);
    bt.position.set(0, h / 2, 0);
    bb.scale.set(w, t, 1);
    bb.position.set(0, -h / 2, 0);
    bl.scale.set(t, h, 1);
    bl.position.set(-w / 2, 0, 0);
    br.scale.set(t, h, 1);
    br.position.set(w / 2, 0, 0);
    this.grid.forEach((q, i) => {
      if (i < 2) {
        q.scale.set(0.001, h, 1);
        q.position.set(((i ? 1 : -1) * w) / 6, 0, 0);
      } else {
        q.scale.set(w, 0.001, 1);
        q.position.set(0, ((i === 3 ? 1 : -1) * h) / 6, 0);
      }
    });
    const L = Math.min(0.05, Math.min(w, h) * 0.3);
    const k = 0.005;
    [[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(([sx, sy], i) => {
      const a = this.brackets[i * 2];
      const b = this.brackets[i * 2 + 1];
      a.scale.set(L, k, 1);
      a.position.set((sx * w) / 2 - (sx * L) / 2, (sy * h) / 2, 0.001);
      b.scale.set(k, L, 1);
      b.position.set((sx * w) / 2, (sy * h) / 2 - (sy * L) / 2, 0.001);
      this.handles[i].position.set((sx * w) / 2, (sy * h) / 2, 0.002);
    });
    this.edge.scale.set(Math.max(0.05, w - 0.12), 0.05, 1);
    this.edge.position.set(0, h / 2 + 0.012, 0.002);
    this.controls.mesh.position.set(0, -h / 2 - 0.05, 0.003);
    this.hint.mesh.position.set(0, h / 2 + 0.04, 0.003);
  }

  update(t, dt) {
    this.watchRoom();
    const hands = this.world.hands;
    if (this.state === 'framing' && hands.corners) this.frameFrom(hands.corners[0], hands.corners[1]);
    if (this.state === 'placed' && performance.now() - this.idleSince > 25000) this.close(); // forgotten frames go away
    this.show.target = this.state === 'idle' ? 0 : 1;
    const s = this.show.step(dt);
    if (this.state === 'idle' && s < 0.02) {
      this.group.visible = false;
      return;
    }
    dampVec(this.group.position, this.target, this.state === 'framing' ? 30 : 14, dt);
    this.group.quaternion.slerp(this.targetQ, 1 - Math.exp(-(this.state === 'framing' ? 26 : 12) * dt));
    this.layout();
    const a = Math.max(0, Math.min(1, s));
    this.mask.forEach((m) => (m.material.opacity = 0.42 * a));
    this.border.forEach((m) => (m.material.opacity = 0.5 * a));
    this.grid.forEach((m) => (m.material.opacity = 0.16 * a));
    this.brackets.forEach((m) => (m.material.opacity = 0.95 * a));
    this.controls.mesh.visible = this.state === 'placed';
    this.controls.mat.uniforms.uOpacity.value = a;
    this.hint.mat.uniforms.uOpacity.value = a * 0.9;
    this.controls.update(t, dt);
    this.hint.update(t, dt);
  }
}
