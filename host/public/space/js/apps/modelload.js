// Loads a 3D model of any common kind (glTF / GLB, OBJ, STL, PLY meshes or point clouds) into one
// group, toned down to the space's matte look, and measures it: real size, triangles, points.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import { OBJLoader } from '../../vendor/OBJLoader.js';
import { STLLoader } from '../../vendor/STLLoader.js';
import { PLYLoader } from '../../vendor/PLYLoader.js';

export const FORMATS = ['glb', 'gltf', 'obj', 'stl', 'ply'];
export const formatOf = (name) => (String(name).split('?')[0].split('.').pop() || '').toLowerCase();

/** Unpainted models (OBJ, STL, PLY without colours) get this: warm paper, no gloss. */
function paper(vertexColors = false) {
  return new THREE.MeshStandardMaterial({ color: vertexColors ? 0xffffff : 0xd9d2c3, vertexColors, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
}

/** Glossy, mirror-like materials clash with the space: keep their colours and textures, lose the shine. */
function matte(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (m && m.isMeshBasicMaterial) return m; // unlit on purpose (baked light): leave it
      if (!m || m.isMeshPhongMaterial || m.isMeshLambertMaterial) {
        const p = paper(!!o.geometry.attributes.color);
        if (m && m.map) p.map = m.map;
        if (m && m.color && !m.color.equals(new THREE.Color(1, 1, 1))) p.color.copy(m.color);
        return p;
      }
      if (m.isMeshStandardMaterial) {
        m.roughness = Math.max(m.roughness, 0.55);
        m.metalness = Math.min(m.metalness, 0.35);
        m.envMapIntensity = 0.45;
        if (m.isMeshPhysicalMaterial) {
          m.clearcoat = 0;
          m.iridescence = 0;
          m.sheen = 0;
        }
      }
      return m;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

/** Size, centre, triangles and points of what was loaded. */
export function measure(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  let tris = 0;
  let points = 0;
  let meshes = 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    if (o.isMesh) {
      meshes++;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    } else if (o.isPoints) points += g.attributes.position.count;
  });
  return { box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), tris: Math.round(tris), points, meshes };
}

/** Fetch and parse. Returns { root, stats, unit, animations } — unit is metres per model unit
 *  (glTF is in metres; OBJ / STL files are usually millimetres when they come out large). */
export async function loadModel(url, format) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not open the file (${res.status})`);
  const buf = await res.arrayBuffer();
  let root;
  let animations = [];
  if (format === 'glb' || format === 'gltf') {
    const base = url.includes('?') ? '' : url.slice(0, url.lastIndexOf('/') + 1);
    const gltf = await new GLTFLoader().parseAsync(buf, base);
    root = gltf.scene;
    animations = gltf.animations || [];
  } else if (format === 'obj') {
    root = new OBJLoader().parse(new TextDecoder().decode(buf));
  } else if (format === 'stl') {
    const geo = new STLLoader().parse(buf);
    root = new THREE.Group();
    root.add(new THREE.Mesh(geo, paper(!!geo.hasColors)));
  } else if (format === 'ply') {
    const geo = new PLYLoader().parse(buf);
    root = new THREE.Group();
    if (geo.index) {
      if (!geo.attributes.normal) geo.computeVertexNormals();
      root.add(new THREE.Mesh(geo, paper(!!geo.attributes.color)));
    } else {
      // a point cloud (scans are saved like this)
      const colored = !!geo.attributes.color;
      root.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.004, color: colored ? 0xffffff : 0xece5d6, vertexColors: colored, sizeAttenuation: true })));
    }
  } else throw new Error(`.${format} files cannot be opened yet`);
  matte(root);
  const stats = measure(root);
  const max = Math.max(stats.size.x, stats.size.y, stats.size.z);
  const unit = (format === 'obj' || format === 'stl') && max > 8 ? 0.001 : 1;
  return { root, stats, unit, animations };
}

/** "12.4 × 8 × 20.1 cm" (or m / mm), from a size in metres. */
export function sizeLabel(v) {
  const max = Math.max(v.x, v.y, v.z);
  const [k, u] = max >= 2 ? [1, 'm'] : max >= 0.02 ? [100, 'cm'] : [1000, 'mm'];
  const f = (n) => {
    const x = n * k;
    return x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, '');
  };
  return `${f(v.x)} × ${f(v.y)} × ${f(v.z)} ${u}`;
}

export const countLabel = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export const bytesLabel = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
