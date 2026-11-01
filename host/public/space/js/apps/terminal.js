// TERMINAL 端末 — a real shell on your Quest (Android's toybox: a minimal Linux), plus UTSUSHI's
// own commands. Type with the 3D keyboard, a Bluetooth keyboard, or tap the chips.
import { App } from '../panels.js';
import { T, chrome, text, mono, button, font, icon } from '../theme.js';
import { api, events } from '../api.js';

// text size: A− / A+ in the window's corner (kept in settings); smaller shows more of long output
const FS_MIN = 16;
const FS_MAX = 30;

// Commands that never end on their own get a sensible limit (no TTY, so no Ctrl+C).
const TAME = [
  [/^top(\s|$)(?!.*-n)/, (c) => `${c} -n 1 -m 14`],
  [/^ping\s(?!.*-c)/, (c) => c.replace(/^ping/, 'ping -c 4')],
  [/^logcat(\s|$)(?!.*-d)/, (c) => `${c} -d -t 40`],
  [/^ip$/, () => 'ip -4 addr show wlan0; ip route | head -3'],
];

// Linux (Alpine, with its package manager) runs in the UTSUSHI Linux companion on the headset; the
// space opened from the PC reaches it on the headset too
const LX = () => `${location.port === '8770' ? '' : 'http://localhost:8770'}/api/space/linux`;

const LOGO = [
  '    ▄▄▄▄          ▄▄▄▄    ',
  '  ▄█▀  ▀█▄      ▄█▀  ▀█▄  ',
  ' ██      ▀█▄  ▄█▀      ██ ',
  ' ██        ▀██▀        ██ ',
  ' ██        ▄██▄        ██ ',
  ' ██      ▄█▀  ▀█▄      ██ ',
  '  ▀█▄  ▄█▀      ▀█▄  ▄█▀  ',
  '    ▀▀▀▀          ▀▀▀▀    ',
  '                          ',
];

export class Terminal extends App {
  constructor() {
    super('term', 'Terminal', '端末', [1.12, 0.66]);
    this.lines = [];
    this.input = '';
    this.history = [];
    this.hIndex = -1;
    this.scroll = 0;
    this.fps = 2; // cursor blink
    this.shell = null;
    this.linux = null; // the Linux shell, while you are in it
    this.busy = false;
    this.print('UTSUSHI terminal — a real Linux shell on your headset.', 'sys');
    this.print('Type "help". Chips below run common commands.', 'sys');
  }

  print(s, kind = 'out') {
    const clean = String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
    for (const line of clean.split('\n')) this.lines.push({ text: line, kind });
    if (this.lines.length > 600) this.lines.splice(0, this.lines.length - 600);
    this.scroll = 0;
    this.invalidate();
  }

  opened() {
    this.world.keyTarget = this;
  }

  // ------------------------------------------------------------------ keys (3D keyboard, BT keyboard)

  key(k) {
    if (k === 'Enter') return this.submit();
    if (k === 'Backspace') this.input = this.input.slice(0, -1);
    else if (k === 'ArrowUp') {
      if (this.history.length) {
        this.hIndex = Math.min(this.history.length - 1, this.hIndex + 1);
        this.input = this.history[this.history.length - 1 - this.hIndex];
      }
    } else if (k === 'ArrowDown') {
      this.hIndex = Math.max(-1, this.hIndex - 1);
      this.input = this.hIndex < 0 ? '' : this.history[this.history.length - 1 - this.hIndex];
    } else if (k.length === 1) this.input += k;
    this.invalidate();
  }

  submit(cmdIn) {
    const cmd = (cmdIn ?? this.input).trim();
    this.input = '';
    this.hIndex = -1;
    if (!cmd) return this.invalidate();
    this.history.push(cmd);
    this.print(`${this.linux ? '#' : '❯'} ${cmd}`, 'cmd');
    if (this.linux) this.runLinux(cmd);
    else this.run(cmd);
  }

  async run(cmd) {
    const [name, ...rest] = cmd.split(/\s+/);
    const arg = rest.join(' ');
    const W = this.world;
    switch (name) {
      case 'help':
        this.print(
          [
            'UTSUSHI commands',
            '  sysinfo        this headset + PC, at a glance',
            '  snap           take a photo of your view',
            '  void | room    switch environment',
            '  matrix         glyph rain',
            '  say <text>     the core speaks (captioned)',
            '  open <app>     term sys pc dev obj gal ges set',
            '  dev <line>     send a line to the connected board',
            '  ports          list serial ports on the PC',
            '  theme night|paper',
            '  history · clear · restart',
            '  ip · sudo      (the Quest has no root: sudo runs it as you)',
            '  linux          enter Linux (Alpine): apk add <package> installs',
            '  linux install · linux status · linux remove',
            'Anything else runs in the headset shell (ls, cd, cat, ps, df, getprop, …);',
            'on the Quest alone with a Linux toolbox too (vi, wget, awk, tar, nc …)',
          ].join('\n'),
          'sys'
        );
        return;
      case 'clear':
        this.lines = [];
        return this.invalidate();
      case 'history':
        return this.print(this.history.map((h, i) => `${String(i + 1).padStart(3)}  ${h}`).join('\n'));
      case 'sysinfo':
      case 'neofetch':
        return this.sysinfo();
      case 'snap':
        this.print('· framing your view…', 'sys');
        return W.photo(null, null);
      case 'void':
      case 'room':
        W.setMode(name);
        return this.print(`environment → ${name}`, 'sys');
      case 'matrix':
        W.fx.glyphRain();
        return this.print('wake up, neo…', 'sys');
      case 'say':
        W.coreSay(arg || 'Hello. I am the core.');
        return;
      case 'open': {
        const app = W.apps[arg];
        if (!app) return this.print(`no app "${arg}". try: ${Object.keys(W.apps).filter((k) => !['dock', 'keys', 'watch', 'tour'].includes(k)).join(' ')}`, 'err');
        W.panels.focus(app);
        return;
      }
      case 'theme':
        W.setTheme(arg === 'paper' ? 'paper' : 'night');
        return this.print(`theme → ${arg === 'paper' ? 'paper' : 'night'}`, 'sys');
      case 'ports': {
        try {
          const r = await api('/api/serial/ports');
          if (!r.ports.length) return this.print('no serial ports on the PC', 'sys');
          return this.print(r.ports.map((p) => `${p.port.padEnd(6)} ${p.likelyBoard ? '◆' : '·'} ${p.name}${p.chip ? `  (${p.chip})` : ''}`).join('\n'));
        } catch (e) {
          return this.print(e.message, 'err');
        }
      }
      case 'dev':
        try {
          await api('/api/serial/send', { text: arg });
          return this.print(`→ board: ${arg}`, 'sys');
        } catch (e) {
          return this.print(`${e.message} — connect a board in DEVICES first`, 'err');
        }
      case 'restart':
        this.closeShell();
        return this.print('shell restarted', 'sys');
      case 'sudo':
        // there is no root on a Quest: say so once, then run it as you
        if (!arg) return this.print('sudo: the Quest has no root; commands run as your user here.', 'sys');
        this.print('sudo: no root on the Quest — running it as your user.', 'sys');
        return this.run(arg);
      case 'ip':
      case 'ifconfig':
        if (!W.standalone) break; // the headset shell (over the cable) has ip
        try {
          const r = await api('/api/space/net');
          return this.print(r.interfaces.map((n, i) => `${i + 1}: ${n.name}: <${n.up ? 'UP' : 'DOWN'}${n.loopback ? ',LOOPBACK' : ''}> mtu ${n.mtu}\n${n.addrs.map((a) => `    ${a.includes(':') ? 'inet6' : 'inet '} ${a}`).join('\n')}`).join('\n'));
        } catch (e) {
          return this.print(e.message, 'err');
        }
      case 'exit':
        W.panels.close(this);
        return;
      case 'linux':
        return this.linuxCmd(rest[0] || '', rest.slice(1));
      case 'apk':
      case 'apt':
      case 'apt-get':
      case 'pkg':
        // packages live in Linux: go there and run it (Alpine's is apk)
        this.print(name === 'apk' ? 'packages live in Linux (Alpine) — entering it…' : `Linux here is Alpine: it uses apk (apk add <name>), not ${name}.`, 'sys');
        if (name === 'apk') return this.enterLinux(cmd);
        return;
    }
    // everything else: the headset's shell
    let line = cmd;
    for (const [re, fix] of TAME) if (re.test(line)) line = fix(line);
    try {
      await this.ensureShell();
      await api('/api/space/shell/input', { id: this.shell, line });
    } catch (e) {
      this.shell = null;
      this.print(e.status === 409 ? 'no headset connected to the PC (plug in the cable once)' : e.message, 'err');
    }
  }

  async ensureShell() {
    if (this.shell) return;
    const r = await api('/api/space/shell', {});
    this.shell = r.id;
    const take = (m) => {
      if (m.kind === 'out') this.print(m.data.replace(/\n$/, ''), 'out');
      else if (m.kind === 'err') this.print(m.data.replace(/\n$/, ''), 'err');
      else if (m.kind === 'exit') {
        this.print('shell ended', 'sys');
        this.closeShell();
      }
    };
    if (!this.world.standalone) {
      this.stopEvents = events(`/api/space/shell/stream?id=${r.id}`, take);
      return;
    }
    // on the Quest alone the app runs the shell (with its Linux toolbox) and is read a moment at a time
    const id = r.id;
    let since = 0;
    this.stopEvents = () => (since = -1);
    (async () => {
      while (since >= 0 && this.shell === id) {
        try {
          const o = await api(`/api/space/shell/read?id=${id}&since=${since}`);
          if (since < 0) break;
          since = o.next;
          o.messages.forEach(take);
          if (o.ended) break;
        } catch {
          await new Promise((res) => setTimeout(res, 1000));
        }
      }
    })();
  }

  // ------------------------------------------------------------------ Linux (Alpine)

  lxError(e) {
    if (e.status === 0) return 'the UTSUSHI app on the headset is not answering: open it once, then try again';
    return e.message;
  }

  async linuxCmd(sub, args) {
    if (sub === '' || sub === 'enter') return this.enterLinux();
    if (sub === 'install') return this.linuxInstall();
    if (sub === 'status') {
      try {
        const st = await api(`${LX()}/state`);
        return this.print(st.installed ? `Alpine Linux ${st.version} · ${(st.bytes / 1048576).toFixed(0)} MB` : `not installed${st.phase === 'failed' ? ` (last try: ${st.error})` : ''} · type "linux install"`, 'sys');
      } catch (e) {
        return this.print(this.lxError(e), 'err');
      }
    }
    if (sub === 'remove') {
      if (args[0] !== '--yes') return this.print('this deletes Linux with everything installed in it and its /root. Type "linux remove --yes" to go ahead.', 'sys');
      try {
        this.closeLinux();
        await api(`${LX()}/remove`, {});
        return this.print('Linux removed.', 'sys');
      } catch (e) {
        return this.print(this.lxError(e), 'err');
      }
    }
    this.print('linux · linux install · linux status · linux remove', 'sys');
  }

  /** Downloads Alpine (~4 MB) on the headset, showing how far it is. */
  async linuxInstall() {
    let st;
    try {
      st = await api(`${LX()}/install`, {});
    } catch (e) {
      return this.print(this.lxError(e), 'err');
    }
    const line = { text: '· getting Alpine Linux from alpinelinux.org…', kind: 'sys' };
    this.lines.push(line);
    while (st.phase === 'downloading' || st.phase === 'unpacking') {
      await new Promise((r) => setTimeout(r, 600));
      try {
        st = await api(`${LX()}/state`);
      } catch (e) {
        return this.print(this.lxError(e), 'err');
      }
      const mb = (n) => (n / 1048576).toFixed(1);
      line.text = st.phase === 'unpacking' ? '· unpacking…' : `· downloading ${mb(st.got)}${st.total > 0 ? ` / ${mb(st.total)}` : ''} MB`;
      this.invalidate();
    }
    if (st.phase === 'failed') return this.print(`could not install Linux: ${st.error}`, 'err');
    line.text = `· Alpine Linux ${st.version} is ready`;
    this.print('type "linux" to enter it — then apk add <package> (python3, git, nodejs, …)', 'sys');
  }

  async enterLinux(first) {
    if (this.linux) return first && this.runLinux(first);
    let st;
    try {
      st = await api(`${LX()}/state`);
    } catch (e) {
      return this.print(this.lxError(e), 'err');
    }
    if (!st.installed) return this.print('Linux is not installed yet. Type "linux install" (about 4 MB from alpinelinux.org).', 'sys');
    let r;
    try {
      r = await api(`${LX()}/shell`, {});
    } catch (e) {
      return this.print(this.lxError(e), 'err');
    }
    const id = r.id;
    this.linux = id;
    this.print(`Alpine Linux ${st.version} · you are root here · apk add <package> · exit leaves`, 'sys');
    this.invalidate();
    let since = 0;
    this.stopLinux = () => (since = -1);
    (async () => {
      while (since >= 0 && this.linux === id) {
        try {
          const o = await api(`${LX()}/shell/read?id=${id}&since=${since}`);
          if (since < 0) break;
          since = o.next;
          for (const m of o.messages) {
            if (m.kind === 'exit') {
              if (this.linux === id) this.print('left Linux', 'sys');
              this.closeLinux();
            } else this.print(m.data.replace(/\n$/, ''), m.kind === 'err' ? 'err' : 'out');
          }
          if (o.ended) break;
        } catch {
          await new Promise((res) => setTimeout(res, 1000));
        }
      }
    })();
    if (first) this.runLinux(first);
  }

  async runLinux(cmd) {
    const [name, ...rest] = cmd.split(/\s+/);
    if (name === 'clear') {
      this.lines = [];
      return this.invalidate();
    }
    if (name === 'help') return this.print('Alpine Linux: apk add|del|search <name> · exit leaves · everything else runs in its shell', 'sys');
    let line = name === 'sudo' ? rest.join(' ') : cmd; // you are root here already
    if (!line) return;
    for (const [re, fix] of TAME) if (re.test(line)) line = fix(line);
    try {
      await api(`${LX()}/shell/input`, { id: this.linux, line });
    } catch (e) {
      this.print(this.lxError(e), 'err');
      this.closeLinux();
    }
  }

  closeLinux() {
    if (this.stopLinux) this.stopLinux();
    this.stopLinux = null;
    if (this.linux) api(`${LX()}/shell/close`, { id: this.linux }).catch(() => {});
    this.linux = null;
    this.invalidate();
  }

  closeShell() {
    if (this.stopEvents) this.stopEvents();
    this.stopEvents = null;
    if (this.shell) api('/api/space/shell/close', { id: this.shell }).catch(() => {});
    this.shell = null;
  }

  async sysinfo() {
    let s;
    try {
      s = await api('/api/space/stats');
    } catch (e) {
      return this.print(e.message, 'err');
    }
    const q = s.quest || {};
    const gb = (k) => (k / 1024 / 1024).toFixed(1);
    const pc = s.pc;
    const info = [
      `utsushi@${(q.model || 'quest').toLowerCase().replace(/\s+/g, '')}`,
      '────────────────────────────',
      `os       Horizon OS ${q.build || ''}`.trim(),
      `host     ${q.model || 'Meta Quest'}`,
      `battery  ${q.battery ?? '—'}%${q.charging ? ' charging' : ''} · ${q.tempC ?? '—'} °C`,
      `memory   ${q.memAvail ? gb(q.memTotal - q.memAvail) : '—'} / ${q.memTotal ? gb(q.memTotal) : '—'} GB`,
      `uptime   ${q.uptime ? `${Math.floor(q.uptime / 3600)} h ${Math.floor((q.uptime % 3600) / 60)} min` : '—'}`,
      `link     ${s.standalone ? 'on its own' : q.transport || 'none'}${q.wifiIp ? ` · ${q.wifiIp}` : ''}`,
      pc ? `pc       ${pc.name} · cpu ${pc.cpu}% · ${gb(pc.memUsed / 1024)} / ${gb(pc.memTotal / 1024)} GB` : 'pc       not connected',
    ];
    this.print(LOGO.map((a, i) => `${a}  ${info[i] || ''}`).join('\n'), 'art');
  }

  get fs() {
    return (this.world && this.world.settings.termFs) || 22;
  }

  get lh() {
    return Math.round(this.fs * 1.38);
  }

  // ------------------------------------------------------------------ pointer: drag to scroll

  /** Pinch the output and drag: down shows older lines, up comes back (the scrollbar follows). */
  pointer(kind, x, y) {
    const top = 128;
    const bottom = this.panel.H - 92;
    if (kind === 'down' && y > top && y < bottom && x < this.panel.W - 70) {
      this.dragY = y;
      this.dragScroll = this.scroll;
      return false;
    }
    if (kind === 'move' && this.dragY != null) {
      this.scroll = Math.max(0, Math.min(this.maxScroll || 0, this.dragScroll + Math.round((y - this.dragY) / this.lh)));
      this.invalidate();
      return Math.abs(y - this.dragY) > 8;
    }
    if (kind === 'up' && this.dragY != null) this.dragY = null;
    // the scrollbar: press anywhere on it to jump there
    if ((kind === 'down' || (kind === 'move' && this.barDrag)) && this.bar && x > this.bar.x - 30 && y >= this.bar.y - 10 && y <= this.bar.y + this.bar.h + 10) {
      this.barDrag = true;
      const f = Math.max(0, Math.min(1, (y - this.bar.y) / this.bar.h));
      this.scroll = Math.round((1 - f) * (this.maxScroll || 0));
      this.invalidate();
      return true;
    }
    if (kind === 'up' || kind === 'leave') this.barDrag = false;
    return false;
  }

  wheel(d) {
    this.scroll = Math.max(0, Math.min(this.maxScroll || 0, this.scroll - d * 3));
    this.invalidate();
  }

  click(id) {
    const W = this.world;
    if (id === 'kbd') W.keyboard.toggle(this);
    else if (id === 'latest') this.scroll = 0;
    else if (id === 'fs-' || id === 'fs+') {
      W.settings.termFs = Math.max(FS_MIN, Math.min(FS_MAX, this.fs + (id === 'fs+' ? 2 : -2)));
      W.saveSettings();
    }
    this.invalidate();
  }

  draw(g, ui, W, H, t) {
    const top = chrome(g, ui, W, H, { title: 'Terminal', sub: this.linux ? 'Alpine Linux · root' : `${this.world.standalone ? 'on the Quest' : 'headset shell'} · ${this.shell ? 'connected' : 'ready'}` });
    // text size, top right
    const FS = this.fs;
    const LH = this.lh;
    button(g, ui, 'fs-', W - 212, 30, 80, 52, 'A−', { small: true });
    button(g, ui, 'fs+', W - 124, 30, 80, 52, 'A+', { small: true });
    // output
    const x0 = 40;
    const outTop = top + 6;
    const outBottom = H - 92;
    const rows = Math.floor((outBottom - outTop) / LH);
    font(g, FS, 'mono', 500);
    const maxChars = Math.floor((W - 110) / g.measureText('M').width);
    const wrapped = [];
    for (const l of this.lines) {
      if (l.text.length <= maxChars) wrapped.push(l);
      else for (let i = 0; i < l.text.length; i += maxChars) wrapped.push({ text: l.text.slice(i, i + maxChars), kind: l.kind });
    }
    this.maxScroll = Math.max(0, wrapped.length - rows);
    this.scroll = Math.min(this.scroll, this.maxScroll);
    const end = Math.max(0, wrapped.length - this.scroll);
    const start = Math.max(0, end - rows);
    const colors = { cmd: T.ink, out: T.ink2, err: T.seal, sys: T.gold, art: T.ink };
    g.save();
    g.beginPath();
    g.rect(0, outTop - 4, W, outBottom - outTop + 8);
    g.clip();
    wrapped.slice(start, end).forEach((l, i) => text(g, l.text, x0, outTop + (i + 1) * LH - 8, { size: FS, family: 'mono', weight: l.kind === 'cmd' ? 700 : 500, color: colors[l.kind] || T.ink2 }));
    g.restore();
    // the scrollbar (only when there is more than fits), and a way back to the newest line
    this.bar = null;
    if (this.maxScroll > 0) {
      const bx = W - 30;
      const bh = outBottom - outTop;
      this.bar = { x: bx, y: outTop, h: bh };
      g.fillStyle = T.line;
      g.fillRect(bx, outTop, 4, bh);
      const th = Math.max(36, (rows / wrapped.length) * bh);
      const ty = outTop + (start / Math.max(1, wrapped.length - rows)) * (bh - th);
      g.fillStyle = this.scroll > 0 ? T.seal : T.ink3;
      g.fillRect(bx - 2, ty, 8, th);
    }
    if (this.scroll > 0) button(g, ui, 'latest', W - 260, outBottom - 50, 210, 46, `↓ ${this.scroll} newer`, { small: true, active: true });
    // the prompt
    const iy = H - 44;
    g.fillStyle = T.line;
    g.fillRect(36, iy - 34, W - 72, 1);
    text(g, this.linux ? '#' : '❯', 40, iy + 8, { size: 26, family: 'mono', weight: 700, color: this.linux ? T.moss : T.seal });
    const room = maxChars - 8;
    const shown = this.input.length > room ? '…' + this.input.slice(-(room - 1)) : this.input;
    text(g, shown, 72, iy + 8, { size: 24, family: 'mono', weight: 600, color: T.ink });
    font(g, 24, 'mono', 600);
    const cx = 72 + g.measureText(shown).width + 3;
    if (Math.floor(t * 2) % 2 === 0) {
      g.fillStyle = T.seal;
      g.fillRect(cx, iy - 14, 12, 28);
    }
    if (!this.input) text(g, 'type a command · help', cx + 24, iy + 6, { size: 20, family: 'mono', color: T.ink3 });
    // keyboard: a small key at the end of the prompt
    const kOn = this.world.keyboard.visible && this.world.keyboard.target === this;
    icon(g, 'keyboard', W - 74, iy - 14, 28, kOn ? T.seal : T.ink3);
    ui.hit('kbd', W - 96, iy - 34, 70, 64);
  }
}

// ------------------------------------------------------------------ 3D keyboard

const ROWS_ABC = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm./'];
const ROWS_SYM = ['!@#$%^&*()', '~`|\\_+=[]', '{}<>"\':;?', ',$€¥°±§¶'];

export class Keys extends App {
  constructor() {
    super('keys', 'Keyboard', '鍵', [1.0, 0.36]);
    this.shift = false;
    this.sym = false;
  }

  click(id, data) {
    const target = this.world.keyTarget;
    this.world.sound.key(this.panel.group.position);
    if (id === 'k') {
      let ch = data;
      if (this.shift && !this.sym) ch = ch.toUpperCase();
      if (target && target.key) target.key(ch);
      if (this.shift) {
        this.shift = false;
        this.invalidate();
      }
    } else if (id === 'shift') {
      this.shift = !this.shift;
      this.invalidate();
    } else if (id === 'sym') {
      this.sym = !this.sym;
      this.invalidate();
    } else if (target && target.key) target.key({ space: ' ', back: 'Backspace', enter: 'Enter', up: 'ArrowUp', down: 'ArrowDown' }[id] || '');
  }

  draw(g, ui, W, H) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = T.bg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = T.line2;
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, W - 3, H - 3);
    const rows = this.sym ? ROWS_SYM : ROWS_ABC;
    const kw = (W - 40) / 10;
    const kh = 66;
    rows.forEach((row, r) => {
      const off = (10 - row.length) * kw * 0.5;
      [...row].forEach((ch, i) => {
        const label = this.shift && !this.sym ? ch.toUpperCase() : ch;
        button(g, ui, 'k', 20 + off + i * kw + 3, 16 + r * (kh + 6), kw - 6, kh, label, { small: true, data: ch });
      });
    });
    const y = 16 + 4 * (kh + 6);
    button(g, ui, 'shift', 20, y, kw * 1.3, kh, '⇧', { small: true, active: this.shift });
    button(g, ui, 'sym', 20 + kw * 1.35, y, kw * 1.3, kh, this.sym ? 'abc' : '#+=', { small: true, active: this.sym });
    button(g, ui, 'space', 20 + kw * 2.7, y, kw * 3.4, kh, 'space', { small: true });
    button(g, ui, 'up', 20 + kw * 6.15, y, kw * 0.9, kh, '↑', { small: true });
    button(g, ui, 'back', 20 + kw * 7.1, y, kw * 1.3, kh, '⌫', { small: true });
    button(g, ui, 'enter', 20 + kw * 8.45, y, kw * 1.5, kh, '⏎', { small: true, primary: true });
  }
}
