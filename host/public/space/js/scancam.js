// Colour for scans: the newest picture from the headset's left passthrough camera (sent by the
// Quest app, ~10 a second while scanning) and where that camera sits on the headset. A point in the
// room is moved into the camera's view, projected with its focal length and centre, and takes the
// colour of the pixel it lands on.
import * as THREE from 'three';

const BASE = location.port === '8770' ? '' : 'http://localhost:8770'; // the Quest app serves the camera
export const TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

export class ScanCamera {
  constructor(world) {
    this.world = world;
    this.info = null;
    this.pixels = null;
    this.busy = false;
    this.error = null;
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.camInv = new THREE.Matrix4();
    this.v = new THREE.Vector3();
  }

  get ready() {
    return !!this.pixels;
  }

  async start() {
    if (this.info) return;
    try {
      const r = await fetch(`${BASE}/api/space/camera/info`);
      if (!r.ok) throw new Error((await r.json()).error || `camera ${r.status}`);
      this.setup(await r.json());
    } catch (e) {
      this.error = e.message || 'No camera';
    }
  }

  /** Focal length and centre for the frame size we get; the lens pose as a matrix from the camera's
   *  own axes (x right, y down, z ahead) to the headset's (x right, y up, z back). */
  setup(info) {
    const w = info.w;
    const h = info.h;
    const sc = Math.min(1, 640 / w); // colours don't need more; reading fewer pixels is faster
    this.canvas.width = Math.round(w * sc);
    this.canvas.height = Math.round(h * sc);
    let [fx, fy, cx, cy] = info.k || [w * 0.9, w * 0.9, w / 2, h / 2];
    if (info.k && info.sensor) {
      // the intrinsics are for the whole sensor; the frame is that sensor, scaled and centre-cropped
      const [Ws, Hs] = info.sensor;
      const sx = w / Ws;
      const sy = h / Hs;
      const m = Math.max(sx, sy);
      const cw = (Ws * sx) / m;
      const ch = (Hs * sy) / m;
      const f = w / cw;
      fx *= f;
      fy *= f;
      cx = (cx - (Ws - cw) / 2) * f;
      cy = (cy - (Hs - ch) / 2) * f;
    }
    this.K = { fx: fx * sc, fy: fy * sc, cx: cx * sc, cy: cy * sc, w: this.canvas.width, h: this.canvas.height };
    // which way round the rotation is written varies; pick the reading that looks ahead and keeps
    // the picture's "down" pointing down
    const q = info.q ? new THREE.Quaternion(info.q[0], info.q[1], info.q[2], info.q[3]).normalize() : new THREE.Quaternion();
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    const cands = [q.clone(), q.clone().invert(), q.clone().multiply(flip), q.clone().invert().multiply(flip)];
    let best = cands[0];
    let score = -9;
    for (const c of cands) {
      const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(c).dot(new THREE.Vector3(0, 0, -1));
      const down = new THREE.Vector3(0, 1, 0).applyQuaternion(c).dot(new THREE.Vector3(0, -1, 0));
      if (ahead + down > score) {
        score = ahead + down;
        best = c;
      }
    }
    const t = info.t ? new THREE.Vector3(info.t[0], info.t[1], info.t[2]) : new THREE.Vector3(-0.032, -0.02, -0.06);
    this.lens = new THREE.Matrix4().compose(t, best, new THREE.Vector3(1, 1, 1));
    this.info = info;
  }

  /** Ask for the next picture (one at a time); remembers where your head was when it was taken. */
  tick() {
    if (!this.info || this.busy) return;
    this.busy = true;
    let pose = this.world.camera.matrixWorld.clone();
    let blob = null;
    fetch(`${BASE}/api/space/camera/frame`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `camera ${r.status}`);
        // the Quest app says how old the picture is: use where your head was at that moment
        const age = Number(r.headers.get('X-Age-Ms'));
        const then = Number.isFinite(age) && this.poseAt ? this.poseAt(performance.now() - age) : null;
        if (then) pose = then.clone();
        blob = await r.blob();
        return createImageBitmap(blob);
      })
      .then((bmp) => {
        pose.multiply(this.lens);
        if (this.onPicture) this.onPicture(blob, pose.clone()); // camera → room, camera axes x right, y down, z ahead
        this.g.drawImage(bmp, 0, 0, this.K.w, this.K.h);
        bmp.close();
        this.pixels = this.g.getImageData(0, 0, this.K.w, this.K.h).data;
        this.camInv.copy(pose).invert();
        this.error = null;
      })
      .catch((e) => (this.error = e.message))
      .finally(() => (this.busy = false));
  }

  /** The sRGB colour (0..255) seen at a point in the room, or -1 when the camera can't see it. */
  colorAt(world, out) {
    if (!this.pixels) return -1;
    const p = this.v.copy(world).applyMatrix4(this.camInv);
    if (p.z < 0.05) return -1;
    const { fx, fy, cx, cy, w, h } = this.K;
    const u = Math.round((fx * p.x) / p.z + cx);
    const v = Math.round((fy * p.y) / p.z + cy);
    if (u < 0 || v < 0 || u >= w || v >= h) return -1;
    const i = (v * w + u) * 4;
    out[0] = this.pixels[i];
    out[1] = this.pixels[i + 1];
    out[2] = this.pixels[i + 2];
    return 1;
  }
}
