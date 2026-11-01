'use strict';
// UTSUSHI device link: talks to an ESP32 / M5Stack Cardputer / any USB-serial board plugged into
// this PC, so the headset can control it. Windows-only (a small PowerShell + .NET helper does the I/O).
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const HELPER = path.join(__dirname, 'serial.ps1');

// USB vendor ids of the chips found on ESP32 boards.
const KNOWN = {
  '303A': 'Espressif (ESP32-S3 / C3 native USB: Cardputer, StampS3…)',
  '10C4': 'CP210x USB-serial (classic ESP32 dev boards)',
  '1A86': 'CH340 / CH9102 USB-serial (ESP32 / ESP8266 boards)',
  '0403': 'FTDI USB-serial',
  '2341': 'Arduino',
};

class SerialLink extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.ready = null;
    this.buf = '';
    this.state = { open: false, port: null, baud: 115200, error: null };
    this.lines = []; // recent console lines: { t, dir: 'in'|'out'|'sys', text }
    this.partial = '';
    this.clients = new Set();
    this.waitPorts = [];
  }

  supported() {
    return process.platform === 'win32';
  }

  start() {
    if (this.proc) return this.ready;
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], { windowsHide: true });
    this.proc = proc;
    this.ready = new Promise((resolve) => (this._ready = resolve));
    proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.onHelper(line);
      }
    });
    proc.stderr.on('data', (d) => console.warn('[serial]', d.toString().trim()));
    proc.stdin.on('error', () => {});
    proc.on('exit', () => {
      this.proc = null;
      this.state.open = false;
      this.waitPorts.splice(0).forEach((w) => w([]));
      this.broadcast({ kind: 'state', state: this.state });
    });
    return this.ready;
  }

  onHelper(line) {
    if (line === 'ready') return this._ready();
    const sp = line.indexOf(' ');
    const cmd = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1);
    if (cmd === 'ports') {
      let ports = [];
      try {
        ports = JSON.parse(rest) || [];
      } catch {}
      ports = ports.map((p) => ({ ...p, chip: KNOWN[p.vid] || (/bluetooth/i.test(p.name) ? 'Bluetooth serial link' : ''), likelyBoard: !!KNOWN[p.vid] }));
      this.waitPorts.splice(0).forEach((w) => w(ports));
    } else if (cmd === 'opened') {
      this.state = { ...this.state, open: true, port: rest, error: null };
      this.log('sys', `connected to ${rest} @ ${this.state.baud}`);
      this.broadcast({ kind: 'state', state: this.state });
    } else if (cmd === 'closed') {
      this.state = { ...this.state, open: false };
      this.log('sys', 'disconnected');
      this.broadcast({ kind: 'state', state: this.state });
    } else if (cmd === 'error') {
      this.state = { ...this.state, error: rest };
      this.log('sys', `error: ${rest}`);
      this.broadcast({ kind: 'state', state: this.state });
    } else if (cmd === 'data') {
      const text = Buffer.from(rest, 'base64').toString('utf8');
      this.partial += text;
      let i;
      while ((i = this.partial.search(/\r?\n/)) >= 0) {
        const one = this.partial.slice(0, i);
        this.partial = this.partial.slice(i + (this.partial[i] === '\r' ? 2 : 1));
        this.log('in', one);
      }
      if (this.partial.length > 2000) {
        this.log('in', this.partial);
        this.partial = '';
      }
    }
  }

  log(dir, text) {
    const entry = { t: Date.now(), dir, text };
    this.lines.push(entry);
    if (this.lines.length > 400) this.lines.shift();
    this.broadcast({ kind: 'line', line: entry });
  }

  broadcast(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of this.clients) c.write(data);
  }

  async ports() {
    if (!this.supported()) return [];
    await this.start();
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve([]), 8000);
      this.waitPorts.push((p) => {
        clearTimeout(t);
        resolve(p);
      });
      this.proc.stdin.write('list\n');
    });
  }

  async open(port, baud) {
    if (!/^COM\d{1,3}$/i.test(port)) throw Object.assign(new Error('Pick a COM port'), { status: 400 });
    baud = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].includes(Number(baud)) ? Number(baud) : 115200;
    await this.start();
    this.state = { ...this.state, baud, error: null };
    this.proc.stdin.write(`open ${port.toUpperCase()} ${baud}\n`);
  }

  async send(text, { newline = true } = {}) {
    if (!this.state.open) throw Object.assign(new Error('No board connected'), { status: 409 });
    const s = String(text).slice(0, 2000) + (newline ? '\n' : '');
    this.proc.stdin.write(`write ${Buffer.from(s, 'utf8').toString('base64')}\n`);
    this.log('out', String(text));
  }

  close() {
    if (this.proc) this.proc.stdin.write('close\n');
  }

  stream(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ kind: 'hello', state: this.state, lines: this.lines.slice(-120) })}\n\n`);
    this.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

module.exports = { SerialLink };
