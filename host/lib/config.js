'use strict';
const fs = require('fs');
const path = require('path');

// The Windows app keeps settings in %APPDATA%\QuestMirror so reinstalling never loses them.
const FILE = process.env.QM_CONFIG || path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  port: 8765,
  quality: 'medium',   // low | medium | high
  view: 'left',        // left | right | both
  zoom: 1.0,           // 1.0 - 2.5, crop tighter into the eye
  offsetX: 0,          // -0.25 - 0.25, shift crop inside the eye (fraction of eye size)
  offsetY: 0,
  lensFix: true,       // undo the lens pre-distortion so straight lines look straight
  maxFps: 30,
  paused: false,       // when true nothing is captured even with viewers watching
  allowControl: true,  // viewers may send input to the headset
  keepAwake: false,    // keep the display on while the headset is not worn
  pin: '',             // optional PIN viewers must enter
  wirelessIp: '',      // last Quest Wi-Fi IP used for ADB over Wi-Fi
  preferWireless: false,
  autoWireless: true,  // when the Quest is plugged in, switch ADB to Wi-Fi so the cable can go
  theme: 'paper',      // dashboard look: paper | night
  pcShare: true,       // let the paired Quest app show this PC's screens
  pcToken: '',         // secret the Quest app uses to watch/control this PC (made on first run)
  pcLinkedAt: 0,       // when the Quest app first linked (setup checklist)
  autoInstallApp: true, // put the Quest app on the headset (and keep it updated) without a click
  apkInstalled: {},    // headset serial -> fingerprint of the APK we last installed there
};

const LIMITS = {
  quality: ['low', 'medium', 'high'],
  view: ['left', 'right', 'both'],
  zoom: [1, 2.5],
  offsetX: [-0.25, 0.25],
  offsetY: [-0.25, 0.25],
  maxFps: [5, 60],
};

let current = { ...DEFAULTS };

function load() {
  try {
    // Notepad and PowerShell like to add a BOM; JSON.parse doesn't.
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''));
    current = sanitize({ ...DEFAULTS, ...saved });
  } catch {
    current = { ...DEFAULTS };
  }
  return current;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  } catch (e) {
    console.warn('[config] could not save:', e.message);
  }
}

function sanitize(c) {
  const out = { ...c };
  for (const [k, lim] of Object.entries(LIMITS)) {
    if (Array.isArray(lim) && typeof lim[0] === 'string') {
      if (!lim.includes(out[k])) out[k] = DEFAULTS[k];
    } else {
      const n = Number(out[k]);
      out[k] = Number.isFinite(n) ? Math.min(lim[1], Math.max(lim[0], n)) : DEFAULTS[k];
    }
  }
  for (const k of ['lensFix', 'paused', 'allowControl', 'keepAwake', 'preferWireless', 'pcShare', 'autoWireless']) out[k] = !!out[k];
  if (!['paper', 'night'].includes(out.theme)) out.theme = DEFAULTS.theme;
  out.pin = String(out.pin || '').slice(0, 12);
  out.pcToken = /^[0-9a-f]{32}$/.test(out.pcToken) ? out.pcToken : '';
  out.pcLinkedAt = Number(out.pcLinkedAt) || 0;
  out.port = Number(out.port) || DEFAULTS.port;
  return out;
}

/** Merge a partial update; returns the list of keys whose value changed. */
function update(patch) {
  const next = sanitize({ ...current, ...patch });
  const changed = Object.keys(next).filter((k) => next[k] !== current[k]);
  current = next;
  if (changed.length) save();
  return changed;
}

function get() {
  return current;
}

/** Settings safe to show to any viewer (no secrets). */
function publicView() {
  const { pin, pcToken, pcLinkedAt, apkInstalled, ...rest } = current;
  return { ...rest, pinRequired: !!pin };
}

module.exports = { load, save, update, get, publicView, DEFAULTS };
