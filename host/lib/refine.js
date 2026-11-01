'use strict';
// Refining a scan on the PC with LingBot-Map: the headset sends the pictures it took while you
// scanned (with where the camera was), this runs tools/lingbot_refine.py in its own Python
// environment, and the dense, coloured result is saved as a model. Available only when LingBot-Map
// is installed (see README: %LOCALAPPDATA%\UTSUSHI\lingbot).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(process.env.LOCALAPPDATA || os.homedir(), 'UTSUSHI', 'lingbot');
const PY = path.join(ROOT, 'venv', 'Scripts', 'python.exe');
const REPO = path.join(ROOT, 'lingbot-map');
const CKPT = path.join(ROOT, 'lingbot-map.pt');
const SCRIPT = path.join(__dirname, '..', 'tools', 'lingbot_refine.py');

let busy = false;

function available() {
  try {
    return fs.existsSync(PY) && fs.existsSync(path.join(REPO, 'demo.py')) && fs.statSync(CKPT).size > 4e9;
  } catch {
    return false;
  }
}

/** { frames: [{ jpg (base64), c2w: [16, row-major] }], box: { w2box: [16, row-major], side } } → saved model */
async function refine(body, modelsDir) {
  if (!available()) throw Object.assign(new Error('LingBot-Map is not installed on this PC'), { status: 501 });
  if (busy) throw Object.assign(new Error('A scan is already being refined'), { status: 409 });
  const frames = Array.isArray(body.frames) ? body.frames.slice(0, 120) : [];
  if (frames.length < 8) throw Object.assign(new Error('Too few pictures: scan a little longer'), { status: 400 });
  busy = true;
  const job = fs.mkdtempSync(path.join(os.tmpdir(), 'utsushi-refine-'));
  try {
    fs.mkdirSync(path.join(job, 'frames'));
    const list = frames.map((f, i) => {
      const name = `${String(i).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(job, 'frames', name), Buffer.from(String(f.jpg || ''), 'base64'));
      return { name, c2w: f.c2w };
    });
    fs.writeFileSync(path.join(job, 'job.json'), JSON.stringify({ frames: list, box: body.box }));
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const file = `scan-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-refined.ply`;
    fs.mkdirSync(modelsDir, { recursive: true });
    const out = path.join(modelsDir, file);
    const log = await new Promise((resolve, reject) => {
      const proc = spawn(PY, [SCRIPT, '--job', job, '--model', CKPT, '--out', out], { cwd: REPO, windowsHide: true });
      let text = '';
      proc.stdout.on('data', (b) => (text += b));
      proc.stderr.on('data', (b) => (text += b));
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(`LingBot-Map stopped (${code}): ${text.trim().split('\n').slice(-2).join(' ')}`))));
    });
    const last = log.trim().split('\n').pop();
    let info = {};
    try {
      info = JSON.parse(last);
    } catch {}
    return { file, url: `/api/space/model/${encodeURIComponent(file)}`, bytes: fs.statSync(out).size, ...info };
  } finally {
    busy = false;
    fs.rmSync(job, { recursive: true, force: true });
  }
}

module.exports = { refine, available };
