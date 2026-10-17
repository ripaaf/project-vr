'use strict';
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIFI_PORT = 5555;
const isNetworkSerial = (s) => /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s) || s.includes('._adb-tls-connect.');

/** Quote a string for the Android (toybox sh) shell. */
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

class Adb {
  constructor(bin) {
    this.bin = bin;
  }

  run(args, { timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          err.message = `adb ${args.join(' ')}: ${(stderr || err.message).toString().trim()}`;
          return reject(err);
        }
        resolve(stdout.toString());
      });
    });
  }

  /** Run a command and return stdout as a Buffer (for binary output such as PNG). */
  runBinary(args, { timeout = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { timeout, windowsHide: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  }

  shell(serial, cmd, opts) {
    return this.run(['-s', serial, 'shell', cmd], opts);
  }

  async devices() {
    const out = await this.run(['devices', '-l'], { timeout: 8000 });
    return out
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [serial, state, ...rest] = line.split(/\s+/);
        const props = Object.fromEntries(rest.filter((p) => p.includes(':')).map((p) => p.split(':')));
        return {
          serial,
          state,
          model: (props.model || '').replace(/_/g, ' '),
          product: props.product || '',
          transport: isNetworkSerial(serial) ? 'wifi' : 'usb',
        };
      });
  }
}

/**
 * Keeps one long-lived `adb shell` per device so input commands don't pay
 * the ~150 ms process start-up cost every time.
 */
class FastShell {
  constructor(adb, serial) {
    this.adb = adb;
    this.serial = serial;
    this.proc = null;
  }

  exec(cmd) {
    if (!this.proc) {
      this.proc = spawn(this.adb.bin, ['-s', this.serial, 'shell'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      this.proc.on('exit', () => (this.proc = null));
      this.proc.on('error', () => (this.proc = null));
      this.proc.stdin.on('error', () => {});
    }
    this.proc.stdin.write(cmd + '\n');
  }

  close() {
    if (this.proc) {
      try {
        this.proc.stdin.end('exit\n');
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
  }
}

/**
 * Watches `adb devices`, picks the Quest to use (USB or Wi-Fi), and keeps the
 * port tunnels to the companion app in place.
 */
class DeviceManager extends EventEmitter {
  constructor(adb, config, { hostPort, agentPort }) {
    super();
    this.adb = adb;
    this.config = config;
    this.hostPort = hostPort;
    this.agentPort = agentPort;
    this.list = [];
    this.current = null; // { serial, transport, model }
    this.info = {}; // battery, wifiIp, ...
    this.fast = null;
    this.lastReconnect = 0;
    this.adbError = null;
    this.autoTried = new Map();
    this.switching = false;
  }

  start() {
    const tick = async () => {
      try {
        await this.poll();
        this.adbError = null;
      } catch (e) {
        this.adbError = e.message;
      }
      setTimeout(tick, 2000);
    };
    tick();
    setInterval(() => this.refreshInfo().catch(() => {}), 15000);
  }

  async poll() {
    this.list = await this.adb.devices();
    // Forget dead Wi-Fi links from an old network (they'd otherwise hang around as "offline").
    for (const d of this.list) {
      if (d.transport === 'wifi' && d.state === 'offline' && d.serial.split(':')[0] !== this.config.get().wirelessIp) {
        this.adb.run(['disconnect', d.serial], { timeout: 4000 }).catch(() => {});
      }
    }
    const ready = this.list.filter((d) => d.state === 'device');
    const usb = ready.find((d) => d.transport === 'usb');
    const wifi = ready.find((d) => d.transport === 'wifi');
    const pick = this.config.get().preferWireless ? wifi || usb : usb || wifi;

    // Cable plugged in but no Wi-Fi link yet: switch ADB to Wi-Fi so the cable can be unplugged.
    // (Needed once after every Quest restart; this makes it "plug in, unplug, done".)
    if (usb && !wifi && this.config.get().autoWireless && !this.switching &&
        Date.now() - (this.autoTried.get(usb.serial) || 0) > 45000) {
      this.autoTried.set(usb.serial, Date.now());
      this.switching = true;
      this.enableWireless()
        .then((r) => !r.already && console.log(`[adb] Wi-Fi mode on (${r.ip}). You can unplug the cable.`))
        .catch((e) => console.log(`[adb] staying on USB: ${e.message}`))
        .finally(() => (this.switching = false));
    }

    // Lost the cable (or never had one) but we know where the Quest lives on Wi-Fi: try to reconnect.
    const ip = this.config.get().wirelessIp;
    if (ip && !wifi && Date.now() - this.lastReconnect > 6000) {
      this.lastReconnect = Date.now();
      this.adb.run(['connect', `${ip}:${WIFI_PORT}`], { timeout: 4000 }).catch(() => {});
    }

    if ((pick && pick.serial) !== (this.current && this.current.serial)) {
      const prev = this.current;
      this.current = pick ? { serial: pick.serial, transport: pick.transport, model: pick.model } : null;
      if (this.fast) this.fast.close();
      this.fast = pick ? new FastShell(this.adb, pick.serial) : null;
      this.info = {};
      if (pick) {
        console.log(`[adb] using ${pick.model || 'device'} over ${pick.transport.toUpperCase()} (${pick.serial})`);
        await this.setupTunnels().catch((e) => console.warn('[adb] tunnel setup failed:', e.message));
        await this.refreshInfo().catch(() => {});
      } else if (prev) {
        console.log('[adb] Quest disconnected');
      }
      this.emit('change', this.current, prev);
    }
  }

  /** adb reverse: the Quest app reaches this host at 127.0.0.1:hostPort. adb forward: we reach the app's agent. */
  async setupTunnels() {
    const s = this.current && this.current.serial;
    if (!s) return;
    await this.adb.run(['-s', s, 'reverse', `tcp:${this.hostPort}`, `tcp:${this.hostPort}`]);
    await this.adb.run(['-s', s, 'forward', `tcp:${this.agentPort}`, `tcp:${this.agentPort}`]);
  }

  async refreshInfo() {
    const s = this.current && this.current.serial;
    if (!s) return;
    const out = await this.adb.shell(
      s,
      'dumpsys battery | grep -E "^  level:"; ip -o -f inet addr show wlan0 2>/dev/null; wm size | tail -1; ' +
        'getprop ro.product.model; pm path com.questmirror.app >/dev/null 2>&1 && echo APP_INSTALLED; ' +
        'settings get secure enabled_accessibility_services'
    );
    const level = /level:\s*(\d+)/.exec(out);
    const ip = /inet (\d+\.\d+\.\d+\.\d+)/.exec(out);
    const size = /(\d+)x(\d+)/.exec(out.split('\n').find((l) => /size/.test(l)) || '');
    const model = out.split('\n').map((l) => l.trim()).find((l) => /^Quest|^Oculus|^Meta/i.test(l));
    this.info = {
      battery: level ? Number(level[1]) : null,
      wifiIp: ip ? ip[1] : null,
      display: size ? { w: Number(size[1]), h: Number(size[2]) } : this.info.display || null,
      model: model || (this.current && this.current.model) || 'Quest',
      appInstalled: out.includes('APP_INSTALLED'),
      controlEnabled: out.includes('com.questmirror.app/'),
    };
  }

  async displaySize() {
    if (!this.info.display) await this.refreshInfo().catch(() => {});
    return this.info.display || { w: 4128, h: 2208 };
  }

  /** Fire-and-forget input command over the persistent shell. */
  input(cmd) {
    if (!this.fast) throw new Error('No Quest connected');
    this.fast.exec(cmd);
  }

  shell(cmd, opts) {
    if (!this.current) return Promise.reject(new Error('No Quest connected'));
    return this.adb.shell(this.current.serial, cmd, opts);
  }

  /** One-time USB step: switch adbd to TCP mode, then connect to it over Wi-Fi. */
  async enableWireless() {
    const usb = this.list.find((d) => d.state === 'device' && d.transport === 'usb');
    const existing = this.list.find((d) => d.state === 'device' && d.transport === 'wifi');
    if (existing) {
      this.config.update({ wirelessIp: existing.serial.split(':')[0] });
      return { ip: existing.serial.split(':')[0], already: true };
    }
    if (!usb) throw new Error('Plug the Quest in by USB once to turn on Wi-Fi mode.');
    const out = await this.adb.shell(usb.serial, 'ip -o -f inet addr show wlan0');
    const m = /inet (\d+\.\d+\.\d+\.\d+)/.exec(out);
    if (!m) throw new Error('The Quest is not connected to Wi-Fi. Connect it to the same Wi-Fi as this PC first.');
    const ip = m[1];
    await this.adb.run(['-s', usb.serial, 'tcpip', String(WIFI_PORT)]);
    let res = '';
    for (let i = 0; i < 6; i++) {
      await sleep(1500);
      res = await this.adb.run(['connect', `${ip}:${WIFI_PORT}`], { timeout: 6000 }).catch((e) => e.message);
      if (/connected to/i.test(res)) break;
    }
    if (!/connected to/i.test(res)) {
      throw new Error(`Could not reach the Quest at ${ip}. Make sure the PC and Quest are on the same Wi-Fi network. (${res.trim()})`);
    }
    this.config.update({ wirelessIp: ip });
    return { ip };
  }

  async disableWireless() {
    const ip = this.config.get().wirelessIp;
    this.config.update({ wirelessIp: '', preferWireless: false });
    if (ip) await this.adb.run(['disconnect', `${ip}:${WIFI_PORT}`]).catch(() => {});
  }

  status() {
    const c = this.current;
    const usbPresent = this.list.some((d) => d.state === 'device' && d.transport === 'usb');
    const wifiPresent = this.list.some((d) => d.state === 'device' && d.transport === 'wifi');
    const unauthorized = this.list.some((d) => d.state === 'unauthorized');
    return {
      connected: !!c,
      serial: c ? c.serial : null,
      transport: c ? c.transport : null,
      model: (this.info && this.info.model) || (c && c.model) || null,
      battery: this.info.battery ?? null,
      wifiIp: this.info.wifiIp || null,
      appInstalled: !!this.info.appInstalled,
      controlEnabled: !!this.info.controlEnabled,
      usbPresent,
      wifiPresent,
      unauthorized,
      wirelessIp: this.config.get().wirelessIp || null,
      switching: this.switching,
      adbError: this.adbError,
    };
  }
}

module.exports = { Adb, DeviceManager, shQuote, sleep };
