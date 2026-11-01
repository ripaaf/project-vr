// App charms — small tiles for your apps that float around you, so the space itself is the menu.
// Pinch one (from afar, or right at it) or push a fingertip into it to open its app (again: the
// window comes to you); pinch and move it to put it anywhere: on your desk, by a window, out of the
// way. They bob a little, turn to face you, glow while their app is open (a faint thread runs to its
// window) and pulse when the app saves something. Now and then a little 3D thing comes out of one —
// a paper plane from Notes, a polaroid from Photos, a spinning cube from Studio — and goes back.
// Where you put each one is kept, relative to where you stand (like the windows). Gather (quick
// ring, Settings) flies them all home.

import * as THREE from 'three';
import { T, icon, text, cutPath } from './theme.js';
import { APPS } from './apps/launcher.js';

const TILE = 0.064; // m
const PX = 192; // canvas px per tile side
const LIFT = { y: -0.36, r: 0.62 }; // default ring: chest height, within reach
const TAP_MOVE = 0.025; // m: less than this between pinch and release is a tap
const UP = new THREE.Vector3(0, 1, 0);
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** Where charm i of n sits at first: an arc on your left, then one on your right. */
function home(i, n) {
  const half = Math.ceil(n / 2);
  const left = i < half;
  const k = left ? i : i - half;
  return [THREE.MathUtils.degToRad((left ? 1 : -1) * (34 + k * 11)), LIFT.r, LIFT.y + (k % 2) * 0.05];
}

// ------------------------------------------------------------------ the little 3D things

const lineMat = () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
const meshMat = (role) => {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  m.userData.role = role; // ink · paper · seal: coloured from the theme when it comes out
  return m;
};
const edges = (geo) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat());

/** One per app: build(group) adds its parts; step(group, u) poses them for u = 0 → 1. */
const POPS = {
  // a paper plane loops out and lands back in the tile
  notes: {
    dur: 2.6,
    build(o) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.022, -0.016, 0.002, -0.012, 0, -0.004, -0.008, 0, 0, 0.022, 0.016, 0.002, -0.012, 0, -0.004, -0.008], 3));
      o.add(new THREE.Mesh(g, meshMat('ink')));
      o.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), lineMat()));
    },
    step(o, u) {
      const a = u * Math.PI * 2;
      const pos = (k) => new THREE.Vector3(Math.sin(k) * 0.075, 0.03 + Math.sin(k / 2) * 0.07, 0.02 + (1 - Math.cos(k)) * 0.045);
      o.position.copy(pos(a));
      o.lookAt(o.parent.localToWorld(pos(a + 0.05)));
      o.scale.setScalar(Math.min(1, u * 8, (1 - u) * 8));
    },
  },
  // three pages fan out of the folder, then slip back in
  files: {
    dur: 2.2,
    build(o) {
      for (let i = 0; i < 3; i++) {
        const sheet = new THREE.Group();
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.026, 0.034), meshMat('paper'));
        m.position.y = 0.017;
        const e = edges(new THREE.PlaneGeometry(0.026, 0.034));
        e.position.y = 0.017;
        sheet.add(m, e);
        o.add(sheet);
      }
    },
    step(o, u) {
      const k = Math.sin(Math.PI * Math.min(1, u * 1.15));
      o.position.set(0, 0.015 + k * 0.03, 0.012);
      o.children.forEach((s, i) => {
        s.rotation.z = (i - 1) * 0.45 * k;
        s.position.z = i * 0.002;
      });
      o.scale.setScalar(Math.min(1, u * 6, (1 - u) * 6));
    },
  },
  // a polaroid pops up, turns once, and sinks back
  gal: {
    dur: 2.4,
    build(o) {
      o.add(new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.048), meshMat('paper')));
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.03), meshMat('seal'));
      pic.position.set(0, 0.004, 0.0006);
      o.add(pic, edges(new THREE.PlaneGeometry(0.04, 0.048)));
    },
    step(o, u) {
      const k = Math.sin(Math.PI * u);
      o.position.set(0, 0.02 + k * 0.06, 0.02);
      o.rotation.set(-0.15 * k, ease(u) * Math.PI * 2, 0.12 * Math.sin(u * 9) * k);
      o.scale.setScalar(Math.min(1, u * 6, (1 - u) * 6));
    },
  },
  // a flash: a ring opens out and fades
  camera: {
    dur: 1.1,
    build(o) {
      o.add(new THREE.Mesh(new THREE.RingGeometry(0.03, 0.034, 40), meshMat('paper')));
      o.add(new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), meshMat('paper')));
    },
    step(o, u) {
      o.position.set(0, 0, 0.012);
      o.children[0].scale.setScalar(0.6 + u * 1.8);
      o.children[1].scale.setScalar(1 + u * 0.6);
      o.userData.fade = 1 - u;
    },
  },
  // a wire cube rises out of Studio, turning
  models: {
    dur: 2.6,
    build(o) {
      o.add(edges(new THREE.BoxGeometry(0.03, 0.03, 0.03)));
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), meshMat('seal'));
      o.add(core);
    },
    step(o, u) {
      const k = Math.sin(Math.PI * u);
      o.position.set(0, 0.015 + k * 0.065, 0.02);
      o.rotation.set(u * Math.PI * 1.5, u * Math.PI * 3, 0);
      o.children[1].rotation.set(-u * 6, u * 4, 0);
      o.scale.setScalar(Math.min(1, u * 5, (1 - u) * 5));
    },
  },
  // a wire globe spins up
  web: {
    dur: 2.6,
    build(o) {
      o.add(edges(new THREE.IcosahedronGeometry(0.02, 1)));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.0275, 48), meshMat('seal'));
      ring.rotation.x = Math.PI / 2.4;
      o.add(ring);
    },
    step(o, u) {
      const k = Math.sin(Math.PI * u);
      o.position.set(0, 0.015 + k * 0.065, 0.02);
      o.children[0].rotation.y = u * Math.PI * 4;
      o.children[1].rotation.z = u * 3;
      o.scale.setScalar(Math.min(1, u * 5, (1 - u) * 5));
    },
  },
  // a prompt: glyph blocks rise and blink out
  term: {
    dur: 2.2,
    build(o) {
      for (let i = 0; i < 7; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.009, 0.002), meshMat(i === 0 ? 'seal' : 'ink'));
        b.userData.x = (Math.random() - 0.5) * 0.05;
        b.userData.d = Math.random() * 0.4;
        o.add(b);
      }
    },
    step(o, u) {
      o.position.set(0, 0, 0.014);
      o.children.forEach((b) => {
        const v = Math.max(0, Math.min(1, (u - b.userData.d) / 0.6));
        b.position.set(b.userData.x, 0.02 + v * 0.07, 0);
        b.visible = v > 0 && v < 1 && Math.sin(u * 40 + b.userData.x * 100) > -0.6;
      });
    },
  },
  // a gear turns out of Settings
  set: {
    dur: 2.4,
    build(o) {
      const gear = new THREE.Group();
      gear.add(new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.004, 6, 24), meshMat('ink')));
      for (let i = 0; i < 8; i++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.007, 0.006), meshMat('ink'));
        const a = (i / 8) * Math.PI * 2;
        t.position.set(Math.cos(a) * 0.019, Math.sin(a) * 0.019, 0);
        t.rotation.z = a;
        gear.add(t);
      }
      o.add(gear);
    },
    step(o, u) {
      const k = Math.sin(Math.PI * u);
      o.position.set(0, 0.015 + k * 0.06, 0.02);
      o.children[0].rotation.z = -u * Math.PI * 3;
      o.scale.setScalar(Math.min(1, u * 5, (1 - u) * 5));
    },
  },
  // a small screen pops up and lights
  pc: {
    dur: 2.2,
    build(o) {
      o.add(edges(new THREE.BoxGeometry(0.044, 0.028, 0.003)));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.024), meshMat('seal'));
      scr.position.z = 0.002;
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.01, 0.003), meshMat('ink'));
      stand.position.y = -0.019;
      o.add(scr, stand);
    },
    step(o, u) {
      const k = Math.sin(Math.PI * u);
      o.position.set(0, 0.02 + k * 0.055, 0.02);
      o.rotation.y = Math.sin(u * Math.PI * 2) * 0.5;
      o.children[1].visible = Math.sin(u * 30) > -0.4; // it flickers on
      o.scale.setScalar(Math.min(1, u * 5, (1 - u) * 5));
    },
  },
};

export class Charms {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'charms';
    this.group.visible = false;
    world.scene.add(this.group);
    this.list = [];
    this.nextHop = 6;
    this.nextPop = 12;
    const pos = (world.settings && world.settings.charmPos) || {};
    const apps = APPS.filter((a) => !(a.pc && world.standalone) && a.app !== 'dev');
    apps.forEach((def, i) => this.list.push(this.make(def, pos[def.app || def.action] || home(i, apps.length), i)));
    // the apps tell their charms when something happened
    world.on('photoSaved', () => this.pulse('gal', true));
    world.on('noteSaved', () => this.pulse('notes'));
    world.on('scanSaved', () => this.pulse('models', true));
  }

  make(def, place, i) {
    const id = def.app || def.action;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PX;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    face.renderOrder = 3;
    // a little thickness behind the face, so it reads as a thing you can pick up
    const back = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.94, TILE * 0.94, 0.008), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    back.position.z = -0.0045;
    const ring = new THREE.Mesh(new THREE.RingGeometry(TILE * 0.76, TILE * 0.8, 48), new THREE.MeshBasicMaterial({ color: 0xe2472c, transparent: true, opacity: 0, depthWrite: false }));
    ring.position.z = -0.001;
    // the name, under the tile, while you point at it
    const lc = document.createElement('canvas');
    lc.width = 320;
    lc.height = 72;
    const ltex = new THREE.CanvasTexture(lc);
    ltex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.0225), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, opacity: 0, depthWrite: false }));
    label.position.y = -TILE * 0.5 - 0.018;
    label.renderOrder = 3;
    g.add(back, ring, face, label);
    this.group.add(g);
    const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xe2472c, transparent: true, opacity: 0, depthWrite: false }));
    thread.frustumCulled = false;
    this.group.add(thread);
    const c = { def, id, g, face, back, ring, label, canvas, tex, lc, ltex, thread, place: [...place], phase: i * 1.7, hover: 0, hot: false, open: false, pulse: 0, hop: 0, drag: null, pos: new THREE.Vector3(), dirty: true, fly: null, pop: null, touchAt: 0 };
    face.userData.interactive = {
      kind: 'handle',
      hover: (on) => (c.hot = on),
      // a fingertip pushed into it: open, unless that hand goes on to pinch it (then it's a move)
      touch: () => {
        c.touchAt = performance.now();
        setTimeout(() => {
          if (c.touchAt && !c.drag) this.tap(c);
          c.touchAt = 0;
        }, 260);
      },
      touchR: TILE * 0.62,
      begin: (p, pt) => {
        c.touchAt = 0;
        c.fly = null;
        c.drag = { start: pt.clone(), t0: performance.now(), moved: 0, off: c.g.position.clone().sub(pt) };
        this.world.haptic(p, 0.2, 14);
      },
      drag: (p, pt) => {
        const d = c.drag;
        if (!d) return;
        d.moved = Math.max(d.moved, pt.distanceTo(d.start));
        if (d.moved > TAP_MOVE) c.pos.copy(pt).add(d.off);
      },
      end: () => {
        const d = c.drag;
        c.drag = null;
        if (!d) return;
        if (d.moved <= TAP_MOVE) this.tap(c);
        else this.keep(c);
      },
    };
    return c;
  }

  /** Open its app; if it is open already, bring the window to you. */
  tap(c) {
    const W = this.world;
    c.pulse = 1;
    this.popOut(c);
    W.sound.click(c.g.position);
    if (c.def.action === 'camera') return W.cameraBox.open();
    const app = W.apps[c.def.app];
    if (!app) return;
    if (W.panels.isOpen(app)) W.panels.focus(app);
    else W.panels.open(app);
  }

  /** Remember where you put it (angle and distance from where you stand, height from your eyes). */
  keep(c) {
    const P = this.world.panels;
    const p = c.pos;
    const dx = p.x - P.head.x;
    const dz = p.z - P.head.z;
    const a = Math.atan2(-dx, -dz) - P.baseYaw;
    c.place = [+a.toFixed(4), +Math.max(0.25, Math.hypot(dx, dz)).toFixed(3), +(p.y - P.head.y).toFixed(3)];
    const s = this.world.settings;
    s.charmPos = { ...(s.charmPos || {}), [c.id]: c.place };
    this.world.saveSettings();
  }

  /** Where they belong around you (arriving, recentring). With `glide` they fly there. */
  place(glide) {
    const P = this.world.panels;
    this.list.forEach((c, i) => {
      const [a, r, h] = c.place;
      c.pos.copy(P.arcPoint(P.baseYaw + a, r, P.head.y + h));
      if (glide && this.group.visible) c.fly = { from: c.g.position.clone(), t: -i * 0.07, dur: 0.95 };
      else {
        c.fly = null;
        c.g.position.copy(c.pos);
      }
    });
  }

  /** All of them back to their first places around you, flying in one after another. */
  gather() {
    const W = this.world;
    const s = W.settings;
    delete s.charmPos;
    if (s.charms === false) s.charms = true;
    W.saveSettings();
    const n = this.list.length;
    this.list.forEach((c, i) => (c.place = home(i, n)));
    if (!this.group.visible) {
      this.group.visible = true;
      // from just in front of you, so you see where they go
      const head = W.camera.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(0, 0, -0.5).applyQuaternion(W.camera.getWorldQuaternion(new THREE.Quaternion()));
      for (const c of this.list) c.g.position.copy(head).add(fwd).add(new THREE.Vector3(0, -0.2, 0));
    }
    this.place(true);
    W.sound.open(W.camera.getWorldPosition(new THREE.Vector3()));
  }

  pulse(id, pop) {
    const c = this.list.find((x) => x.id === id);
    if (!c) return;
    c.pulse = 1;
    if (pop) this.popOut(c);
  }

  /** Its little 3D thing comes out (made the first time, then kept). */
  popOut(c) {
    const kind = POPS[c.id];
    if (!kind || c.pop) return;
    if (!c.popObj) {
      c.popObj = new THREE.Group();
      kind.build(c.popObj);
      c.popObj.traverse((m) => {
        if (m.material) m.renderOrder = 4;
      });
      c.g.add(c.popObj);
    }
    // colours follow the theme: ink lines, paper sheets, the seal for accents
    const ink = new THREE.Color(T.ink);
    const paper = new THREE.Color(T.name === 'paper' ? '#ffffff' : T.ink);
    const seal = new THREE.Color(T.seal);
    c.popObj.traverse((m) => {
      if (!m.material) return;
      const role = m.material.userData.role;
      m.material.color.copy(role === 'seal' ? seal : role === 'paper' ? paper : ink);
    });
    c.popObj.visible = true;
    c.pop = { t: 0, dur: kind.dur };
  }

  get on() {
    return this.world.settings.charms !== false;
  }

  /** The gate, before you step in: the charms float in a slow arc across the view, showing off. */
  showcase(on) {
    this.showcasing = on;
    if (!on) return;
    this.world.env.setMode('void'); // the night garden behind them (your choice returns as you enter)
    this.group.visible = true;
    this.nextPop = 1.2;
    this.showcaseAt(0, true);
  }

  showcaseAt(t, snap) {
    const cam = this.world.camera;
    const c0 = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(-dir.x, -dir.z);
    const n = this.list.length;
    this.list.forEach((c, i) => {
      const f = n > 1 ? i / (n - 1) : 0.5;
      const a = yaw + (0.8 - 1.6 * f) + Math.sin(t * 0.22 + i) * 0.05;
      // a smile: lower in the middle (under the prompt), higher towards the edges
      const y = c0.y - 0.31 + Math.pow(Math.abs(f - 0.5) * 2, 2) * 0.3 + Math.sin(t * 0.5 + i * 1.3) * 0.02;
      c.pos.set(c0.x - Math.sin(a) * 1.0, y, c0.z - Math.cos(a) * 1.0);
      if (snap) c.g.position.copy(c.pos);
    });
  }

  start() {
    this.showcasing = false;
    this.place();
    this.group.visible = this.on;
  }

  stop() {
    this.group.visible = false;
  }

  setOn(on) {
    this.world.settings.charms = on;
    this.world.saveSettings();
    if (on) this.place();
    this.group.visible = on;
  }

  interactives() {
    return this.group.visible ? this.list.map((c) => c.face) : [];
  }

  dirtyAll() {
    for (const c of this.list) c.dirty = true;
  }

  drawFace(c) {
    const g = c.canvas.getContext('2d');
    const s = PX;
    g.clearRect(0, 0, s, s);
    cutPath(g, 2, 2, s - 4, s - 4, 16);
    g.fillStyle = T.bgSolid;
    g.fill();
    g.strokeStyle = c.open ? T.seal : T.line2;
    g.lineWidth = c.open ? 4 : 2;
    g.stroke();
    icon(g, c.def.icon, s / 2 - 42, s / 2 - 42, 84, c.open ? T.seal : T.ink);
    c.tex.needsUpdate = true;
    const l = c.lc.getContext('2d');
    l.clearRect(0, 0, c.lc.width, c.lc.height);
    cutPath(l, 0, 0, c.lc.width, c.lc.height, 8);
    l.fillStyle = T.chip;
    l.fill();
    text(l, c.def.label, c.lc.width / 2, c.lc.height / 2 + 2, { size: 34, weight: 500, color: T.ink, align: 'center', base: 'middle' });
    c.ltex.needsUpdate = true;
    c.back.material.color.set(T.name === 'paper' ? 0x8a857b : 0x000000);
    c.ring.material.color.set(T.seal);
    c.thread.material.color.set(T.seal);
    c.dirty = false;
  }

  update(t, dt) {
    if (!this.group.visible) return;
    const W = this.world;
    const head = W.camera.getWorldPosition(new THREE.Vector3());
    const idle = () => this.list.filter((c) => !c.drag && !c.hot && !c.fly && !c.pop);
    // now and then one of them stretches: a small hop and a turn
    this.nextHop -= dt;
    if (this.nextHop <= 0) {
      this.nextHop = 9 + Math.random() * 9;
      const free = idle();
      if (free.length) free[Math.floor(Math.random() * free.length)].hop = 1;
    }
    if (this.showcasing) this.showcaseAt(t);
    // and now and then one shows what it does, in 3D (often, at the gate)
    this.nextPop -= dt;
    if (this.nextPop <= 0) {
      this.nextPop = this.showcasing ? 2.2 + Math.random() * 2 : 16 + Math.random() * 14;
      const free = idle().filter((c) => POPS[c.id]);
      if (free.length) this.popOut(free[Math.floor(Math.random() * free.length)]);
    }
    for (const c of this.list) {
      const app = c.def.app && W.apps[c.def.app];
      const open = c.def.action === 'camera' ? !!(W.cameraBox && W.cameraBox.state && W.cameraBox.state !== 'idle') : !!(app && W.panels.isOpen(app));
      if (open !== c.open) {
        c.open = open;
        c.dirty = true;
        if (open) c.pulse = Math.max(c.pulse, 0.6);
      }
      if (c.dirty) this.drawFace(c);
      let spin = 0;
      if (c.fly) {
        // gathering: an arc home, a turn on the way
        const f = c.fly;
        f.t += dt;
        const u = Math.max(0, Math.min(1, f.t / f.dur));
        const e = ease(u);
        c.g.position.lerpVectors(f.from, c.pos, e).addScaledVector(UP, Math.sin(Math.PI * e) * Math.min(0.18, 0.05 + f.from.distanceTo(c.pos) * 0.25));
        spin = e * Math.PI * 2;
        if (u >= 1) c.fly = null;
      } else if (!c.drag || c.drag.moved <= TAP_MOVE) {
        // where it floats: its place, a slow bob, a hop now and then
        c.hop = Math.max(0, c.hop - dt * 1.25);
        const bob = Math.sin(t * 1.3 + c.phase) * 0.005 + Math.sin(Math.PI * c.hop) * 0.028;
        c.g.position.lerp(new THREE.Vector3(c.pos.x, c.pos.y + bob, c.pos.z), Math.min(1, dt * 8));
        spin = c.hop > 0 ? (1 - c.hop) * Math.PI * 2 : 0;
      } else c.g.position.lerp(c.pos, Math.min(1, dt * 20));
      // it turns to you, swaying a little
      const look = new THREE.Matrix4().lookAt(head, c.g.position, UP);
      const q = new THREE.Quaternion().setFromRotationMatrix(look);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.sin(t * 0.7 + c.phase) * 0.12 + spin));
      c.g.quaternion.slerp(q, Math.min(1, dt * (c.fly ? 14 : 6)));
      // pointed at: a bit bigger, with its name
      c.hover += ((c.hot || c.drag || c.touchAt ? 1 : 0) - c.hover) * Math.min(1, dt * 10);
      c.pulse = Math.max(0, c.pulse - dt * 1.4);
      const bump = Math.sin(Math.PI * Math.min(1, c.pulse)) * 0.22;
      c.g.scale.setScalar(1 + c.hover * 0.16 + bump);
      c.label.material.opacity = c.hover;
      c.label.visible = c.hover > 0.02;
      // the seal ring: breathing while open, a wave when something happens
      const wave = c.pulse > 0 ? c.pulse : 0;
      c.ring.scale.setScalar(1 + (1 - wave) * (wave > 0 ? 0.7 : 0));
      c.ring.material.opacity = Math.max(c.open ? 0.35 + Math.sin(t * 2 + c.phase) * 0.12 : 0, wave * 0.9);
      // its little 3D thing
      if (c.pop) {
        c.pop.t += dt;
        const u = Math.min(1, c.pop.t / c.pop.dur);
        c.popObj.userData.fade = 1;
        POPS[c.id].step(c.popObj, u);
        const fade = c.popObj.userData.fade;
        c.popObj.traverse((m) => {
          if (m.material) m.material.opacity = (m.material.userData.base ?? (m.material.userData.base = m.material.opacity)) * fade;
        });
        if (u >= 1) {
          c.popObj.visible = false;
          c.pop = null;
        }
      }
      // a thread to its window
      const panel = app && c.open ? W.panels.get(app) : null;
      if (panel && panel.group.visible) {
        const a = c.g.position;
        const b = panel.group.getWorldPosition(new THREE.Vector3());
        b.y -= app.size[1] * panel.group.scale.y * 0.45; // to the window's lower edge
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= Math.min(0.25, a.distanceTo(b) * 0.18); // it hangs a little
        const pts = c.thread.geometry.attributes.position;
        for (let i = 0; i < 16; i++) {
          const u = i / 15;
          const p = new THREE.Vector3()
            .copy(a)
            .multiplyScalar((1 - u) * (1 - u))
            .addScaledVector(mid, 2 * u * (1 - u))
            .addScaledVector(b, u * u);
          pts.setXYZ(i, p.x, p.y, p.z);
        }
        pts.needsUpdate = true;
        c.thread.material.opacity += (0.22 - c.thread.material.opacity) * Math.min(1, dt * 4);
        c.thread.visible = true;
      } else {
        c.thread.material.opacity = Math.max(0, c.thread.material.opacity - dt);
        c.thread.visible = c.thread.material.opacity > 0.01;
      }
    }
  }
}
