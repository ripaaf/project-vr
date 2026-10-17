'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const config = require('./lib/config');
const { findAdb, findFfmpeg } = require('./lib/tools');
const { Adb, DeviceManager } = require('./lib/adb');
const { Capture } = require('./lib/capture');
const { MjpegHub } = require('./lib/mjpeg');
const { Control } = require('./lib/control');
const { PcScreens } = require('./lib/pcscreen');
const { PcAudio } = require('./lib/pcaudio');
const autostart = require('./lib/autostart');
const { spawn } = require('child_process');

const VERSION = '1.0.0';
const AGENT_PORT = 8766;
const APP_ID = 'com.questmirror.app';
const A11Y_SERVICE = `${APP_ID}/${APP_ID}.ControlService`;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Changes whenever the dashboard files change, so open tabs know to reload after an update.
const UI_BUILD = (() => {
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(PUBLIC_DIR).sort()) {
    try {
      h.update(f + fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs);
    } catch {}
  }
  return h.digest('hex').slice(0, 10);
})();
const APK_PATH = process.env.QM_APK || path.join(__dirname, '..', 'quest-app', 'build', 'quest-mirror.apk');
// Set when the Windows app (QuestMirror.exe) runs this host: it opens and raises the app window.
const APP_EXE = process.env.QM_APP_EXE || '';
const LINGER_MS = 15000; // keep capturing briefly after the last viewer leaves so reloads are instant

config.load();
const PORT = Number(process.env.PORT) || config.get().port;

const adbBin = findAdb();
const ffmpegBin = findFfmpeg();
if (!adbBin) {
  console.error('\n  adb not found. Install Android platform-tools and add it to PATH (or set ADB=C:\\path\\to\\adb.exe).\n');
  process.exit(1);
}
if (!ffmpegBin) {
  console.error('\n  ffmpeg not found. Install ffmpeg and add it to PATH (or set FFMPEG=C:\\path\\to\\ffmpeg.exe).\n');
  process.exit(1);
}

const adb = new Adb(adbBin);
const devices = new DeviceManager(adb, config, { hostPort: PORT, agentPort: AGENT_PORT });
const capture = new Capture({ adbBin, ffmpegBin });
const hub = new MjpegHub(() => config.get().maxFps);
const control = new Control(devices, AGENT_PORT);
const pc = new PcScreens({ ffmpegBin, config });
const pcAudio = new PcAudio();

capture.on('frame', (f) => hub.push(f));
capture.on('state', (s, m) => console.log(`[capture] ${s}${m ? ': ' + m : ''}`));

// ---------------------------------------------------------------- capture demand
let lastDemand = 0;
function syncCapture() {
  const s = config.get();
  if (hub.viewerCount > 0) lastDemand = Date.now();
  const want = devices.current && !s.paused && Date.now() - lastDemand < LINGER_MS;
  if (want) {
    const wireless = devices.current.transport === 'wifi';
    capture.ensure(devices.current.serial, s, devices.info.display || { w: 4128, h: 2208 }, { wireless });
  }
  else capture.stop();
}
setInterval(syncCapture, 1000);

devices.on('change', (cur) => {
  syncCapture();
  if (cur && config.get().keepAwake) control.setKeepAwake(true).catch(() => {});
  control.pingAgent();
});

// ---------------------------------------------------------------- helpers
function lanUrls() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue;
      const virtual = /vmware|virtualbox|vethernet|hyper-v|docker|wsl|tailscale|zerotier|openvpn|tap|tun|bluetooth|loopback/i.test(name);
      const wifi = /wi-?fi|wlan|wireless/i.test(name);
      out.push({ name, url: `http://${a.address}:${PORT}`, virtual, wifi });
    }
  }
  out.sort((a, b) => a.virtual - b.virtual || b.wifi - a.wifi);
  return out;
}

const SECRET = crypto.randomBytes(16).toString('hex');
const pinToken = (pin) => crypto.createHmac('sha256', SECRET).update(pin).digest('hex').slice(0, 32);

function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2)
  );
}
/** The paired Quest app proves itself with the PC token (query `token` or header `x-qm-token`). */
function hasPcToken(req) {
  const url = new URL(req.url, 'http://x');
  const ok = pc.checkToken(req.headers['x-qm-token'] || url.searchParams.get('token') || '');
  if (ok) markAppSeen();
  return ok;
}
// When the Quest app last talked to us with its token (drives the "Link the Quest app" step).
let appSeenAt = 0;
function markAppSeen() {
  appSeenAt = Date.now();
  if (!config.get().pcLinkedAt) config.update({ pcLinkedAt: appSeenAt });
}
/** The PC itself, or the paired Quest app: may change any setting. */
const isOwner = (req) => isLocal(req) || hasPcToken(req);
function authed(req) {
  const pin = config.get().pin;
  return !pin || isOwner(req) || cookies(req).qm_auth === pinToken(pin);
}
const canControl = (req) => isOwner(req) || config.get().allowControl;

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}
function fail(res, code, message) {
  json(res, code, { error: message });
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString();
      if (!s) return resolve({});
      try {
        resolve(JSON.parse(s));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function status(req) {
  const local = isLocal(req);
  const owner = isOwner(req);
  return {
    version: VERSION,
    build: UI_BUILD,
    hostName: os.hostname(),
    device: { ...devices.status(), installing: !!installing },
    capture: { ...capture.status(), worn: worn.value, viewers: hub.viewerCount, paused: config.get().paused },
    settings: owner ? { ...config.publicView(), pin: config.get().pin } : config.publicView(),
    agent: control.agent,
    urls: lanUrls(),
    you: { local, owner, canControl: canControl(req), authed: authed(req) },
    pc: {
      ...pc.status(),
      audio: pcAudio.status(),
      enabled: config.get().pcShare,
      pairCode: local ? pc.pairCode : undefined,
      requests: local ? pc.pendingRequests() : undefined,
      appLinked: !!config.get().pcLinkedAt,
      appOnline: Date.now() - appSeenAt < 8000,
      scanning: local && Date.now() - scanHint.at < 25000 ? scanHint.device : null,
    },
    autostart: local ? { supported: autostart.supported(), enabled: autostart.isEnabled() } : undefined,
    apkAvailable: local ? fs.existsSync(APK_PATH) : undefined,
  };
}

// A black picture has two causes: nobody wears the headset (it stops drawing), or Horizon OS hides
// the recording while a private panel shows. Ask the headset which, only while the picture is black.
const worn = { at: 0, value: null };
setInterval(() => {
  if (!capture.status().dark) return void (worn.value = null);
  if (!devices.current || Date.now() - worn.at < 5000) return;
  worn.at = Date.now();
  devices
    .shell("dumpsys vrpowermanager | grep -E 'State:|idle state:'", { timeout: 4000 })
    .then((out) => (worn.value = /HEADSET_MOUNTED/.test(out) && /idle state: Not idle/i.test(out)))
    .catch(() => {});
}, 1000);

// Put the Quest app on the headset by itself as soon as one is plugged in and allowed, and
// reinstall it whenever the bundled APK changes (an update) — no "Install" click needed.
let installing = null;
const installTried = new Map(); // serial|apk fingerprint -> last attempt
function apkFingerprint() {
  try {
    const st = fs.statSync(APK_PATH);
    return `${st.size}-${Math.round(st.mtimeMs)}`;
  } catch {
    return null;
  }
}
async function autoInstall() {
  const d = devices.current;
  if (!d || installing || !config.get().autoInstallApp || devices.info.appInstalled === undefined) return;
  const fp = apkFingerprint();
  if (!fp) return;
  const done = (config.get().apkInstalled || {})[d.serial];
  if (devices.info.appInstalled && done === fp) return;
  const key = `${d.serial}|${fp}`;
  if (Date.now() - (installTried.get(key) || 0) < 5 * 60000) return; // a failure retries in a while, not in a loop
  installTried.set(key, Date.now());
  installing = d.serial;
  console.log(`[setup] ${devices.info.appInstalled ? 'updating' : 'installing'} the Quest app on ${d.serial}…`);
  try {
    const out = await adb.run(['-s', d.serial, 'install', '-r', '-g', APK_PATH], { timeout: 120000 });
    if (/Success/.test(out)) {
      config.update({ apkInstalled: { ...(config.get().apkInstalled || {}), [d.serial]: fp } });
      console.log('[setup] Quest app ready on the headset');
      await devices.refreshInfo().catch(() => {});
    } else console.warn('[setup] install said:', out.trim().split(/\r?\n/).pop());
  } catch (e) {
    console.warn('[setup] install failed:', e.message);
  } finally {
    installing = null;
  }
}
setInterval(() => autoInstall().catch(() => {}), 4000);

// Dashboards on this PC that someone can actually see (a tab in the background or a minimised
// browser doesn't count); when there is none, a pairing request or a scanning Quest pops one up.
let visibleDashboards = 0;
let localDashboards = 0;
let scanHint = { at: 0, device: '' };
let lastHintPop = 0;
function popDashboard(hash) {
  if (visibleDashboards > 0 || process.platform !== 'win32') return false;
  if (APP_EXE) {
    // The Windows app brings its own window forward (or opens it).
    spawn(APP_EXE, ['--show', hash], { windowsHide: true, stdio: 'ignore', detached: true }).unref();
    return true;
  }
  // Windows keeps a browser opened by a background app behind the current window; raise it.
  const raise = (tries) =>
    setTimeout(async () => {
      if (!(await pc.bringToFront('Quest Mirror')) && tries > 1) raise(tries - 1);
    }, 1200);
  const open = () => {
    spawn('cmd.exe', ['/c', 'start', '""', `http://localhost:${PORT}/${hash}`], { windowsHide: true, stdio: 'ignore', detached: true }).unref();
    raise(3);
  };
  // A dashboard that's only behind other windows comes forward instead of piling up another tab.
  if (localDashboards > 0) pc.bringToFront('Quest Mirror').then((ok) => ok || open());
  else open();
  return true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return fail(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/** http://PC:8765/link?c=CODE -> opens the Quest Mirror app (intent link) to pair with that code. */
function serveLinkPage(req, res, url) {
  const code = (url.searchParams.get('c') || '').replace(/\D/g, '').slice(0, 6);
  const hostHeader = (req.headers.host || `localhost:${PORT}`).replace(/[^\w.:-]/g, '');
  const name = os.hostname().replace(/[^\w.-]/g, '');
  const deep = `pair?h=${encodeURIComponent(hostHeader)}&c=${code}&n=${encodeURIComponent(name)}`;
  const intent = `intent://${deep}#Intent;scheme=questmirror;package=com.questmirror.app;end`;
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link Quest Mirror</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#e7e6e1;color:#0f1012;font:500 18px/1.4 "Bahnschrift","Arial Narrow",system-ui,sans-serif;
background-image:radial-gradient(rgba(15,16,18,.2) 1px,transparent 1.2px);background-size:24px 24px}
.c{width:min(520px,92vw);background:#f3f2ed;border:2px solid #0f1012;padding:28px;clip-path:polygon(22px 0,100% 0,100% calc(100% - 22px),calc(100% - 22px) 100%,0 100%,0 22px)}
.m{font:700 13px/1 Consolas,monospace;letter-spacing:.12em;color:#ff3b1f}h1{margin:8px 0 10px;font-size:34px;text-transform:uppercase;letter-spacing:.03em}
a{display:block;margin-top:20px;padding:20px;text-align:center;background:#0f1012;color:#f3f2ed;font:700 18px Consolas,monospace;letter-spacing:.1em;text-decoration:none}
a:active{background:#ff3b1f}p{color:#45474d;margin:0}</style></head><body><div class="c">
<div class="m">■ LINK // ${name.toUpperCase()}</div><h1>Link your Quest</h1>
<p>Opening Quest Mirror on the headset… If nothing happens, press the button.</p>
<a href="${intent}">OPEN QUEST MIRROR →</a></div>
<script>setTimeout(function(){location.href=${JSON.stringify(intent)}},400)</script></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}

const iconCache = new Map();

// Settings any controlling viewer may change vs. ones only the PC / Quest app may change.
const VIEW_KEYS = ['quality', 'view', 'zoom', 'offsetX', 'offsetY', 'lensFix', 'maxFps', 'paused'];
const OWNER_KEYS = ['allowControl', 'keepAwake', 'pin', 'preferWireless', 'pcShare', 'autoWireless', 'theme'];

// ---------------------------------------------------------------- routes
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const method = req.method;

  if (method === 'POST' && p === '/api/login') {
    const { pin } = await readBody(req);
    if (!config.get().pin || String(pin) === config.get().pin) {
      res.setHeader('Set-Cookie', `qm_auth=${pinToken(config.get().pin || '')}; Path=/; SameSite=Lax; Max-Age=31536000`);
      return json(res, 200, { ok: true });
    }
    return fail(res, 401, 'Wrong PIN');
  }

  // ---- PC -> Quest (the headset app pairs once, then uses the PC token)
  if (p === '/api/pc/pair' && method === 'POST') {
    const { code } = await readBody(req);
    return json(res, 200, { token: pc.pair(code), hostName: os.hostname() });
  }
  if (p === '/api/pc/pair-request') {
    if (method === 'POST') {
      const { device } = await readBody(req);
      const r = pc.requestPair(device, req.socket.remoteAddress);
      popDashboard('#pair');
      return json(res, 200, { ...r, hostName: os.hostname() });
    }
    return json(res, 200, { ...pc.pollPair(url.searchParams.get('id')), hostName: os.hostname() });
  }
  // The Quest app is looking through its camera: show the big link code on this PC's screen.
  if (p === '/api/pc/scan-hint' && method === 'POST') {
    const { device } = await readBody(req);
    scanHint = { at: Date.now(), device: String(device || 'Quest').replace(/[^\w .()-]/g, '').slice(0, 40) || 'Quest' };
    if (!config.get().pcLinkedAt && Date.now() - lastHintPop > 60000 && popDashboard('#link')) lastHintPop = Date.now();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/pc/pair-decide' && method === 'POST') {
    if (!isLocal(req)) return fail(res, 403, 'Approve on the PC itself');
    const { id, allow } = await readBody(req);
    pc.decidePair(id, !!allow);
    return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/pc/')) {
    if (!pc.supported) return fail(res, 501, 'Showing the PC screen needs the host to run on Windows');
    if (p === '/api/pc/token') {
      if (!isLocal(req)) return fail(res, 403, 'Pair with the code shown on the PC');
      markAppSeen();
      return json(res, 200, { token: pc.token(), hostName: os.hostname() });
    }
    if (!isOwner(req)) return fail(res, 401, 'Not paired with this PC');
    // Screen/input/sound are for the linked Quest app only. Always demand the secret — even over
    // the ADB cable tunnel, which arrives as 127.0.0.1 — so an unlink really cuts the headset off.
    if (/^\/api\/pc\/(monitors|stream|input|audio)$/.test(p) && !hasPcToken(req)) return fail(res, 401, 'Not linked with this PC');
    if (method === 'POST' && p === '/api/pc/unlink') {
      pc.revoke();
      pcAudio.dropAll();
      appSeenAt = 0;
      return json(res, 200, { ok: true });
    }
    if (!config.get().pcShare) return fail(res, 403, 'Screen sharing to the Quest is turned off on the PC');
    if (method === 'GET' && p === '/api/pc/monitors') return json(res, 200, { monitors: await pc.monitors(url.searchParams.has('refresh')) });
    if (method === 'GET' && p === '/api/pc/stream') {
      const num = (k, def, lo, hi) => Math.min(hi, Math.max(lo, Number(url.searchParams.get(k)) || def));
      return pc.stream(req, res, url.searchParams.get('id') || '', {
        fps: num('fps', 60, 15, 90),
        kbps: num('kbps', 12000, 1000, 60000),
        maxW: num('maxw', 1920, 960, 3840),
      });
    }
    if (method === 'POST' && p === '/api/pc/input') return pc.inputStream(req, res);
    if (method === 'GET' && p === '/api/pc/audio') return pcAudio.stream(req, res);
    return fail(res, 404, 'Not found');
  }

  // QR link page: the Quest's QR scanner opens this in the Quest Browser, which hands off to the app.
  if (p === '/link') return serveLinkPage(req, res, url);

  // Static files are always reachable (the page itself asks for the PIN).
  if (!p.startsWith('/api/') && p !== '/stream.mjpg' && p !== '/snapshot.jpg') return serveStatic(req, res, p);
  if (!authed(req)) return fail(res, 401, 'PIN required');

  if (p === '/stream.mjpg') {
    hub.attach(req, res);
    syncCapture();
    return;
  }
  if (p === '/snapshot.jpg') {
    if (url.searchParams.get('viewer')) hub.touchPoller(url.searchParams.get('viewer'));
    syncCapture();
    if (!hub.latest) return fail(res, 503, 'No picture yet');
    const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' };
    if (url.searchParams.get('download')) headers['Content-Disposition'] = `attachment; filename="quest-${Date.now()}.jpg"`;
    res.writeHead(200, headers);
    return res.end(hub.latest);
  }

  if (method === 'GET' && p === '/api/status') return json(res, 200, status(req));

  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const push = () => res.write(`data: ${JSON.stringify(status(req))}\n\n`);
    push();
    const t = setInterval(push, 1000);
    const local = isLocal(req);
    const seen = local && url.searchParams.get('v') === '1';
    if (local) localDashboards++;
    if (seen) visibleDashboards++;
    req.on('close', () => {
      clearInterval(t);
      if (local) localDashboards--;
      if (seen) visibleDashboards--;
    });
    return;
  }

  if (method === 'POST' && p === '/api/settings') {
    const body = await readBody(req);
    const allowed = isOwner(req) ? [...VIEW_KEYS, ...OWNER_KEYS] : canControl(req) ? VIEW_KEYS : [];
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(patch).length) return fail(res, 403, 'Not allowed to change these settings');
    const changed = config.update(patch);
    if (changed.includes('keepAwake')) await control.setKeepAwake(config.get().keepAwake).catch(() => {});
    if (changed.includes('paused') && !config.get().paused) lastDemand = Date.now();
    syncCapture();
    return json(res, 200, { ok: true, changed, settings: config.publicView() });
  }

  // ---- everything below sends input to the headset
  if (p.startsWith('/api/control') || p.startsWith('/api/apps') || p.startsWith('/api/panels')) {
    if (!canControl(req)) return fail(res, 403, 'Remote control is turned off on the headset');
    if (!devices.current) return fail(res, 409, 'No Quest connected');
  }

  if (method === 'POST' && p === '/api/control') {
    const b = await readBody(req);
    switch (b.action) {
      case 'key':
        return json(res, 200, { ok: true, ...(await control.key(String(b.key))) });
      case 'text':
        return json(res, 200, { ok: true, ...(await control.text(b.text, b.enter)) });
      case 'launch':
        await control.launch(String(b.pkg));
        return json(res, 200, { ok: true });
      case 'close':
        await control.close(String(b.pkg));
        return json(res, 200, { ok: true });
      case 'url':
        await control.openUrl(b.url);
        return json(res, 200, { ok: true });
      case 'global':
        await control.agentCall('POST', '/global', { action: String(b.name) });
        return json(res, 200, { ok: true });
      default:
        return fail(res, 400, 'Unknown action');
    }
  }

  if (method === 'GET' && p === '/api/apps') return json(res, 200, { apps: await control.apps() });

  if (method === 'GET' && p === '/api/apps/icon') {
    const pkg = url.searchParams.get('pkg') || '';
    if (!iconCache.has(pkg)) {
      const r = await control.agentCall('GET', `/icon?pkg=${encodeURIComponent(pkg)}`, null, { raw: true, timeout: 5000 });
      iconCache.set(pkg, r.body);
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
    return res.end(iconCache.get(pkg));
  }

  if (method === 'GET' && p === '/api/panels') return json(res, 200, await control.agentCall('GET', '/windows'));

  if (method === 'GET' && p === '/api/panels/shot') {
    const id = Number(url.searchParams.get('id'));
    const r = await control.agentCall('GET', `/shot?id=${id}`, null, { raw: true, timeout: 6000 });
    res.writeHead(200, { 'Content-Type': r.type || 'image/jpeg', 'Cache-Control': 'no-store' });
    return res.end(r.body);
  }

  if (method === 'POST' && p === '/api/panels/action') {
    const b = await readBody(req);
    const routes = { tap: '/tap', longpress: '/tap', scroll: '/scroll', text: '/text', focus: '/focus' };
    if (!routes[b.type]) return fail(res, 400, 'Unknown panel action');
    return json(res, 200, await control.agentCall('POST', routes[b.type], { ...b, long: b.type === 'longpress' }));
  }

  // ---- owner-only setup actions (PC dashboard or the Quest app itself)
  if (p.startsWith('/api/setup') || p.startsWith('/api/wireless')) {
    if (!isOwner(req)) return fail(res, 403, 'Only available on the PC or in the Quest app');
  }

  if (method === 'POST' && p === '/api/wireless') {
    const b = await readBody(req);
    if (b.enable) {
      const r = await devices.enableWireless();
      return json(res, 200, { ok: true, ...r });
    }
    await devices.disableWireless();
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && p === '/api/setup/install-app') {
    if (!devices.current) return fail(res, 409, 'No Quest connected');
    if (!fs.existsSync(APK_PATH)) return fail(res, 404, 'APK not built yet. Run quest-app\\build.ps1 first.');
    const out = await adb.run(['-s', devices.current.serial, 'install', '-r', '-g', APK_PATH], { timeout: 120000 });
    await devices.refreshInfo().catch(() => {});
    return json(res, 200, { ok: /Success/.test(out), output: out.trim() });
  }

  if (method === 'POST' && p === '/api/setup/autostart') {
    if (!isLocal(req)) return fail(res, 403, 'Only on the PC');
    const { enable } = await readBody(req);
    return json(res, 200, { ok: true, enabled: await autostart.setEnabled(!!enable) });
  }

  if (method === 'POST' && p === '/api/setup/enable-control') {
    if (!devices.current) return fail(res, 409, 'No Quest connected');
    const cur = (await devices.shell('settings get secure enabled_accessibility_services')).trim();
    const list = cur && cur !== 'null' ? cur.split(':').filter(Boolean) : [];
    if (!list.includes(A11Y_SERVICE)) list.push(A11Y_SERVICE);
    await devices.shell(`settings put secure enabled_accessibility_services ${list.join(':')}; settings put secure accessibility_enabled 1`);
    await devices.refreshInfo().catch(() => {});
    setTimeout(() => control.pingAgent(), 1500);
    return json(res, 200, { ok: true });
  }

  return fail(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) fail(res, e.status && e.status < 600 ? e.status : 500, e.message);
    else res.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  devices.start();
  if (pc.supported) pc.startDiscovery(PORT);
  const urls = lanUrls().filter((u) => !u.virtual);
  console.log(`\n  Quest Mirror host ${VERSION}`);
  console.log(`  adb:    ${adbBin}`);
  console.log(`  ffmpeg: ${ffmpegBin}\n`);
  console.log(`  This PC:        http://localhost:${PORT}`);
  for (const u of urls) console.log(`  Other screens:  ${u.url}   (${u.name})`);
  console.log('\n  Open one of those addresses in any browser (phone, TV, laptop) on the same network.\n');
});
// Video and input streams stay open for as long as a screen is shown in the headset.
server.requestTimeout = 0;
server.headersTimeout = 60000;

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `\n  Port ${PORT} is already in use. Is the host already running?\n` : e);
  process.exit(1);
});

function shutdown() {
  console.log('\n  Stopping...');
  hub.closeAll();
  capture.stop();
  pc.stopAll();
  pcAudio.stop();
  const done = () => process.exit(0);
  if (config.get().keepAwake && devices.current) control.setKeepAwake(false).then(done, done);
  else setTimeout(done, 500);
  setTimeout(done, 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
