// Fusion for scans: a truncated signed-distance volume (TSDF) over the scan box. Every depth ray
// from your eye to a surface updates the few cells around where it hit — in front of the surface
// counts as "outside", behind as "inside" — and the running average over many views cancels the
// depth camera's noise. The surface is where the average crosses zero; each cell near it also keeps
// the average colour the camera saw there. Marching cubes turns that into a solid, coloured mesh.

export class Fusion {
  constructor(n) {
    this.n = n;
    const c = n * n * n;
    this.sdf = new Float32Array(c);
    this.w = new Float32Array(c);
    this.rgb = new Float32Array(c * 3);
    this.cw = new Float32Array(c);
    this.side = 1;
  }

  reset(side) {
    this.side = side;
    this.vox = side / this.n;
    this.trunc = this.vox * 3;
    this.sdf.fill(1);
    this.w.fill(0);
    this.rgb.fill(0);
    this.cw.fill(0);
    this.rays = 0;
  }

  /** One depth ray, in box coordinates: from the eye (o) to the surface point (p), with the linear
   *  colour seen there (or null). */
  integrate(ox, oy, oz, px, py, pz, col) {
    const n = this.n;
    const vox = this.vox;
    const half = this.side / 2;
    let dx = px - ox;
    let dy = py - oy;
    let dz = pz - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    const tr = this.trunc;
    const step = vox * 0.7;
    for (let t = -tr; t <= tr; t += step) {
      const x = px + dx * t;
      const y = py + dy * t;
      const z = pz + dz * t;
      const ix = Math.floor((x + half) / vox);
      const iy = Math.floor(y / vox);
      const iz = Math.floor((z + half) / vox);
      if (ix < 1 || iy < 1 || iz < 1 || ix >= n - 1 || iy >= n - 1 || iz >= n - 1) continue;
      const i = ix + iy * n + iz * n * n;
      const d = Math.max(-1, Math.min(1, -t / tr)); // +1 in front of the surface, -1 behind
      const w = this.w[i];
      this.sdf[i] = (this.sdf[i] * w + d) / (w + 1);
      this.w[i] = Math.min(64, w + 1);
      if (col && Math.abs(t) <= vox) {
        const k = i * 3;
        this.rgb[k] += col[0];
        this.rgb[k + 1] += col[1];
        this.rgb[k + 2] += col[2];
        this.cw[i] += 1;
      }
    }
    this.rays++;
  }

  /** Fill a three.js MarchingCubes of the same size: inside = positive (unseen cells count as
   *  outside, so only what the camera saw becomes surface), and the palette from the colours. */
  toMarchingCubes(mc) {
    const n = this.n;
    const c = n * n * n;
    mc.reset();
    const f = mc.field;
    const pal = mc.palette;
    // close small gaps (cells between rays that no ray touched) from their seen neighbours, then
    // smooth lightly: the depth sensor is precise to about a centimetre, so tiny bumps are noise
    const sdf = this.sdf.slice();
    const seen = new Uint8Array(c);
    for (let i = 0; i < c; i++) seen[i] = this.w[i] > 0 ? 1 : 0;
    const six = [1, -1, n, -n, n * n, -n * n];
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let i = n * n + n + 1; i < c - n * n - n - 1; i++) {
        if (seen[i]) continue;
        let m = 0;
        let sum = 0;
        for (const d of six)
          if (seen[i + d]) {
            m++;
            sum += sdf[i + d];
          }
        if (m >= 2) add.push(i, sum / m);
      }
      for (let k = 0; k < add.length; k += 2) {
        sdf[add[k]] = add[k + 1];
        seen[add[k]] = 1;
      }
    }
    const smooth = sdf.slice();
    for (let z = 1; z < n - 1; z++)
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          const i = x + y * n + z * n * n;
          if (!seen[i]) continue;
          let m = 0;
          let sum = 0;
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const j = i + dx + dy * n + dz * n * n;
                if (seen[j]) {
                  const wgt = dx || dy || dz ? 1 : 3;
                  m += wgt;
                  sum += sdf[j] * wgt;
                }
              }
          smooth[i] = sum / m;
        }
    for (let i = 0; i < c; i++) f[i] = seen[i] ? -smooth[i] : -1;
    const has = new Uint8Array(c);
    for (let i = 0; i < c; i++) {
      if (!this.cw[i]) continue;
      const k = i * 3;
      pal[k] = this.rgb[k] / this.cw[i];
      pal[k + 1] = this.rgb[k + 1] / this.cw[i];
      pal[k + 2] = this.rgb[k + 2] / this.cw[i];
      has[i] = 1;
    }
    // spread colour into neighbouring cells (the surface passes between cells)
    const steps = [1, -1, n, -n, n * n, -n * n];
    for (let pass = 0; pass < 3; pass++) {
      const next = has.slice();
      for (let i = n * n + n + 1; i < c - n * n - n - 1; i++) {
        if (has[i]) continue;
        let m = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (const d of steps)
          if (has[i + d]) {
            m++;
            r += pal[(i + d) * 3];
            g += pal[(i + d) * 3 + 1];
            b += pal[(i + d) * 3 + 2];
          }
        if (m) {
          pal[i * 3] = r / m;
          pal[i * 3 + 1] = g / m;
          pal[i * 3 + 2] = b / m;
          next[i] = 1;
        }
      }
      has.set(next);
    }
    // cells with no colour at all: a neutral paper grey
    for (let i = 0; i < c; i++)
      if (!has[i]) {
        pal[i * 3] = 0.55;
        pal[i * 3 + 1] = 0.52;
        pal[i * 3 + 2] = 0.47;
      }
    mc.isolation = 0;
    mc.update();
  }
}
