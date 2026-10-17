'use strict';
// Locate the adb and ffmpeg executables: env override, then PATH, then common install folders.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const isWin = process.platform === 'win32';
const exe = (name) => (isWin ? `${name}.exe` : name);

function onPath(name) {
  try {
    const cmd = isWin ? 'where' : 'which';
    const out = execFileSync(cmd, [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const first = out.split(/\r?\n/).find(Boolean);
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

function findAdb() {
  if (process.env.ADB && fs.existsSync(process.env.ADB)) return process.env.ADB;
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'),
  ].filter(Boolean);
  return (
    onPath(exe('adb')) ||
    firstExisting([
      path.join(__dirname, '..', '..', 'tools', 'platform-tools', exe('adb')),
      ...sdkRoots.map((r) => path.join(r, 'platform-tools', exe('adb'))),
      isWin ? 'C:\\adb\\adb.exe' : null,
      isWin ? 'C:\\platform-tools\\adb.exe' : null,
    ])
  );
}

function findFfmpeg() {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  return (
    onPath(exe('ffmpeg')) ||
    firstExisting([
      path.join(__dirname, '..', '..', 'tools', 'ffmpeg', 'bin', exe('ffmpeg')),
      isWin ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' : null,
      isWin ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe') : null,
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
    ])
  );
}

module.exports = { findAdb, findFfmpeg };
