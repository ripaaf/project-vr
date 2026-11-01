'use strict';
// Files for UTSUSHI Space's explorer: the headset's storage (over ADB) and this PC's folders.
// Browse, search, preview (thumbnails, raw files with range support), new folder, rename, copy /
// move (also between the Quest and the PC), delete (PC files go to the Recycle Bin).
// Only the owner reaches these routes (this PC, or the linked headset over the cable).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json', '.log': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.pdf': 'application/pdf',
};
const IMAGE = /\.(jpe?g|png|gif|webp|bmp)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|mkv)$/i;

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`; // POSIX single-quote for the Quest shell
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

class Files {
  constructor({ adbBin, ffmpegBin, devices }) {
    this.adbBin = adbBin;
    this.ffmpegBin = ffmpegBin;
    this.devices = devices;
    this.thumbs = new Map(); // key → jpeg buffer (small LRU)
  }

  serial() {
    if (!this.devices.current) throw err('The headset is not connected', 409);
    return this.devices.current.serial;
  }

  adb(args, { timeout = 30000, input } = {}) {
    return new Promise((resolve, reject) => {
      const p = execFile(this.adbBin, ['-s', this.serial(), ...args], { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (e, out, se) => {
        if (e) return reject(err((se || e.message).toString().trim().split('\n').pop() || 'adb failed', 500));
        resolve(out.toString());
      });
      if (input) p.stdin.end(input);
    });
  }

  sh(cmd, opts) {
    return this.adb(['shell', cmd], opts);
  }

  questPath(p) {
    const s = String(p || '/sdcard');
    if (!s.startsWith('/')) throw err('Quest paths start with /');
    return path.posix.normalize(s);
  }

  pcPath(p) {
    const s = String(p || os.homedir());
    if (!path.isAbsolute(s)) throw err('PC paths must be absolute');
    return path.normalize(s);
  }

  // ------------------------------------------------------------------ places

  roots() {
    const home = os.homedir();
    const pc = [{ name: 'Home', path: home, icon: 'home' }];
    for (const [name, icon] of [['Desktop', 'desk'], ['Downloads', 'down'], ['Documents', 'doc'], ['Pictures', 'pic'], ['Videos', 'vid'], ['Music', 'music']]) {
      const p = path.join(home, name);
      if (fs.existsSync(p)) pc.push({ name, path: p, icon });
    }
    for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const p = `${L}:\\`;
      try {
        if (process.platform === 'win32' && fs.existsSync(p)) pc.push({ name: `Drive ${L}:`, path: p, icon: 'drive' });
      } catch {}
    }
    const quest = [
      { name: 'Storage', path: '/sdcard', icon: 'home' },
      { name: 'Download', path: '/sdcard/Download', icon: 'down' },
      { name: 'Screenshots', path: '/sdcard/Oculus/Screenshots', icon: 'pic' },
      { name: 'Videos', path: '/sdcard/Oculus/VideoShots', icon: 'vid' },
      { name: 'Pictures', path: '/sdcard/Pictures', icon: 'pic' },
      { name: 'Movies', path: '/sdcard/Movies', icon: 'vid' },
      { name: 'Music', path: '/sdcard/Music', icon: 'music' },
      { name: 'Documents', path: '/sdcard/Documents', icon: 'doc' },
    ];
    return { pc, quest, questOnline: !!this.devices.current };
  }

  // ------------------------------------------------------------------ list

  async list(src, p) {
    if (src === 'quest') {
      const dir = this.questPath(p);
      // trailing slash: /sdcard is a symlink, and we want what is inside it
      const out = await this.sh(`ls -lA ${q(dir === "/" ? "/" : `${dir}/`)} 2>&1`);
      if (/No such file|Permission denied/.test(out) && !/^[-dl]/m.test(out)) throw err(out.trim().split('\n')[0], 404);
      const entries = [];
      for (const line of out.split('\n')) {
        const m = /^([-dlcbps])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d)\s+(.+)$/.exec(line.trim());
        if (!m) continue;
        let name = m[5];
        const link = m[1] === 'l';
        if (link) name = name.split(' -> ')[0];
        entries.push({ name, dir: m[1] === 'd' || link, size: Number(m[2]), mtime: Date.parse(`${m[3]}T${m[4]}:00`) || 0 });
      }
      return { src, path: dir, parent: dir === '/' ? null : path.posix.dirname(dir), entries };
    }
    const dir = this.pcPath(p);
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      throw err(e.code === 'ENOENT' ? 'That folder is gone' : e.code === 'EPERM' || e.code === 'EACCES' ? 'Windows does not allow opening that folder' : e.message, 404);
    }
    const entries = [];
    for (const d of names.slice(0, 3000)) {
      if (d.name === 'desktop.ini' || d.name.startsWith('$')) continue;
      try {
        const st = fs.statSync(path.join(dir, d.name));
        entries.push({ name: d.name, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs });
      } catch {}
    }
    const parent = path.dirname(dir);
    return { src, path: dir, parent: parent === dir ? null : parent, entries };
  }

  async search(src, p, text) {
    const needle = String(text || '').trim();
    if (!needle) return { entries: [] };
    if (src === 'quest') {
      const dir = this.questPath(p);
      const out = await this.sh(`find ${q(dir)} -iname ${q(`*${needle}*`)} 2>/dev/null | head -200`, { timeout: 20000 });
      const paths = out.split('\n').map((s) => s.trim()).filter(Boolean);
      return { entries: paths.map((full) => ({ name: path.posix.basename(full), full, dir: false, size: 0, mtime: 0 })) };
    }
    const root = this.pcPath(p);
    const res = [];
    const low = needle.toLowerCase();
    const stack = [[root, 0]];
    let seen = 0;
    while (stack.length && res.length < 200 && seen < 6000) {
      const [dir, depth] = stack.pop();
      let items = [];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of items) {
        seen++;
        const full = path.join(dir, d.name);
        if (d.name.toLowerCase().includes(low)) res.push({ name: d.name, full, dir: d.isDirectory(), size: 0, mtime: 0 });
        if (d.isDirectory() && depth < 6 && !d.name.startsWith('.') && d.name !== 'node_modules' && d.name !== 'AppData') stack.push([full, depth + 1]);
      }
    }
    return { entries: res };
  }

  // ------------------------------------------------------------------ read

  /** Stream a file (PC files honour Range, so videos can seek). */
  raw(src, p, req, res) {
    const type = MIME[path.extname(String(p)).toLowerCase()] || 'application/octet-stream';
    if (src === 'quest') {
      const file = this.questPath(p);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      const proc = spawn(this.adbBin, ['-s', this.serial(), 'exec-out', `cat ${q(file)}`], { windowsHide: true });
      proc.stdout.pipe(res);
      req.on('close', () => proc.kill());
      return;
    }
    const file = this.pcPath(p);
    const st = fs.statSync(file);
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    }
  }

  /** A 320px JPEG preview of an image or a video's first second. */
  async thumb(src, p) {
    const key = `${src}:${p}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    if (!IMAGE.test(p) && !VIDEO.test(p)) throw err('No preview for this file', 404);
    let args;
    let input = null;
    if (src === 'quest') {
      if (VIDEO.test(p)) throw err('No preview for headset videos', 404);
      input = await new Promise((resolve, reject) => {
        const proc = spawn(this.adbBin, ['-s', this.serial(), 'exec-out', `cat ${q(this.questPath(p))}`], { windowsHide: true });
        const chunks = [];
        let size = 0;
        proc.stdout.on('data', (c) => {
          size += c.length;
          if (size > 40 * 1024 * 1024) proc.kill();
          else chunks.push(c);
        });
        proc.on('exit', () => (chunks.length ? resolve(Buffer.concat(chunks)) : reject(err('Could not read it', 500))));
        proc.on('error', reject);
      });
      args = ['-i', 'pipe:0'];
    } else args = VIDEO.test(p) ? ['-ss', '1', '-i', this.pcPath(p)] : ['-i', this.pcPath(p)];
    const jpg = await new Promise((resolve, reject) => {
      const ff = spawn(this.ffmpegBin, ['-hide_banner', '-loglevel', 'error', ...args, '-frames:v', '1', '-vf', "scale='min(320,iw)':-2", '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'], { windowsHide: true });
      const chunks = [];
      ff.stdout.on('data', (c) => chunks.push(c));
      ff.on('exit', (code) => (code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(err('No preview', 404))));
      ff.on('error', reject);
      ff.stdin.on('error', () => {});
      if (input) ff.stdin.end(input);
      else ff.stdin.end();
    });
    this.thumbs.set(key, jpg);
    if (this.thumbs.size > 300) this.thumbs.delete(this.thumbs.keys().next().value);
    return jpg;
  }

  // ------------------------------------------------------------------ change

  async mkdir(src, dir, name) {
    const n = cleanName(name);
    if (src === 'quest') return this.sh(`mkdir -p ${q(path.posix.join(this.questPath(dir), n))}`);
    fs.mkdirSync(path.join(this.pcPath(dir), n), { recursive: true });
  }

  async rename(src, p, name) {
    const n = cleanName(name);
    if (src === 'quest') {
      const from = this.questPath(p);
      return this.sh(`mv ${q(from)} ${q(path.posix.join(path.posix.dirname(from), n))}`);
    }
    const from = this.pcPath(p);
    fs.renameSync(from, path.join(path.dirname(from), n));
  }

  async remove(src, paths) {
    const list = [].concat(paths || []);
    if (!list.length) return;
    if (src === 'quest') return this.sh(`rm -rf ${list.map((p) => q(this.questPath(p))).join(' ')}`);
    // to the Recycle Bin, so a slip of the finger can be undone
    const files = list.map((p) => this.pcPath(p));
    const script =
      'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
      'foreach ($p in ($env:QM_PATHS | ConvertFrom-Json)) { ' +
      "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } " +
      "else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } }";
    await new Promise((resolve, reject) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 120000, env: { ...process.env, QM_PATHS: JSON.stringify(files) } }, (e, out, se) =>
        e ? reject(err((se || e.message).toString().trim().split('\n')[0], 500)) : resolve()
      )
    );
  }

  /** Copy or move items into a folder, on the same side or across (PC ⇄ Quest). */
  async copy(src, paths, dest, move = false) {
    const list = [].concat(paths || []);
    const dsrc = dest && dest.src;
    if (!list.length || !dsrc) throw err('Nothing to paste');
    const ddir = dsrc === 'quest' ? this.questPath(dest.dir) : this.pcPath(dest.dir);
    const taken = new Set((await this.list(dsrc, ddir)).entries.map((e) => e.name));
    const unique = (base) => {
      if (!taken.has(base)) return base;
      const ext = path.extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      for (let i = 2; ; i++) if (!taken.has(`${stem} (${i})${ext}`)) return `${stem} (${i})${ext}`;
    };
    for (const p of list) {
      const base = src === 'quest' ? path.posix.basename(p) : path.basename(p);
      const name = unique(base);
      taken.add(name);
      if (src === 'quest' && dsrc === 'quest') {
        const to = path.posix.join(ddir, name);
        await this.sh(`${move ? 'mv' : 'cp -r'} ${q(this.questPath(p))} ${q(to)}`, { timeout: 600000 });
      } else if (src === 'pc' && dsrc === 'pc') {
        const from = this.pcPath(p);
        const to = path.join(ddir, name);
        if (move) {
          try {
            fs.renameSync(from, to);
          } catch {
            fs.cpSync(from, to, { recursive: true });
            fs.rmSync(from, { recursive: true, force: true });
          }
        } else fs.cpSync(from, to, { recursive: true });
      } else if (src === 'pc' && dsrc === 'quest') {
        await this.adb(['push', this.pcPath(p), path.posix.join(ddir, name)], { timeout: 1800000 });
        if (move) await this.remove('pc', [p]);
      } else {
        await this.adb(['pull', this.questPath(p), path.join(ddir, name)], { timeout: 1800000 });
        if (move) await this.remove('quest', [p]);
      }
    }
  }
}

function cleanName(name) {
  const n = String(name || '').trim();
  if (!n || /[\\/:*?"<>|]/.test(n) || n === '.' || n === '..') throw err('That name has characters a file name cannot have');
  return n;
}

module.exports = { Files };
