// Effects: gesture labels with a hold ring, the photo frame + flash + flying polaroid, glyph rain
// for hacker mode, ink rings on taps, and captions under the core (everything spoken is written).
import * as THREE from 'three';
import { T, FONT, text, mono, hudTag, cutPath, ring, enso, seal } from './theme.js';
import { Spring } from './spring.js';

function canvasSprite(w, h, scale) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, (scale * h) / w, 1);
  s.renderOrder = 30;
  return { s, c, g: c.getContext('2d'), tex };
}

export class FX {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.items = [];
    // hold ring + label next to the hand
    this.hold = canvasSprite(512, 384, 0.1);
    this.hold.s.visible = false;
    this.scene.add(this.hold.s);
    this.holdKey = '';
    // frame corners while you hold the photo frame
    const cornerMat = new THREE.LineBasicMaterial({ color: 0xd8b26a, transparent: true, opacity: 0.9, depthTest: false });
    this.frameLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 3), 3)), cornerMat);
    this.frameLines.frustumCulled = false;
    this.frameLines.renderOrder = 31;
    this.frameLines.visible = false;
    this.scene.add(this.frameLines);
    // caption under the core
    this.caption = canvasSprite(1400, 160, 0.8);
    this.caption.s.visible = false;
    this.scene.add(this.caption.s);
    this.captionUntil = 0;
  }

  /** On the line from your eyes through `p`, but never closer than `min` metres: labels at your
   *  hand would otherwise sit ~35 cm from your eyes (Meta comfort: nothing closer than 0.5 m). */
  comfy(p, min) {
    const head = this.world.camera.getWorldPosition(new THREE.Vector3());
    const d = p.clone().sub(head);
    return d.length() >= min ? p.clone() : head.addScaledVector(d.normalize(), min);
  }

  // ------------------------------------------------------------------ gesture hold feedback

  gestureProgress(list, meta) {
    const top = list.sort((a, b) => b.p - a.p)[0];
    if (!top) {
      this.hold.s.visible = false;
      this.frameLines.visible = false;
      return;
    }
    const info = meta[top.name] || { glyph: '·', name: top.name };
    const key = `${top.name}:${Math.round(top.p * 24)}`;
    if (key !== this.holdKey) {
      this.holdKey = key;
      const g = this.hold.g;
      g.clearRect(0, 0, 512, 384);
      ring(g, 256, 130, 96, top.p, { color: T.seal, width: 7, track: T.line2 });
      g.fillStyle = T.ink;
      g.fillRect(250, 124, 12, 12);
      g.font = `600 30px ${FONT.mono}`;
      const w = g.measureText(String(info.name).toUpperCase()).width + 34;
      hudTag(g, 256 - w / 2, 262, info.name, { size: 30 });
      mono(g, 'hold', 256, 362, { size: 22, color: '#a8a194', align: 'center' });
      this.hold.tex.needsUpdate = true;
    }
    this.hold.s.position.copy(this.comfy(top.at, 0.6)).add(new THREE.Vector3(0, 0.07, 0));
    this.hold.s.visible = true;
    if (top.corners) this.drawFrame(top.corners[0], top.corners[1], top.p);
    else this.frameLines.visible = false;
  }

  /** Gold corner marks between the two hands' L corners, in the plane facing you. */
  drawFrame(a, b, p) {
    const cam = this.world.camera;
    const right = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(cam.matrixWorld);
    const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const d = new THREE.Vector3().subVectors(b, a);
    const hw = Math.abs(d.dot(right)) / 2;
    const hh = Math.abs(d.dot(up)) / 2;
    const L = Math.min(hw, hh) * 0.35 * (0.6 + 0.4 * p);
    const pts = [];
    for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const corner = c.clone().addScaledVector(right, sx * hw).addScaledVector(up, sy * hh);
      pts.push(corner, corner.clone().addScaledVector(right, -sx * L), corner, corner.clone().addScaledVector(up, -sy * L));
    }
    const pos = this.frameLines.geometry.attributes.position;
    pts.forEach((q, i) => pos.setXYZ(i, q.x, q.y, q.z));
    pos.needsUpdate = true;
    this.frameLines.material.opacity = 0.4 + 0.6 * p;
    this.frameLines.visible = true;
  }

  /** Where a gesture fired: its name as a tag that types in, one quiet line under it. */
  stamp(at, glyph, name, sub) {
    const sp = canvasSprite(720, 150, 0.2);
    const g = sp.g;
    const label = String(name).toUpperCase();
    let shown = -1;
    const paint = (n) => {
      g.clearRect(0, 0, 720, 150);
      hudTag(g, 8, 8, label, { size: 30, chars: n });
      if (sub && n >= label.length) {
        g.font = `500 30px ${FONT.ui}`;
        const tw = Math.min(700, g.measureText(sub).width + 36);
        cutPath(g, 8, 72, tw, 64, 6);
        g.fillStyle = T.chip;
        g.fill();
        text(g, sub, 26, 114, { size: 30, weight: 500, color: '#ece5d6', max: 670 });
      }
      sp.tex.needsUpdate = true;
    };
    sp.s.center.set(0, 1); // grow from the top-left, next to your hand
    sp.s.position.copy(this.comfy(at, 0.7)).add(new THREE.Vector3(0.03, 0.09, 0));
    this.scene.add(sp.s);
    this.items.push({ obj: sp.s, t: 0, life: 1.6, update: (k) => {
      const n = Math.min(label.length, Math.floor(k * 1.6 * 4 * label.length));
      if (n !== shown) {
        shown = n;
        paint(n);
      }
      sp.s.material.opacity = k < 0.06 ? k / 0.06 : 1 - Math.max(0, (k - 0.7) / 0.3);
    } });
  }

  /** Ink ring rippling out from a point (taps, arrivals). */
  ink(at, color = 0xece5d6, size = 0.12) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(at);
    m.lookAt(this.world.camera.getWorldPosition(new THREE.Vector3()));
    this.scene.add(m);
    this.items.push({ obj: m, t: 0, life: 0.7, update: (k) => {
      m.scale.setScalar(size * (0.2 + k));
      m.material.opacity = (1 - k) * 0.8;
    } });
  }

  // ------------------------------------------------------------------ photo

  flash(corners) {
    const cam = this.world.camera;
    let center;
    let w = 0.5;
    let h = 0.32;
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    if (corners) {
      center = new THREE.Vector3().addVectors(corners[0], corners[1]).multiplyScalar(0.5);
      const right = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(cam.matrixWorld);
      const d = new THREE.Vector3().subVectors(corners[1], corners[0]);
      w = Math.max(0.1, Math.abs(d.dot(right)));
      h = Math.max(0.08, Math.abs(d.dot(up)));
    } else center = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.7);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false }));
    m.position.copy(center);
    m.quaternion.copy(cam.getWorldQuaternion(new THREE.Quaternion()));
    m.renderOrder = 40;
    this.scene.add(m);
    this.items.push({ obj: m, t: 0, life: 0.45, update: (k) => {
      m.material.opacity = (1 - k) * 0.85;
      m.scale.setScalar(1 + k * 0.08);
    } });
    return center;
  }

  /** The photo as a polaroid that drifts from where you took it toward `to`. */
  polaroid(url, from, to) {
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const ar = tex.image.width / tex.image.height || 1.5;
      const w = 0.24;
      const h = w / ar;
      const g = new THREE.Group();
      const card = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.024, h + 0.06), new THREE.MeshBasicMaterial({ color: 0xece5d6 }));
      card.position.y = -0.016;
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
      pic.position.z = 0.001;
      g.add(card, pic);
      g.position.copy(from);
      g.lookAt(this.world.camera.getWorldPosition(new THREE.Vector3()));
      this.scene.add(g);
      const start = from.clone();
      this.items.push({ obj: g, t: 0, life: 2.6, update: (k) => {
        const e = k < 0.35 ? 0 : (k - 0.35) / 0.65;
        const ease = e * e * (3 - 2 * e);
        g.position.lerpVectors(start, to, ease);
        g.position.y += Math.sin(ease * Math.PI) * 0.12;
        g.rotation.z = Math.sin(k * 6) * 0.06 * (1 - ease);
        g.scale.setScalar(1 - ease * 0.6);
      } });
    });
  }

  // ------------------------------------------------------------------ hacker mode

  glyphRain(duration = 3.2) {
    const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ映写影光01ﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ空間';
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.font = `40px ${'"Noto Sans CJK JP","Noto Sans JP",monospace'}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 64; i++) {
      g.fillStyle = i % 9 === 0 ? '#e2472c' : i % 5 === 0 ? '#d0aa5f' : '#ece5d6';
      g.fillText(glyphs[i % glyphs.length], (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 32);
    }
    const tex = new THREE.CanvasTexture(c);
    const N = 900;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const head = this.world.camera.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.6 + Math.random() * 2.6;
      pos.set([head.x + Math.cos(a) * r, head.y + 1.6 + Math.random() * 2, head.z + Math.sin(a) * r], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uMap: { value: tex }, uT: { value: 0 }, uFade: { value: 1 } },
      vertexShader: `attribute float aSeed; uniform float uT; varying float vS; varying float vA;
        void main(){ vec3 p = position; p.y -= uT * (0.8 + aSeed * 1.6); vS = floor(aSeed * 64.0 + uT * 6.0 * aSeed);
          vA = smoothstep(-0.5, 0.4, p.y); vec4 mv = modelViewMatrix * vec4(p,1.0); gl_PointSize = 26.0 * (2.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; uniform float uFade; varying float vS; varying float vA;
        void main(){ float i = mod(vS, 64.0); vec2 cell = vec2(mod(i, 8.0), floor(i / 8.0));
          vec2 uv = (cell + vec2(gl_PointCoord.x, gl_PointCoord.y)) / 8.0; uv.y = 1.0 - uv.y;
          vec4 c = texture2D(uMap, uv); gl_FragColor = vec4(c.rgb, c.a * vA * uFade * 0.9); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.items.push({ obj: pts, t: 0, life: duration, update: (k, t) => {
      mat.uniforms.uT.value = t;
      mat.uniforms.uFade.value = k > 0.75 ? (1 - k) / 0.25 : Math.min(1, k * 5);
    } });
  }

  // ------------------------------------------------------------------ captions

  /** The caption: one line, always the same look and place (below the centre of view). */
  say(textStr, ms = 3800) {
    const g = this.caption.g;
    g.clearRect(0, 0, 1400, 160);
    g.font = `500 42px ${FONT.ui}`;
    const d = new Date();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const w = Math.min(1380, g.measureText(textStr).width + 200);
    const x = (1400 - w) / 2;
    cutPath(g, x, 30, w, 100, 10);
    g.fillStyle = T.chip;
    g.fill();
    g.strokeStyle = T.line2;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#e2472c';
    g.fillRect(x, 40, 8, 80);
    text(g, textStr, x + 38, 94, { size: 42, weight: 500, color: '#ece5d6', max: w - 170 });
    text(g, time, x + w - 30, 92, { size: 24, family: 'mono', color: '#6f6a61', align: 'right' });
    this.caption.tex.needsUpdate = true;
    this.caption.s.visible = true;
    this.capFade = this.capFade || new Spring(0, { stiffness: 260, damping: 26 });
    this.capFade.target = 1;
    this.captionUntil = performance.now() + ms;
  }

  update(t, dt) {
    // captions sit a little below the centre of your view, 1.1 m away, and follow lazily
    const cam = this.world.camera;
    const e = cam.matrixWorld.elements;
    const head = new THREE.Vector3(e[12], e[13], e[14]);
    const yaw = Math.atan2(e[8], e[10]);
    if (this.capYaw === undefined || Math.abs(Math.atan2(Math.sin(yaw - this.capYaw), Math.cos(yaw - this.capYaw))) > 0.5 || !this.caption.s.visible) this.capYaw = yaw;
    const want = head.clone().add(new THREE.Vector3(-Math.sin(this.capYaw) * 1.1, -0.2, -Math.cos(this.capYaw) * 1.1));
    if (!this.capPos || !this.caption.s.visible) this.capPos = want.clone();
    this.capPos.lerp(want, 1 - Math.exp(-5 * dt));
    this.caption.s.position.copy(this.capPos);
    if (this.capFade) {
      if (performance.now() > this.captionUntil) this.capFade.target = 0;
      const a = Math.max(0, Math.min(1, this.capFade.step(dt)));
      this.caption.s.material.opacity = a;
      if (a < 0.01 && this.capFade.target === 0) this.caption.s.visible = false;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.life);
      it.update(k, it.t);
      if (k >= 1) {
        it.obj.removeFromParent();
        it.obj.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
        });
        this.items.splice(i, 1);
      }
    }
  }
}

// keep tree-shaking honest for helpers used by apps
export { enso, seal };
