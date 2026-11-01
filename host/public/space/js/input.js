// Input, the Quest way:
//   - far:  each hand / controller casts a soft ray; pinch presses what it points at
//   - near: bring your fingertip to a window, the launcher, the keyboard… and just touch it
//           (the ray hides while you do, a small ring shows where your finger will land)
//   - grab: pinch a handle (window bar, corner, keyboard bar, camera frame) to move or resize it;
//           with a ray you can push it away or pull it in by moving your hand forward / back,
//           and when your hand is right next to a handle you grab it directly
//   - 3D objects: pinch to carry, pinch with both hands to scale
// In the flat preview the mouse does the same.
import * as THREE from 'three';

const POKE_PRESS = 0.006; // fingertip this close to (or through) a surface presses it (m)
const POKE_RELEASE = 0.016;
const POKE_RANGE = 0.07; // in front of a surface: the finger "hovers" it
const NEAR_GRAB = 0.07; // pinch this close to a handle grabs it directly

function makeRay() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
  geo.setAttribute('alpha', new THREE.Float32BufferAttribute([0, 0.9], 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(0.93, 0.9, 0.84, vA * uOpacity); }`,
    uniforms: { uOpacity: { value: 1 } },
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return line;
}

function makeReticle() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0075, 0.0105, 40), new THREE.MeshBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.95, depthTest: false }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 20), new THREE.MeshBasicMaterial({ color: 0xe2472c, transparent: true, opacity: 0, depthTest: false }));
  ring.renderOrder = 20;
  dot.renderOrder = 21;
  g.add(ring, dot);
  g.userData = { ring, dot };
  return g;
}

export class Input {
  constructor(world) {
    this.world = world;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 8;
    this.pointers = [];
    this.lastEmptyPinch = 0;
    this.tmp = {};
  }

  makePointer(id, obj) {
    const p = {
      id,
      obj,
      source: null,
      handedness: id === 'mouse' ? 'mouse' : '',
      isHand: false,
      active: id === 'mouse',
      pressed: false,
      hit: null, // ray hit (when not poking)
      over: null, // interactive currently hovered (ray or poke)
      overObj: null,
      drag: null,
      poke: null, // { surface, d, uv, pressed }
      lastBusy: 0,
      origin: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      ray: makeRay(),
      reticle: makeReticle(),
    };
    this.world.scene.add(p.ray, p.reticle);
    p.ray.visible = p.reticle.visible = false;
    this.pointers.push(p);
    return p;
  }

  setupXR(renderer, scene) {
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      scene.add(c);
      const p = this.makePointer(`xr${i}`, c);
      c.addEventListener('connected', (e) => {
        p.source = e.data;
        p.handedness = e.data.handedness;
        p.isHand = !!e.data.hand;
        p.active = true;
      });
      c.addEventListener('disconnected', () => {
        this.release(p);
        this.setOver(p, null);
        p.active = false;
        p.source = null;
        p.ray.visible = p.reticle.visible = false;
      });
      c.addEventListener('selectstart', () => this.down(p));
      c.addEventListener('selectend', () => this.up(p));
    }
  }

  setupMouse(dom, camera) {
    const p = this.makePointer('mouse', null);
    this.mouse = p;
    const ndc = new THREE.Vector2();
    let look = null;
    const toNdc = (e) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    dom.addEventListener('pointermove', (e) => {
      toNdc(e);
      if (look) {
        this.world.lookBy((e.clientX - look.x) * 0.004, (e.clientY - look.y) * 0.004);
        look = { x: e.clientX, y: e.clientY };
      }
    });
    dom.addEventListener('pointerdown', (e) => {
      toNdc(e);
      this.mouseRay(camera, ndc);
      this.updatePointer(p);
      if (e.button === 2 || !p.hit) {
        look = { x: e.clientX, y: e.clientY };
        dom.setPointerCapture(e.pointerId);
        if (e.button !== 2 && !p.hit) this.emptyPinch(p);
        return;
      }
      this.down(p);
    });
    dom.addEventListener('pointerup', (e) => {
      if (look) {
        look = null;
        return;
      }
      if (e.button !== 2) this.up(p);
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener(
      'wheel',
      (e) => {
        const h = p.hit && p.hit.object.userData.interactive;
        const app = h && h.panel && h.panel.app;
        if (h && h.kind === 'surface' && app && app.wheel) app.wheel(e.deltaY > 0 ? 1 : -1, h.surface.px(p.hit.uv));
      },
      { passive: true }
    );
    this.mouseRay = (cam, v) => {
      this.raycaster.setFromCamera(v, cam);
      p.origin.copy(this.raycaster.ray.origin);
      p.dir.copy(this.raycaster.ray.direction);
    };
    this.mouseNdc = ndc;
    this.mouseCam = camera;
  }

  // ------------------------------------------------------------------ helpers

  hand(p) {
    if (!p.isHand) return null;
    const hs = this.world.hands && this.world.hands.state[p.handedness];
    return hs && hs.tracked ? hs : null;
  }

  /** Between thumb and index tips: where a hand pinch happens. */
  pinchPoint(p) {
    const hs = this.hand(p);
    if (!hs) return null;
    return new THREE.Vector3().addVectors(hs.p['thumb-tip'], hs.p['index-finger-tip']).multiplyScalar(0.5);
  }

  head() {
    return this.world.camera.getWorldPosition(new THREE.Vector3());
  }

  /** True while this hand is using UI (so its gestures stay quiet). `aimOk`: just pointing at
   *  something doesn't count (a push is aimed at a window on purpose). */
  busy(handedness, aimOk = false) {
    const now = performance.now();
    return this.pointers.some(
      (p) => p.active && p.handedness === handedness && (p.poke || p.drag || p.pressed || (!aimOk && p.hit && p.hit.object.userData.interactive) || now - p.lastBusy < 700)
    );
  }

  emptyPinch(p) {
    if (this.world.drawMode) return;
    const now = performance.now();
    if (now - this.lastEmptyPinch < 420) {
      this.lastEmptyPinch = 0;
      this.world.emit('gesture', { name: 'doublePinch', phase: 'start', hand: p.handedness });
    } else this.lastEmptyPinch = now;
  }

  /** Hover bookkeeping: windows light their chrome, surfaces count who is on them. */
  setOver(p, h, obj) {
    if (p.over === h && p.overObj === obj) return;
    const prev = p.over;
    if (prev) {
      if (prev.kind === 'surface') {
        prev.surface.hovers = Math.max(0, prev.surface.hovers - 1);
        prev.surface.pointer('leave', null, p);
      } else if (prev.panel) {
        prev.panel.chromeHover = Math.max(0, (prev.panel.chromeHover || 0) - 1);
        if (prev.corner && prev.panel.hoverCorner === p.overObj) prev.panel.hoverCorner = null;
        if (prev.role && prev.panel.hoverPart === prev.role) prev.panel.hoverPart = null;
      }
      if (prev.hover) prev.hover(false, p);
    }
    p.over = h || null;
    p.overObj = obj || null;
    if (h) {
      if (h.kind === 'surface') h.surface.hovers++;
      else {
        if (h.panel) {
          h.panel.chromeHover = (h.panel.chromeHover || 0) + 1;
          if (h.corner) h.panel.hoverCorner = obj;
          if (h.role) h.panel.hoverPart = h.role;
        }
        if (h.hover) h.hover(true, p);
        this.world.sound.tick(obj ? obj.getWorldPosition(new THREE.Vector3()) : null);
      }
    }
  }

  // ------------------------------------------------------------------ press / release

  down(p) {
    p.pressed = true;
    p.lastBusy = performance.now();
    if (p.poke) return; // your fingertip is already doing the work
    this.world.haptic(p, 0.15, 12);
    // near grab: your pinch is right at a handle or an object
    const pp = this.pinchPoint(p);
    if (pp) {
      const near = this.nearGrabbable(pp);
      if (near) {
        const h = near.userData.interactive;
        if (h.kind === 'handle') {
          h.begin(p, pp);
          p.drag = { kind: 'handle', h, near: true, off: new THREE.Vector3() };
          return;
        }
        if (h.kind === 'object') return this.grabObject(p, h, pp, pp.distanceTo(p.origin), true);
      }
    }
    if (!p.hit) {
      this.emptyPinch(p);
      this.world.emit('pinch', { pointer: p, target: null });
      return;
    }
    const h = p.hit.object.userData.interactive;
    this.world.emit('pinch', { pointer: p, target: h });
    if (h.kind === 'surface') {
      h.surface.pointer('down', p.hit.uv, p);
      // the title area (top ~11 cm of a window) is also a handle: move far enough and it drags.
      // Other surfaces can be movable too (the Apps tab, the launcher's header).
      const px = h.surface.px(p.hit.uv);
      const mv = !h.panel && h.surface.movable;
      const header = (!!h.panel && !h.panel.pinned && px.y < 112) || (!!mv && (!mv.zone || mv.zone(px.x, px.y)));
      p.drag = { kind: 'surface', surface: h.surface, header, panel: h.panel, movable: mv || null, start: p.hit.point.clone(), dist: p.hit.distance };
    } else if (h.kind === 'handle') {
      h.begin(p, p.hit.point.clone());
      p.drag = { kind: 'handle', h, dist: p.hit.distance, hand0: p.id === 'mouse' ? 0 : Math.max(0.12, this.handReach(p)) };
    } else if (h.kind === 'button') {
      p.drag = { kind: 'button', h };
    } else if (h.kind === 'object') {
      this.grabObject(p, h, p.hit.point, p.hit.distance, false);
    }
  }

  up(p) {
    p.pressed = false;
    p.lastBusy = performance.now();
    const d = p.drag;
    p.drag = null;
    if (!d) return;
    if (d.kind === 'surface') {
      const h = p.hit && p.hit.object.userData.interactive;
      d.surface.pointer('up', h && h.surface === d.surface ? p.hit.uv : null, p);
    } else if (d.kind === 'handle') d.h.end(p);
    else if (d.kind === 'button') {
      const h = p.hit && p.hit.object.userData.interactive;
      if (h === d.h) {
        this.world.sound.click(p.hit.point);
        d.h.press(p);
      }
    } else if (d.kind === 'object') {
      const h = d.obj.userData.interactive;
      if (h && h.onRelease) h.onRelease(p);
    }
  }

  release(p) {
    if (p.poke && p.poke.pressed) p.poke.surface.pointer('up', null, p);
    p.poke = null;
    if (p.drag) this.up(p);
  }

  grabObject(p, h, point, dist, near) {
    const obj = h.object;
    const other = this.pointers.find((q) => q !== p && q.drag && q.drag.kind === 'object' && q.drag.obj === obj);
    if (other) {
      const a = this.dragPoint(other);
      p.drag = { kind: 'scale', obj, other, dist, near, d0: a.distanceTo(point), s0: obj.scale.x };
    } else {
      const local = obj.worldToLocal(point.clone());
      // turn your hand and the object turns with it (for things you inspect); from afar, pull your
      // hand in to bring it closer
      const q0 = h.rotates ? this.frameOf(p) : null;
      p.drag = { kind: 'object', obj, dist, near, local, q0, oq0: obj.quaternion.clone(), hand0: near || p.id === 'mouse' ? 0 : Math.max(0.12, this.handReach(p)) };
      if (h.onGrab) h.onGrab(p);
    }
    this.world.sound.click(point);
  }

  /** How a hand or controller is turned (world), or null (mouse). */
  frameOf(p) {
    const hs = this.hand(p);
    if (hs) {
      const f = new THREE.Vector3().subVectors(hs.p['middle-finger-metacarpal'], hs.p.wrist).normalize();
      const r = new THREE.Vector3().crossVectors(f, hs.palm).normalize();
      const u = new THREE.Vector3().crossVectors(r, f);
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.negate()));
    }
    return p.obj ? p.obj.getWorldQuaternion(new THREE.Quaternion()) : null;
  }

  /** Distance from your head to this hand / controller (horizontal-ish), for push-pull. */
  handReach(p) {
    const head = this.head();
    return Math.hypot(p.origin.x - head.x, p.origin.z - head.z) + Math.abs(p.origin.y - head.y) * 0.3;
  }

  /** Where a drag currently points: your pinch (near) or along the ray (far, with push-pull). */
  dragPoint(p) {
    const d = p.drag;
    if (d.near) {
      const pp = this.pinchPoint(p);
      if (pp) return pp;
    }
    let dist = d.dist;
    if (d.hand0) {
      const k = this.handReach(p) / d.hand0;
      dist = THREE.MathUtils.clamp(d.dist * Math.pow(k, 2.2), 0.25, 5);
    }
    return p.origin.clone().addScaledVector(p.dir, dist);
  }

  nearGrabbable(point) {
    let best = null;
    let bestD = NEAR_GRAB;
    const v = new THREE.Vector3();
    for (const o of this.world.interactives()) {
      const h = o.userData.interactive;
      if (!h || (h.kind !== 'handle' && h.kind !== 'object')) continue;
      o.getWorldPosition(v);
      const d = v.distanceTo(point);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ per frame

  rayFrom(p) {
    if (p.id === 'mouse') {
      this.mouseRay(this.mouseCam, this.mouseNdc);
      return;
    }
    p.obj.updateMatrixWorld();
    p.origin.setFromMatrixPosition(p.obj.matrixWorld);
    p.dir.set(0, 0, -1).transformDirection(p.obj.matrixWorld);
  }

  /** Fingertip near a surface? Then it is a touch, not a ray. */
  updatePoke(p) {
    const hs = this.hand(p);
    if (!hs || (p.drag && p.drag.kind !== 'poke')) return false;
    const tip = hs.p['index-finger-tip'];
    // small buttons (the close dot under each window) are touched directly
    const nowMs = performance.now();
    const bv = new THREE.Vector3();
    for (const o of this.world.interactives()) {
      const h = o.userData.interactive;
      if (h && h.touch) {
        // small things in the air (app charms): a fingertip pushed through the face, from the front
        const l = o.worldToLocal(bv.copy(tip));
        const r = h.touchR || 0.04;
        const key = o.uuid;
        p.touchZ = p.touchZ || {};
        if (Math.abs(l.x) < r && Math.abs(l.y) < r && l.z > -0.03 && l.z < 0.07) {
          const prevZ = p.touchZ[key];
          p.touchZ[key] = l.z;
          if (prevZ !== undefined && prevZ > 0.008 && l.z <= 0.008 && nowMs - (p.btnAt || 0) > 700) {
            p.btnAt = nowMs;
            h.touch(p);
          }
          p.lastBusy = nowMs;
        } else delete p.touchZ[key];
        continue;
      }
      if (!h || h.kind !== 'button') continue;
      if (o.getWorldPosition(bv).distanceTo(tip) < 0.02) {
        if (nowMs - (p.btnAt || 0) > 900) {
          p.btnAt = nowMs;
          this.world.sound.click(bv);
          h.press(p);
        }
        p.lastBusy = nowMs;
        return false;
      }
    }
    let best = null;
    const loc = this.tmp;
    for (const s of this.world.surfaces()) {
      if (!s.mesh.visible || s.mat.uniforms.uOpacity.value < 0.5) continue;
      s.locate(tip, loc);
      const mx = 0.015 / s.w;
      const my = 0.015 / s.h;
      if (loc.u < -mx || loc.u > 1 + mx || loc.v < -my || loc.v > 1 + my) continue;
      if (loc.d > POKE_RANGE || loc.d < -0.04) continue;
      if (!best || Math.abs(loc.d) < Math.abs(best.d)) best = { surface: s, d: loc.d, uv: { x: THREE.MathUtils.clamp(loc.u, 0, 1), y: THREE.MathUtils.clamp(loc.v, 0, 1) } };
    }
    const prev = p.poke;
    if (!best) {
      if (prev) {
        if (prev.pressed) prev.surface.pointer('up', null, p);
        p.poke = null;
        p.lastBusy = performance.now();
      }
      return false;
    }
    // only a finger coming from the front presses (not one already behind the window)
    const wasFront = prev && prev.surface === best.surface ? prev.d : best.d > 0.02 ? best.d : -1;
    const pressed = prev && prev.surface === best.surface ? prev.pressed : false;
    if (prev && prev.surface !== best.surface && prev.pressed) prev.surface.pointer('up', null, p);
    p.poke = { surface: best.surface, d: best.d, uv: best.uv, pressed };
    this.setOver(p, best.surface.mesh.userData.interactive, best.surface.mesh);
    if (!pressed && best.d < POKE_PRESS && wasFront >= POKE_PRESS) {
      p.poke.pressed = true;
      best.surface.pointer('down', best.uv, p);
      this.world.emit('pinch', { pointer: p, target: best.surface.mesh.userData.interactive, poke: true });
    } else if (pressed && best.d > POKE_RELEASE) {
      p.poke.pressed = false;
      best.surface.pointer('up', best.uv, p);
    } else best.surface.pointer(pressed ? 'move' : 'hover', best.uv, p);
    p.lastBusy = performance.now();
    return true;
  }

  updatePointer(p) {
    this.rayFrom(p);
    if (p.id !== 'mouse' && this.updatePoke(p)) {
      p.hit = null;
      return;
    }
    this.raycaster.set(p.origin, p.dir);
    const hits = this.raycaster.intersectObjects(this.world.interactives(), false);
    const hit = hits.find((x) => x.object.userData.interactive) || null;
    p.hit = hit;
    const h = hit && hit.object.userData.interactive;
    // while dragging a surface keep talking to it, even if the ray slides off
    if (p.drag && p.drag.kind === 'surface') {
      if (h && h.surface === p.drag.surface) p.drag.surface.pointer('move', hit.uv, p);
      return;
    }
    if (p.drag) return;
    this.setOver(p, h, hit && hit.object);
    if (h && h.kind === 'surface') h.surface.pointer('hover', hit.uv, p);
  }

  /** Touch controllers: grip grabs the window you point at, the thumbstick scrolls it,
   *  A / X opens the quick ring, B / Y brings the windows in front, a thumbstick click opens Apps. */
  controller(p) {
    const gp = p.source && p.source.gamepad;
    if (!gp || p.isHand) return;
    const b = gp.buttons;
    const prev = p.prevButtons || [];
    const down = (i) => !!(b[i] && b[i].pressed);
    const edge = (i) => down(i) && !prev[i];
    const now = performance.now();
    if (edge(1) && p.hit && !p.drag) {
      const h = p.hit.object.userData.interactive;
      const panel = h && h.panel;
      if (panel && !panel.pinned) {
        panel.beginMove(p.hit.point.clone());
        p.drag = { kind: 'handle', h: panel.barHit.userData.interactive, dist: p.hit.distance, hand0: Math.max(0.12, this.handReach(p)), grip: true };
      } else if (h && h.kind === 'handle') {
        h.begin(p, p.hit.point.clone());
        p.drag = { kind: 'handle', h, dist: p.hit.distance, hand0: Math.max(0.12, this.handReach(p)), grip: true };
      }
    }
    if (!down(1) && prev[1] && p.drag && p.drag.grip) {
      p.drag.h.end(p);
      p.drag = null;
    }
    const ay = gp.axes[3] || 0;
    if (Math.abs(ay) > 0.55 && now - (p.wheelAt || 0) > 130 && p.hit) {
      p.wheelAt = now;
      const h = p.hit.object.userData.interactive;
      const app = h && h.panel && h.panel.app;
      if (app && app.wheel) app.wheel(ay > 0 ? 1 : -1, h.surface.px(p.hit.uv));
    }
    if (edge(4)) this.world.quick.toggle(p.origin.clone().addScaledVector(p.dir, 0.4));
    if (edge(5)) this.world.recenter();
    if (edge(3)) this.world.launcher.toggle();
    p.prevButtons = b.map((x) => x.pressed);
  }

  update() {
    for (const p of this.pointers) {
      if (!p.active) continue;
      this.updatePointer(p);
      this.controller(p);
      let d = p.drag;
      if (d && d.kind === 'surface' && d.header) {
        const now = p.origin.clone().addScaledVector(p.dir, d.dist);
        if (now.distanceTo(d.start) > 0.03) {
          // it became a move: let go of the button press, grab the window where you pinched it
          d.surface.pointer('leave', null, p);
          let h;
          if (d.panel) {
            h = d.panel.barHit.userData.interactive;
            d.panel.beginMove(d.start);
          } else {
            const mv = d.movable;
            h = { kind: 'handle', begin: () => {}, drag: (q, point) => mv.drag(point), end: () => mv.end && mv.end() };
            mv.begin(d.start);
          }
          p.drag = d = { kind: 'handle', h, dist: d.dist, hand0: p.id === 'mouse' ? 0 : Math.max(0.12, this.handReach(p)) };
        }
      }
      if (d && d.kind === 'handle') d.h.drag(p, this.dragPoint(p));
      else if (d && d.kind === 'object') {
        if (d.q0) {
          const q = this.frameOf(p);
          if (q) d.obj.quaternion.copy(q.multiply(d.q0.clone().invert()).multiply(d.oq0));
        }
        const target = this.dragPoint(p);
        const offset = d.local.clone().multiply(d.obj.scale).applyQuaternion(d.obj.quaternion);
        d.obj.position.copy(target.sub(offset));
        const h = d.obj.userData.interactive;
        if (h && h.onDrag) h.onDrag(p);
      } else if (d && d.kind === 'scale' && d.other.drag) {
        const a = this.dragPoint(d.other);
        const b = this.dragPoint(p);
        d.obj.scale.setScalar(THREE.MathUtils.clamp(d.s0 * (a.distanceTo(b) / Math.max(0.02, d.d0)), 0.2, 4));
      }
      this.drawRay(p);
    }
  }

  drawRay(p) {
    const r = p.reticle;
    if (p.poke) {
      // fingertip cursor: a ring on the surface that tightens as you get closer
      p.ray.visible = false;
      const s = p.poke.surface;
      const pt = s.mesh.localToWorld(new THREE.Vector3((p.poke.uv.x - 0.5) * s.w, (p.poke.uv.y - 0.5) * s.h, 0.002));
      r.visible = true;
      r.position.copy(pt);
      r.quaternion.copy(s.mesh.getWorldQuaternion(new THREE.Quaternion()));
      const k = 0.55 + Math.min(1, Math.max(0, p.poke.d) / POKE_RANGE) * 1.1;
      r.scale.setScalar(k);
      r.userData.dot.material.opacity = p.poke.pressed ? 1 : 0;
      r.userData.ring.material.color.set(p.poke.pressed ? 0xe2472c : 0xece5d6);
      return;
    }
    p.ray.visible = p.id !== 'mouse';
    r.visible = !!p.hit;
    const len = p.hit ? p.hit.distance : 0.3;
    const pos = p.ray.geometry.attributes.position;
    pos.setXYZ(0, p.origin.x + p.dir.x * 0.06, p.origin.y + p.dir.y * 0.06, p.origin.z + p.dir.z * 0.06);
    pos.setXYZ(1, p.origin.x + p.dir.x * len, p.origin.y + p.dir.y * len, p.origin.z + p.dir.z * len);
    pos.needsUpdate = true;
    p.ray.material.uniforms.uOpacity.value = p.hit ? 0.7 : 0.16;
    p.ray.geometry.computeBoundingSphere();
    if (p.hit) {
      r.position.copy(p.hit.point).addScaledVector(p.dir, -0.004);
      r.lookAt(p.origin);
      const s = p.pressed ? 0.65 : 1;
      r.scale.lerp(new THREE.Vector3(s, s, s), 0.35);
      r.userData.dot.material.opacity = p.pressed ? 1 : 0;
      r.userData.ring.material.color.set(p.pressed ? 0xe2472c : 0xece5d6);
    }
  }
}
