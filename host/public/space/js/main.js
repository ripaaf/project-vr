// UTSUSHI Space — boot, XR session, the world object, gesture actions, photos, the render loop.
import * as THREE from 'three';
import { ALL_SURFACES } from './surface.js';
import { createEnvironment } from './env.js';
import { Sound } from './audio.js';
import { Panels, setMaxAnisotropy } from './panels.js';
import { Input } from './input.js';
import { Hands, GESTURES } from './hands.js';
import { FX } from './fx.js';
import { Camera } from './camera.js';
import { Keyboard } from './keyboard.js';
import { setTheme, setGlass } from './theme.js';
import { api } from './api.js';
import { Terminal } from './apps/terminal.js';
import { System } from './apps/system.js';
import { Screens } from './apps/screens.js';
import { Devices } from './apps/devices.js';
import { Models } from './apps/models.js';
import { Scanner } from './scanner.js';
import { Web } from './apps/web.js';
import { Gallery } from './apps/gallery.js';
import { Gestures } from './apps/gestures.js';
import { Settings } from './apps/settings.js';
import { Tour } from './apps/tour.js';
import { Files } from './apps/files.js';
import { Notes } from './apps/notes.js';
import { Launcher } from './apps/launcher.js';
import { Watch } from './apps/watch.js';
import { QuickRing } from './quickring.js';
import { Charms } from './charms.js';

// ------------------------------------------------------------------ settings (per device)

const DEFAULTS = { mode: 'room', theme: 'night', glass: 0.9, sound: true, volume: 0.8, ambient: false, voice: false, skeleton: true, fps: 90, sharp: 'high', gestures: {}, toured: false, winSize: 'compact' };
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('utsushi.settings') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
const settings = loadSettings();
setTheme(settings.theme);
setGlass(settings.glass);

// ------------------------------------------------------------------ three

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// Sharp text: three.js asks the headset for maximum foveation by default, which blurs everything
// away from the centre of your view; turn it off and render a bit above the default resolution.
renderer.xr.setFoveation(0);
stage.appendChild(renderer.domElement);
setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const deskCam = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.03, 200);
deskCam.position.set(0, 1.6, 0);
scene.add(deskCam);
let yaw = 0;
let pitch = -0.05;

// ------------------------------------------------------------------ the world

const listeners = {};
const world = {
  scene,
  renderer,
  settings,
  apps: {},
  objects: [],
  xrActive: false,
  session: null,
  arSupported: false,
  keyTarget: null,
  armingNames: new Set(),
  lastStats: null,
  // served by the Quest app itself (no PC): notes, models and scans stay on the headset
  standalone: location.port === '8770',
  planes: [], // tables and desks from the headset's Space Setup: { y, cx, cz, r }
  get camera() {
    return renderer.xr.isPresenting ? renderer.xr.getCamera() : deskCam;
  },
  on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
  },
  emit(name, e) {
    (listeners[name] || []).forEach((fn) => fn(e));
  },
  haptic(p, intensity = 0.3, ms = 20) {
    try {
      const a = p && p.source && p.source.gamepad && p.source.gamepad.hapticActuators && p.source.gamepad.hapticActuators[0];
      if (a) a.pulse(intensity, ms);
    } catch {}
  },
  interactives() {
    return [...quick.interactives(), ...panels.interactives(), ...launcher.interactives(), ...keyboard.interactives(), ...cameraBox.interactives(), ...watch.interactives(), ...apps.notes.interactives3d(), ...stageOf('interactives'), ...scanner.interactives(), ...charms.interactives(), ...world.objects];
  },
  surfaces() {
    return [...quick.surfaces(), ...panels.surfaces(), ...launcher.surfaces(), ...keyboard.surfaces(), ...cameraBox.surfaces(), ...watch.surfaces(), ...apps.notes.surfaces3d(), ...stageOf('surfaces'), ...scanner.surfaces()];
  },
  saveSettings() {
    try {
      localStorage.setItem('utsushi.settings', JSON.stringify(settings));
    } catch {}
  },
  lookBy(dx, dy) {
    yaw -= dx;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - dy));
    deskCam.rotation.set(pitch, yaw, 0, 'YXZ');
  },
  /** Height of a table under a point (Space Setup), or null. */
  tableUnder(p) {
    let best = null;
    for (const pl of world.planes) {
      if (pl.y > p.y + 0.25 || pl.y < p.y - 0.7) continue;
      if (Math.hypot(p.x - pl.cx, p.z - pl.cz) > pl.r + 0.1) continue;
      if (best === null || Math.abs(pl.y - p.y) < Math.abs(best - p.y)) best = pl.y;
    }
    return best;
  },
};

const sound = new Sound();
sound.enabled = settings.sound;
sound.volume = settings.volume;
sound.voiceOn = settings.voice;
world.sound = sound;
const env = createEnvironment(scene, renderer);
world.env = env;
world.core = env;
const panels = new Panels(scene, world);
world.panels = panels;
const fx = new FX(world);
world.fx = fx;
const input = new Input(world);
world.input = input;
const hands = new Hands(world);
hands.show = settings.skeleton;
world.hands = hands;
const keyboard = new Keyboard(world);
world.keyboard = keyboard;
const cameraBox = new Camera(world);
world.cameraBox = cameraBox;
const launcher = new Launcher(world);
world.launcher = launcher;
const watch = new Watch(world);
world.watch = watch;
const quick = new QuickRing(world);
world.quick = quick;
const scanner = new Scanner(world);
world.scanner = scanner;
const charms = new Charms(world);
world.charms = charms;

const apps = {
  notes: new Notes(),
  term: new Terminal(),
  files: new Files(),
  sys: new System(),
  pc: new Screens(),
  dev: new Devices(),
  models: new Models(),
  web: new Web(),
  gal: new Gallery(),
  ges: new Gestures(),
  set: new Settings(),
  tour: new Tour(),
};
world.apps = apps;
for (const a of Object.values(apps)) a.world = world;

/** The models stage (made the first time a model is shown). */
function stageOf(what) {
  const st = apps.models._stage;
  return st ? st[what]() : [];
}

const META = Object.fromEntries(GESTURES.map((g) => [g.id, g]));

// ------------------------------------------------------------------ actions

world.coreSay = (text) => {
  fx.say(text);
  sound.say(text);
};

async function status() {
  try {
    const s = await api('/api/space/stats');
    world.lastStats = s;
    const d = new Date();
    const q = s.quest || {};
    const parts = [`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`];
    if (q.battery != null) parts.push(`headset ${q.battery}%${q.charging ? ' charging' : ''}`);
    if (s.pc) parts.push(`pc cpu ${s.pc.cpu}%`);
    else parts.push('running on the Quest alone');
    if (s.serial && s.serial.open) parts.push(`${s.serial.port} connected`);
    world.coreSay(parts.join(' · '));
  } catch {
    world.coreSay('The PC is quiet.');
  }
}

function allSurfacesDirty() {
  for (const s of ALL_SURFACES) s.dirty = true;
  charms.dirtyAll();
}

world.setMode = (m) => {
  roomHeld = false; // your choice wins over a temporary peek
  if (m === 'room' && !world.arSupported && world.xrActive) m = 'void';
  env.setMode(m);
  settings.mode = m;
  world.saveSettings();
  sound.chime(null, m === 'void' ? 3 : 1);
  allSurfacesDirty();
};

// Scanning and framing a photo need to see the real room: in Void they bring it back for a while
// (your Void setting stays as it is) and Void returns when nothing needs the room any more.
const roomNeeds = new Set();
let roomHeld = false;
world.needRoom = (who, on) => {
  if (on) {
    if (!roomNeeds.size && env.mode === 'void') {
      roomHeld = true;
      env.setMode('room');
    }
    roomNeeds.add(who);
  } else if (roomNeeds.delete(who) && !roomNeeds.size && roomHeld) {
    roomHeld = false;
    env.setMode('void');
  }
};

world.setGlass = (a) => {
  setGlass(a);
  settings.glass = a;
  world.saveSettings();
  allSurfacesDirty();
};

world.setTheme = (name) => {
  setTheme(name);
  settings.theme = name;
  world.saveSettings();
  allSurfacesDirty();
};

// Asked for inside an XR frame (that is how Meta's docs do it); the headset may still keep its
// default 72 Hz, so Settings shows the rate it actually runs at.
let wantRate = null;
world.applyFrameRate = () => {
  const s = world.session;
  if (!s || !s.supportedFrameRates || !s.updateTargetFrameRate) return;
  const rates = [...s.supportedFrameRates];
  wantRate = rates.reduce((best, r) => (Math.abs(r - settings.fps) < Math.abs(best - settings.fps) ? r : best), rates[0]);
};

world.recenter = () => {
  panels.recenter(world.camera);
  launcher.place(true);
  charms.place(true); // they fly back around you
  sound.chime(null, 4);
};

let photoBusy = false;
const frameWaiters = [];
world.waitFrames = (n) => new Promise((r) => frameWaiters.push({ n, r }));

/** A photo of what you see; `rect` crops it (camera frame), `from` is where the polaroid starts. */
world.photo = async (rect, from) => {
  if (photoBusy) return;
  photoBusy = true;
  sound.shutter(from || null);
  // keep our own overlays out of the picture
  const showHands = hands.show;
  hands.show = false;
  fx.hold.s.visible = false;
  await world.waitFrames(3);
  try {
    // with the PC: a capture of what you see; on the Quest alone: the app's passthrough camera
    const r = await api('/api/space/snap', { rect });
    hands.show = showHands;
    const start = from ? from.clone() : fx.flash(null);
    if (from) fx.ink(from, 0xffffff, 0.3);
    const to = panels.isOpen(apps.gal) ? panels.get(apps.gal).group.position.clone() : launcher.group.position.clone();
    fx.polaroid(r.url, start, to);
    world.emit('photoSaved', r);
    apps.gal.refresh();
    apps.tour.signal('photo');
    world.coreSay(world.standalone ? 'Photo saved on the Quest.' : 'Photo saved to the PC.');
  } catch (e) {
    hands.show = showHands;
    sound.error(from || null);
    world.coreSay(e.status === 409 ? 'No picture: is the headset awake and on the cable?' : `No photo. ${e.message}`);
  }
  photoBusy = false;
};

world.startTour = (force) => {
  if (force) panels.closeAll();
  panels.open(apps.tour, { slot: 0, height: 0.02, pinned: true });
};

world.tourDone = () => {
  settings.toured = true;
  world.saveSettings();
  defaultWindows();
  world.coreSay('The Apps tab rests below your windows. Pinch it, or raise a palm.');
};

function defaultWindows() {
  // start clean: the launcher in front of you, nothing else in the way
  launcher.open();
}

world.exit = () => {
  if (world.session) world.session.end();
  else stopPreview();
};

world.gestureProgress = (list) => {
  world.armingNames = new Set(list.map((x) => x.name));
  fx.gestureProgress(list, META);
};

// ------------------------------------------------------------------ gestures → actions

const STAMPED = new Set(['menu', 'peace', 'rock', 'thumbsUp', 'clap', 'pointAt', 'doublePinch', 'center']);

world.on('gesture', (e) => {
  const meta = META[e.name] || { glyph: '·', name: e.name };
  if (e.phase === 'start' && STAMPED.has(e.name)) {
    const at = e.at || launcher.group.position;
    sound.chime(at, Object.keys(META).indexOf(e.name));
    fx.stamp(at, meta.glyph, meta.name, meta.does);
  }
  if (e.phase === 'start') apps.tour.signal(e.name);
  const start = e.phase === 'start';
  switch (e.name) {
    case 'frame':
      if (start) cameraBox.begin(e.corners);
      else cameraBox.place();
      break;
    case 'shutter':
      cameraBox.snap();
      break;
    case 'pointAt':
      if (start) world.photo(null, e.at);
      break;
    case 'menu':
      if (start) quick.open(e.at);
      break;
    case 'watch':
      if (start) watch.show();
      else watch.hide();
      break;
    case 'peace':
      if (start) world.setMode(env.mode === 'void' ? 'room' : 'void');
      break;
    case 'rock':
      if (start) {
        fx.glyphRain();
        panels.focus(apps.term);
        world.coreSay('Hacker mode.');
      }
      break;
    case 'thumbsUp':
    case 'clap':
      if (start) status();
      break;
    case 'push':
      if (start) {
        const target = panels.pushTarget(world.camera.getWorldPosition(new THREE.Vector3()), e.dir || new THREE.Vector3(0, 0, -1).transformDirection(world.camera.matrixWorld));
        if (target) panels.pushAway(target.app, e.dir || new THREE.Vector3(0, 0, -1).transformDirection(world.camera.matrixWorld));
        else sound.tick(e.at);
      }
      break;
    case 'swipe':
      if (start) {
        panels.rotate(e.dir);
        sound.open(null);
      }
      break;
    case 'doublePinch':
    case 'center':
      if (start) world.recenter();
      break;
  }
});

world.on('launcher', () => apps.tour.signal('launcher'));

// physical / Bluetooth keyboard
window.addEventListener('keydown', (e) => {
  if (previewing && e.altKey) {
    const map = { 1: 'menu', 2: 'peace', 3: 'rock', 4: 'thumbsUp', 5: 'pointAt', 6: 'clap', 7: 'camera', 8: 'push', 9: 'swipeR', 0: 'center' };
    const name = map[e.key];
    if (name) {
      e.preventDefault();
      const at = deskCam.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.12, -0.2, -0.55).applyQuaternion(deskCam.quaternion));
      if (name === 'camera') cameraBox.open();
      else if (name === 'push') world.emit('gesture', { name: 'push', phase: 'start', at, dir: new THREE.Vector3(0, 0, -1).applyQuaternion(deskCam.quaternion) });
      else if (name.startsWith('swipe')) world.emit('gesture', { name: 'swipe', phase: 'start', dir: name === 'swipeR' ? 1 : -1, at });
      else {
        world.emit('gesture', { name, phase: 'start', hand: 'right', at });
        setTimeout(() => world.emit('gesture', { name, phase: 'end', hand: 'right' }), 600);
      }
      return;
    }
  }
  const t = keyboard.visible && keyboard.target ? keyboard.target : world.keyTarget;
  if (!t || !t.key || (!world.xrActive && !previewing)) return;
  if (e.key.length === 1 || ['Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
    e.preventDefault();
    t.key(e.key);
  }
});

// ------------------------------------------------------------------ arrive / leave

async function arrive() {
  env.setMode(world.xrActive && !world.arSupported ? 'void' : settings.mode);
  sound.boot();
  sound.ambient(settings.ambient);
  await world.waitFrames(4); // let the headset report where you are
  panels.anchorTo(world.camera);
  launcher.start();
  charms.start();
  if (!settings.toured) world.startTour();
  else {
    defaultWindows();
    world.coreSay('Welcome back.');
  }
  clearInterval(world.statsTimer);
  const poll = () => api('/api/space/stats').then((s) => (world.lastStats = s)).catch(() => {});
  poll();
  world.statsTimer = setInterval(poll, 6000);
}

function leave() {
  panels.closeAll();
  launcher.stop();
  charms.stop();
  keyboard.hide();
  cameraBox.close();
  watch.hide();
  quick.close();
  sound.ambient(false);
  clearInterval(world.statsTimer);
  world.keyTarget = null;
  env.setMode('void'); // the garden is the gate's backdrop
  showGate();
}

/** What this browser can do: 'ar' (passthrough), 'vr', or null (desktop → preview only). */
async function detectXR() {
  if (!navigator.xr) return null;
  if (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) return 'ar';
  if (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) return 'vr';
  return null;
}
const xrKind = detectXR().then((k) => {
  world.arSupported = k === 'ar';
  return k;
});

async function enterXR() {
  // requestSession first, while the click still counts as a user gesture
  const kind = await xrKind;
  if (!kind) throw new Error('This browser has no WebXR. Open the space on the headset.');
  renderer.xr.setFramebufferScaleFactor(settings.sharp === 'high' ? 1.25 : 1);
  const session = await navigator.xr.requestSession(kind === 'ar' ? 'immersive-ar' : 'immersive-vr', {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'plane-detection', 'depth-sensing'],
    // depth is only read while scanning (Scan in the launcher)
    depthSensing: { usagePreference: ['gpu-optimized', 'cpu-optimized'], dataFormatPreference: ['float32', 'luminance-alpha'] },
  });
  sound.init();
  await renderer.xr.setSession(session);
  // three.js would hide anything behind real surfaces with the depth map; windows should never
  // vanish behind a wall or your hand, so that stays off. Depth sleeps until the scanner wakes it.
  renderer.xr.hasDepthSensing = () => false;
  renderer.xr.getDepthSensingMesh = () => null; // (three r170 draws this occluder whenever depth exists)
  if (session.depthUsage && session.pauseDepthSensing) {
    try {
      session.pauseDepthSensing();
    } catch {}
  }
  world.session = session;
  world.xrActive = true;
  session.addEventListener('end', () => {
    world.xrActive = false;
    world.session = null;
    leave();
  });
  world.applyFrameRate();
  hideGate();
  arrive();
}

let previewing = false;
let mouseReady = false;
async function startPreview() {
  await sound.init();
  previewing = true;
  world.arSupported = false;
  yaw = 0;
  pitch = -0.2;
  deskCam.rotation.set(pitch, yaw, 0, 'YXZ');
  if (!mouseReady) {
    input.setupMouse(renderer.domElement, deskCam);
    mouseReady = true;
  }
  input.mouse.active = true;
  hideGate();
  document.body.classList.add('previewing');
  arrive();
}

function stopPreview() {
  previewing = false;
  if (input.mouse) input.mouse.active = false;
  document.body.classList.remove('previewing');
  leave();
}

// ------------------------------------------------------------------ gate (the 2D landing page)

function hideGate() {
  document.body.classList.add('inside');
}
function showGate() {
  document.body.classList.remove('inside');
}

input.setupXR(renderer, scene);
hands.setupXR(renderer, scene);
window.addEventListener('keydown', (e) => {
  if (previewing && e.key === 'Escape') stopPreview();
});
env.setMode('void');
pitch = 0.12;
world.lookBy(0, 0);
window.UTSUSHI = { world, enterXR, startPreview, stopPreview, xrKind, showcase: (on) => charms.showcase(on) };

// ------------------------------------------------------------------ planes (tables from Space Setup)

let planeTick = 0;
function readPlanes() {
  const frame = renderer.xr.getFrame && renderer.xr.getFrame();
  if (!frame || !frame.detectedPlanes) return;
  const ref = renderer.xr.getReferenceSpace();
  const out = [];
  const all = []; // every surface, in world space (the room miniature draws them)
  const m = new THREE.Matrix4();
  frame.detectedPlanes.forEach((pl) => {
    const pose = frame.getPose(pl.planeSpace, ref);
    if (!pose) return;
    m.fromArray(pose.transform.matrix);
    all.push({ label: pl.semanticLabel || '', orientation: pl.orientation, pts: (pl.polygon || []).map((v) => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(m)) });
    if (pl.orientation && pl.orientation !== 'horizontal') return;
    const p = pose.transform.position;
    let r = 0.3;
    for (const v of pl.polygon || []) r = Math.max(r, Math.hypot(v.x, v.z));
    const label = pl.semanticLabel || '';
    if (p.y > 0.35 && p.y < 1.3 && (!label || label === 'table' || label === 'desk')) out.push({ y: p.y, cx: p.x, cz: p.z, r, label });
  });
  world.planes = out;
  world.roomPlanes = all;
}

// ------------------------------------------------------------------ loop

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (!world.xrActive && !previewing) world.lookBy(-dt * 0.025, 0); // the gate's slow pan
  if (wantRate && world.session) {
    world.session.updateTargetFrameRate(wantRate).then(() => apps.set.invalidate(), () => {});
    wantRate = null;
  }
  if (world.xrActive && ++planeTick % 45 === 0) readPlanes();
  env.update(t, dt);
  if (world.xrActive) hands.update(t);
  input.update();
  panels.update(t, dt);
  launcher.update(t, dt);
  keyboard.update(t, dt);
  cameraBox.update(t, dt);
  watch.update(t, dt);
  quick.update(t, dt);
  if (apps.models._stage) apps.models._stage.update(t, dt);
  scanner.update(t, dt);
  charms.update(t, dt);
  fx.update(t, dt);
  sound.listen(world.camera);
  for (let i = frameWaiters.length - 1; i >= 0; i--) if (--frameWaiters[i].n <= 0) frameWaiters.splice(i, 1)[0].r();
  renderer.render(scene, deskCam);
});

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  deskCam.aspect = window.innerWidth / window.innerHeight;
  deskCam.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

export { world };
