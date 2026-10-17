'use strict';
// PC audio -> Quest: one WASAPI loopback capture (winaudio.ps1) fanned out to every listener
// as raw 16-bit stereo PCM. Uncompressed on purpose: ~1.5 Mbit/s is nothing on a LAN and it
// avoids encoder delay.
const { spawn } = require('child_process');
const path = require('path');

const HELPER = path.join(__dirname, 'winaudio.ps1');
const LINGER_MS = 10000; // keep capturing a little after the last listener leaves (instant reopen)
const MAX_BACKLOG_MS = 250; // a listener further behind than this skips ahead instead of lagging

class PcAudio {
  constructor() {
    this.proc = null;
    this.format = null; // { rate, channels }
    this.formatWaiters = [];
    this.clients = new Set();
    this.lingerTimer = null;
    this.lastError = '';
  }

  get supported() {
    return process.platform === 'win32';
  }

  start() {
    if (this.proc) return;
    clearTimeout(this.lingerTimer);
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;
    let errBuf = '';
    proc.stderr.on('data', (d) => {
      errBuf += d.toString();
      let i;
      while ((i = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, i).trim();
        errBuf = errBuf.slice(i + 1);
        const m = /QMAUDIO rate=(\d+) channels=(\d+)/.exec(line);
        if (m) {
          this.format = { rate: Number(m[1]), channels: Number(m[2]) };
          console.log(`[pc-audio] capturing ${line.replace('QMAUDIO ', '')}`);
          this.formatWaiters.splice(0).forEach((w) => w(this.format));
        } else if (line) {
          this.lastError = line;
          console.warn('[pc-audio]', line);
        }
      }
    });
    proc.stdout.on('data', (chunk) => this.fanOut(chunk));
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.format = null;
      // Default output device changed or went away: start again for whoever is still listening.
      if (this.clients.size) setTimeout(() => this.clients.size && this.start(), 1000);
      else this.formatWaiters.splice(0).forEach((w) => w(null));
    });
  }

  stop() {
    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      this.format = null;
      p.kill();
    }
  }

  fanOut(chunk) {
    for (const c of this.clients) {
      const backlog = c.res.writableLength;
      if (backlog > c.maxBacklog) {
        c.dropped += chunk.length;
        continue;
      }
      c.res.write(chunk);
    }
  }

  waitFormat(timeout = 15000) {
    if (this.format) return Promise.resolve(this.format);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`PC audio did not start. ${this.lastError}`.trim())), timeout);
      this.formatWaiters.push((f) => {
        clearTimeout(t);
        f ? resolve(f) : reject(new Error(this.lastError || 'PC audio stopped'));
      });
    });
  }

  /** GET /api/pc/audio: raw s16le stereo PCM; rate in the X-Rate header. */
  async stream(req, res) {
    if (!this.supported) throw Object.assign(new Error('PC audio needs Windows'), { status: 501 });
    this.start();
    const fmt = await this.waitFormat();
    res.writeHead(200, {
      'Content-Type': `audio/L16; rate=${fmt.rate}; channels=2`,
      'Cache-Control': 'no-store',
      'X-Rate': String(fmt.rate),
      'X-Channels': '2',
    });
    if (res.socket) res.socket.setNoDelay(true);
    const client = { res, dropped: 0, maxBacklog: Math.round((fmt.rate * 4 * MAX_BACKLOG_MS) / 1000) };
    this.clients.add(client);
    console.log(`[pc-audio] listener connected (${this.clients.size})`);
    const leave = () => {
      if (!this.clients.delete(client)) return;
      console.log(`[pc-audio] listener left (${this.clients.size})`);
      if (!this.clients.size) {
        clearTimeout(this.lingerTimer);
        this.lingerTimer = setTimeout(() => !this.clients.size && this.stop(), LINGER_MS);
      }
    };
    req.on('close', leave);
    res.on('error', leave);
  }

  /** Close every listener now (used when the Quest is unlinked). */
  dropAll() {
    for (const c of this.clients) {
      try {
        c.res.end();
        c.res.destroy();
      } catch {}
    }
    this.clients.clear();
  }

  status() {
    return { listeners: this.clients.size, running: !!this.proc };
  }
}

module.exports = { PcAudio };
