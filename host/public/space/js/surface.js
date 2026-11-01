// Surface: a flat, crisp, touchable canvas in the space. Windows, the launcher, the keyboard, the
// watch and the camera controls are all surfaces, so they look and respond the same way:
//   - drawn on a 2D canvas at 1.6× density (sharp up close), uploaded only when something changed
//   - hover is a soft light inside the element under your pointer, gliding from button to button on
//     a spring (done in the shader, so hovering never redraws the canvas)
//   - pressed with a ray + pinch from afar, or with your fingertip when it is within reach
import * as THREE from 'three';
import { UI, PX_PER_M, T } from './theme.js';
import { Spring } from './spring.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FRAG = `
  uniform sampler2D map; uniform float uOpacity, uHoverAmt, uPress, uPointerAmt, uDim;
  uniform vec4 uHover; uniform vec2 uPointer, uSize; uniform vec3 uInk; varying vec2 vUv;
  float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main(){
    vec4 c = texture2D(map, vUv);
    vec2 p = vUv * uSize;
    vec2 hc = (uHover.xy + uHover.zw) * 0.5 * uSize;
    vec2 hb = abs(uHover.zw - uHover.xy) * 0.5 * uSize;
    float inside = 1.0 - smoothstep(-0.0008, 0.0008, box(p - hc, hb, 0.004));
    vec2 dp = p - uPointer * uSize;
    float glow = exp(-dot(dp, dp) / 0.0016);
    float lift = (0.06 + 0.08 * glow * uPointerAmt) * uHoverAmt * inside;
    c.rgb = mix(c.rgb, uInk, lift);
    // a thin ink underline along the element's bottom edge, like the web buttons
    float band = inside * (1.0 - smoothstep(0.0012, 0.0022, p.y - (hc.y - hb.y)));
    c.rgb = mix(c.rgb, uInk, band * uHoverAmt * 0.7);
    c.rgb *= 1.0 - 0.16 * uPress * inside;
    c.rgb *= uDim;
    gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  }`;

let maxAniso = 4;
export function setMaxAnisotropy(a) {
  maxAniso = a;
}

export const SS = 1.6; // canvas pixels per design pixel
/** Every surface that exists (a theme change redraws them all). */
export const ALL_SURFACES = new Set();

export class Surface {
  /**
   * size: [w, h] metres. draw(g, ui, W, H, t) paints in design pixels (PX_PER_M per metre).
   * Optional: canvasPx [w, h] (exact canvas size, e.g. video), ss (density), mipmaps (false for video).
   */
  constructor(world, { size, draw, click, pointer, canvasPx, ss = SS, mipmaps = true, fps = 0, name = '' }) {
    this.world = world;
    this.name = name;
    this.w = size[0];
    this.h = size[1];
    this.drawFn = draw;
    this.clickFn = click;
    this.pointerFn = pointer;
    this.fps = fps;
    if (canvasPx) {
      this.W = canvasPx[0];
      this.H = canvasPx[1];
      this.ss = 1;
    } else {
      this.W = Math.round(this.w * PX_PER_M);
      this.H = Math.round(this.h * PX_PER_M);
      this.ss = ss;
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.W * this.ss);
    this.canvas.height = Math.round(this.H * this.ss);
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.anisotropy = maxAniso;
    if (mipmaps) this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    else {
      this.tex.generateMipmaps = false;
      this.tex.minFilter = THREE.LinearFilter;
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.tex },
        uOpacity: { value: 1 },
        uDim: { value: 1 },
        uHover: { value: new THREE.Vector4(0, 0, 0, 0) },
        uHoverAmt: { value: 0 },
        uPress: { value: 0 },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) },
        uPointerAmt: { value: 0 },
        uSize: { value: new THREE.Vector2(this.w, this.h) },
        uInk: { value: new THREE.Color(T.ink) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), this.mat);
    this.mesh.userData.interactive = { kind: 'surface', surface: this };
    this.ui = new UI();
    this.dirty = true;
    this.lastDraw = -1;
    // hover light: rectangle + amount, both on springs
    this.hv = [0, 0, 0, 0].map((v) => new Spring(v, { stiffness: 320, damping: 32 }));
    this.hoverAmt = new Spring(0, { stiffness: 260, damping: 28 });
    this.pressAmt = new Spring(0, { stiffness: 500, damping: 34 });
    this.pointerAmt = new Spring(0, { stiffness: 200, damping: 26 });
    this.hoverId = null;
    this.pressedId = null;
    this.hovers = 0; // how many pointers are on this surface
    ALL_SURFACES.add(this);
  }

  invalidate() {
    this.dirty = true;
  }

  render(t) {
    const g = this.g;
    g.setTransform(this.ss, 0, 0, this.ss, 0, 0);
    this.ui.begin();
    this.drawFn(g, this.ui, this.W, this.H, t);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.tex.needsUpdate = true;
    this.mat.uniforms.uInk.value.set(T.ink);
    this.dirty = false;
    this.lastDraw = t;
    // the hovered element may have moved
    if (this.hoverId) this.aimHover(this.ui.hits.find((r) => r.id === this.hoverId && r.data === this.hoverData));
  }

  /** Design-pixel coordinates of a uv. */
  px(uv) {
    return { x: uv.x * this.W, y: (1 - uv.y) * this.H };
  }

  aimHover(r, snap) {
    if (!r) return;
    const box = [r.x / this.W, 1 - (r.y + r.h) / this.H, (r.x + r.w) / this.W, 1 - r.y / this.H];
    this.hv.forEach((s, i) => (snap ? s.set(box[i]) : (s.target = box[i])));
  }

  /** kind: hover | down | move | up | leave. Returns the element id it acted on (if any). */
  pointer(kind, uv, p) {
    const { x, y } = uv ? this.px(uv) : { x: -1, y: -1 };
    if (uv) this.mat.uniforms.uPointer.value.set(uv.x, uv.y);
    if (this.pointerFn && this.pointerFn(kind, x, y, p)) return null;
    const hit = kind === 'leave' ? null : this.ui.find(x, y);
    const id = hit ? hit.id : null;
    if (kind === 'hover' || kind === 'move') {
      if (id !== this.hoverId || (hit && hit.data !== this.hoverData)) {
        const from = this.hoverId;
        this.hoverId = id;
        this.hoverData = hit ? hit.data : undefined;
        if (id) {
          this.aimHover(hit, !from); // glide from the last element, appear in place from nothing
          this.world.sound.tick(this.mesh.getWorldPosition(new THREE.Vector3()));
        }
      }
      this.hoverAmt.target = id ? 1 : 0;
      this.pointerAmt.target = 1;
    } else if (kind === 'down') {
      this.pressedId = id;
      this.ui.press = id;
      this.pressAmt.target = id ? 1 : 0;
      if (id) this.world.haptic(p, 0.25, 18);
      this.dirty = true;
      return id;
    } else if (kind === 'up') {
      const was = this.pressedId;
      this.pressedId = null;
      this.ui.press = null;
      this.pressAmt.target = 0;
      this.dirty = true;
      if (was && was === id) {
        this.world.sound.click(this.mesh.getWorldPosition(new THREE.Vector3()));
        if (this.clickFn) this.clickFn(id, hit.data, p);
        return id;
      }
    } else if (kind === 'leave') {
      this.hoverId = null;
      this.hoverAmt.target = 0;
      this.pointerAmt.target = 0;
      if (this.pressedId) {
        this.pressedId = null;
        this.ui.press = null;
        this.pressAmt.target = 0;
        this.dirty = true;
      }
    }
    return id;
  }

  /** Where a world point sits on this surface: uv, signed distance in metres (+ in front), inside. */
  locate(point, out = {}) {
    const m = this.mesh.matrixWorld;
    const inv = (this._inv = this._inv || new THREE.Matrix4()).copy(m).invert();
    const l = (this._l = this._l || new THREE.Vector3()).copy(point).applyMatrix4(inv);
    const scale = (this._s = this._s || new THREE.Vector3()).setFromMatrixScale(m).x;
    out.u = l.x / this.w + 0.5;
    out.v = l.y / this.h + 0.5;
    out.d = l.z * scale;
    out.inside = out.u >= 0 && out.u <= 1 && out.v >= 0 && out.v <= 1;
    out.uv = { x: out.u, y: out.v };
    return out;
  }

  update(t, dt) {
    if (this.dirty || (this.fps && t - this.lastDraw > 1 / this.fps)) this.render(t);
    const u = this.mat.uniforms;
    this.hv.forEach((s, i) => s.step(dt));
    u.uHover.value.set(this.hv[0].value, this.hv[1].value, this.hv[2].value, this.hv[3].value);
    u.uHoverAmt.value = Math.max(0, this.hoverAmt.step(dt));
    u.uPress.value = Math.max(0, this.pressAmt.step(dt));
    u.uPointerAmt.value = Math.max(0, this.pointerAmt.step(dt));
  }

  dispose() {
    ALL_SURFACES.delete(this);
    this.tex.dispose();
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}
