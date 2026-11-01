// The world: a cyber-wabi dry garden. Ink sky, raked sand that glows faintly, stones mended with
// gold (kintsugi), a huge imperfect ensō on the horizon, drifting motes, and the CORE orb.
// "room" mode hides the garden so passthrough (your real room) shows through.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

// Hand-picked display colours: written straight out, no linear->sRGB pass (that would grey the night sky).
const COLORSPACE = '';

export function createEnvironment(scene, renderer) {
  const garden = new THREE.Group();
  const always = new THREE.Group();
  scene.add(garden, always);

  // reflections for chrome / gold
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.HemisphereLight(0xf2ebde, 0x101012, 1.1));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
  key.position.set(-3, 6, 2);
  scene.add(key);

  // ---------------------------------------------------------------- sky
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform float uTime;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        void main(){
          float y = vDir.y;
          vec3 top = vec3(0.018,0.018,0.022);
          vec3 hor = vec3(0.075,0.072,0.088);
          vec3 c = mix(hor, top, smoothstep(-0.05, 0.6, y));
          // faint moon haze behind the ensō
          float moon = pow(max(0.0, dot(vDir, normalize(vec3(0.0,0.3,-1.0)))), 18.0);
          c += vec3(0.16,0.14,0.12) * moon * 0.6;
          // sparse stars, slowly twinkling
          vec3 q = floor(vDir * 260.0);
          float s = step(0.9975, h(q)) * smoothstep(0.05, 0.3, y);
          c += vec3(0.85,0.82,0.78) * s * (0.55 + 0.45*sin(uTime*1.3 + h(q+1.0)*40.0));
          gl_FragColor = vec4(c, 1.0);
          ${COLORSPACE}
        }`,
    })
  );
  sky.renderOrder = -10;
  garden.add(sky);

  // ---------------------------------------------------------------- raked sand (karesansui)
  const stones = [
    { x: -2.3, z: -3.6, r: 0.55, ry: 0.4, seed: 3 },
    { x: 2.7, z: -4.3, r: 0.75, ry: 0.5, seed: 11 },
    { x: 0.5, z: -6.4, r: 0.42, ry: 0.55, seed: 23 },
  ];
  const groundMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uStones: { value: stones.map((s) => new THREE.Vector3(s.x, s.z, s.r)) },
    },
    vertexShader: `varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec2 vP; uniform float uTime; uniform vec3 uStones[3];
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        // straight rake lines, bent into rings around each stone
        float field = vP.y * 9.0;
        float ringMask = 0.0;
        for (int i = 0; i < 3; i++) {
          float d = length(vP - uStones[i].xy) - uStones[i].z;
          float w = smoothstep(1.6, 0.9, d);
          field = mix(field, d * 10.0, w);
          ringMask = max(ringMask, w);
        }
        float wave = 0.5 + 0.5 * sin(field * 3.14159);
        float line = smoothstep(0.86, 1.0, wave);
        float dist = length(vP);
        float fade = exp(-dist * 0.12) * smoothstep(0.0, 0.6, dist);
        vec3 sand = vec3(0.055,0.054,0.058);
        vec3 lineCol = mix(vec3(0.84,0.80,0.72), vec3(0.66,0.86,0.95), 0.18 + 0.18*sin(vP.x*0.4 + uTime*0.2));
        vec3 c = sand + lineCol * line * (0.16 + 0.1*ringMask);
        // grain
        c += (h(floor(vP*240.0)) - 0.5) * 0.018;
        // soft pool of light where you stand
        c += vec3(0.05,0.045,0.04) * smoothstep(3.2, 0.0, dist);
        gl_FragColor = vec4(c, fade + 0.25);
        ${COLORSPACE}
      }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -9;
  garden.add(ground);

  // ---------------------------------------------------------------- stones with gold seams
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.82, metalness: 0.05, flatShading: true, envMap: envTex, envMapIntensity: 0.25 });
  const goldMat = new THREE.LineBasicMaterial({ color: 0xd8b26a, transparent: true, opacity: 0.95 });
  for (const s of stones) {
    const geo = new THREE.IcosahedronGeometry(s.r, 1);
    const pos = geo.attributes.position;
    let seed = s.seed;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const moved = new Map();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!moved.has(key)) moved.set(key, 0.82 + rand() * 0.3);
      const k = moved.get(key);
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * s.ry, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, stoneMat);
    rock.position.set(s.x, s.r * s.ry * 0.55, s.z);
    rock.rotation.y = rand() * 6;
    garden.add(rock);
    // kintsugi: a gold seam along a random walk of edges
    const edges = new THREE.EdgesGeometry(geo, 1);
    const e = edges.attributes.position;
    const pts = [];
    for (let i = 0; i < e.count; i += 2) if (rand() < 0.22 && e.getY(i) > -s.r * 0.2) pts.push(e.getX(i), e.getY(i), e.getZ(i), e.getX(i + 1), e.getY(i + 1), e.getZ(i + 1));
    const seam = new THREE.BufferGeometry();
    seam.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.LineSegments(seam, goldMat);
    line.scale.setScalar(1.004);
    rock.add(line);
  }

  // ---------------------------------------------------------------- the ensō on the horizon
  const ensoPts = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI * 0.6 + (i / N) * Math.PI * 2 * 0.86;
    const r = 7 * (1 + Math.sin(i * 0.7) * 0.015 + Math.sin(i * 0.23) * 0.02);
    ensoPts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(i * 0.4) * 0.15));
  }
  const ensoCurve = new THREE.CatmullRomCurve3(ensoPts);
  const enso = new THREE.Mesh(
    new THREE.TubeGeometry(ensoCurve, 220, 0.11, 6, false),
    new THREE.MeshBasicMaterial({ color: 0xe9e1d2, transparent: true, opacity: 0.9 })
  );
  enso.position.set(0, 10, -34);
  garden.add(enso);
  const ensoInner = new THREE.Mesh(
    new THREE.TubeGeometry(ensoCurve, 220, 0.035, 4, false),
    new THREE.MeshBasicMaterial({ color: 0xd8b26a, transparent: true, opacity: 0.7 })
  );
  ensoInner.position.copy(enso.position);
  ensoInner.scale.setScalar(0.93);
  garden.add(ensoInner);

  // ---------------------------------------------------------------- drifting motes
  const M = 420;
  const mp = new Float32Array(M * 3);
  const ms = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * 16;
    mp.set([Math.cos(a) * r, Math.random() * 7, Math.sin(a) * r], i * 3);
    ms[i] = Math.random();
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.05 + aSeed*0.08), 7.0);
          p.x += sin(uTime*0.3 + aSeed*20.0) * 0.4;
          p.z += cos(uTime*0.25 + aSeed*13.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = (2.0 + aSeed*3.0) * (14.0 / -mv.z);
          vA = 0.25 + 0.35*aSeed;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main(){ float d = length(gl_PointCoord-0.5); if (d>0.5) discard; gl_FragColor = vec4(0.95,0.88,0.76, vA * smoothstep(0.5,0.0,d)); ${COLORSPACE} }`,
    })
  );
  garden.add(motes);

  // ---------------------------------------------------------------- presence ring (both modes)
  const feet = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.432, 96),
    new THREE.MeshBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  feet.rotation.x = -Math.PI / 2;
  feet.position.y = 0.005;
  always.add(feet);

  // ---------------------------------------------------------------- CORE (the Jarvis presence)
  const core = new THREE.Group();
  core.position.set(-0.72, 1.42, -1.3);
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 48, 24),
    new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, metalness: 1, roughness: 0.07, iridescence: 1, iridescenceIOR: 1.45, iridescenceThicknessRange: [180, 620], envMap: envTex, envMapIntensity: 1.4 })
  );
  core.add(orb);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xece5d6, transparent: true, opacity: 0.55 });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.0012, 6, 96), ringMat);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.0009, 6, 96), new THREE.MeshBasicMaterial({ color: 0xd8b26a, transparent: true, opacity: 0.65 }));
  r1.rotation.x = 1.2;
  r2.rotation.y = 0.9;
  core.add(r1, r2);
  const sealDot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe2472c }));
  sealDot.position.set(0.15, 0, 0);
  r2.add(sealDot);
  always.add(core);
  orb.userData.isCore = true;
  // retired as a floating object: the launcher's ensō is the core now (it stays as a sound anchor)
  core.visible = false;

  let pulse = 0;
  let mode = 'room';

  return {
    garden,
    core,
    orb,
    envTex,
    get mode() {
      return mode;
    },
    setMode(m) {
      mode = m === 'void' ? 'void' : 'room';
      garden.visible = mode === 'void';
    },
    pulse(strength = 1) {
      pulse = Math.max(pulse, strength);
    },
    update(t, dt) {
      sky.material.uniforms.uTime.value = t;
      groundMat.uniforms.uTime.value = t;
      motes.material.uniforms.uTime.value = t;
      enso.rotation.z = t * 0.02;
      ensoInner.rotation.z = t * 0.02;
      pulse = Math.max(0, pulse - dt * 1.6);
      const s = 1 + pulse * 0.35 + Math.sin(t * 1.4) * 0.02;
      orb.scale.setScalar(s);
      core.position.y = (core.userData.baseY ?? 1.42) + Math.sin(t * 0.8) * 0.015;
      r1.rotation.z = t * 0.6;
      r2.rotation.z = -t * 0.4;
      r2.rotation.x = Math.sin(t * 0.3) * 0.4;
      ringMat.opacity = 0.45 + pulse * 0.5;
    },
  };
}
