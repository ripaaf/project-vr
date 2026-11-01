// "Your room" in miniature: the floor, walls and tables the headset knows from Space Setup, your
// windows as small panels and you as a seal mark. It is live: move a window or walk around and the
// miniature follows. Without Space Setup it shows a 4 × 4 m floor around you.
import * as THREE from 'three';

const INK = 0xece5d6;
const SEAL = 0xe2472c;

/** A filled planar polygon (fan) and its outline, from world points. */
function polygon(pts, fill, line) {
  const g = new THREE.Group();
  if (pts.length < 3) return g;
  const pos = [];
  for (const p of pts) pos.push(p.x, p.y, p.z);
  const idx = [];
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  if (fill) g.add(new THREE.Mesh(geo, fill));
  if (line) g.add(new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)), line));
  return g;
}

export function makeRoom(world) {
  const root = new THREE.Group();
  const shell = new THREE.Group(); // floor, walls, tables
  const live = new THREE.Group(); // windows and you
  root.add(shell, live);
  const M = {
    line: new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.6 }),
    faint: new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.25 }),
    floor: new THREE.MeshBasicMaterial({ color: 0x1f1f21, side: THREE.DoubleSide }),
    table: new THREE.MeshBasicMaterial({ color: 0x47443e, side: THREE.DoubleSide }),
    wall: new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    win: new THREE.MeshBasicMaterial({ color: 0x141415, side: THREE.DoubleSide }),
    winEdge: new THREE.LineBasicMaterial({ color: SEAL }),
    seal: new THREE.MeshBasicMaterial({ color: SEAL }),
  };
  let floorY = 0;
  let signature = '';

  function buildShell() {
    for (const c of [...shell.children]) {
      shell.remove(c);
      c.traverse((o) => o.geometry && o.geometry.dispose());
    }
    const planes = (world.roomPlanes || []).filter((p) => p.pts && p.pts.length >= 3);
    if (!planes.length) {
      // no Space Setup: a 4 × 4 m floor around where you started
      const s = 2;
      const pts = [new THREE.Vector3(-s, 0, -s), new THREE.Vector3(s, 0, -s), new THREE.Vector3(s, 0, s), new THREE.Vector3(-s, 0, s)];
      shell.add(polygon(pts, M.floor, M.faint));
      floorY = 0;
      return;
    }
    floorY = Math.min(...planes.filter((p) => p.orientation !== 'vertical').map((p) => p.pts[0] ? p.pts[0].y : 0), 0);
    for (const p of planes) {
      const label = p.label || '';
      if (p.orientation === 'vertical' || label === 'wall' || label === 'door' || label === 'window') shell.add(polygon(p.pts, M.wall, M.faint));
      else if (label === 'floor' || p.pts[0].y < floorY + 0.15) shell.add(polygon(p.pts, M.floor, M.line));
      else if (label === 'ceiling') shell.add(polygon(p.pts, null, M.faint));
      else shell.add(polygon(p.pts, M.table, M.line));
    }
  }

  // windows: a pool of small panels with a seal edge
  const unit = new THREE.PlaneGeometry(1, 1);
  const edge = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  const wins = [];
  const winOf = (i) => {
    if (!wins[i]) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(unit, M.win), new THREE.LineLoop(edge, M.winEdge));
      live.add(g);
      wins[i] = g;
    }
    return wins[i];
  };
  // you: a wedge pointing where you look, a line down to the floor, a ring where you stand
  const you = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 3), M.seal);
  cone.rotation.x = -Math.PI / 2;
  const head = new THREE.Group();
  head.add(cone);
  const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), M.line);
  const foot = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 32), M.seal);
  foot.rotation.x = -Math.PI / 2;
  you.add(head, stem, foot);
  live.add(you);

  let acc = 1;
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  function refresh() {
    const sig = (world.roomPlanes || []).length + ':' + (world.roomPlanes || []).map((p) => p.label).join(',');
    if (sig !== signature) {
      signature = sig;
      buildShell();
    }
    const open = world.panels.openWindows();
    open.forEach((p, i) => {
      const w = winOf(i);
      w.visible = true;
      p.surface.mesh.matrixWorld.decompose(v, q, s);
      w.position.copy(v);
      w.quaternion.copy(q);
      w.scale.set(p.surface.w * s.x, p.surface.h * s.y, 1);
    });
    for (let i = open.length; i < wins.length; i++) wins[i].visible = false;
    world.camera.getWorldPosition(v);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(world.camera.getWorldQuaternion(q));
    head.position.copy(v);
    head.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
    stem.position.copy(v);
    stem.scale.set(1, Math.max(0.01, v.y - floorY), 1);
    foot.position.set(v.x, floorY + 0.005, v.z);
  }
  refresh();
  return {
    root,
    note: () => {
      const s = (world.roomPlanes || []).length;
      const w = world.panels.openWindows().length;
      return `${s || 'no'} surface${s === 1 ? '' : 's'} · ${w} window${w === 1 ? '' : 's'}`;
    },
    live: (dt) => {
      acc += dt;
      if (acc < 0.5) return;
      acc = 0;
      refresh();
    },
  };
}
