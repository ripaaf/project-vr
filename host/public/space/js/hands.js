// Hands: drawn as a fine skeleton and read for gestures from the 25 WebXR joints.
// Gestures must be deliberate, so they never fire while you just move around or use a window:
//   - one-hand poses count only when the hand is raised in front of you, held still, and not
//     pointing at / touching / holding any UI; each needs a short hold (ring shows progress)
//   - every gesture can be switched off in HANDS (手); the disruptive ones start switched off
// Meta reserves "look at your palm + pinch" for the system, so nothing here uses it.
import * as THREE from 'three';

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...FINGERS.flatMap((f) => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`]),
];
const BONES = [];
(() => {
  const chain = (names) => names.slice(1).forEach((n, i) => BONES.push([names[i], n]));
  chain(['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']);
  for (const f of FINGERS) chain(['wrist', `${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`]);
  BONES.push(['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal'], ['middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal'], ['ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal']);
})();

/** Every gesture the space understands (listed in HANDS, where each can be switched off). */
export const GESTURES = [
  { id: 'frame', glyph: '⌜⌟', name: 'Frame', how: 'Both hands make an L, like a viewfinder', does: 'Opens the camera frame between your hands', on: true },
  { id: 'pointAt', glyph: '👈👉', name: 'Point at each other', how: 'Index fingers pointing at each other', does: 'Photo of your whole view', on: true },
  { id: 'menu', glyph: '🤲', name: 'Palm up', how: 'Raise an open hand, palm to the sky, hold', does: 'Opens the quick ring at your hand', on: true },
  { id: 'watch', glyph: '⌚', name: 'Check watch', how: 'Raise your left wrist and look at it', does: 'Time and battery on your wrist', on: true },
  { id: 'peace', glyph: '✌', name: 'Peace', how: 'Index + middle up, hold', does: 'Switches room ⇄ void', on: true },
  { id: 'rock', glyph: '🤘', name: 'Horns', how: 'Index + pinky up, hold', does: 'Hacker mode: terminal + glyph rain', on: true },
  { id: 'thumbsUp', glyph: '👍', name: 'Thumbs up', how: 'Thumb up, fist closed, hold', does: 'Status in a caption', on: true },
  { id: 'clap', glyph: '👏', name: 'Clap', how: 'Clap once', does: 'Status in a caption', on: true },
  { id: 'center', glyph: '🙌', name: 'Both palms up', how: 'Raise both open hands, palms to the sky, hold', does: 'Brings every window back in front of you', on: true },
  { id: 'doublePinch', glyph: '◉◉', name: 'Double pinch', how: 'Pinch twice quickly on empty space', does: 'Brings every window back in front', on: true },
  { id: 'push', glyph: '🫸', name: 'Push away', how: 'Open palm toward a window, push it', does: 'That window glides away and closes', on: true },
  { id: 'swipe', glyph: '⇆', name: 'Swipe', how: 'Sweep a hand quickly left or right', does: 'Turns the windows around you', on: true },
  { id: 'pinch', glyph: '◉', name: 'Pinch / touch', how: 'Point and pinch, or touch with a fingertip', does: 'Selects / presses (always on)', on: true, fixed: true },
];

const v = () => new THREE.Vector3();
const dirOf = (a, b, out = v()) => out.subVectors(b, a).normalize();

class Hold {
  constructor(name, holdMs, releaseMs = 220) {
    this.name = name;
    this.holdMs = holdMs;
    this.releaseMs = releaseMs;
    this.state = 'idle';
    this.t0 = 0;
    this.lastOk = 0;
    this.progress = 0;
  }
  /** returns 'start' | 'end' | null */
  step(now, ok) {
    if (ok) {
      this.lastOk = now;
      if (this.state === 'idle') {
        this.state = 'arming';
        this.t0 = now;
      }
      if (this.state === 'arming') {
        this.progress = Math.min(1, (now - this.t0) / this.holdMs);
        if (this.progress >= 1) {
          this.state = 'active';
          return 'start';
        }
      }
      return null;
    }
    if (this.state === 'arming' && now - this.lastOk > 90) {
      this.state = 'idle';
      this.progress = 0;
    } else if (this.state === 'active' && now - this.lastOk > this.releaseMs) {
      this.state = 'idle';
      this.progress = 0;
      return 'end';
    }
    return null;
  }
}

class HandState {
  constructor(handedness) {
    this.handedness = handedness;
    this.tracked = false;
    this.p = Object.fromEntries(JOINTS.map((n) => [n, v()]));
    this.palm = v();
    this.palmCenter = v();
    this.pointDir = v();
    this.ext = {};
    this.curl = {};
    this.history = [];
    this.holds = {
      menu: new Hold('menu', 520, 350),
      peace: new Hold('peace', 600),
      rock: new Hold('rock', 600),
      thumbsUp: new Hold('thumbsUp', 650),
      watch: new Hold('watch', 380, 450),
    };
    this.lastSwipe = 0;
    this.lastPush = 0;
  }

  read(hand) {
    let n = 0;
    for (const name of JOINTS) {
      const j = hand.joints[name];
      if (!j || !j.visible) continue;
      j.getWorldPosition(this.p[name]);
      n++;
    }
    this.tracked = n === JOINTS.length;
    if (!this.tracked) return;
    const P = this.p;
    const a = v().subVectors(P['index-finger-metacarpal'], P.wrist);
    const b = v().subVectors(P['pinky-finger-metacarpal'], P.wrist);
    this.palm.crossVectors(a, b).normalize();
    if (this.handedness === 'left') this.palm.negate();
    this.palmCenter.addVectors(P.wrist, P['middle-finger-phalanx-proximal']).multiplyScalar(0.5);
    dirOf(P['index-finger-phalanx-proximal'], P['index-finger-tip'], this.pointDir);
    for (const f of FINGERS) {
      const base = dirOf(P[`${f}-metacarpal`], P[`${f}-phalanx-proximal`]);
      const prox = dirOf(P[`${f}-phalanx-proximal`], P[`${f}-phalanx-intermediate`]);
      const dist = dirOf(P[`${f}-phalanx-intermediate`], P[`${f}-tip`]);
      const along = base.dot(dirOf(P[`${f}-phalanx-proximal`], P[`${f}-tip`]));
      this.ext[f] = prox.dot(dist) > 0.7 && along > 0.78;
      this.curl[f] = along < 0.25;
    }
    const tStraight = dirOf(P['thumb-phalanx-proximal'], P['thumb-phalanx-distal']).dot(dirOf(P['thumb-phalanx-distal'], P['thumb-tip']));
    const tAway = P['thumb-tip'].distanceTo(P['index-finger-phalanx-proximal']);
    const tToMiddle = P['thumb-tip'].distanceTo(P['middle-finger-phalanx-intermediate']);
    this.ext.thumb = tStraight > 0.75 && tAway > 0.055;
    this.curl.thumb = tAway < 0.04 || tToMiddle < 0.035;
    this.pinch = P['thumb-tip'].distanceTo(P['index-finger-tip']);
    const now = performance.now();
    this.history.push([now, this.palmCenter.x, this.palmCenter.y, this.palmCenter.z]);
    while (this.history.length && now - this.history[0][0] > 260) this.history.shift();
  }

  velocity(out = v()) {
    const h = this.history;
    if (h.length < 2) return out.set(0, 0, 0);
    const a = h[0];
    const b = h[h.length - 1];
    const dt = Math.max(0.016, (b[0] - a[0]) / 1000);
    return out.set((b[1] - a[1]) / dt, (b[2] - a[2]) / dt, (b[3] - a[3]) / dt);
  }

  still(limit = 0.32) {
    return this.velocity().length() < limit;
  }
  fingers(...names) {
    return names.every((n) => this.ext[n]);
  }
  folded(...names) {
    return names.every((n) => this.curl[n]);
  }
  open() {
    return FINGERS.every((f) => this.ext[f]);
  }
  lShape() {
    if (!this.ext['index-finger'] || !this.ext.thumb) return false;
    if (!this.folded('middle-finger', 'ring-finger', 'pinky-finger')) return false;
    const t = dirOf(this.p['thumb-phalanx-proximal'], this.p['thumb-tip']);
    const ang = Math.acos(Math.max(-1, Math.min(1, t.dot(this.pointDir)))) * (180 / Math.PI);
    return ang > 45 && ang < 130;
  }
  /** The L with the index curled in: the camera's shutter "click". */
  shutterShape() {
    return this.ext.thumb && !this.ext['index-finger'] && this.folded('middle-finger', 'ring-finger', 'pinky-finger');
  }
  pointing() {
    return this.ext['index-finger'] && this.folded('middle-finger', 'ring-finger', 'pinky-finger');
  }
  corner(out = v()) {
    return out.addVectors(this.p['thumb-phalanx-proximal'], this.p['index-finger-phalanx-proximal']).multiplyScalar(0.5);
  }
}

export class Hands {
  constructor(world) {
    this.world = world;
    this.state = { left: new HandState('left'), right: new HandState('right') };
    this.xrHands = [];
    this.show = true;
    this.two = {
      frame: new Hold('frame', 260, 160),
      center: new Hold('center', 450, 300),
      pointAt: new Hold('pointAt', 520, 200),
    };
    this.lastClap = 0;
    this.active = new Set();
    this.framing = false; // live viewfinder between the hands (camera.js reads the corners)
    // visuals: joints as instanced dots, bones as one line set (2 draw calls for both hands)
    const N = JOINTS.length * 2;
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 }), N);
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    for (let h = 0; h < 2; h++)
      JOINTS.forEach((n, i) => {
        const c = new THREE.Color(n === 'index-finger-tip' ? '#e2472c' : n.endsWith('tip') ? '#ece5d6' : '#a8a194');
        this.dots.setColorAt(h * JOINTS.length + i, c);
      });
    this.dots.instanceColor.needsUpdate = true;
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(BONES.length * 2 * 2 * 3), 3));
    this.bones = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.28 }));
    this.bones.frustumCulled = false;
    world.scene.add(this.dots, this.bones);
    this.mat4 = new THREE.Matrix4();
  }

  setupXR(renderer, scene) {
    for (let i = 0; i < 2; i++) {
      const h = renderer.xr.getHand(i);
      scene.add(h);
      h.addEventListener('connected', (e) => {
        if (e.data.hand) h.userData.handedness = e.data.handedness;
      });
      this.xrHands.push(h);
    }
  }

  enabled(id) {
    const s = this.world.settings.gestures || {};
    const g = GESTURES.find((x) => x.id === id);
    return g && (g.fixed || (id in s ? s[id] : g.on));
  }

  emit(name, phase, hand, data = {}) {
    if (phase === 'start') this.active.add(name);
    if (phase === 'end') this.active.delete(name);
    this.world.emit('gesture', { name, phase, hand, ...data });
  }

  update(t) {
    const now = performance.now();
    const S = this.state;
    for (const hs of Object.values(S)) hs.tracked = false;
    for (const h of this.xrHands) {
      const hd = h.userData.handedness;
      if (hd && S[hd] && h.joints && Object.keys(h.joints).length) S[hd].read(h);
    }
    this.draw();
    const cam = this.world.camera;
    const head = v().setFromMatrixPosition(cam.matrixWorld);
    const fwd = v().set(0, 0, -1).transformDirection(cam.matrixWorld);
    const input = this.world.input;
    const progress = [];
    const palmSky = (hs) => hs.tracked && hs.open() && hs.palm.y > 0.75;
    const bothUp = palmSky(S.left) && palmSky(S.right);
    const twoBusy = this.two.frame.state !== 'idle' || this.two.pointAt.state !== 'idle' || this.two.center.state !== 'idle' || this.framing || bothUp;

    for (const hs of Object.values(S)) {
      const ok = hs.tracked;
      const H = hs.holds;
      // deliberate: raised in front of you, in view, held still, not using UI
      const rel = ok ? v().subVectors(hs.palmCenter, head) : v();
      const inFront = ok && rel.dot(fwd) > 0.22 && rel.clone().normalize().dot(fwd) > 0.72 && rel.y > -0.55 && rel.y < 0.2;
      const calm = ok && inFront && hs.still() && !input.busy(hs.handedness) && !twoBusy;
      const palmUp = calm && hs.open() && hs.palm.y > 0.82;
      const peace = calm && hs.fingers('index-finger', 'middle-finger') && hs.folded('ring-finger', 'pinky-finger') && hs.palm.y < 0.5 &&
        dirOf(hs.p['index-finger-phalanx-proximal'], hs.p['index-finger-tip']).angleTo(dirOf(hs.p['middle-finger-phalanx-proximal'], hs.p['middle-finger-tip'])) > 0.2;
      const rock = calm && hs.fingers('index-finger', 'pinky-finger') && hs.folded('middle-finger', 'ring-finger');
      const thumbUp = calm && hs.ext.thumb && hs.folded('index-finger', 'middle-finger', 'ring-finger', 'pinky-finger') && dirOf(hs.p['thumb-phalanx-proximal'], hs.p['thumb-tip']).y > 0.8;
      // watch: left wrist raised, the back of the hand toward your eyes, forearm across your view
      const toHead = rel.clone().negate().normalize();
      const wristFlat = ok && Math.abs(dirOf(hs.p.wrist, hs.p['middle-finger-metacarpal']).y) < 0.55;
      const near = ok && rel.length() > 0.18 && rel.length() < 0.55;
      const watch = ok && hs.handedness === 'left' && near && wristFlat && hs.palm.dot(toHead) < -0.78 && rel.clone().normalize().dot(fwd) > 0.82 &&
        hs.still(0.45) && !hs.open() && !input.busy('left') && !twoBusy;
      for (const [name, ok2] of [['menu', palmUp], ['peace', peace], ['rock', rock], ['thumbsUp', thumbUp], ['watch', watch]]) {
        if (!this.enabled(name)) continue;
        const r = H[name].step(now, ok2);
        if (r) this.emit(name, r, hs.handedness, { at: hs.palmCenter.clone() });
        if (H[name].state === 'arming' && H[name].progress > 0.25 && name !== 'watch') progress.push({ name, p: H[name].progress, at: hs.palmCenter });
      }
      if (this.enabled('push') && ok && inFront && hs.open() && now - hs.lastPush > 900 && !input.busy(hs.handedness, true) && !twoBusy) {
        const vel = hs.velocity();
        const palmFwd = hs.palm.dot(fwd) > 0.55;
        if (palmFwd && vel.dot(fwd) > 0.95 && vel.length() < 4) {
          hs.lastPush = now;
          // aim: between where you look through your palm and where the palm travels
          const dir = rel.clone().normalize().add(vel.clone().normalize()).normalize();
          this.emit('push', 'start', hs.handedness, { at: hs.palmCenter.clone(), dir });
          this.emit('push', 'end', hs.handedness);
        }
      }
      const raised = ok && rel.dot(fwd) > 0.12 && rel.y > -0.6 && rel.y < 0.3;
      // any hand shape: a quick sideways sweep in front of you (not while pinching)
      if (this.enabled('swipe') && raised && hs.pinch > 0.04 && now - hs.lastSwipe > 900 && !input.busy(hs.handedness, true) && !twoBusy) {
        const vel = hs.velocity();
        const right = v().set(-fwd.z, 0, fwd.x).normalize();
        const side = vel.dot(right);
        if (Math.abs(side) > 1.2 && Math.abs(vel.y) < Math.abs(side) * 0.6 && Math.abs(vel.dot(fwd)) < Math.abs(side)) {
          hs.lastSwipe = now;
          this.emit('swipe', 'start', hs.handedness, { dir: side > 0 ? 1 : -1, at: hs.palmCenter.clone() });
          this.emit('swipe', 'end', hs.handedness);
        }
      }
    }

    // ---- two hands
    const L = S.left;
    const R = S.right;
    const both = L.tracked && R.tracked;
    const cl = both && L.corner();
    const cr = both && R.corner();
    const frameNow = both && L.lShape() && R.lShape() && cl.distanceTo(cr) > 0.12;
    // keep framing while the L's hold, or while one hand "clicks" its index (the shutter)
    const holdingFrame = this.framing && both && ((L.lShape() || L.shutterShape()) && (R.lShape() || R.shutterShape()));
    if (this.enabled('frame')) {
      const r = this.two.frame.step(now, frameNow || holdingFrame);
      if (r === 'start') {
        this.framing = true;
        this.emit('frame', 'start', 'both', { corners: [cl.clone(), cr.clone()] });
      }
      if (this.framing && both) {
        this.corners = [cl.clone(), cr.clone()];
        const shutter = L.shutterShape() || R.shutterShape();
        if (shutter && !this.shutterDown) {
          this.shutterDown = true;
          this.emit('shutter', 'start', 'both', { corners: this.corners });
        } else if (!shutter) this.shutterDown = false;
      }
      if (r === 'end') {
        this.framing = false;
        this.emit('frame', 'end', 'both', { corners: this.corners });
      }
    }
    if (this.enabled('center')) {
      const ok2 = bothUp && L.still(0.4) && R.still(0.4) && !input.busy('left', true) && !input.busy('right', true);
      const r = this.two.center.step(now, ok2);
      if (r) this.emit('center', r, 'both', { at: v().addVectors(L.palmCenter, R.palmCenter).multiplyScalar(0.5) });
      if (this.two.center.state === 'arming' && this.two.center.progress > 0.2) progress.push({ name: 'center', p: this.two.center.progress, at: v().addVectors(L.palmCenter, R.palmCenter).multiplyScalar(0.5) });
    }
    const pointAt = both && L.pointing() && R.pointing() && L.pointDir.dot(R.pointDir) < -0.7 && Math.abs(L.pointDir.y) < 0.45 &&
      L.p['index-finger-tip'].distanceTo(R.p['index-finger-tip']) < 0.2 && !frameNow && !this.framing && L.still(0.4) && R.still(0.4) && !input.busy('left') && !input.busy('right');
    for (const [name, ok2, data] of [
      ['pointAt', pointAt, () => ({ at: v().addVectors(L.p['index-finger-tip'], R.p['index-finger-tip']).multiplyScalar(0.5) })],
    ]) {
      if (!this.enabled(name)) continue;
      const r = this.two[name].step(now, ok2);
      if (r) this.emit(name, r, 'both', r === 'start' ? data() : {});
      if (this.two[name].state === 'arming' && name === 'pointAt' && this.two[name].progress > 0.2) {
        progress.push({ name, p: this.two[name].progress, at: v().addVectors(L.p['index-finger-tip'], R.p['index-finger-tip']).multiplyScalar(0.5) });
      }
    }
    if (this.enabled('clap') && both && now - this.lastClap > 1200 && !this.framing) {
      const gap = L.palmCenter.distanceTo(R.palmCenter);
      const facing = L.palm.dot(R.palm) < -0.5;
      const closing = v().subVectors(L.velocity(), R.velocity()).dot(v().subVectors(R.palmCenter, L.palmCenter).normalize());
      if (facing && gap < 0.085 && closing > 0.7 && L.open() && R.open()) {
        this.lastClap = now;
        this.emit('clap', 'start', 'both', { at: v().addVectors(L.palmCenter, R.palmCenter).multiplyScalar(0.5) });
        this.emit('clap', 'end', 'both');
      }
    }
    this.world.gestureProgress(progress);
  }

  draw() {
    const pos = this.bones.geometry.attributes.position;
    let k = 0;
    let n = 0;
    const m = this.mat4;
    for (const hs of [this.state.left, this.state.right]) {
      if (!hs.tracked || !this.show) continue;
      JOINTS.forEach((name) => {
        const r = name.endsWith('tip') ? 0.003 : name === 'wrist' ? 0.0035 : 0.0018; // small: your real hand stays visible
        m.makeScale(r, r, r).setPosition(hs.p[name]);
        this.dots.setMatrixAt(n++, m);
      });
      for (const [a, b] of BONES) {
        pos.setXYZ(k++, hs.p[a].x, hs.p[a].y, hs.p[a].z);
        pos.setXYZ(k++, hs.p[b].x, hs.p[b].y, hs.p[b].z);
      }
    }
    this.dots.count = n;
    this.dots.visible = n > 0; // an empty draw floods the console with WebGL warnings
    this.dots.instanceMatrix.needsUpdate = true;
    this.bones.geometry.setDrawRange(0, k);
    this.bones.visible = k > 0;
    pos.needsUpdate = true;
  }
}
