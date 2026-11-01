// The 3D side of a note: ink lines drawn in the air, text cards you place, move and resize, and the
// pencil — a stylus that appears in your hand so you see exactly where the ink comes out.
// Everything lives in the note window's own space, so it follows the window and comes back with it.
import * as THREE from 'three';
import { Surface } from '../surface.js';
import { T, text, paragraph, cutPath, font, icon } from '../theme.js';
import { drawStrip } from '../panels.js';

export const INKS = { ink: 0xece5d6, seal: 0xe2472c, gold: 0xc9a35a };
/** The swatches in the 3D row (any '#rrggbb' from the hue bar works too). */
export const PALETTE = ['ink', 'seal', 'gold', '#ffffff', '#8a857b', '#161615', '#ff8a3d', '#f5d547', '#5fd38d', '#3fc1c9', '#4a7dff', '#b46cff'];
/** A line's colour, from a name or '#rrggbb'. */
export const inkOf = (c) => (INKS[c] != null ? INKS[c] : typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : INKS.ink);
export const WIDTHS = { s: 0.0015, m: 0.0028, l: 0.005 };
const HIT = new THREE.MeshBasicMaterial({ visible: false });
const HALO = new THREE.MeshBasicMaterial({ color: 0xe2472c, transparent: true, opacity: 0.28, depthWrite: false });
const UP = new THREE.Vector3(0, 1, 0);

/** A paper card with text, floating in the space. Drag it anywhere; pull its corner to resize; ✕ removes it.
 *  The handles sit quietly on the card and come forward when you point at it or touch it. */
class Card {
  constructor(n3d, data) {
    this.n3d = n3d;
    this.data = data;
    const world = n3d.world;
    this.surface = new Surface(world, {
      size: [0.26, 0.15],
      ss: 2.2,
      name: 'card',
      draw: (g, ui, W, H) => this.draw(g, ui, W, H),
      click: (id) => (id === 'close' ? n3d.deleteCard(this) : n3d.edit(this)),
    });
    this.mesh = this.surface.mesh;
    this.mesh.position.fromArray(data.p);
    this.mesh.scale.setScalar(data.s || 1);
    // whole card = drag handle (a tap still edits it)
    this.surface.movable = {
      zone: (x, y) => !(x > this.surface.W - 52 && y < 52), // not from the ✕
      begin: (pt) => (this.off = this.mesh.getWorldPosition(new THREE.Vector3()).sub(pt)),
      drag: (pt) => this.setWorld(pt.clone().add(this.off)),
      end: () => n3d.notes.save(),
    };
    // bottom-right corner: resize
    this.corner = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshBasicMaterial({ visible: false }));
    this.corner.position.set(0.13, -0.075, 0.002);
    this.corner.userData.interactive = {
      kind: 'handle',
      begin: (p, pt) => (this.rs = { s0: this.mesh.scale.x, d0: Math.max(0.03, pt.distanceTo(this.mesh.getWorldPosition(new THREE.Vector3()))) }),
      drag: (p, pt) => {
        const s = THREE.MathUtils.clamp((this.rs.s0 * pt.distanceTo(this.mesh.getWorldPosition(new THREE.Vector3()))) / this.rs.d0, 0.4, 4);
        this.mesh.scale.setScalar(s);
        this.data.s = Math.round(s * 100) / 100;
      },
      end: () => n3d.notes.save(),
    };
    this.mesh.add(this.corner);
  }

  setWorld(pt) {
    const local = this.n3d.group.worldToLocal(pt.clone());
    this.mesh.position.copy(local);
    this.data.p = local.toArray().map((v) => Math.round(v * 1000) / 1000);
  }

  draw(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    const editing = this.n3d.editing === this;
    cutPath(g, 0, 0, W, H, 10);
    g.fillStyle = '#ece5d6';
    g.fill();
    if (editing) {
      g.strokeStyle = T.seal;
      g.lineWidth = 4;
      g.stroke();
    }
    const hot = editing || this.surface.hovers > 0;
    g.fillStyle = T.seal;
    g.fillRect(16, 16, 8, 8);
    // grip: you can carry the card by any part of it
    g.fillStyle = hot ? '#5d5950' : '#b9b2a4';
    for (let i = -2; i <= 2; i++) g.fillRect(W / 2 + i * 9 - 1.5, 12, 3, 3);
    const body = (this.data.text || '') + (editing ? '▏' : '');
    if (!body) text(g, 'Tap to write', 16, 62, { size: 22, color: '#8a857b' });
    else paragraph(g, body, 16, 58, W - 32, { size: 23, lh: 1.35, color: '#161615', weight: 500, maxLines: 4 });
    ui.hit('card', 0, 0, W, H);
    // resize: a seal bracket in the corner you pull
    g.strokeStyle = hot ? T.seal : '#8a857b';
    g.lineWidth = hot ? 4 : 2.5;
    g.beginPath();
    g.moveTo(W - 34, H - 9);
    g.lineTo(W - 9, H - 9);
    g.lineTo(W - 9, H - 34);
    g.stroke();
    if (hot) {
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(W - 22, H - 15);
      g.lineTo(W - 15, H - 22);
      g.stroke();
    }
    // ✕: remove the card
    cutPath(g, W - 46, 8, 38, 38, 5);
    g.fillStyle = hot ? '#161615' : 'rgba(22,22,21,0.1)';
    g.fill();
    icon(g, 'close', W - 37, 17, 20, hot ? '#ece5d6' : '#8a857b');
    ui.hit('close', W - 52, 0, 52, 52);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.surface.dispose();
  }
}

function makePencil() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.12, 12), new THREE.MeshBasicMaterial({ color: 0x242427 }));
  body.position.y = -0.075;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.012, 12), new THREE.MeshBasicMaterial({ color: 0xece5d6 }));
  band.position.y = -0.022;
  // the sharpened end: wide at the body, its point at the tip (the group's origin)
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.0042, 0.016, 12), new THREE.MeshBasicMaterial({ color: 0xece5d6 }));
  cone.position.y = -0.008;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe2472c }));
  g.add(body, band, cone, tip);
  g.userData.tip = tip;
  g.userData.cone = cone;
  g.userData.band = band;
  g.visible = false;
  return g;
}

export class Notes3D {
  constructor(world, notes) {
    this.world = world;
    this.notes = notes;
    this.group = new THREE.Group(); // attached to the note window
    this.cards = [];
    this.editing = null;
    this.source = 'pencil'; // 'hand' | 'pencil'
    this.color = 'ink';
    this.width = 'm';
    this.stroke = null;
    this.mode = 'draw'; // 'draw' | 'select': in Select, pinch a line to pick it up, move it, recolour it
    this.sel = -1; // the chosen line (index in note.ink3d)
    this.lines = []; // one group per line: { group, hit }
    this.pencil = makePencil();
    world.scene.add(this.pencil);
  }

  // ------------------------------------------------------------------ build from a note

  rebuild(note) {
    this.endEdit();
    for (const c of this.cards) c.dispose();
    this.cards = [];
    if (this.selUI) for (const o of [this.selUI.brackets, this.selUI.strip.mesh, this.selUI.corner]) o.removeFromParent(); // kept, not disposed
    for (const ch of [...this.group.children]) {
      ch.removeFromParent();
      ch.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.lines = [];
    if (!note) return;
    if (this.sel >= (note.ink3d || []).length) this.sel = -1;
    (note.ink3d || []).forEach((s, i) => this.addLine(s, i));
    for (const c of note.cards || []) this.addCardMesh(c);
  }

  tube(s) {
    const v = [];
    for (let i = 0; i < s.pts.length; i += 3) v.push(new THREE.Vector3(s.pts[i], s.pts[i + 1], s.pts[i + 2]));
    const curve = new THREE.CatmullRomCurve3(v);
    const geo = new THREE.TubeGeometry(curve, Math.min(400, v.length * 3), s.r || WIDTHS[s.w] || WIDTHS.m, 6, false);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: inkOf(s.c) }));
  }

  /** A line: its ink tube, plus a fatter invisible tube that is easy to pinch (red when chosen). */
  addLine(s, idx) {
    const g = new THREE.Group();
    const ink = this.tube(s);
    const hit = new THREE.Mesh(new THREE.TubeGeometry(ink.geometry.parameters.path, Math.min(120, ink.geometry.parameters.tubularSegments), 0.014, 5, false), idx === this.sel ? HALO : HIT);
    ink.geometry.computeBoundingBox();
    const c0 = ink.geometry.boundingBox.getCenter(new THREE.Vector3());
    ink.geometry.translate(-c0.x, -c0.y, -c0.z);
    hit.geometry.translate(-c0.x, -c0.y, -c0.z);
    g.position.copy(c0);
    g.userData.c0 = c0.clone();
    g.userData.idx = idx;
    g.add(ink, hit);
    const info = {
      kind: 'object',
      object: g,
      onGrab: () => {
        this.select(idx);
        this.world.scene.attach(g);
      },
      onRelease: () => {
        this.group.attach(g);
        this.commit(g);
      },
    };
    hit.userData.interactive = info;
    g.userData.interactive = info;
    this.group.add(g);
    this.lines.push({ group: g, hit });
  }

  /** Keep where (and how big) you made it: bake the line's move / size into its points. */
  commit(g) {
    const idx = g.userData.idx;
    const data = this.notes.note.ink3d[idx];
    if (!data) return;
    g.updateMatrix();
    const v = new THREE.Vector3();
    const c0 = g.userData.c0;
    const k = g.scale.x;
    for (let i = 0; i < data.pts.length; i += 3) {
      v.set(data.pts[i] - c0.x, data.pts[i + 1] - c0.y, data.pts[i + 2] - c0.z).applyMatrix4(g.matrix);
      data.pts[i] = Math.round(v.x * 10000) / 10000;
      data.pts[i + 1] = Math.round(v.y * 10000) / 10000;
      data.pts[i + 2] = Math.round(v.z * 10000) / 10000;
    }
    // a line made bigger gets a thicker stroke too
    if (Math.abs(k - 1) > 0.05) data.r = Math.max(0.0008, Math.min(0.03, (data.r || WIDTHS[data.w] || WIDTHS.m) * k));
    this.rebuild(this.notes.note);
    this.select(idx);
    this.notes.save();
  }

  select(idx) {
    this.sel = idx;
    this.lines.forEach((l, i) => (l.hit.material = i === idx ? HALO : HIT));
    this.placeSelection();
    this.notes.invalidate();
  }

  /** Around the chosen line: corner brackets, a strip under it (✕ deletes it, the grip moves it) and a
   *  red corner to pull for size. They ride on the line, so they follow it while you carry it. */
  placeSelection() {
    if (!this.selUI) {
      const brackets = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe2472c }));
      const strip = new Surface(this.world, {
        size: [0.16, 0.034],
        ss: 3,
        name: 'line-strip',
        draw: (g, ui, W, H) => drawStrip(g, ui, W, H),
        click: (id) => id === 'close' && this.deleteSelected(),
      });
      strip.movable = {
        zone: (x) => x > 48,
        begin: (pt) => {
          const l = this.lines[this.sel];
          if (l) this.carry = { g: l.group, off: l.group.getWorldPosition(new THREE.Vector3()).sub(pt) };
        },
        drag: (pt) => {
          const c = this.carry;
          if (c) c.g.position.copy(this.group.worldToLocal(pt.clone().add(c.off)));
        },
        end: () => {
          if (this.carry) this.commit(this.carry.g);
          this.carry = null;
        },
      };
      const corner = new THREE.Group();
      corner.add(new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe2472c })));
      const cornerHit = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), HIT);
      corner.add(cornerHit);
      cornerHit.userData.interactive = {
        kind: 'handle',
        begin: (p, pt) => {
          const l = this.lines[this.sel];
          if (!l) return;
          const c = l.group.getWorldPosition(new THREE.Vector3());
          this.sizing = { g: l.group, c, s0: l.group.scale.x, d0: Math.max(0.02, pt.distanceTo(c)) };
        },
        drag: (p, pt) => {
          const z = this.sizing;
          if (z) z.g.scale.setScalar(THREE.MathUtils.clamp((z.s0 * pt.distanceTo(z.c)) / z.d0, 0.2, 6));
        },
        end: () => {
          if (this.sizing) this.commit(this.sizing.g);
          this.sizing = null;
        },
      };
      this.selUI = { brackets, strip, corner, cornerHit };
    }
    const ui = this.selUI;
    const l = this.lines[this.sel];
    for (const o of [ui.brackets, ui.strip.mesh, ui.corner]) o.removeFromParent();
    if (!l || this.mode !== 'select') return;
    const box = l.group.children[0].geometry.boundingBox || (l.group.children[0].geometry.computeBoundingBox(), l.group.children[0].geometry.boundingBox);
    const min = box.min.clone().addScalar(-0.012);
    const max = box.max.clone().addScalar(0.012);
    const pts = [];
    const k = 0.25;
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const sx = x === min.x ? 1 : -1;
          const sy = y === min.y ? 1 : -1;
          const sz = z === min.z ? 1 : -1;
          pts.push(x, y, z, x + sx * (max.x - min.x) * k, y, z, x, y, z, x, y + sy * (max.y - min.y) * k, z, x, y, z, x, y, z + sz * (max.z - min.z) * k);
        }
    ui.brackets.geometry.dispose();
    ui.brackets.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    ui.strip.mesh.position.set((min.x + max.x) / 2, min.y - 0.03, (min.z + max.z) / 2);
    ui.corner.position.set(max.x, min.y, max.z);
    l.group.add(ui.brackets, ui.strip.mesh, ui.corner);
  }

  /** Paper / Seal / Gold: the chosen line in Select, the next line in Draw. */
  setColor(c) {
    const note = this.notes.note;
    if (this.mode === 'select' && note && note.ink3d[this.sel]) {
      note.ink3d[this.sel].c = c;
      this.rebuild(note);
      this.select(this.sel);
      this.notes.save();
    } else this.color = c;
  }

  deleteSelected() {
    const note = this.notes.note;
    if (!note || !note.ink3d[this.sel]) return;
    note.ink3d.splice(this.sel, 1);
    this.sel = -1;
    this.rebuild(note);
    this.notes.save();
  }

  setMode(m) {
    this.mode = m;
    this.select(m === 'draw' ? -1 : this.sel);
  }

  // ------------------------------------------------------------------ cards

  addCardMesh(data) {
    const c = new Card(this, data);
    this.group.add(c.mesh);
    this.cards.push(c);
    return c;
  }

  /** A new card in front of you (between you and the note), ready to type into. */
  newCard() {
    const note = this.notes.note;
    const head = this.world.camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(this.world.camera.matrixWorld);
    const pt = head.clone().addScaledVector(fwd, 0.7).add(new THREE.Vector3(0.1 * (this.cards.length % 3), -0.05, 0));
    const data = { id: `c${Date.now().toString(36)}`, text: '', p: this.group.worldToLocal(pt.clone()).toArray(), s: 1 };
    note.cards = note.cards || [];
    note.cards.push(data);
    const c = this.addCardMesh(data);
    this.edit(c);
    return c;
  }

  edit(card) {
    this.editing = card;
    for (const c of this.cards) c.surface.dirty = true;
    this.world.keyboard.showFor(this.notes);
  }

  endEdit() {
    if (!this.editing) return;
    const c = this.editing;
    this.editing = null;
    c.surface.dirty = true;
    // an empty card disappears when you leave it
    if (!c.data.text) this.removeCard(c);
  }

  /** ✕ on a card: gone (Undo in the note does not bring it back). */
  deleteCard(c) {
    const at = c.mesh.getWorldPosition(new THREE.Vector3());
    if (this.editing === c) {
      this.editing = null;
      this.world.keyboard.hide();
    }
    this.removeCard(c);
    this.world.sound.close(at);
    this.notes.save();
  }

  removeCard(c) {
    const note = this.notes.note;
    note.cards = (note.cards || []).filter((d) => d !== c.data);
    this.cards = this.cards.filter((x) => x !== c);
    c.dispose();
  }

  typeInto(k) {
    const c = this.editing;
    if (!c) return false;
    if (k === 'Enter') c.data.text += '\n';
    else if (k === 'Backspace') c.data.text = c.data.text.slice(0, -1);
    else if (k.length === 1) c.data.text += k;
    c.surface.dirty = true;
    this.notes.save();
    return true;
  }

  // ------------------------------------------------------------------ drawing

  /** Where ink comes out for this pointer: the pencil tip, your pinch, or a point ahead of a controller. */
  tipOf(p) {
    const input = this.world.input;
    const hs = input.hand(p);
    if (hs) {
      const pinch = input.pinchPoint(p);
      if (this.source === 'hand') return { tip: pinch, dir: null };
      const dir = pinch.clone().sub(hs.p.wrist).normalize();
      return { tip: pinch.clone().addScaledVector(dir, 0.06), dir };
    }
    const dir = p.dir.clone();
    return { tip: p.origin.clone().addScaledVector(dir, p.id === 'mouse' ? 0.6 : 0.07), dir };
  }

  /** The pointer that draws: whichever is pinching, else your right hand / controller. */
  drawer() {
    const ps = this.world.input.pointers.filter((p) => p.active && p.id !== 'mouse');
    return ps.find((p) => p.pressed) || ps.find((p) => p.handedness === 'right') || ps[0] || null;
  }

  start(pointer) {
    if (this.mode !== 'draw') return;
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: inkOf(this.color) }));
    line.frustumCulled = false;
    this.group.add(line);
    this.stroke = { pointer, pts: [], line };
  }

  finish() {
    const s = this.stroke;
    this.stroke = null;
    s.line.removeFromParent();
    s.line.geometry.dispose();
    if (s.pts.length < 9) return;
    const data = { pts: s.pts.map((v) => Math.round(v * 10000) / 10000), c: this.color, w: this.width };
    this.notes.note.ink3d.push(data);
    this.notes.history.push('3d');
    this.addLine(data, this.notes.note.ink3d.length - 1);
    this.world.sound.tick(this.group.getWorldPosition(new THREE.Vector3()));
    this.notes.save();
  }

  clear3d() {
    const note = this.notes.note;
    note.ink3d = [];
    this.rebuild(note);
    this.notes.save();
  }

  // ------------------------------------------------------------------ per frame

  interactives() {
    const out = [];
    for (const c of this.cards) out.push(c.mesh, c.corner);
    if (this.mode === 'select') for (const l of this.lines) out.push(l.hit); // lines can be picked up only in Select
    if (this.selUI && this.selUI.strip.mesh.parent) out.push(this.selUI.strip.mesh, this.selUI.cornerHit);
    return out;
  }

  surfaces() {
    const out = this.cards.map((c) => c.surface);
    if (this.selUI && this.selUI.strip.mesh.parent) out.push(this.selUI.strip);
    return out;
  }

  update(t, dt, active) {
    // the pencil rides the drawing hand while 3D drawing with the pencil
    const drawing = active && this.world.drawMode === this.notes && this.mode === 'draw';
    const p = drawing && this.source === 'pencil' ? this.drawer() : null;
    if (p) {
      const { tip, dir } = this.tipOf(p);
      this.pencil.visible = true;
      this.pencil.position.copy(tip);
      // the body runs back from the tip, through your fingers, toward your wrist
      if (dir) this.pencil.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate());
      // the sharpened end and its point show the ink you will draw with
      const ink = inkOf(this.color);
      this.pencil.userData.tip.material.color.setHex(this.color === 'ink' ? 0xe2472c : ink);
      this.pencil.userData.cone.material.color.setHex(ink);
      this.pencil.userData.band.material.color.setHex(ink);
    } else this.pencil.visible = false;
    // a stroke in progress
    const s = this.stroke;
    if (s) {
      if (!s.pointer.pressed) this.finish();
      else {
        const local = this.group.worldToLocal(this.tipOf(s.pointer).tip);
        const n = s.pts.length;
        if (!n || local.distanceTo(new THREE.Vector3(s.pts[n - 3], s.pts[n - 2], s.pts[n - 1])) > 0.003) {
          s.pts.push(local.x, local.y, local.z);
          s.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(s.pts, 3));
        }
      }
    }
    // the chosen line's strip faces you
    if (this.selUI && this.selUI.strip.mesh.parent) {
      this.selUI.strip.mesh.lookAt(this.world.camera.getWorldPosition(new THREE.Vector3()));
      this.selUI.strip.update(t, dt);
    }
    // cards face you and stay crisp
    if (this.cards.length) {
      const head = this.world.camera.getWorldPosition(new THREE.Vector3());
      for (const c of this.cards) {
        // the handles light up while you point at or touch the card
        const hot = c.surface.hovers > 0;
        if (hot !== c.hot) {
          c.hot = hot;
          c.surface.dirty = true;
        }
        c.mesh.lookAt(head);
        c.surface.mat.uniforms.uOpacity.value = this.notes.panel ? this.notes.panel.surface.mat.uniforms.uOpacity.value : 1;
        c.surface.update(t, dt);
      }
    }
  }
}
