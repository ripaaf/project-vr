'use strict';
// "Start with Windows": a shortcut in the user's Startup folder that runs the host minimized.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const LINK = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Quest Mirror.lnk')
  : null;
const SERVER = path.join(__dirname, '..', 'server.js');
// Under the Windows app, start that (tray + host) instead of a bare node window.
const APP_EXE = process.env.QM_APP_EXE || '';

const supported = () => process.platform === 'win32' && !!LINK;

function isEnabled() {
  return supported() && fs.existsSync(LINK);
}

function setEnabled(on) {
  if (!supported()) return Promise.reject(new Error('Only on Windows'));
  if (!on) {
    try {
      fs.unlinkSync(LINK);
    } catch {}
    return Promise.resolve(false);
  }
  // Paths go in through environment variables, so no quoting games inside the script.
  const script =
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:QM_LINK);' +
    '$s.TargetPath = $env:QM_NODE; $s.Arguments = \'"\' + $env:QM_SERVER + \'"\';' +
    '$s.WorkingDirectory = $env:QM_DIR; $s.WindowStyle = 7; $s.Description = "Quest Mirror host"; $s.Save()';
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        env: APP_EXE
          ? { ...process.env, QM_LINK: LINK, QM_NODE: APP_EXE, QM_SERVER: '--background', QM_DIR: path.dirname(APP_EXE) }
          : { ...process.env, QM_LINK: LINK, QM_NODE: process.execPath, QM_SERVER: SERVER, QM_DIR: path.dirname(SERVER) },
      },
      (err) => (err ? reject(err) : resolve(isEnabled()))
    );
  });
}

module.exports = { isEnabled, setEnabled, supported };
