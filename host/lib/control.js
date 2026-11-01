'use strict';
const http = require('http');
const { shQuote } = require('./adb');

const KEYS = {
  back: 4, home: 3, menu: 82,
  up: 19, down: 20, left: 21, right: 22, ok: 23, enter: 66,
  del: 67, space: 62, tab: 61, escape: 111,
  volup: 24, voldown: 25, mute: 164,
  playpause: 85, next: 87, prev: 88,
  wake: 224, sleep: 223,
};

// Built-in Quest apps worth showing in the launcher (third-party apps are listed automatically).
const SYSTEM_APPS = {
  'com.oculus.browser': 'Browser',
  'com.oculus.tv': 'Meta TV',
  'com.oculus.store': 'Store',
  'com.oculus.systemutilities': 'Files',
  'com.oculus.hzosgallery': 'Gallery',
  'com.oculus.horizonmediaplayer': 'Media Player',
  'com.oculus.panelapp.settings': 'Settings',
  'com.oculus.remotedesktop': 'Remote Desktop',
};
const HIDDEN_PREFIXES = ['com.meta.shell.env.', 'com.oculus.vrprivacycheckup', 'com.oculus.helpcenter', 'com.oculus.accountscenter', 'horizonos.'];

const PKG_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;

function prettyName(pkg) {
  const last = pkg.split('.').filter((p) => !/^(com|oculus|quest|vr|android|app|client|meta)$/i.test(p)).pop() || pkg;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Small HTTP client for the companion app's agent, reached through `adb forward`. */
function agentRequest(port, method, path, body, { timeout = 4000, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        timeout,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            let msg = buf.toString();
            try {
              msg = JSON.parse(msg).error || msg;
            } catch {}
            return reject(Object.assign(new Error(msg || `agent error ${res.statusCode}`), { status: res.statusCode }));
          }
          if (raw) return resolve({ type: res.headers['content-type'], body: buf });
          try {
            resolve(JSON.parse(buf.toString() || '{}'));
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Quest app did not respond')));
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' ? 'Quest app agent is not running' : e.message)));
    if (data) req.write(data);
    req.end();
  });
}

class Control {
  constructor(devices, agentPort) {
    this.devices = devices;
    this.agentPort = agentPort;
    this.agent = { connected: false, accessibility: false, version: null, checkedAt: 0 };
    setInterval(() => this.pingAgent(), 3000);
  }

  async pingAgent() {
    if (!this.devices.current) {
      this.agent = { connected: false, accessibility: false, version: null, checkedAt: Date.now() };
      return this.agent;
    }
    try {
      const r = await agentRequest(this.agentPort, 'GET', '/ping', null, { timeout: 2000 });
      this.agent = { connected: true, accessibility: !!r.accessibility, version: r.version || null, standalone: r.standalone || null, checkedAt: Date.now() };
    } catch {
      this.agent = { connected: false, accessibility: false, version: null, checkedAt: Date.now() };
    }
    return this.agent;
  }

  agentCall(method, path, body, opts) {
    return agentRequest(this.agentPort, method, path, body, opts);
  }

  async key(name) {
    const code = KEYS[name];
    if (!code) throw new Error(`Unknown key "${name}"`);
    // Horizon OS ignores injected volume keys; the Quest app can change media volume itself.
    const vol = { volup: 'up', voldown: 'down', mute: 'mute' }[name];
    if (vol && this.agent.connected) {
      try {
        return await this.agentCall('POST', '/volume', { dir: vol });
      } catch {}
    }
    this.devices.input(`input keyevent ${code}`);
    return {};
  }

  async text(text, enter) {
    text = String(text || '').slice(0, 2000);
    if (this.agent.accessibility) {
      try {
        await this.agentCall('POST', '/text', { text, enter: !!enter });
        return { via: 'agent' };
      } catch (e) {
        if (!/no focused text field/i.test(e.message)) throw e;
      }
    }
    // Fallback: plain `input text` (ASCII only; %s is how it spells a space).
    const ascii = text.replace(/[^\x20-\x7e]/g, '');
    if (ascii) this.devices.input(`input text ${shQuote(ascii.replace(/%/g, '\\%').replace(/ /g, '%s'))}`);
    if (enter) this.devices.input(`input keyevent ${KEYS.enter}`);
    return { via: 'input', dropped: ascii.length !== text.length };
  }

  async launch(pkg) {
    if (!PKG_RE.test(pkg)) throw new Error('Bad package name');
    const out = await this.devices.shell(
      `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1 2>&1 | grep -q 'No activities' && monkey -p ${pkg} -c com.oculus.intent.category.VR 1 >/dev/null 2>&1; echo done`
    );
    return { ok: out.includes('done') };
  }

  async close(pkg) {
    if (!PKG_RE.test(pkg)) throw new Error('Bad package name');
    if (pkg === 'com.questmirror.app') throw new Error('Not closing the UTSUSHI app itself');
    await this.devices.shell(`am force-stop ${pkg}`);
  }

  async openUrl(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('That does not look like a web address');
    }
    await this.devices.shell(`am start -a android.intent.action.VIEW -d ${shQuote(parsed.href)} com.oculus.browser`);
  }

  async setKeepAwake(on) {
    if (!this.devices.current) return;
    if (on) {
      await this.devices.shell('am broadcast -a com.oculus.vrpowermanager.prox_close; input keyevent KEYCODE_WAKEUP');
    } else {
      await this.devices.shell('am broadcast -a com.oculus.vrpowermanager.automation_disable');
    }
  }

  async apps() {
    let list = null;
    if (this.agent.connected) {
      try {
        const r = await this.agentCall('GET', '/apps', null, { timeout: 6000 });
        list = (r.apps || []).map((a) => ({ pkg: a.pkg, label: a.label, system: !!a.system }));
      } catch {}
    }
    if (!list) {
      const out = await this.devices.shell('pm list packages -3; echo ===; pm list packages -s');
      const [third, sys] = out.split('===');
      const parse = (s) => (s || '').split(/\r?\n/).map((l) => l.replace('package:', '').trim()).filter(Boolean);
      const sysSet = new Set(parse(sys));
      list = parse(third).map((pkg) => ({ pkg, label: prettyName(pkg), system: false }));
      for (const [pkg, label] of Object.entries(SYSTEM_APPS)) if (sysSet.has(pkg)) list.push({ pkg, label, system: true });
    }
    list = list
      .filter((a) => !HIDDEN_PREFIXES.some((p) => a.pkg.startsWith(p)))
      .filter((a) => !a.system || SYSTEM_APPS[a.pkg])
      .map((a) => (SYSTEM_APPS[a.pkg] && a.system ? { ...a, label: SYSTEM_APPS[a.pkg] } : a));
    list.sort((a, b) => (a.system === b.system ? a.label.localeCompare(b.label) : a.system ? -1 : 1));
    return list;
  }
}

module.exports = { Control, KEYS, agentRequest };
