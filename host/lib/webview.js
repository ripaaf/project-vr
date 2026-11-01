'use strict';
// The space's web browser: a headless Edge (or Chrome) on this PC, driven over the DevTools
// protocol. Its page is streamed to the headset as JPEG frames; taps, scrolls and typing come back.
// Sites keep their logins in the browser's own profile folder (next to the settings). The browser
// starts when the Web window opens and quits a minute after the last viewer leaves.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const VIEW = { w: 1280, h: 720 };
const IDLE_MS = 60000;
const HOME = 'https://www.youtube.com/';

function findBrowser() {
  const L = process.env.LOCALAPPDATA || '';
  const list = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    L && path.join(L, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  return list.find((p) => fs.existsSync(p)) || null;
}

/** The browser's version, from the numbered folder next to its exe (for a normal user agent). */
function versionOf(exe) {
  try {
    return fs.readdirSync(path.dirname(exe)).find((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d)) || '130.0.0.0';
  } catch {
    return '130.0.0.0';
  }
}

/** Just enough of a WebSocket client (RFC 6455) to talk to DevTools on 127.0.0.1. */
class MiniWS extends EventEmitter {
  constructor(url) {
    super();
    const u = new URL(url);
    this.sock = net.connect(Number(u.port), u.hostname);
    this.buf = Buffer.alloc(0);
    this.open = false;
    this.parts = [];
    const key = crypto.randomBytes(16).toString('base64');
    this.sock.on('connect', () => {
      this.sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    this.sock.on('data', (d) => this.onData(d));
    this.sock.on('error', (e) => this.emit('error', e));
    this.sock.on('close', () => {
      this.open = false;
      this.emit('close');
    });
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (!this.open) {
      const end = this.buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = this.buf.slice(0, end).toString();
      this.buf = this.buf.slice(end + 4);
      if (!/^HTTP\/1\.1 101/.test(head)) return this.emit('error', new Error('DevTools refused the connection'));
      this.open = true;
      this.emit('open');
    }
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      const op = b0 & 0x0f;
      if (op === 0x1 || op === 0x0) {
        this.parts.push(payload);
        if (b0 & 0x80) {
          const msg = Buffer.concat(this.parts).toString();
          this.parts = [];
          this.emit('message', msg);
        }
      } else if (op === 0x8) this.sock.end();
      else if (op === 0x9) this.frame(0xa, payload);
    }
  }

  frame(op, payload) {
    const mask = crypto.randomBytes(4);
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 0xff]) : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 127]), (() => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64BE(BigInt(n));
      return b;
    })()]);
    const body = Buffer.alloc(n);
    for (let i = 0; i < n; i++) body[i] = payload[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([head, mask, body]));
  }

  send(str) {
    if (this.open) this.frame(0x1, Buffer.from(str));
  }

  close() {
    try {
      this.sock.destroy();
    } catch {}
  }
}

function readPort(file) {
  try {
    return Number(fs.readFileSync(file, 'utf8').split('\n')[0]) || null;
  } catch {
    return null;
  }
}

async function alive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function closeBrowser(port) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).json();
  await new Promise((resolve) => {
    const ws = new MiniWS(v.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 500);
    });
    ws.on('error', resolve);
  });
}

class WebView {
  constructor({ dataDir }) {
    this.profile = path.join(dataDir, 'web-profile');
    this.exe = findBrowser();
    this.proc = null;
    this.ws = null;
    this.starting = null;
    this.id = 0;
    this.pending = new Map();
    this.clients = new Set();
    this.frame = null; // newest JPEG
    this.state = { url: '', title: '', loading: false, back: false, fwd: false, running: false };
    this.idleTimer = null;
  }

  get supported() {
    return !!this.exe;
  }

  // ------------------------------------------------------------------ browser life

  async ensure() {
    if (this.ws && this.ws.open) return;
    if (!this.starting) this.starting = this.launch().finally(() => (this.starting = null));
    return this.starting;
  }

  async launch() {
    if (!this.exe) throw Object.assign(new Error('No Edge or Chrome on this PC'), { status: 501 });
    fs.mkdirSync(this.profile, { recursive: true });
    const portFile = path.join(this.profile, 'DevToolsActivePort');
    // one that is still closing must be gone first (it would hand the profile back and quit)
    if (this.closing) await this.closing;
    // a browser still running from before (the host restarted): carry on with it
    const prev = readPort(portFile);
    if (prev && (await alive(prev))) return this.attach(prev);
    try {
      fs.unlinkSync(portFile);
    } catch {}
    const v = versionOf(this.exe);
    const edge = /msedge/i.test(this.exe);
    const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v.split('.')[0]}.0.0.0 Safari/537.36${edge ? ` Edg/${v}` : ''}`;
    this.proc = spawn(
      this.exe,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        '--remote-allow-origins=*',
        `--user-data-dir=${this.profile}`,
        `--window-size=${VIEW.w},${VIEW.h}`,
        `--user-agent=${ua}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=Translate,msEdgeSidebarV2,msHubApps',
        'about:blank',
      ],
      { windowsHide: true, stdio: 'ignore' }
    );
    const proc = this.proc;
    proc.on('exit', () => {
      if (this.proc !== proc) return; // an older browser ending after stop(): not ours any more
      this.proc = null;
      if (this.ws) this.ws.close();
      this.ws = null;
      this.setState({ running: false });
    });
    // the browser writes the port it chose
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) {
      await new Promise((r) => setTimeout(r, 100));
      port = readPort(portFile) || 0;
    }
    if (!port) {
      this.stop();
      throw new Error('The browser did not start');
    }
    return this.attach(port);
  }

  async attach(port) {
    this.port = port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    let page = targets.find((t) => t.type === 'page');
    if (!page) page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    await this.connect(page.webSocketDebuggerUrl);
    await this.send('Page.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: false });
    // the page lays out at 1280 × 720; the picture travels at 1024 × 576 (sharp enough, and cheap to upload on the headset)
    await this.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 1024, maxHeight: 576, everyNthFrame: 1 });
    this.setState({ running: true });
    if (!page.url || page.url === 'about:blank') await this.navigate(HOME);
    else this.refreshState(false);
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new MiniWS(url);
      ws.on('open', () => {
        this.ws = ws;
        resolve();
      });
      ws.on('error', reject);
      ws.on('close', () => {
        if (this.ws === ws) this.ws = null;
      });
      ws.on('message', (m) => this.onMessage(m));
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('The browser is not running'));
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 15000);
    });
  }

  onMessage(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      return m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
    if (m.method === 'Page.screencastFrame') {
      this.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
      this.frame = Buffer.from(m.params.data, 'base64');
      this.broadcast(1, this.frame);
    } else if (m.method === 'Page.frameStartedLoading') this.setState({ loading: true });
    else if (m.method === 'Page.frameStoppedLoading' || m.method === 'Page.loadEventFired' || m.method === 'Page.navigatedWithinDocument' || m.method === 'Page.frameNavigated') this.refreshState(m.method === 'Page.frameStoppedLoading' || m.method === 'Page.loadEventFired' ? false : undefined);
  }

  async checkTyping() {
    try {
      const r = await this.send('Runtime.evaluate', { expression: "(() => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|range|color|file|image|reset)$/i.test(a.type))); })()", returnByValue: true });
      this.setState({ typing: !!(r && r.result && r.result.value), focusAt: Date.now() });
    } catch {}
  }

  async refreshState(loading) {
    try {
      const h = await this.send('Page.getNavigationHistory');
      const e = h.entries[h.currentIndex] || {};
      this.setState({ url: e.url || '', title: e.title || '', back: h.currentIndex > 0, fwd: h.currentIndex < h.entries.length - 1, ...(loading === undefined ? {} : { loading }) });
    } catch {}
  }

  setState(s) {
    Object.assign(this.state, s);
    this.broadcast(2, Buffer.from(JSON.stringify(this.state)));
  }

  /** Quit the browser: politely over DevTools (it saves its profile), then by force. */
  stop() {
    clearTimeout(this.idleTimer);
    if (this.ws) this.ws.close();
    this.ws = null;
    const port = this.port;
    const proc = this.proc;
    this.port = 0;
    this.proc = null;
    this.frame = null;
    this.state.running = false;
    if (port)
      this.closing = closeBrowser(port)
        .catch(() => {})
        .then(async () => {
          for (let i = 0; i < 30 && (await alive(port)); i++) await new Promise((r) => setTimeout(r, 100));
        })
        .finally(() => (this.closing = null));
    if (proc)
      setTimeout(() => {
        try {
          proc.kill();
        } catch {}
      }, 3000);
  }

  /** On the way out (no time for DevTools): end the browser we started. */
  killNow() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
    }
  }

  // ------------------------------------------------------------------ viewers

  /** Chunked stream: [type 1 byte][length 4 bytes][payload] — type 1 = JPEG frame, 2 = state JSON. */
  async stream(req, res) {
    try {
      await this.ensure();
    } catch (e) {
      res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
    clearTimeout(this.idleTimer);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const c = { res, busy: false };
    this.clients.add(c);
    this.write(c, 2, Buffer.from(JSON.stringify(this.state)));
    if (this.frame) this.write(c, 1, this.frame);
    req.on('close', () => {
      this.clients.delete(c);
      if (!this.clients.size) this.idleTimer = setTimeout(() => this.stop(), IDLE_MS);
    });
  }

  write(c, type, payload) {
    if (c.busy && type === 1) return; // a slow viewer skips frames rather than falling behind
    const head = Buffer.alloc(5);
    head[0] = type;
    head.writeUInt32BE(payload.length, 1);
    const ok = c.res.write(Buffer.concat([head, payload]));
    if (!ok) {
      c.busy = true;
      c.res.once('drain', () => (c.busy = false));
    }
  }

  broadcast(type, payload) {
    for (const c of this.clients) this.write(c, type, payload);
  }

  // ------------------------------------------------------------------ input

  async navigate(input) {
    let url = String(input || '').trim();
    if (!url) return;
    if (/^(file|chrome|edge|about|javascript|data|view-source):/i.test(url) && url !== 'about:blank') throw Object.assign(new Error('That address is not allowed here'), { status: 400 });
    if (!/^https?:\/\//i.test(url)) url = /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(url) ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    this.setState({ loading: true, url });
    await this.send('Page.navigate', { url });
  }

  /** Input from the headset. Answered at once: events go out without waiting for each one (DevTools
   *  keeps them in order), so a tap that starts a page load never holds up the next. */
  input(events) {
    if (!this.ws) return;
    this.inq = (this.inq || Promise.resolve()).then(() => this.apply(events)).catch(() => {});
  }

  async apply(events) {
    const fire = (method, params) => this.send(method, params).catch(() => {});
    const X = (e) => Math.round(Math.min(1, Math.max(0, Number(e.x) || 0)) * VIEW.w);
    const Y = (e) => Math.round(Math.min(1, Math.max(0, Number(e.y) || 0)) * VIEW.h);
    const mouse = (type, e, extra = {}) => fire('Input.dispatchMouseEvent', { type, x: X(e), y: Y(e), button: 'left', buttons: type === 'mouseReleased' ? 0 : extra.buttons ?? 0, clickCount: extra.clickCount ?? 0, ...extra });
    for (const e of (Array.isArray(events) ? events : []).slice(0, 100)) {
      switch (e.t) {
        case 'move':
          mouse('mouseMoved', e, { buttons: e.held ? 1 : 0, button: e.held ? 'left' : 'none' });
          break;
        case 'down':
          mouse('mouseMoved', e);
          mouse('mousePressed', e, { buttons: 1, clickCount: 1 });
          break;
        case 'up':
          mouse('mouseReleased', e, { clickCount: 1 });
          // did that tap land in a text field? (the headset then brings up its keyboard)
          setTimeout(() => this.checkTyping(), 120);
          break;
        case 'wheel':
          fire('Input.dispatchMouseEvent', { type: 'mouseWheel', x: X(e), y: Y(e), deltaX: 0, deltaY: Math.max(-2000, Math.min(2000, Number(e.dy) || 0)) });
          break;
        case 'text':
          fire('Input.insertText', { text: String(e.s || '').slice(0, 500) });
          break;
        case 'key': {
          const K = { Enter: [13, '\r'], Backspace: [8], Tab: [9], Escape: [27], ArrowLeft: [37], ArrowUp: [38], ArrowRight: [39], ArrowDown: [40], ' ': [32, ' '] }[e.k];
          if (!K) break;
          const base = { key: e.k, code: e.k === ' ' ? 'Space' : e.k, windowsVirtualKeyCode: K[0], nativeVirtualKeyCode: K[0] };
          fire('Input.dispatchKeyEvent', { type: K[1] ? 'keyDown' : 'rawKeyDown', ...base, ...(K[1] ? { text: K[1] } : {}) });
          fire('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
          break;
        }
        case 'nav':
          await this.navigate(e.url).catch(() => {});
          break;
        case 'back':
        case 'forward': {
          const h = await this.send('Page.getNavigationHistory');
          const i = h.currentIndex + (e.t === 'back' ? -1 : 1);
          if (h.entries[i]) await this.send('Page.navigateToHistoryEntry', { entryId: h.entries[i].id });
          break;
        }
        case 'reload':
          fire('Page.reload');
          break;
        default:
      }
    }
  }
}

module.exports = { WebView, VIEW };
