// The scanner: turns a real thing into a 3D point model with the headset's depth sensing.
// A box appears on the table in front of you (or at chest height). Put the thing inside it, press
// Scan and walk slowly around it: points gather where the depth camera sees a surface inside the box,
// and the ring on the floor of the box fills in as you cover each side. Save keeps it as a .ply in
// Models, and puts it on the stage. Every point takes its colour from the headset's own camera
// (through the Quest app), and Dots / Mesh shows it as a cloud or as a solid, coloured surface.
//
// How depth is read: Quest Browser gives the depth map as a GPU texture (aligned with the left eye,
// in that eye's depth-buffer encoding). While scanning, a tiny shader pass copies a 96 × 96 grid of
// it — only the part of your view the box covers — ~18 times a second; each texel is unprojected into
// the room. Every ray also updates a fusion volume (fusion.js), so the mesh is the average of many
// views rather than one noisy layer, and each camera picture is matched to where your head was when
// it was taken, so colours land where they belong.
import * as THREE from 'three';
import { Surface } from './surface.js';
import { Spring } from './spring.js';
import { T, text, cutPath, icon, hudTag } from './theme.js';
import { api } from './api.js';
import { ScanCamera, TO_LINEAR } from './scancam.js';
import { MarchingCubes } from '../vendor/MarchingCubes.js';
import { Fusion } from './fusion.js';

const INK = [236, 229, 214];
const FUS = 64; // fusion cells per side of the box (S 3 mm, M 5.5 mm, L 9.4 mm: about what depth can tell apart)

const GRID = 96; // depth samples per side, per read (over the box only, not the whole view)
const MAX = 150000; // points kept
const VOXEL = 0.003; // one point per 3 mm cube
const FLOOR_CUT = 0.006; // the table under the thing is not part of it
const SIZES = { s: 0.2, m: 0.35, l: 0.6 };
const SEGS = 36; // coverage ring

function bracketGeo(s) {
  const k = 0.22;
  const pts = [];
  for (const x of [-1, 1])
    for (const y of [0, 1])
      for (const z of [-1, 1]) {
        const px = (x * s) / 2;
        const py = y * s;
        const pz = (z * s) / 2;
        pts.push(px, py, pz, px - x * s * k, py, pz, px, py, pz, px, py + (y ? -1 : 1) * s * k, pz, px, py, pz, px, py, pz - z * s * k);
      }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}

export class Scanner {
  constructor(world) {
    this.world = world;
    this.on = false;
    this.scanning = false;
    this.size = 'm';
    this.saving = false;
    this.showS = new Spring(0, { stiffness: 240, damping: 24 });
    this.group = new THREE.Group(); // the box: origin at the middle of its floor
    this.group.visible = false;
    world.scene.add(this.group);
    this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.14 }));
    this.brackets = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xece5d6 }));
    this.group.add(this.edges, this.brackets);
    // coverage ring on the box floor: one segment per 10°, ink once that side is seen
    this.ring = [];
    for (let i = 0; i < SEGS; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      this.group.add(m);
      this.ring.push(m);
    }
    this.seen = new Array(SEGS).fill(false);
    // the points (box-local), grown in place
    this.pos = new Float32Array(MAX * 3);
    this.rgb = new Uint8Array(MAX * 3); // as the camera saw it (sRGB), for saving
    this.pending = []; // points still waiting for a colour (seen before a picture had them)
    this.col = new Float32Array(MAX * 3); // the same, linear, for drawing
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    cg.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.cloud = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.004, sizeAttenuation: true, vertexColors: true }));
    this.cam = new ScanCamera(world);
    // pictures for refining on the PC (LingBot-Map): one every ~0.35 s while scanning, up to 60
    this.pictures = [];
    this.cam.onPicture = (blob, c2w) => {
      if (!this.scanning || this.world.standalone) return;
      const now = performance.now();
      if (now - (this.lastPicture || 0) < 350) return;
      this.lastPicture = now;
      this.pictures.push({ blob, c2w });
      if (this.pictures.length > 60) this.pictures = this.pictures.filter((_, i) => i % 2 === 0);
    };
    this.fusion = new Fusion(FUS);
    this.poses = []; // your head over the last second, to match camera pictures to the moment they were taken
    this.cam.poseAt = (t) => {
      let best = null;
      for (const p of this.poses) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      return best ? best.m : null;
    };
    this.lv2 = new THREE.Vector3();
    this.eyeL = new THREE.Vector3();
    this.lin = [0, 0, 0];
    this.rect = [0, 0, 1, 1];
    this.view = 'dots'; // 'dots' | 'mesh'
    this.mesh = null; // MarchingCubes, made when first asked for
    this.meshRays = -1; // how much fusion the mesh was built from
    this.lv = new THREE.Vector3();
    this.c3 = [0, 0, 0];
    this.cloud.geometry.setDrawRange(0, 0);
    this.cloud.frustumCulled = false;
    this.group.add(this.cloud);
    this.count = 0;
    this.voxels = new Set();
    // status tag above the box
    this.tag = new Surface(world, { size: [0.2, 0.06], ss: 3, name: 'scan-tag', draw: (g, ui, W, H) => this.drawTag(g, ui, W, H) });
    world.scene.add(this.tag.mesh);
    this.tag.mesh.visible = false;
    // controls in front of the box, leaning back
    this.bar = new Surface(world, { size: [0.63, 0.07], ss: 2.6, name: 'scan-bar', draw: (g, ui, W, H) => this.drawBar(g, ui, W, H), click: (id, data) => this.press(id, data) });
    this.bar.mesh.rotation.x = -0.7;
    this.group.add(this.bar.mesh);
    this.bar.movable = {
      zone: (x) => x < 40,
      begin: (pt) => (this.grabOff = this.group.position.clone().sub(pt)),
      drag: (pt) => this.moveTo(pt.clone().add(this.grabOff)),
      end: () => {},
    };
    // the size corner: pull it to make the box any size (the scan starts again at the new size)
    this.corner = new THREE.Group();
    this.cornerDot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 14, 10), new THREE.MeshBasicMaterial({ color: 0xe2472c }));
    this.cornerHit = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.corner.add(this.cornerDot, this.cornerHit);
    this.group.add(this.corner);
    this.cornerHit.userData.interactive = {
      kind: 'handle',
      begin: () => (this.resizing = { side: this.side }),
      drag: (p, pt) => {
        // the corner sits at (s/2, s, s/2): read the size back from where you hold it
        const l = this.group.worldToLocal(pt.clone());
        const s = THREE.MathUtils.clamp(Math.max(l.y, Math.abs(l.x) * 2, Math.abs(l.z) * 2), 0.12, 0.8);
        this.resizing.side = s;
        this.shape(s);
        this.tag.dirty = true;
      },
      end: () => {
        const s = this.resizing.side;
        this.resizing = null;
        this.setSide(s);
      },
    };
    this.setSize('m');
    // depth read-back
    this.rt = null;
    this.px = new Uint8Array(GRID * GRID * 4);
    this.frame = 0;
  }

  // ------------------------------------------------------------------ open / place

  get side() {
    return this.custom || SIZES[this.size];
  }

  depthOk() {
    const s = this.world.session;
    return !!s && !!s.depthUsage;
  }

  open() {
    this.cam.start();
    this.world.needRoom('scan', true);
    // is LingBot-Map installed on the PC? (then Refine shows up)
    if (!this.world.standalone)
      api('/api/space/refine/status')
        .then((r) => {
          this.refineAvailable = !!r.available;
          this.bar.dirty = true;
        })
        .catch(() => (this.refineAvailable = false));
    const W = this.world;
    if (W.xrActive && !this.depthOk()) {
      W.coreSay('Scanning needs depth sensing, which this headset session did not allow.');
      return;
    }
    if (!this.on) {
      this.on = true;
      this.showS.set(0);
      if (!this.count) this.place(); // an unsaved scan keeps its box where it was
      W.sound.open(this.group.position);
      if (W.session && W.session.resumeDepthSensing) {
        try {
          W.session.resumeDepthSensing();
        } catch {}
      }
    }
    this.bar.dirty = true;
  }

  close() {
    if (!this.on) return;
    this.on = false;
    this.scanning = false;
    this.world.needRoom('scan', false);
    this.world.sound.close(this.group.position);
    const s = this.world.session;
    if (s && s.pauseDepthSensing) {
      try {
        s.pauseDepthSensing();
      } catch {}
    }
  }

  headPos() {
    return this.world.camera.getWorldPosition(new THREE.Vector3());
  }

  place() {
    const head = this.headPos();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.world.camera.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const pos = head.clone().addScaledVector(fwd, 0.6);
    pos.y = head.y - 0.45;
    const table = this.world.tableUnder ? this.world.tableUnder(pos) : null;
    if (table != null) pos.y = table;
    this.moveTo(pos, true);
  }

  moveTo(pos, snapTable) {
    const table = this.world.tableUnder ? this.world.tableUnder(pos) : null;
    if (table != null && (snapTable || Math.abs(pos.y - table) < 0.1)) pos.y = table;
    this.group.position.copy(pos);
    const head = this.headPos();
    this.group.rotation.set(0, Math.atan2(head.x - pos.x, head.z - pos.z), 0);
    if (this.count) this.clear(); // the points belong to where the box was
  }

  setSize(k) {
    this.size = k;
    this.custom = null;
    this.shape(this.side);
    this.clear();
  }

  /** Any size (from the corner handle), 12 to 80 cm. */
  setSide(m) {
    this.custom = THREE.MathUtils.clamp(m, 0.12, 0.8);
    this.size = null;
    this.shape(this.custom);
    this.clear();
  }

  /** Lines, ring, bar and corner for a box of side s (no clearing: used live while you pull). */
  shape(s) {
    this.edges.geometry.dispose();
    const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s));
    e.translate(0, s / 2, 0);
    this.edges.geometry = e;
    this.brackets.geometry.dispose();
    this.brackets.geometry = bracketGeo(s);
    const r = s * 0.62;
    this.ring.forEach((m, i) => {
      const a = ((i + 0.5) / SEGS) * Math.PI * 2;
      m.position.set(Math.sin(a) * r, 0.002, Math.cos(a) * r);
      m.scale.set(((Math.PI * 2 * r) / SEGS) * 0.8, 0.012, 1);
      m.rotation.set(-Math.PI / 2, 0, -a);
    });
    this.bar.mesh.position.set(0, 0.03, r + 0.07);
    if (this.corner) this.corner.position.set(s / 2, s, s / 2);
  }

  clear() {
    this.pictures = [];
    this.fusion.reset(this.side);
    this.meshRays = -1;
    this.count = 0;
    this.pending = [];
    if (this.mesh) this.mesh.visible = false;
    this.voxels.clear();
    this.cloud.geometry.setDrawRange(0, 0);
    this.seen.fill(false);
    this.ring.forEach((m) => (m.material.opacity = 0.12));
    this.bar.dirty = true;
    this.tag.dirty = true;
  }

  coverage() {
    return this.seen.filter(Boolean).length / SEGS;
  }

  // ------------------------------------------------------------------ controls

  press(id, data) {
    const W = this.world;
    if (id === 'go') {
      this.scanning = !this.scanning;
      W.sound.blip(this.group.position, this.scanning ? 1 : 0.6);
    } else if (id.startsWith('size:')) this.setSize(data);
    else if (id === 'clear') this.clear();
    else if (id.startsWith('view:')) {
      this.view = data;
      this.showView();
    }
    else if (id === 'save') return this.save();
    else if (id === 'refine') return this.refine();
    else if (id === 'close') return this.close();
    this.bar.dirty = true;
    this.tag.dirty = true;
  }

  /** Binary PLY (x y z + colour), centred on the box floor, sent to the PC's models folder. */
  /** Binary PLY of what you see: the coloured dots, or the coloured mesh (with faces). Centred on the
   *  box floor. Kept in Models (on the PC, or on the Quest without it) and put on the stage. */
  async save() {
    const W = this.world;
    if (this.count < 200) {
      W.coreSay('Not enough of it yet. Walk around it a little more.');
      return;
    }
    this.saving = true;
    this.scanning = false;
    this.bar.dirty = true;
    this.fillColours();
    const mesh = this.view === 'mesh' && this.buildMesh() ? this.mesh : null;
    const buf = mesh ? this.meshPly(mesh) : this.dotsPly();
    const u8 = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    try {
      const saved = await api('/api/space/model-save', { ply: btoa(bin) });
      W.coreSay(`Scan saved in Studio${mesh ? ' as a mesh' : ''}.`);
      W.emit('scanSaved', saved);
      this.clear(); // the next scan starts empty
      this.close();
      const M = W.apps.models;
      await M.refresh();
      M.openUrl(saved.url, saved.file, 'ply', saved.bytes);
    } catch (e) {
      W.coreSay(e.message || 'Could not save the scan.');
    }
    this.saving = false;
    this.bar.dirty = true;
  }

  /** Send the pictures (and where the camera was) to the PC: LingBot-Map rebuilds the thing densely,
   *  at real size, and it lands in Studio like any scan. */
  async refine() {
    const W = this.world;
    if (this.refining) return;
    if (this.pictures.length < 8) {
      W.coreSay('Scan a little longer first: the PC needs more pictures.');
      return;
    }
    this.refining = true;
    this.scanning = false;
    this.bar.dirty = true;
    this.tag.dirty = true;
    W.coreSay('Refining on the PC with LingBot-Map. This takes a minute.');
    const rowMajor = (m) => m.clone().transpose().elements.map((v) => +v.toFixed(6));
    try {
      const frames = [];
      for (const p of this.pictures) {
        const u8 = new Uint8Array(await p.blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        frames.push({ jpg: btoa(bin), c2w: rowMajor(p.c2w) });
      }
      this.group.updateMatrixWorld(true);
      const box = { w2box: rowMajor(this.group.matrixWorld.clone().invert()), side: this.side };
      const saved = await api('/api/space/refine', { frames, box });
      W.coreSay(`Refined: ${saved.points ? `${Math.round(saved.points / 1000)}k points` : 'done'}. It is in Studio.`);
      this.clear();
      this.close();
      const M = W.apps.models;
      await M.refresh();
      M.openUrl(saved.url, saved.file, 'ply', saved.bytes);
    } catch (e) {
      W.coreSay(e.message || 'Refining did not work.');
    }
    this.refining = false;
    this.bar.dirty = true;
    this.tag.dirty = true;
  }

  dotsPly() {
    const n = this.count;
    const head = `ply\nformat binary_little_endian 1.0\ncomment UTSUSHI scan\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
    const hb = new TextEncoder().encode(head);
    const buf = new ArrayBuffer(hb.length + n * 15);
    new Uint8Array(buf).set(hb);
    const dv = new DataView(buf);
    for (let i = 0; i < n; i++) {
      const o = hb.length + i * 15;
      dv.setFloat32(o, this.pos[i * 3], true);
      dv.setFloat32(o + 4, this.pos[i * 3 + 1], true);
      dv.setFloat32(o + 8, this.pos[i * 3 + 2], true);
      dv.setUint8(o + 12, this.rgb[i * 3]);
      dv.setUint8(o + 13, this.rgb[i * 3 + 1]);
      dv.setUint8(o + 14, this.rgb[i * 3 + 2]);
    }
    return buf;
  }

  meshPly(mc) {
    const n = mc.count; // vertices, three per triangle
    const s = this.side;
    const head = `ply\nformat binary_little_endian 1.0\ncomment UTSUSHI scan (mesh)\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${n / 3}\nproperty list uchar int vertex_indices\nend_header\n`;
    const hb = new TextEncoder().encode(head);
    const buf = new ArrayBuffer(hb.length + n * 15 + (n / 3) * 13);
    new Uint8Array(buf).set(hb);
    const dv = new DataView(buf);
    const toS = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
    let o = hb.length;
    for (let i = 0; i < n; i++) {
      dv.setFloat32(o, (mc.positionArray[i * 3] * s) / 2, true);
      dv.setFloat32(o + 4, ((mc.positionArray[i * 3 + 1] + 1) * s) / 2, true);
      dv.setFloat32(o + 8, (mc.positionArray[i * 3 + 2] * s) / 2, true);
      for (let k = 0; k < 3; k++) dv.setUint8(o + 12 + k, Math.max(0, Math.min(255, toS(mc.colorArray[i * 3 + k]))));
      o += 15;
    }
    for (let f = 0; f < n / 3; f++) {
      dv.setUint8(o, 3);
      dv.setInt32(o + 1, f * 3, true);
      dv.setInt32(o + 5, f * 3 + 1, true);
      dv.setInt32(o + 9, f * 3 + 2, true);
      o += 13;
    }
    return buf;
  }

  // ------------------------------------------------------------------ the mesh

  /** A solid surface around the points (marching cubes over a smoothed density grid), coloured by the
   *  points in each cell. Built when you look at it, not every frame. Returns false when too thin. */
  buildMesh() {
    if (this.meshRays === this.fusion.rays && this.mesh) return this.mesh.count > 0;
    if (!this.mesh) {
      this.mesh = new MarchingCubes(FUS, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), false, true, 160000);
      this.mesh.frustumCulled = false;
      this.group.add(this.mesh);
    }
    const s = this.side;
    this.fusion.toMarchingCubes(this.mesh);
    this.mesh.scale.setScalar(s / 2);
    this.mesh.position.set(0, s / 2, 0);
    this.meshRays = this.fusion.rays;
    return this.mesh.count > 0;
  }

  /** Points still without a colour take the average the fusion volume saw around them. */
  fillColours() {
    if (!this.pending.length) return;
    const F = this.fusion;
    const n = F.n;
    const s = this.side;
    const keep = [];
    const toS = (l) => Math.max(0, Math.min(255, Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055))));
    // the cell itself and its neighbours first; then a wider look (a few cm) for the stragglers
    const near = [0, 1, -1, n, -n, n * n, -n * n];
    const wide = [];
    for (let dz = -3; dz <= 3; dz++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1) wide.push(dx + dy * n + dz * n * n);
    for (const i of this.pending) {
      const ix = Math.floor(((this.pos[i * 3] + s / 2) / s) * n);
      const iy = Math.floor((this.pos[i * 3 + 1] / s) * n);
      const iz = Math.floor(((this.pos[i * 3 + 2] + s / 2) / s) * n);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= n || iy >= n || iz >= n) {
        keep.push(i);
        continue;
      }
      const c = ix + iy * n + iz * n * n;
      let r = 0;
      let g = 0;
      let b = 0;
      let m = 0;
      for (const set of [near, wide]) {
        for (const d of set) {
          const j = c + d;
          if (j < 0 || j >= F.cw.length) continue;
          const w = F.cw[j];
          if (!w) continue;
          r += F.rgb[j * 3] / w;
          g += F.rgb[j * 3 + 1] / w;
          b += F.rgb[j * 3 + 2] / w;
          m++;
        }
        if (m) break;
      }
      if (!m) {
        keep.push(i);
        continue;
      }
      const lin = [r / m, g / m, b / m];
      for (let k = 0; k < 3; k++) {
        this.col[i * 3 + k] = lin[k];
        this.rgb[i * 3 + k] = toS(lin[k]);
      }
    }
    this.pending = keep;
    this.cloud.geometry.attributes.color.needsUpdate = true;
  }

  /** Dots while scanning; the mesh when paused (if chosen). */
  showView() {
    if (!this.scanning) this.fillColours();
    const meshNow = this.view === 'mesh' && !this.scanning && this.count >= 200 && this.buildMesh();
    if (this.mesh) this.mesh.visible = !!meshNow;
    this.cloud.visible = !meshNow;
  }

  // ------------------------------------------------------------------ drawing

  drawBar(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 7);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = T.line2;
    g.lineWidth = 1;
    g.stroke();
    // grip (move the box)
    g.fillStyle = T.ink3;
    for (let i = 0; i < 4; i++) {
      g.fillRect(14, 20 + i * 9, 3, 3);
      g.fillRect(22, 20 + i * 9, 3, 3);
    }
    ui.hit('grip', 0, 0, 40, H);
    const cell = (x, w, id, on, primary, draw, data) => {
      cutPath(g, x + 2, 8, w - 4, H - 16, 5);
      g.fillStyle = primary ? T.seal : on ? T.ink : T.bg3;
      g.fill();
      draw(x + w / 2, H / 2, primary ? T.onSeal : on ? T.bgSolid : T.ink);
      ui.hit(id, x, 0, w, H, data);
    };
    let x = 40;
    cell(x, 120, 'go', false, !this.scanning, (cx, cy, c) => {
      const x0 = cx - 46;
      g.fillStyle = c;
      if (this.scanning) {
        g.fillRect(x0, cy - 7, 4, 14);
        g.fillRect(x0 + 8, cy - 7, 4, 14);
      } else {
        g.beginPath();
        g.arc(x0 + 6, cy, 6, 0, Math.PI * 2);
        g.fill();
      }
      text(g, this.scanning ? 'Pause' : this.count ? 'Resume' : 'Scan', x0 + 22, cy + 1, { size: 16, weight: 600, color: c, base: 'middle' });
    });
    x += 124;
    for (const k of ['s', 'm', 'l']) {
      cell(x, 40, `size:${k}`, !this.custom && this.size === k, false, (cx, cy, c) => text(g, k.toUpperCase(), cx, cy + 1, { size: 15, family: 'mono', weight: 600, color: c, align: 'center', base: 'middle' }), k);
      x += 40;
    }
    x += 6;
    for (const [k, label] of [['dots', 'Dots'], ['mesh', 'Mesh']]) {
      cell(x, 58, `view:${k}`, this.view === k, false, (cx, cy, c) => text(g, label, cx, cy + 1, { size: 15, weight: 600, color: c, align: 'center', base: 'middle' }), k);
      x += 58;
    }
    x += 4;
    cell(x, 50, 'clear', false, false, (cx, cy, c) => icon(g, 'undo', cx - 9, cy - 9, 18, c));
    x += 50;
    cell(x, 80, 'save', false, false, (cx, cy, c) => text(g, this.saving ? 'Saving' : 'Save', cx, cy + 1, { size: 16, weight: 600, color: this.count < 200 ? T.ink3 : c, align: 'center', base: 'middle' }));
    x += 80;
    if (this.refineAvailable && !this.world.standalone) {
      cell(x, 96, 'refine', !!this.refining, false, (cx, cy, c) => text(g, this.refining ? 'Refining' : 'Refine', cx, cy + 1, { size: 16, weight: 600, color: this.pictures.length < 8 ? T.ink3 : c, align: 'center', base: 'middle' }));
      x += 96;
    }
    cell(x, W - x - 4, 'close', false, false, (cx, cy, c) => icon(g, 'close', cx - 8, cy - 8, 16, c));
  }

  drawTag(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    cutPath(g, 0, 0, W, H, 6);
    g.fillStyle = T.chip;
    g.fill();
    const label = this.refining ? 'Refining on PC' : this.resizing ? `${Math.round(this.resizing.side * 100)} cm box` : this.scanning ? 'Scanning' : this.count ? 'Paused' : 'Ready';
    hudTag(g, 8, 8, label, { variant: this.scanning ? 'seal' : 'line', size: 12 });
    const pts = this.count >= 1000 ? `${(this.count / 1000).toFixed(1)}k` : String(this.count);
    text(g, `${pts} points · ${Math.round(this.coverage() * 100)}% around`, 8, 50, { size: 14, family: 'mono', color: T.ink2, max: W - 16 });
    // colour comes from the Quest's camera when it can be reached
    const colour = this.cam.ready ? 'colour' : this.world.xrActive ? 'no colour' : '';
    if (colour) text(g, colour, W - 8, 26, { size: 12, family: 'mono', color: this.cam.ready ? T.ink2 : T.seal, align: 'right' });
  }

  // ------------------------------------------------------------------ depth → points

  /** Shader pass: copy a GRID × GRID sampling of the left-eye depth into RGBA8 (packed float). */
  readDepthGPU() {
    const W = this.world;
    const renderer = W.renderer;
    const tex = renderer.xr.getDepthTexture && renderer.xr.getDepthTexture();
    if (!tex) return null;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(GRID, GRID, { depthBuffer: false });
      this.quadMat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { depthColor: { value: tex }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) } },
        vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `precision highp float; precision highp sampler2DArray;
          uniform sampler2DArray depthColor; uniform vec4 uRect; in vec2 vUv; out vec4 outColor;
          void main(){
            vec2 uv = mix(uRect.xy, uRect.zw, vUv);
            float d = clamp(texture(depthColor, vec3(uv, 0.0)).r, 0.0, 0.99999);
            vec4 enc = fract(d * vec4(1.0, 255.0, 65025.0, 16581375.0));
            enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
            outColor = enc;
          }`,
      });
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat);
      this.quad.frustumCulled = false;
      this.quadScene = new THREE.Scene();
      this.quadScene.add(this.quad);
      this.quadCam = new THREE.Camera();
    }
    this.quadMat.uniforms.depthColor.value = tex;
    this.quadMat.uniforms.uRect.value.fromArray(this.rect);
    const prev = renderer.getRenderTarget();
    const xrOn = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.quadScene, this.quadCam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, GRID, GRID, this.px);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xrOn;
    return this.px;
  }

  /** The part of the left eye's view the box covers (texture 0..1), a little padded; null if out of view. */
  boxRect(cam, eyeWorld) {
    const view = eyeWorld.clone().invert();
    const pm = cam.projectionMatrix;
    const v = new THREE.Vector3();
    const h = this.side / 2;
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    for (const x of [-h, h])
      for (const y of [0, this.side])
        for (const z of [-h, h]) {
          v.set(x, y, z).applyMatrix4(this.group.matrixWorld).applyMatrix4(view);
          if (v.z > -0.05) return [0, 0, 1, 1]; // you are (nearly) inside the box: look everywhere
          v.applyMatrix4(pm);
          x0 = Math.min(x0, v.x * 0.5 + 0.5);
          x1 = Math.max(x1, v.x * 0.5 + 0.5);
          y0 = Math.min(y0, v.y * 0.5 + 0.5);
          y1 = Math.max(y1, v.y * 0.5 + 0.5);
        }
    const pad = 0.02;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(1, x1 + pad);
    y1 = Math.min(1, y1 + pad);
    return x1 - x0 < 0.01 || y1 - y0 < 0.01 ? null : [x0, y0, x1, y1];
  }

  /** Adds what the depth map sees inside the box: dots, and the fusion volume. */
  sample() {
    const W = this.world;
    const cam = W.renderer.xr.getCamera().cameras[0];
    if (!cam) return;
    const inv = cam.projectionMatrixInverse;
    // this frame's eye pose (the camera's world matrix is only refreshed when the frame renders)
    const parent = W.camera.parent;
    const world = parent ? new THREE.Matrix4().multiplyMatrices(parent.matrixWorld, cam.matrix) : cam.matrix;
    const rect = this.boxRect(cam, world);
    if (!rect) return;
    this.rect = rect;
    const px = this.readDepthGPU();
    if (!px) return;
    const toBox = this.group.matrixWorld.clone().invert();
    const eye = this.eyeL.setFromMatrixPosition(world).applyMatrix4(toBox);
    const v = new THREE.Vector3();
    const s = this.side;
    const h = s / 2;
    const m = this.fusion.trunc;
    const [rx0, ry0, rx1, ry1] = rect;
    let added = 0;
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        const o = (j * GRID + i) * 4;
        const d = px[o] / 255 + px[o + 1] / 65025 + px[o + 2] / 16581375 + px[o + 3] / 4228250625;
        if (d <= 0.0001 || d >= 0.9999) continue;
        const nx = (rx0 + ((i + 0.5) / GRID) * (rx1 - rx0)) * 2 - 1;
        const ny = (ry0 + ((j + 0.5) / GRID) * (ry1 - ry0)) * 2 - 1;
        v.set(nx, ny, d * 2 - 1).applyMatrix4(inv).applyMatrix4(world);
        const l = this.lv2.copy(v).applyMatrix4(toBox);
        if (l.y < -m || l.y > s + m || l.x < -h - m || l.x > h + m || l.z < -h - m || l.z > h + m) continue;
        const seen = this.cam.colorAt(v, this.c3) > 0;
        if (seen) for (let k = 0; k < 3; k++) this.lin[k] = TO_LINEAR[this.c3[k]];
        if (l.y > FLOOR_CUT) this.fusion.integrate(eye.x, eye.y, eye.z, l.x, l.y, l.z, seen ? this.lin : null);
        added += this.add(v, s, toBox, seen ? this.c3 : undefined);
      }
    if (added) this.markSeen();
  }

  /** In the browser preview there is no depth camera: rays from your view hit a stand-in ball. */
  sampleFake() {
    const W = this.world;
    const cam = W.camera;
    const center = this.group.localToWorld(new THREE.Vector3(0, this.side * 0.32, 0));
    const ball = new THREE.Sphere(center, this.side * 0.25);
    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    const toBox = this.group.matrixWorld.clone().invert();
    let added = 0;
    const n = 48;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const ndc = new THREE.Vector3(((i + Math.random()) / n) * 2 - 1, ((j + Math.random()) / n) * 2 - 1, 0.5);
        ray.origin.setFromMatrixPosition(cam.matrixWorld);
        ray.direction.copy(ndc.unproject(cam)).sub(ray.origin).normalize();
        if (!ray.intersectSphere(ball, hit)) continue;
        const c = hit.y > center.y ? [226, 71, 44] : [236, 229, 214];
        const l = hit.clone().applyMatrix4(toBox);
        const e = ray.origin.clone().applyMatrix4(toBox);
        this.fusion.integrate(e.x, e.y, e.z, l.x, l.y, l.z, c.map((x) => TO_LINEAR[x]));
        added += this.add(hit, this.side, toBox, c);
      }
    if (added) this.markSeen();
  }

  recolour() {
    const w = new THREE.Vector3();
    const keep = [];
    const budget = Math.min(this.pending.length, 600);
    for (let n = 0; n < this.pending.length; n++) {
      const i = this.pending[n];
      if (n >= budget) {
        keep.push(i);
        continue;
      }
      w.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.group.localToWorld(w);
      if (this.cam.colorAt(w, this.c3) > 0) {
        for (let k = 0; k < 3; k++) {
          this.rgb[i * 3 + k] = this.c3[k];
          this.col[i * 3 + k] = TO_LINEAR[this.c3[k]];
        }
      } else keep.push(i);
    }
    this.pending = keep;
    this.cloud.geometry.attributes.color.needsUpdate = true;
  }

  /** A point seen in the room (world space): kept if it is inside the box and new, with its colour. */
  add(w, s, toBox, fake) {
    const v = this.lv.copy(w).applyMatrix4(toBox);
    const h = s / 2;
    if (v.y < FLOOR_CUT || v.y > s || v.x < -h || v.x > h || v.z < -h || v.z > h) return 0;
    if (this.count >= MAX) return 0;
    const key = Math.floor((v.x + h) / VOXEL) + Math.floor(v.y / VOXEL) * 512 + Math.floor((v.z + h) / VOXEL) * 262144;
    if (this.voxels.has(key)) return 0;
    this.voxels.add(key);
    const i = this.count * 3;
    this.pos[i] = v.x;
    this.pos[i + 1] = v.y;
    this.pos[i + 2] = v.z;
    const seen = fake || this.cam.colorAt(w, this.c3) > 0;
    const c = fake || (seen ? this.c3 : INK);
    if (!seen) this.pending.push(this.count);
    for (let k = 0; k < 3; k++) {
      this.rgb[i + k] = c[k];
      this.col[i + k] = TO_LINEAR[c[k]];
    }
    this.count++;
    return 1;
  }

  markSeen() {
    const head = this.group.worldToLocal(this.headPos());
    let a = Math.atan2(head.x, head.z);
    if (a < 0) a += Math.PI * 2;
    const i = Math.floor((a / (Math.PI * 2)) * SEGS) % SEGS;
    for (const k of [i - 1, i, i + 1]) {
      const idx = (k + SEGS) % SEGS;
      if (!this.seen[idx]) {
        this.seen[idx] = true;
        this.ring[idx].material.opacity = 0.85;
      }
    }
    const g = this.cloud.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.count);
  }

  // ------------------------------------------------------------------ the world asks

  interactives() {
    return this.on && this.showS.value > 0.5 ? [this.bar.mesh, this.cornerHit] : [];
  }

  surfaces() {
    return this.on && this.showS.value > 0.5 ? [this.bar] : [];
  }

  update(t, dt) {
    const onCorner = !!this.resizing || this.world.input.pointers.some((p) => p.over === this.cornerHit.userData.interactive);
    this.cornerDot.scale.setScalar(onCorner ? 1.5 : 1);
    if (this.tinted !== T.ink) {
      this.tinted = T.ink;
      this.edges.material.color.set(T.ink);
      for (const m of this.ring) m.material.color.set(T.ink);
    }
    this.showS.target = this.on ? 1 : 0;
    const s = this.showS.step(dt);
    if (!this.on && s < 0.02) {
      if (this.group.visible) this.group.visible = this.tag.mesh.visible = false;
      return;
    }
    this.group.visible = this.tag.mesh.visible = true;
    this.group.scale.setScalar(0.9 + 0.1 * Math.min(1.04, s));
    this.bar.mat.uniforms.uOpacity.value = Math.min(1, s);
    this.brackets.material.color.set(this.scanning ? 0xe2472c : T.ink);
    if (this.scanning) {
      this.poses.push({ t: performance.now(), m: this.world.camera.matrixWorld.clone() });
      if (this.poses.length > 90) this.poses.shift();
    }
    if (this.scanning && this.world.xrActive) this.cam.tick();
    if (this.scanning !== this.wasScanning) {
      this.wasScanning = this.scanning;
      this.showView();
    }
    // later pictures colour the points the earlier ones missed (a few hundred per frame)
    if (this.pending.length && this.cam.ready && this.frame % 4 === 2) this.recolour();
    if (this.scanning && ++this.frame % 4 === 0) {
      const before = this.count;
      if (this.world.xrActive) this.sample();
      else this.sampleFake();
      if (this.count !== before && this.frame % 16 === 0) this.tag.dirty = true;
      if (this.count >= MAX) {
        this.scanning = false;
        this.world.coreSay('That is as many points as a scan can hold. Save it.');
        this.bar.dirty = true;
      }
    }
    // the status tag floats above the box's far corner, facing you
    const head = this.headPos();
    this.tag.mesh.position.copy(this.group.localToWorld(new THREE.Vector3(0, this.side + 0.07, 0)));
    this.tag.mesh.lookAt(head);
    this.tag.mat.uniforms.uOpacity.value = Math.min(1, s);
    this.tag.update(t, dt);
    this.bar.update(t, dt);
  }
}
