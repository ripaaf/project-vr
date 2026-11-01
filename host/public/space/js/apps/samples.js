// Sample models drawn in code, in the space's style: matte paper, ink lines, a little gold and seal.
// Sizes are real (metres), so the stage can show them at life size.
import * as THREE from 'three';

const paper = (color = 0xd9d2c3) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });

/** A fine ink outline around a mesh. */
function inked(mesh, color = 0x141413) {
  const g = new THREE.Group();
  g.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color })));
  return g;
}

function bowl() {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push(new THREE.Vector2(0.02 + Math.sin(t * Math.PI * 0.5) * 0.11, t * 0.075));
  }
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), paper(0x2a2622)));
  const foot = new THREE.Mesh(new THREE.CircleGeometry(0.021, 32), paper(0x2a2622));
  foot.rotation.x = -Math.PI / 2;
  g.add(foot);
  // gold seams wandering over the glaze (kintsugi)
  const gold = new THREE.LineBasicMaterial({ color: 0xd0aa5f });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let c = 0; c < 4; c++) {
    const crack = [];
    let a = rnd() * Math.PI * 2;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      a += (rnd() - 0.5) * 0.35;
      const r = 0.02 + Math.sin(t * Math.PI * 0.5) * 0.11 + 0.0015;
      crack.push(new THREE.Vector3(Math.cos(a) * r, t * 0.075, Math.sin(a) * r));
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(crack), gold));
  }
  return g;
}

function star() {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
    const rad = i % 2 ? 0.028 : 0.12;
    i ? s.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : s.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 1 });
  geo.center();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xece5d6, roughness: 0.95, metalness: 0, flatShading: true }));
  return inked(m);
}

function globe() {
  const g = new THREE.Group();
  const R = 0.13;
  const pts = [];
  const seg = (ax, ay, az, bx, by, bz) => pts.push(ax, ay, az, bx, by, bz);
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = Math.sin((lat * Math.PI) / 180) * R;
    const rr = Math.cos((lat * Math.PI) / 180) * R;
    for (let i = 0; i < 64; i++) {
      const a0 = (i / 64) * Math.PI * 2;
      const a1 = ((i + 1) / 64) * Math.PI * 2;
      seg(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr);
    }
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const a = (lon * Math.PI) / 180;
    for (let i = 0; i < 64; i++) {
      const t0 = (i / 64) * Math.PI * 2;
      const t1 = ((i + 1) / 64) * Math.PI * 2;
      seg(Math.cos(a) * Math.cos(t0) * R, Math.sin(t0) * R, Math.sin(a) * Math.cos(t0) * R, Math.cos(a) * Math.cos(t1) * R, Math.sin(t1) * R, Math.sin(a) * Math.cos(t1) * R);
    }
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.6 })));
  const eq = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0016, 6, 96), new THREE.MeshBasicMaterial({ color: 0xe2472c }));
  eq.rotation.x = Math.PI / 2;
  g.add(eq);
  return g;
}

function knot() {
  return inked(new THREE.Mesh(new THREE.TorusKnotGeometry(0.075, 0.022, 160, 16, 2, 3), paper()), 0x2a2724);
}

function enso() {
  const pts = [];
  for (let i = 0; i <= 50; i++) {
    const a = -Math.PI * 0.6 + (i / 50) * Math.PI * 2 * 0.85;
    const r = 0.12 * (1 + Math.sin(i * 0.6) * 0.02);
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(i * 0.3) * 0.012));
  }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.011, 8, false), paper(0x1d1b19));
}

export const SAMPLES = [
  { id: 'bowl', name: 'Kintsugi bowl', desc: 'Mended with gold', make: bowl },
  { id: 'star', name: 'Paper star', desc: 'Folded, matte', make: star },
  { id: 'globe', name: 'Wire globe', desc: 'Lines of latitude', make: globe },
  { id: 'knot', name: 'Torus knot', desc: 'One closed loop', make: knot },
  { id: 'enso', name: 'Ensō', desc: 'One brush stroke', make: enso },
];
