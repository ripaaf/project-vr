// The stage: a small round plinth where a model sits for you to look at, like a piece on a table in
// a museum. It rests on a real table when there is one, else at waist height in front of you.
//   - pull the rim to turn it (or let it spin)
//   - pinch the model to lift it close; turn your hand to turn it; let go and it goes back
//   - pinch it with both hands to make it bigger or smaller
//   - corner brackets and a tag show its real size and what it is made of
//   - the placard in front: its name, spin, info, life size, put away; drag the placard to move the stage
import * as THREE from 'three';
import { Surface } from '../surface.js';
import { Spring, dampVec } from '../spring.js';
import { T, text, mono, cutPath, icon, hudTag } from '../theme.js';
import { sizeLabel, countLabel, bytesLabel } from './modelload.js';

const R = 0.2; // plinth radius
const FIT = 0.3; // a model's largest side when it arrives on the plinth
const UP = new THREE.Vector3(0, 1, 0);
const v3 = () => new THREE.Vector3();

function ringGeo(r, n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(Math.sin(a) * r, 0, Math.cos(a) * r);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}

/** Corner brackets around a box standing on the origin (like a tracking box, in ink). */
function bracketGeo(w, h, d) {
  const k = 0.2;
  const pts = [];
  for (const x of [-1, 1])
    for (const y of [0, 1])
      for (const z of [-1, 1]) {
        const px = (x * w) / 2;
        const py = y * h;
        const pz = (z * d) / 2;
        pts.push(px, py, pz, px - x * w * k, py, pz);
        pts.push(px, py, pz, px, py + (y ? -1 : 1) * h * k, pz);
        pts.push(px, py, pz, px, py, pz - z * d * k);
      }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}

function disposeTree(o) {
  o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    const ms = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
    for (const m of ms) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].dispose();
      m.dispose();
    }
  });
}

export class Stage {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.visible = false;
    world.scene.add(this.group);
    this.on = false;
    this.showS = new Spring(0, { stiffness: 240, damping: 24 });
    this.spin = false;
    this.infoOn = true;
    this.angle = 0;
    this.item = null; // { name, format, bytes, real: Vector3 (m), unit, tris, points, fit, live }

    // ---- the plinth
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.03, 0.014, 72), new THREE.MeshBasicMaterial({ color: 0x141415, transparent: true, opacity: 0.94 }));
    disc.position.y = -0.007;
    const rim = new THREE.LineLoop(ringGeo(R), new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.6 }));
    rim.position.y = 0.0006;
    const inner = new THREE.LineLoop(ringGeo(R - 0.034), new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.16 }));
    inner.position.y = 0.0006;
    // the index mark at the front (it stays; the ticks turn past it)
    const tri = new THREE.Shape();
    tri.moveTo(-0.007, 0);
    tri.lineTo(0.007, 0);
    tri.lineTo(0, -0.011);
    const index = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color: 0xe2472c }));
    index.rotation.x = -Math.PI / 2;
    index.position.set(0, 0.001, R + 0.016);
    this.group.add(disc, rim, inner, index);

    // ---- the turntable: ticks + the model's slot
    this.turn = new THREE.Group();
    this.group.add(this.turn);
    const ticks = [];
    const sealTick = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const len = i === 0 ? 0.026 : i % 3 === 0 ? 0.016 : 0.008;
      const arr = i === 0 ? sealTick : ticks;
      arr.push(Math.sin(a) * (R - 0.004), 0.0008, Math.cos(a) * (R - 0.004), Math.sin(a) * (R - 0.004 - len), 0.0008, Math.cos(a) * (R - 0.004 - len));
    }
    this.turn.add(
      new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3)), new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.4 })),
      new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sealTick, 3)), new THREE.LineBasicMaterial({ color: 0xe2472c }))
    );
    this.slot = new THREE.Group();
    this.turn.add(this.slot);

    // the rim is a handle: pull it around to turn the table
    this.rimHit = new THREE.Mesh(new THREE.TorusGeometry(R, 0.03, 6, 48), new THREE.MeshBasicMaterial({ visible: false }));
    this.rimHit.rotation.x = Math.PI / 2;
    this.rimHit.userData.interactive = {
      kind: 'handle',
      begin: (p, pt) => (this.turning = { a0: this.angleAt(pt), t0: this.angle }),
      drag: (p, pt) => {
        if (!this.turning) return;
        let d = this.angleAt(pt) - this.turning.a0;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.angle = this.turning.t0 + d;
        this.turning.a0 = this.angleAt(pt);
        this.turning.t0 = this.angle;
        this.spin = false;
      },
      end: () => {
        this.turning = null;
        this.placard.dirty = true;
      },
    };
    this.group.add(this.rimHit);
    // two curved arrows on the rim: "turn me" (bright while you point at the rim)
    this.arrows = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.45 });
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = side * (0.35 + (i / 12) * 0.5);
        pts.push(new THREE.Vector3(Math.sin(a) * (R + 0.022), 0.004, Math.cos(a) * (R + 0.022)));
      }
      const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0028, 5, false), arrowMat);
      const end = pts[pts.length - 1];
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 10), arrowMat);
      tip.position.copy(end);
      const dir = end.clone().sub(pts[pts.length - 2]).normalize();
      tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.arrows.add(arc, tip);
    }
    this.arrowMat = arrowMat;
    this.group.add(this.arrows);

    // ---- the model: holder (what you grab, scaled by two hands) › fit (to ~30 cm) › the model
    this.holder = new THREE.Group();
    this.fit = new THREE.Group();
    this.holder.add(this.fit);
    this.slot.add(this.holder);
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.holder.add(this.hit);
    const grab = (this.grab = {
      kind: 'object',
      object: this.holder,
      rotates: true,
      onGrab: () => {
        this.held = true;
        this.returning = false;
        world.scene.attach(this.holder);
      },
      onRelease: () => {
        this.held = false;
        this.slot.attach(this.holder);
        this.returning = true;
        this.tag.dirty = true;
        this.placard.dirty = true;
      },
    });
    this.hit.userData.interactive = grab;
    this.holder.userData.interactive = grab;
    this.brackets = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.85 }));
    this.holder.add(this.brackets);
    // the size corner: a red handle at the top corner of the brackets; pull it out or in
    this.sizer = new THREE.Group();
    this.sizerDot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 10), new THREE.MeshBasicMaterial({ color: 0xe2472c }));
    const sizerHit = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.sizer.add(this.sizerDot, sizerHit);
    sizerHit.userData.interactive = {
      kind: 'handle',
      begin: (p, pt) => {
        const c = this.holder.localToWorld(new THREE.Vector3(0, this.box ? this.box.h / 2 : 0.1, 0));
        this.sizing = { c, s0: this.holder.scale.x, d0: Math.max(0.02, pt.distanceTo(c)) };
      },
      drag: (p, pt) => {
        const z = this.sizing;
        if (z) this.holder.scale.setScalar(THREE.MathUtils.clamp((z.s0 * pt.distanceTo(z.c)) / z.d0, 0.1, 12));
      },
      end: () => (this.sizing = null),
    };
    this.sizerHit = sizerHit;
    this.holder.add(this.sizer);

    // ---- the tag above the model, with a leader line down to it
    this.tag = new Surface(world, { size: [0.2, 0.084], ss: 3, name: 'stage-tag', draw: (g, ui, W, H) => this.drawTag(g, ui, W, H) });
    this.tag.mesh.renderOrder = 6;
    world.scene.add(this.tag.mesh);
    this.tag.mesh.visible = false;
    this.leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v3(), v3(), v3()]), new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.7 }));
    this.leader.frustumCulled = false;
    this.leader.visible = false;
    this.dot = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.006), new THREE.MeshBasicMaterial({ color: 0xe2472c, side: THREE.DoubleSide }));
    this.dot.visible = false;
    world.scene.add(this.leader, this.dot);

    // ---- the placard at the front edge, leaning back like a museum label
    this.placard = new Surface(world, {
      size: [0.36, 0.068],
      ss: 2.6,
      name: 'stage-placard',
      draw: (g, ui, W, H) => this.drawPlacard(g, ui, W, H),
      click: (id) => this.press(id),
    });
    this.placard.mesh.position.set(0, 0.03, R + 0.06);
    this.placard.mesh.rotation.x = -0.75;
    this.group.add(this.placard.mesh);
    this.placard.movable = {
      zone: (x) => x < 196,
      begin: (pt) => (this.grabOff = this.group.position.clone().sub(pt)),
      drag: (pt) => this.moveTo(pt.clone().add(this.grabOff)),
      end: () => {},
    };
  }

  // ------------------------------------------------------------------ placing

  headPos() {
    return this.world.camera.getWorldPosition(v3());
  }

  faceHead() {
    const head = this.headPos();
    const p = this.group.position;
    this.group.rotation.set(0, Math.atan2(head.x - p.x, head.z - p.z), 0);
  }

  /** On a table in front of you if there is one, else at waist height, 0.6 m ahead. */
  place() {
    const head = this.headPos();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.world.camera.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const pos = head.clone().addScaledVector(fwd, 0.62);
    pos.y = head.y - 0.5;
    const table = this.world.tableUnder ? this.world.tableUnder(pos) : null;
    if (table != null) pos.y = table + 0.008;
    this.group.position.copy(pos);
    this.faceHead();
  }

  moveTo(pos) {
    const table = this.world.tableUnder ? this.world.tableUnder(pos) : null;
    if (table != null && Math.abs(pos.y - table) < 0.12) pos.y = table + 0.008; // settles onto a table
    this.group.position.copy(pos);
    this.faceHead();
  }

  angleAt(pt) {
    const l = this.group.worldToLocal(pt.clone());
    return Math.atan2(l.x, l.z);
  }

  // ------------------------------------------------------------------ the model

  /** Put a loaded model on the plinth: { root, stats, unit, name, format, bytes, live }. */
  set(m) {
    this.clear();
    const { size, center, box } = m.stats;
    const max = Math.max(size.x, size.y, size.z) || 1;
    const fit = FIT / max;
    this.fit.scale.setScalar(fit);
    this.fit.position.set(-center.x * fit, -box.min.y * fit, -center.z * fit);
    this.fit.add(m.root);
    this.model = m.root;
    this.holder.scale.setScalar(1);
    this.holder.position.set(0, 0.002, 0);
    this.holder.quaternion.identity();
    const w = Math.max(0.05, size.x * fit);
    const h = Math.max(0.05, size.y * fit);
    const d = Math.max(0.05, size.z * fit);
    this.box = { w, h, d };
    this.hit.scale.set(w, h, d);
    this.hit.position.set(0, h / 2, 0);
    this.brackets.geometry.dispose();
    this.brackets.geometry = bracketGeo(w * 1.06, h * 1.04, d * 1.06);
    this.sizer.position.set((w * 1.06) / 2, h * 1.04, (d * 1.06) / 2);
    this.item = {
      name: m.name,
      format: m.format,
      bytes: m.bytes,
      real: size.clone().multiplyScalar(m.unit),
      unit: m.unit,
      tris: m.stats.tris,
      points: m.stats.points,
      fit,
      live: m.live || null,
      note: m.note || null, // replaces the triangle count (e.g. the room: surfaces and windows)
      dispose: m.dispose !== false,
      key: m.key,
    };
    this.angle = 0;
    this.show();
    this.tag.dirty = true;
    this.placard.dirty = true;
  }

  clear() {
    if (this.model) {
      this.fit.remove(this.model);
      if (this.item && this.item.dispose) disposeTree(this.model);
    }
    this.model = null;
    this.item = null;
  }

  show() {
    if (!this.on) {
      this.on = true;
      this.place();
      this.showS.set(0);
      this.world.sound.open(this.group.position);
    }
  }

  hide() {
    if (!this.on) return;
    // let go of a model that is in someone's hand
    for (const p of this.world.input.pointers) if (p.drag && p.drag.obj === this.holder) p.drag = null;
    if (this.held) this.grab.onRelease();
    this.on = false;
    this.world.sound.close(this.group.position);
  }

  /** Displayed size / real size (1 = life size). */
  ratio() {
    const it = this.item;
    return it ? (it.fit * this.holder.scale.x) / it.unit : 1;
  }

  ratioLabel() {
    const r = this.ratio();
    if (Math.abs(r - 1) < 0.04) return 'life size';
    return r < 1 ? `1 : ${r > 0.1 ? (1 / r).toFixed(1).replace(/\.0$/, '') : Math.round(1 / r)}` : `${r.toFixed(1).replace(/\.0$/, '')} : 1`;
  }

  press(id) {
    const W = this.world;
    if (id === 'spin') this.spin = !this.spin;
    else if (id === 'info') this.infoOn = !this.infoOn;
    else if (id === 'life' && this.item) {
      const max = Math.max(this.item.real.x, this.item.real.y, this.item.real.z);
      if (Math.abs(this.ratio() - 1) < 0.04) this.holder.scale.setScalar(1);
      else if (max > 6) W.coreSay('This one is too big to show at life size here.');
      else this.holder.scale.setScalar(this.item.unit / this.item.fit);
    } else if (id === 'close') this.hide();
    this.placard.dirty = true;
    this.tag.dirty = true;
  }

  // ------------------------------------------------------------------ drawing

  drawTag(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    const it = this.item;
    if (!it) return;
    cutPath(g, 0, 0, W, H, 7);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = T.line2;
    g.lineWidth = 1;
    g.stroke();
    hudTag(g, 10, 10, it.name, { variant: 'ink', size: 13, chars: 22 });
    // its real size (not the size on the plinth), then what it is made of and the scale shown
    text(g, sizeLabel(it.real), 10, 56, { size: 16, weight: 600, color: T.ink, max: W - 20 });
    const what = it.note ? (typeof it.note === 'function' ? it.note() : it.note) : it.points ? `${countLabel(it.points)} points` : `${countLabel(it.tris)} triangles`;
    const parts = [what, this.ratioLabel()];
    text(g, parts.join('  ·  '), 10, 77, { size: 12, family: 'mono', color: T.ink3, max: W - 20 });
  }

  drawPlacard(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 7);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = T.line2;
    g.lineWidth = 1;
    g.stroke();
    const it = this.item;
    g.fillStyle = T.seal;
    g.fillRect(12, 16, 6, 6);
    text(g, it ? it.name : 'Stage', 26, 25, { size: 17, weight: 600, color: T.ink, max: 168 });
    const meta = it ? [it.format.toUpperCase(), it.bytes ? bytesLabel(it.bytes) : null, this.ratioLabel()].filter(Boolean).join(' · ') : '';
    text(g, meta, 12, 52, { size: 12, family: 'mono', color: T.ink3, max: 180 });
    // controls: spin · info · life size · put away
    const bx = 198;
    const bw = (W - bx - 6) / 4;
    const btn = (i, id, on, draw) => {
      const x = bx + i * bw;
      cutPath(g, x + 2, 8, bw - 4, H - 16, 5);
      g.fillStyle = on ? T.ink : T.bg3;
      g.fill();
      draw(x + bw / 2, H / 2, on ? T.bgSolid : T.ink);
      ui.hit(id, x, 0, bw, H);
    };
    btn(0, 'spin', this.spin, (cx, cy, c) => icon(g, 'spin', cx - 10, cy - 10, 20, c));
    btn(1, 'info', this.infoOn, (cx, cy, c) => icon(g, 'info', cx - 10, cy - 10, 20, c));
    btn(2, 'life', !!it && Math.abs(this.ratio() - 1) < 0.04, (cx, cy, c) => text(g, '1:1', cx, cy + 1, { size: 14, family: 'mono', weight: 600, color: c, align: 'center', base: 'middle' }));
    btn(3, 'close', false, (cx, cy, c) => icon(g, 'close', cx - 9, cy - 9, 18, c));
  }

  // ------------------------------------------------------------------ the world asks

  interactives() {
    if (!this.on || this.showS.value < 0.5) return [];
    const out = [this.placard.mesh, this.rimHit];
    if (this.model) out.push(this.hit, this.sizerHit);
    return out;
  }

  surfaces() {
    return this.on && this.showS.value > 0.5 ? [this.placard] : [];
  }

  /** Plinth and lines in the theme's colours (night: ink on dark; paper: dark ink on paper). */
  tint() {
    if (this.tinted === T.ink) return;
    this.tinted = T.ink;
    const ink = new THREE.Color(T.ink);
    this.group.children[0].material.color.set(T.bgSolid);
    for (const o of [this.group.children[1], this.group.children[2], this.turn.children[0], this.brackets, this.leader]) if (o && o.material) o.material.color.copy(ink);
  }

  update(t, dt) {
    this.tint();
    this.showS.target = this.on ? 1 : 0;
    const s = this.showS.step(dt);
    if (!this.on && s < 0.02) {
      if (this.group.visible) {
        this.group.visible = false;
        this.tag.mesh.visible = this.leader.visible = this.dot.visible = false;
        if (this.held) this.slot.attach(this.holder);
      }
      return;
    }
    this.group.visible = true;
    this.group.scale.setScalar(0.85 + 0.15 * Math.min(1.04, s));
    this.placard.mat.uniforms.uOpacity.value = Math.min(1, s);
    // turn
    if (this.spin && !this.turning) this.angle += dt * 0.35;
    this.turn.rotation.y = this.angle;
    // a model you let go of glides back onto the plinth
    if (this.returning) {
      dampVec(this.holder.position, new THREE.Vector3(0, 0.002, 0), 9, dt);
      this.holder.quaternion.slerp(new THREE.Quaternion(), 1 - Math.exp(-9 * dt));
      if (this.holder.position.length() < 0.004) this.returning = false;
    }
    if (this.item && this.item.live) {
      this.item.live(dt);
      this.liveAcc = (this.liveAcc || 0) + dt;
      if (this.liveAcc > 1) {
        this.liveAcc = 0;
        this.tag.dirty = true;
      }
    }
    // the size readout follows two-hand scaling
    const sc = this.holder.scale.x;
    if (sc !== this.lastScale) {
      this.lastScale = sc;
      this.placard.dirty = true;
      this.tag.dirty = true;
    }
    // the handles answer your pointer: arrows brighten on the rim, the size corner grows
    const P = this.world.input.pointers;
    const onRim = !!this.turning || P.some((p) => p.over === this.rimHit.userData.interactive);
    const onSizer = !!this.sizing || P.some((p) => p.over === this.sizerHit.userData.interactive);
    this.arrowMat.opacity += ((onRim ? 1 : 0.45) - this.arrowMat.opacity) * Math.min(1, dt * 12);
    this.arrowMat.color.set(onRim ? 0xe2472c : T.ink);
    this.sizerDot.scale.setScalar(onSizer ? 1.5 : 1);
    this.sizer.visible = !!this.model && !this.held;
    // info: brackets + tag + leader
    const info = this.infoOn && !!this.model;
    this.brackets.visible = info;
    const tagOn = info && !this.held;
    this.tag.mesh.visible = this.leader.visible = this.dot.visible = tagOn;
    if (tagOn) {
      const head = this.headPos();
      const top = this.holder.localToWorld(new THREE.Vector3(0, this.box.h * 1.04, 0));
      const right = new THREE.Vector3().subVectors(top, head).cross(UP).normalize();
      const k = this.holder.scale.x * this.group.scale.x;
      const at = top.clone().addScaledVector(UP, 0.07).addScaledVector(right, (this.box.w / 2) * k + 0.06);
      this.tag.mesh.position.copy(at);
      this.tag.mesh.lookAt(head);
      // leader: from the tag's left edge, down to the top of the model
      const left = this.tag.mesh.localToWorld(new THREE.Vector3(-0.1, -0.03, 0));
      const elbow = new THREE.Vector3(left.x, top.y + 0.02, left.z).lerp(top, 0.15);
      const pos = this.leader.geometry.attributes.position;
      pos.setXYZ(0, left.x, left.y, left.z);
      pos.setXYZ(1, elbow.x, elbow.y, elbow.z);
      pos.setXYZ(2, top.x, top.y, top.z);
      pos.needsUpdate = true;
      this.dot.position.copy(top);
      this.dot.lookAt(head);
      this.tag.mat.uniforms.uOpacity.value = Math.min(1, s);
      this.tag.update(t, dt);
    }
    this.placard.update(t, dt);
  }
}
