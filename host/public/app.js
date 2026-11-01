(function () {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  let status = null;
  let lastFrameSeen = 0;
  let pollMode = false;
  let pollTimer = null;
  const viewerId = Math.random().toString(36).slice(2);

  // ------------------------------------------------------------------ theme
  const storedTheme = () => {
    try {
      return localStorage.getItem('qm_theme');
    } catch {
      return null;
    }
  };
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'night' ? '#0c0c0e' : '#e7e6e1';
    $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.themePick === t));
  }
  applyTheme(storedTheme() || 'paper');
  $$('#themeSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      try {
        localStorage.setItem('qm_theme', b.dataset.themePick);
      } catch {}
      applyTheme(b.dataset.themePick);
      if (status && status.you.owner) api('api/settings', { theme: b.dataset.themePick }).catch(() => {});
    })
  );

  // ------------------------------------------------------------------ api
  async function api(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(path, opts);
    if (res.status === 401) {
      showPinGate();
      throw new Error('PIN required');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast' + (bad ? ' bad' : '')), bad ? 4500 : 2200);
  }
  const report = (e) => toast(e.message || String(e), true);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ------------------------------------------------------------------ video
  const video = $('#video');

  // A tab nobody can see doesn't pull the picture (and doesn't count as a viewer).
  const hidden = () => document.visibilityState === 'hidden';
  function startStream() {
    stopPolling();
    if (hidden()) return;
    video.src = `stream.mjpg?v=${viewerId}&t=${Date.now()}`;
  }
  document.addEventListener('visibilitychange', () => {
    if (!hidden()) return startStream();
    stopPolling();
    video.removeAttribute('src');
  });
  function startPolling() {
    if (hidden()) return;
    pollMode = true;
    video.removeAttribute('src');
    const next = () => {
      const img = new Image();
      img.onload = () => {
        video.src = img.src;
        lastFrameSeen = Date.now();
        pollTimer = setTimeout(next, 90);
      };
      img.onerror = () => (pollTimer = setTimeout(next, 800));
      img.src = `snapshot.jpg?viewer=${viewerId}&t=${Date.now()}`;
    };
    next();
  }
  function stopPolling() {
    pollMode = false;
    clearTimeout(pollTimer);
  }

  video.addEventListener('error', () => {
    if (!pollMode) setTimeout(startStream, 1500);
  });
  // MJPEG <img> only fires 'load' once in some browsers, so watch the decoded size instead.
  setInterval(() => {
    if (!pollMode && video.naturalWidth > 0) lastFrameSeen = Date.now();
  }, 500);
  // Browsers that can't show MJPEG fall back to fast snapshot polling.
  let liveSince = 0;
  setInterval(() => {
    if (!status || pollMode) return;
    if (status.capture.state !== 'live') {
      liveSince = 0;
      return;
    }
    if (!liveSince) liveSince = Date.now();
    if (Date.now() - liveSince > 6000 && video.naturalWidth === 0) startPolling();
  }, 1000);

  // HUD clock
  const pad = (n) => String(n).padStart(2, '0');
  setInterval(() => {
    const d = new Date();
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    $('#hudBR').textContent = t;
    $('#ovClock').textContent = t;
  }, 1000);

  // ------------------------------------------------------------------ status
  // The PC pops up a dashboard when a Quest is looking for its code and none is in view, so tell
  // it whether this tab can be seen (reconnecting is cheap; it's the same machine).
  let es = null;
  function connectEvents() {
    if (es) es.close();
    try {
      es = new EventSource(`api/events?v=${document.visibilityState === 'hidden' ? 0 : 1}`);
    } catch {
      return pollStatus();
    }
    const mine = es;
    es.onmessage = (ev) => applyStatus(JSON.parse(ev.data));
    es.onerror = () => {
      if (es !== mine) return;
      es.close();
      es = null;
      setOverlay({ code: 'LINK // LOST', title: 'Lost the PC', text: 'Is UTSUSHI still running on the PC? Reconnecting…', busy: true });
      setTimeout(async () => {
        try {
          await api('api/status');
          connectEvents();
        } catch {
          setTimeout(connectEvents, 3000);
        }
      }, 1500);
    };
  }
  document.addEventListener('visibilitychange', () => {
    if (es) connectEvents();
  });
  async function pollStatus() {
    try {
      applyStatus(await api('api/status'));
    } catch {}
    setTimeout(pollStatus, 2000);
  }

  let overlayTimer = null;
  function setOverlay(o) {
    const el = $('#overlay');
    if (!o) {
      // Fade away when the picture arrives, rather than cutting.
      if (el.classList.contains('hidden') || el.classList.contains('fading')) return;
      el.classList.add('fading');
      overlayTimer = setTimeout(() => el.classList.add('hidden'), 450);
      return;
    }
    clearTimeout(overlayTimer);
    el.classList.remove('hidden', 'fading');
    $('#ovCode').textContent = o.code || 'SYS // LINK';
    $('#overlayTitle').textContent = o.title;
    $('#overlayText').textContent = o.text || '';
    $('#ovRing').classList.toggle('idle', !o.busy);
    $('.scanbar').classList.toggle('idle', !o.busy);
    const steps = $('#overlaySteps');
    steps.hidden = !o.steps;
    if (o.steps) {
      const html = o.steps.map((s) => (typeof s === 'string' ? `<li><span>${s}</span></li>` : `<li class="${s.cls}"><span>${s.t}</span></li>`)).join('');
      if (steps.innerHTML !== html) steps.innerHTML = html;
    }
    const btn = $('#overlayAction');
    btn.hidden = !o.action;
    if (o.action) {
      btn.textContent = o.action.label;
      btn.onclick = o.action.run;
    }
  }

  const VIEW_NAME = { left: 'LEFT EYE', right: 'RIGHT EYE', both: 'STEREO' };
  let lastStreamKick = 0;

  let uiBuild = null;
  function applyStatus(s) {
    // The PC app was updated while this tab stayed open: load the new dashboard.
    if (s.build && uiBuild && s.build !== uiBuild) return location.reload();
    uiBuild = uiBuild || s.build;
    const prev = status;
    status = s;
    const { device, capture, settings, you } = s;
    const frameFresh = Date.now() - lastFrameSeen < 2500;
    const link = device.transport === 'wifi' ? 'WI-FI' : 'USB';
    if (!storedTheme() && settings.theme) applyTheme(settings.theme);

    // pill + meta line
    const pill = $('#statusPill');
    let text = 'OFFLINE', cls = '';
    if (!device.connected) text = 'NO HEADSET';
    else if (settings.paused) (text = 'PAUSED'), (cls = 'warn');
    else if (capture.dark) (text = capture.worn ? 'HIDDEN' : 'RESTING'), (cls = 'warn');
    else if (capture.state === 'live' && frameFresh) (text = `LIVE ${capture.fps}FPS`), (cls = 'live');
    else if (capture.state === 'error') (text = 'NO SIGNAL'), (cls = 'warn');
    else (text = 'STANDBY'), (cls = 'warn');
    $('span', pill).textContent = text;
    pill.className = 'pill ' + cls;
    $('#metaLine').textContent = device.connected
      ? [device.model, link, device.battery != null ? `BAT ${device.battery}%` : null, `${capture.viewers} WATCHING`].filter(Boolean).join(' · ')
      : '';
    $('#hudTL').textContent = `CH-01 // ${VIEW_NAME[settings.view] || ''}`;
    $('#hudBL').textContent = capture.out ? `${capture.out.replace('x', '×')} · ${capture.fps}FPS · ${link}` : '—';

    // waiting / setup screen
    if (!device.connected) {
      if (device.unauthorized) {
        setOverlay({
          code: 'SETUP // ALMOST',
          title: 'Press “Allow” in the headset',
          text: 'Put the Quest on — a prompt is waiting for you.',
          steps: [
            { cls: 'ok', t: 'Quest plugged in' },
            { cls: 'now', t: 'Tick <b>Always allow from this computer</b>, then <b>Allow</b>' },
            { cls: '', t: 'Install & open the <b>UTSUSHI</b> app' },
          ],
          busy: true,
        });
      } else if (device.wirelessIp) {
        setOverlay({
          code: 'LINK // WI-FI',
          title: 'Looking for your Quest',
          text: `Calling ${device.wirelessIp} over Wi-Fi…`,
          steps: ['Make sure the headset is <b>on</b> and on the same Wi-Fi as this PC', 'Restarted the Quest? <b>Plug the cable in once</b> — it switches back to Wi-Fi by itself'],
          busy: true,
        });
      } else if (you.local) {
        setOverlay({
          code: 'SETUP // WELCOME',
          title: 'Let’s connect your Quest',
          text: 'One-time setup, about 2 minutes. Each step ticks off by itself.',
          steps: [
            { cls: 'ok', t: '<b>Developer Mode</b> on (Meta Horizon phone app → Devices)' },
            { cls: 'now', t: '<b>Plug the Quest into this PC</b> with a USB cable' },
            { cls: '', t: 'Press <b>Allow</b> in the headset' },
            { cls: '', t: 'Install & open the <b>UTSUSHI</b> app' },
          ],
          busy: true,
        });
      } else {
        setOverlay({ code: 'FEED // OFFLINE', title: 'Waiting for the headset', text: 'The Quest isn’t connected to the PC right now. This page updates by itself.', busy: true });
      }
    } else if (settings.paused) {
      setOverlay({
        code: 'FEED // HOLD',
        title: 'Mirroring paused',
        text: 'The headset view is not being captured.',
        action: you.canControl ? { label: '▶ Resume', run: () => saveSettings({ paused: false }) } : null,
      });
    } else if (capture.dark && capture.worn) {
      setOverlay({
        code: 'FEED // HIDDEN BY QUEST',
        title: 'Quest is hiding the picture',
        text: 'The headset is on, but Horizon OS is blacking out recordings on purpose: a PIN prompt is open (a locked app asking for its PIN) or another private system pop-up. Enter the PIN or close the prompt and the picture comes back. If it stays black, the pop-up is stuck: restart the Quest (hold the power button → Restart).',
      });
    } else if (capture.dark) {
      setOverlay({
        code: 'FEED // HEADSET RESTING',
        title: 'The headset is resting',
        text: 'It shows a black picture while nobody wears it or it lies still. Put it on or pick it up — the picture comes back by itself.',
      });
    } else if (!frameFresh && capture.state === 'error') {
      setOverlay({ code: 'FEED // NO SIGNAL', title: 'Waiting for picture', text: capture.message, busy: true });
    } else if (!frameFresh) {
      setOverlay({ code: 'FEED // SYNC', title: 'Starting the mirror', text: `${device.model || 'Quest'} linked over ${link}.`, busy: true });
    } else setOverlay(null);

    // Stream dropped while we were showing the overlay: reconnect.
    if (!pollMode && prev && !frameFresh && capture.state === 'live' && Date.now() - lastStreamKick > 8000) {
      lastStreamKick = Date.now();
      startStream();
    }

    video.classList.toggle('waiting', !frameFresh);
    setSeg('#viewSeg2', 'view', settings.view);
    setSeg('#qualitySeg', 'quality', settings.quality);
    $('#controlBlocked').hidden = you.canControl;
    $$('.owner-only').forEach((el) => (el.hidden = !you.local));
    accDefaults(s);
    if (!settingsDirty) syncSettingsInputs(settings);
    if (you.local) {
      renderLink();
      renderPairing();
      renderNext();
      updateLinkOverlay();
    }
    renderShare();
    renderSummaries();
    updateNudge();
    $('#versionLine').textContent = `UTSUSHI ${s.version} // HOST ${s.hostName || ''}`;
  }

  function setSeg(sel, key, value) {
    $$(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset[key] === value));
  }

  // ------------------------------------------------------------------ settings
  let settingsDirty = false;
  let saveTimer = null;
  let pending = {};
  function saveSettings(patch, delay = 0) {
    Object.assign(pending, patch);
    settingsDirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const p = pending;
      pending = {};
      try {
        await api('api/settings', p);
      } catch (e) {
        report(e);
      }
      setTimeout(() => (settingsDirty = false), 600);
    }, delay);
  }

  function syncSettingsInputs(st) {
    $('#zoom').value = st.zoom;
    $('#zoomVal').textContent = `${Number(st.zoom).toFixed(2)}×`;
    $('#offsetX').value = st.offsetX;
    $('#offsetY').value = st.offsetY;
    $('#maxFps').value = st.maxFps;
    $('#fpsVal').textContent = `${st.maxFps} FPS`;
    $('#lensFix').checked = st.lensFix;
    $('#paused').checked = st.paused;
    $('#allowControl').checked = st.allowControl;
    $('#keepAwake').checked = st.keepAwake;
    $('#autoWireless').checked = st.autoWireless;
    if (st.pcShare !== undefined) $('#pcShare').checked = st.pcShare;
    if (document.activeElement !== $('#pin') && st.pin !== undefined) $('#pin').value = st.pin;
    const both = st.view === 'both';
    $('#lensFix').disabled = $('#zoom').disabled = $('#offsetX').disabled = $('#offsetY').disabled = both;
  }

  $$('#viewSeg2 button').forEach((b) => b.addEventListener('click', () => saveSettings({ view: b.dataset.view })));
  $$('#qualitySeg button').forEach((b) => b.addEventListener('click', () => saveSettings({ quality: b.dataset.quality })));
  ['zoom', 'offsetX', 'offsetY', 'maxFps'].forEach((id) => {
    $('#' + id).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (id === 'zoom') $('#zoomVal').textContent = `${v.toFixed(2)}×`;
      if (id === 'maxFps') $('#fpsVal').textContent = `${v} FPS`;
      saveSettings({ [id]: v }, 400);
    });
  });
  ['lensFix', 'paused', 'allowControl', 'keepAwake', 'pcShare', 'autoWireless'].forEach((id) =>
    $('#' + id).addEventListener('change', (e) => saveSettings({ [id]: e.target.checked }))
  );
  $('#pin').addEventListener('change', (e) => saveSettings({ pin: e.target.value.trim() }));
  $('#resetView').addEventListener('click', () => saveSettings({ zoom: 1, offsetX: 0, offsetY: 0 }));
  $('#autostart').addEventListener('change', async (e) => {
    try {
      const r = await api('api/setup/autostart', { enable: e.target.checked });
      toast(r.enabled ? 'Starts with Windows' : 'Autostart off');
    } catch (err) {
      report(err);
    }
  });

  // ------------------------------------------------------------------ link checklist (PC only)
  function renderLink() {
    const { device, agent, apkAvailable, autostart, pc } = status;
    const steps = [
      { ok: device.connected, now: !device.connected, t: 'Quest found', d: device.connected ? `${device.model} · ${device.transport === 'wifi' ? 'Wi-Fi' : 'USB cable'}` : device.unauthorized ? 'Accept the prompt in the headset' : 'Plug in by USB once', v: device.battery != null ? `${device.battery}%` : '' },
      { ok: device.appInstalled, now: device.connected && !device.appInstalled, t: 'Quest app installed', d: device.appInstalled ? (agent.connected ? 'Running' : 'Installed') : device.installing ? 'Installing…' : 'Installs by itself' },
      { ok: device.connected && device.wifiPresent, now: device.connected && !device.wifiPresent && device.switching, t: 'Wireless', d: device.wifiPresent ? `Cable optional (${device.wirelessIp || device.wifiIp})` : device.wifiIp ? 'Switches automatically' : 'Quest is not on Wi-Fi' },
      { ok: agent.accessibility, now: false, t: 'Panel control', d: agent.accessibility ? 'Viewers can click inside 2D apps' : 'Optional' },
      { ok: pc.streams > 0, now: false, t: 'PC in the Quest', d: pc.streams ? `${pc.streams} screen${pc.streams > 1 ? 's' : ''} open${pc.audio && pc.audio.listeners ? ' · sound on' : ''}` : 'Open a screen from the Quest app' },
    ];
    const html = steps.map((s) => `<li class="${s.ok ? 'ok' : s.now ? 'now' : ''}"><span><b>${s.t}</b><small>${esc(s.d)}</small></span><span class="val">${s.v || (s.ok ? 'OK' : '')}</span></li>`).join('');
    if ($('#linkSteps').innerHTML !== html) $('#linkSteps').innerHTML = html;

    $('#autostartRow').hidden = !(autostart && autostart.supported);
    if (autostart && document.activeElement !== $('#autostart')) $('#autostart').checked = autostart.enabled;

    const actions = $('#setupActions');
    const key = JSON.stringify([device.connected, device.transport, device.wifiPresent, device.appInstalled, device.controlEnabled, agent.accessibility, device.wirelessIp, apkAvailable]);
    if (actions.dataset.key === key) return;
    actions.dataset.key = key;
    actions.innerHTML = '';
    const add = (label, run, cls = '') => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.onclick = async () => {
        b.disabled = true;
        try {
          await run();
        } catch (e) {
          report(e);
        }
        b.disabled = false;
      };
      actions.appendChild(b);
    };
    if (device.connected && !device.appInstalled && apkAvailable) {
      add('Install the Quest app', async () => {
        toast('Installing on the headset…');
        const r = await api('api/setup/install-app', {});
        toast(r.ok ? 'Installed. Open UTSUSHI from Library → Unknown Sources' : 'Install failed: ' + r.output, !r.ok);
      }, 'primary');
    }
    if (device.connected && device.appInstalled && !device.controlEnabled) {
      add('Turn on panel control', async () => {
        await api('api/setup/enable-control', {});
        toast('Panel control on');
      });
    }
    if (device.connected && device.transport === 'usb' && !device.wifiPresent && !status.settings.autoWireless) {
      add('Go wireless now', async () => {
        const r = await api('api/wireless', { enable: true });
        toast(`Wi-Fi on (${r.ip}). Unplug the cable whenever`);
      });
    }
    if (device.wirelessIp) {
      add('Forget Wi-Fi link', async () => {
        await api('api/wireless', { enable: false });
        toast('Wi-Fi link forgotten');
      }, 'danger');
    }
  }

  // ------------------------------------------------------------------ pairing (PC only)
  let shownRequest = null;
  $('#bigCodeBtn').addEventListener('click', () => openLinkOverlay(true));
  $('#unlinkQuest').addEventListener('click', async () => {
    if (!confirm('Unlink the Quest? Open PC screens in the headset close right away. You can link again any time.')) return;
    try {
      await api('api/pc/unlink', {});
      toast('Quest unlinked');
    } catch (e) {
      report(e);
    }
  });

  function renderPairing() {
    const pc = status.pc;
    $('#unlinkQuest').hidden = !pc.appLinked;
    $('#pairCode').textContent = pc.pairCode || '––––––';
    // QR = link page on this PC's LAN address with the one-time code; the Quest scans it to link.
    const lan = status.urls.find((u) => !u.virtual) || status.urls[0];
    const qrText = lan && pc.pairCode ? `${lan.url}/link?c=${pc.pairCode}` : '';
    if ($('#pairQr').dataset.text !== qrText) {
      $('#pairQr').dataset.text = qrText;
      let svg = '';
      try {
        svg = qrText ? window.QR.toSvg(qrText) : '';
      } catch {}
      $('#pairQr').innerHTML = svg;
      $('#nextQr').innerHTML = svg;
    }
    $('#pcStatus').textContent = !pc.supported
      ? 'NEEDS THE HOST ON WINDOWS'
      : pc.streams
        ? `${pc.streams} SCREEN${pc.streams > 1 ? 'S' : ''} IN THE QUEST${pc.audio && pc.audio.listeners ? ' · SOUND ON' : ''}`
        : 'NO SCREEN OPEN IN THE QUEST';
    const req = (pc.requests || [])[0];
    if (!req) {
      $('#pairGate').hidden = true;
      shownRequest = null;
      return;
    }
    if (shownRequest === req.id) return;
    shownRequest = req.id;
    $('#pairDevice').textContent = req.device;
    $('#pairCheck').textContent = req.check;
    $('#pairGate').hidden = false;
    $('#pairAllow').focus();
  }
  async function decide(allow) {
    const id = shownRequest;
    $('#pairGate').hidden = true;
    try {
      await api('api/pc/pair-decide', { id, allow });
      toast(allow ? 'Quest linked. Open a screen from the headset' : 'Request denied', !allow);
    } catch (e) {
      report(e);
    }
  }
  $('#pairAllow').addEventListener('click', () => decide(true));
  $('#pairDeny').addEventListener('click', () => decide(false));

  // ------------------------------------------------------------------ share
  let shareKey = '';
  function renderShare() {
    const urls = status.urls.filter((u) => !u.virtual);
    const list = urls.length ? urls : status.urls;
    const key = list.map((u) => u.url).join();
    if (key === shareKey) return;
    shareKey = key;
    const box = $('#shareUrls');
    if (!list.length) {
      box.innerHTML = '<p class="hint">This PC is not on a network.</p>';
      return;
    }
    const main = list[0];
    let qr = '';
    try {
      qr = `<div class="qr" title="Scan with a phone">${window.QR.toSvg(main.url)}</div>`;
    } catch {}
    box.innerHTML =
      qr +
      `<a href="${main.url}" target="_blank" rel="noopener">${main.url.replace('http://', '')}</a>` +
      `<span class="alt">OPEN IN ANY BROWSER ON THE SAME WI-FI</span>` +
      list.slice(1).map((u) => `<span class="alt">${u.url.replace('http://', '')} (${esc(u.name)})</span>`).join('');
  }

  // ------------------------------------------------------------------ drawers
  // Drawers slide in, and slide out again instead of vanishing.
  function setDrawer(el, show) {
    if (show) {
      el.classList.remove('closing');
      el.hidden = false;
      return;
    }
    if (el.hidden || el.classList.contains('closing')) return;
    el.classList.add('closing');
    setTimeout(() => {
      if (el.classList.contains('closing')) {
        el.hidden = true;
        el.classList.remove('closing');
      }
    }, 230);
  }
  const isOpen = (el) => !el.hidden && !el.classList.contains('closing');
  function openDrawer(id) {
    ['#controlDrawer', '#settingsDrawer'].forEach((d) => setDrawer($(d), d === id && !isOpen($(d))));
    $('#btnControl').classList.toggle('active', isOpen($('#controlDrawer')));
    $('#btnSettings').classList.toggle('active', isOpen($('#settingsDrawer')));
    if (isOpen($('#controlDrawer')) && activeTab === 'apps' && !appsLoaded) loadApps();
    updateNudge();
  }

  // Fold-out groups: remember what was left open on this device.
  const accState = (() => {
    try {
      return JSON.parse(localStorage.getItem('qm_acc') || '{}');
    } catch {
      return {};
    }
  })();
  function setAcc(id, open, remember) {
    $('#' + id).classList.toggle('open', open);
    if (remember) {
      accState[id] = open;
      try {
        localStorage.setItem('qm_acc', JSON.stringify(accState));
      } catch {}
    }
  }
  $$('.acc').forEach((a) => $('.acc-head', a).addEventListener('click', () => setAcc(a.id, !a.classList.contains('open'), true)));
  let accDefaultsSet = false;
  function accDefaults(s) {
    if (accDefaultsSet) return;
    accDefaultsSet = true;
    const defaults = { accLink: s.you.local && !s.pc.appLinked, accShare: false, accPicture: !s.you.local, accPrivacy: false, accConn: false };
    for (const [id, open] of Object.entries(defaults)) setAcc(id, id in accState ? accState[id] : open, false);
  }
  $('#btnSpace').addEventListener('click', async () => {
    try {
      await api('/api/space/launch', {});
      toast('Opening UTSUSHI Space in the headset browser. Put the headset on and press Enter space.');
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#btnControl').addEventListener('click', () => openDrawer('#controlDrawer'));
  $('#btnSettings').addEventListener('click', () => openDrawer('#settingsDrawer'));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => openDrawer(null)));
  if (location.hash === '#pair' || location.hash === '#settings') openDrawer('#settingsDrawer');

  // ------------------------------------------------------------------ guidance: "what now?"
  /** The single next thing the PC owner should do, or null when everything is set up. */
  function setupSteps(s) {
    const d = s.device, pc = s.pc;
    return [
      { key: 'plug', label: 'Plug in', ok: d.connected || d.unauthorized },
      { key: 'allow', label: 'Allow', ok: d.connected },
      { key: 'install', label: 'Install app', ok: d.connected && d.appInstalled },
      { key: 'link', label: 'Link app', ok: !!pc.appLinked },
    ];
  }
  function nextStep(s) {
    const d = s.device;
    if (!d.connected && d.unauthorized) return { key: 'allow', title: 'Press “Allow” in the headset', text: 'Put the Quest on — a “USB debugging” prompt is waiting. Tick “Always allow”, then Allow.' };
    if (!d.connected) return { key: 'plug', title: 'Plug your Quest into this PC', text: 'Any USB-C cable. Only this once — afterwards it moves to Wi-Fi by itself.' };
    if (!d.appInstalled && d.installing) return { key: 'install', title: 'Installing the Quest app…', text: 'Putting UTSUSHI on the headset. It takes a few seconds — nothing to press.' };
    if (!d.appInstalled) return { key: 'install', title: 'Install the Quest app', text: 'It goes onto the headset by itself in a moment. In a hurry? Press the button.', action: { label: 'Install now', run: installApp } };
    if (!s.pc.appLinked) return { key: 'link', title: 'Link the Quest app', text: 'In the headset open UTSUSHI (Library → Unknown Sources) and look at the big code. Linking happens by itself.', action: { label: 'Show the big code', run: async () => openLinkOverlay(true) } };
    return null;
  }
  async function installApp() {
    toast('Installing on the headset…');
    const r = await api('api/setup/install-app', {});
    toast(r.ok ? 'Installed! Open UTSUSHI in the headset' : 'Install failed: ' + r.output, !r.ok);
  }

  let lastNextKey = '';
  function renderNext() {
    const s = status;
    const steps = setupSteps(s);
    const done = steps.filter((x) => x.ok).length;
    const next = nextStep(s);
    $('#nextBar').style.width = `${(done / steps.length) * 100}%`;
    $('#nextCount').textContent = `${done}/${steps.length}`;
    $('#nextCard').classList.toggle('done', !next);
    $('#setupBadge').hidden = !next;
    const stepsHtml = steps.map((x, i) => `<li class="${x.ok ? 'ok' : next && next.key === x.key ? 'now' : ''}">${String(i + 1).padStart(2, '0')} ${x.label}</li>`).join('');
    if ($('#nextSteps').innerHTML !== stepsHtml) $('#nextSteps').innerHTML = stepsHtml;
    const key = next ? next.key : 'done';
    if (key === lastNextKey) return;
    lastNextKey = key;
    const card = $('#nextCard');
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = 'pop .45s var(--ease)';
    if (!next) {
      $('#nextKicker').textContent = 'ALL SET';
      $('#nextTitle').textContent = 'Ready to go';
      $('#nextText').textContent = 'Open a screen from the Quest app, or open the share link on a TV or phone.';
      $('#nextQr').hidden = true;
      $('#nextAction').hidden = true;
      return;
    }
    $('#nextKicker').textContent = `NEXT STEP`;
    $('#nextTitle').textContent = next.title;
    $('#nextText').textContent = next.text;
    $('#nextQr').hidden = !next.qr;
    const btn = $('#nextAction');
    btn.hidden = !next.action;
    if (next.action) {
      btn.textContent = next.action.label;
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await next.action.run();
        } catch (e) {
          report(e);
        }
        btn.disabled = false;
      };
    }
  }

  // The nudge over the picture: one line, "Show me" opens the guide.
  let dismissed = (() => {
    try {
      return sessionStorage.getItem('qm_nudge') || '';
    } catch {
      return '';
    }
  })();
  function showNudge(next) {
    const n = $('#nudge');
    $('#nudgeTitle').textContent = next.title;
    if (!n.hidden && !n.classList.contains('leaving')) return;
    n.classList.remove('leaving');
    n.hidden = false;
  }
  /** Show the nudge only when it helps: a step is pending, Settings is closed, no full-screen guide is up. */
  function updateNudge() {
    if (!status || !status.you.local) return hideNudge();
    const next = nextStep(status);
    const overlayUp = !$('#overlay').classList.contains('hidden') && !$('#overlay').classList.contains('fading');
    if (next && dismissed !== next.key && !isOpen($('#settingsDrawer')) && !overlayUp) showNudge(next);
    else hideNudge();
  }
  function hideNudge() {
    const n = $('#nudge');
    if (n.hidden || n.classList.contains('leaving')) return;
    n.classList.add('leaving');
    setTimeout(() => {
      n.hidden = true;
      n.classList.remove('leaving');
    }, 300);
  }
  $('#nudgeGo').addEventListener('click', () => {
    openDrawer('#settingsDrawer');
    $('#settingsDrawer .drawer-scroll').scrollTop = 0;
  });
  $('#nudgeClose').addEventListener('click', () => {
    dismissed = lastNextKey;
    try {
      sessionStorage.setItem('qm_nudge', dismissed);
    } catch {}
    hideNudge();
  });

  // ------------------------------------------------------------------ big link code (Quest looks at it)
  const lo = $('#linkOverlay');
  let loOpen = false, loManual = false, loOpenedAt = 0, loDismissedAt = 0, loLinkedAtOpen = false, loText = '';
  function linkCodeText() {
    const lan = status.urls.find((u) => !u.virtual) || status.urls[0];
    if (!lan || !status.pc.pairCode) return '';
    const u = new URL(lan.url);
    // Uppercase-only payload = compact alphanumeric QR, easy for the headset camera.
    return `QM:${u.hostname}:${u.port || 80}:${status.pc.pairCode}`;
  }
  function openLinkOverlay(manual) {
    if (loOpen) return;
    loOpen = true;
    loManual = manual;
    loOpenedAt = Date.now();
    loLinkedAtOpen = !!status.pc.appLinked;
    lo.classList.remove('leaving', 'success');
    $('#loDone').hidden = true;
    $('#loTitle').textContent = 'Look at this with your Quest';
    $('#loText').innerHTML = 'In the headset open <b>UTSUSHI</b> and look at this screen. Linking happens by itself.';
    lo.hidden = false;
    loText = '';
    renderLinkOverlay();
  }
  function closeLinkOverlay() {
    if (!loOpen) return;
    loOpen = false;
    lo.classList.add('leaving');
    setTimeout(() => {
      lo.hidden = true;
      lo.classList.remove('leaving');
    }, 400);
  }
  function renderLinkOverlay() {
    const text = linkCodeText();
    if (text !== loText) {
      loText = text;
      const old = $('#loQr svg');
      if (old) old.remove();
      try {
        if (text) $('#loQr').insertAdjacentHTML('afterbegin', window.QR.toSvg(text));
      } catch {}
    }
    const scanning = status.pc.scanning;
    $('#loKicker').textContent = scanning ? `LINK // ${scanning.toUpperCase()} IS LOOKING FOR THIS CODE` : 'LINK // WAITING FOR YOUR QUEST';
    $('#loCode').textContent = status.pc.pairCode ? `OR TYPE ${status.pc.pairCode} IN THE APP` : '';
  }
  function updateLinkOverlay() {
    const pc = status.pc;
    if (!loOpen && pc.scanning && !pc.appLinked && Date.now() - loDismissedAt > 30000) openLinkOverlay(false);
    if (!loOpen) return;
    if (pc.appLinked && !loLinkedAtOpen && !lo.classList.contains('success')) {
      lo.classList.add('success');
      $('#loDone').hidden = false;
      $('#loTitle').textContent = 'Linked!';
      $('#loText').textContent = `${pc.scanning || 'Your Quest'} is linked. Pick a screen in the headset.`;
      setTimeout(closeLinkOverlay, 2600);
      return;
    }
    if (!loManual && !pc.scanning && !pc.appLinked && Date.now() - loOpenedAt > 30000) closeLinkOverlay();
    if (!lo.classList.contains('success')) renderLinkOverlay();
  }
  $('#loClose').addEventListener('click', () => {
    loDismissedAt = Date.now();
    closeLinkOverlay();
  });

  function renderSummaries() {
    const s = status;
    const st = s.settings;
    const lan = s.urls.find((u) => !u.virtual) || s.urls[0];
    $('#accShareSum').textContent = lan ? lan.url.replace('http://', '') : '';
    $('#accPicSum').textContent = `${st.quality} · ${VIEW_NAME[st.view] || ''}`.toLowerCase();
    if (s.you.local) {
      $('#accLinkSum').textContent = s.pc.appLinked ? (s.pc.appOnline ? '● linked · online' : 'linked') : 'not linked yet';
      $('#accPrivSum').textContent = `control ${st.allowControl ? 'on' : 'off'} · pin ${st.pin ? 'on' : 'off'}`;
      const d = s.device;
      $('#accConnSum').textContent = d.connected ? `${d.transport === 'wifi' ? 'wi-fi' : 'usb'}${d.battery != null ? ' · ' + d.battery + '%' : ''}` : 'no headset';
    }
  }

  let activeTab = 'remote';
  $$('.tabs button').forEach((t) =>
    t.addEventListener('click', () => {
      activeTab = t.dataset.tab;
      $$('.tabs button').forEach((b) => b.classList.toggle('active', b === t));
      $$('.tab-body').forEach((b) => (b.hidden = b.dataset.body !== activeTab));
      if (activeTab === 'apps' && !appsLoaded) loadApps();
      if (activeTab === 'panels') loadPanels();
    })
  );

  // ------------------------------------------------------------------ remote keys
  const sendKey = (key) =>
    api('api/control', { action: 'key', key })
      .then((r) => {
        if (r && r.volume != null) toast(r.muted ? 'Muted' : `Volume ${r.volume}/${r.max}`);
        // Horizon OS ignores volume keys from outside; only the Quest app can change it.
        else if (/^(volup|voldown|mute)$/.test(key)) toast('Volume needs the UTSUSHI app on the headset — waking it up, try again in a moment', true);
      })
      .catch(report);
  $$('[data-key]').forEach((b) => b.addEventListener('click', () => sendKey(b.dataset.key)));

  const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Backspace: 'back', Escape: 'back', ' ': 'playpause' };
  document.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'f' || e.key === 'F') return toggleFullscreen();
    if (isOpen($('#controlDrawer')) && activeTab === 'remote' && KEYMAP[e.key]) {
      e.preventDefault();
      sendKey(KEYMAP[e.key]);
    }
  });

  // ------------------------------------------------------------------ apps
  let appsLoaded = false;
  let apps = [];
  async function loadApps() {
    appsLoaded = true;
    $('#appGrid').innerHTML = '<p class="hint mono">LOADING APPS…</p>';
    try {
      apps = (await api('api/apps')).apps;
      renderApps();
    } catch (e) {
      appsLoaded = false;
      $('#appGrid').innerHTML = `<p class="hint">${esc(e.message)}</p>`;
    }
  }
  function renderApps() {
    const q = $('#appFilter').value.trim().toLowerCase();
    const grid = $('#appGrid');
    grid.innerHTML = '';
    const useIcons = status && status.agent.connected;
    apps
      .filter((a) => !q || a.label.toLowerCase().includes(q) || a.pkg.includes(q))
      .forEach((a) => {
        const el = document.createElement('div');
        el.className = 'app cut enter';
        el.style.animationDelay = `${Math.min(grid.children.length, 16) * 30}ms`;
        el.tabIndex = 0;
        el.title = a.pkg;
        const letter = `<div class="letter">${esc(a.label.charAt(0).toUpperCase())}</div>`;
        el.innerHTML =
          (useIcons ? `<img src="api/apps/icon?pkg=${encodeURIComponent(a.pkg)}" alt="" loading="lazy">` : letter) +
          `<span>${esc(a.label)}</span><button class="x" title="Close app" aria-label="Close ${esc(a.label)}">✕</button>`;
        const img = el.querySelector('img');
        if (img) img.onerror = () => img.replaceWith(Object.assign(document.createElement('div'), { className: 'letter', textContent: a.label.charAt(0).toUpperCase() }));
        const launch = () => api('api/control', { action: 'launch', pkg: a.pkg }).then(() => toast(`Opening ${a.label}`), report);
        el.addEventListener('click', (e) => !e.target.classList.contains('x') && launch());
        el.addEventListener('keydown', (e) => e.key === 'Enter' && launch());
        el.querySelector('.x').addEventListener('click', () => api('api/control', { action: 'close', pkg: a.pkg }).then(() => toast(`Closed ${a.label}`), report));
        grid.appendChild(el);
      });
    if (!grid.children.length) grid.innerHTML = '<p class="hint">No apps found.</p>';
  }
  $('#appFilter').addEventListener('input', renderApps);
  $('#appsReload').addEventListener('click', loadApps);

  // ------------------------------------------------------------------ type / url
  $('#typeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#typeText').value;
    if (!text && !$('#typeEnter').checked) return;
    try {
      const r = await api('api/control', { action: 'text', text, enter: $('#typeEnter').checked });
      toast(r.dropped ? 'Sent (emoji need panel control on)' : 'Sent');
      $('#typeText').value = '';
    } catch (err) {
      report(err);
    }
  });
  $('#urlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#urlText').value.trim();
    if (!url) return;
    try {
      await api('api/control', { action: 'url', url });
      toast('Opening in the Quest Browser');
    } catch (err) {
      report(err);
    }
  });

  // ------------------------------------------------------------------ panels
  let panel = null; // { id, title, w, h }
  let shotTimer = null;
  let shotBusy = false;

  async function loadPanels() {
    const list = $('#panelList');
    list.innerHTML = '<p class="hint mono">SCANNING…</p>';
    try {
      const wins = (await api('api/panels')).windows || [];
      list.innerHTML = '';
      if (!wins.length) list.innerHTML = '<p class="hint">No 2D app windows are open on the headset.</p>';
      wins.forEach((w, i) => {
        const b = document.createElement('button');
        b.className = 'cut';
        b.innerHTML = `<span class="mono dim">P${String(i + 1).padStart(2, '0')}</span><div><b>${esc(w.title || w.pkg)}</b><small>${esc(w.pkg)} · ${w.w}×${w.h}${w.focused ? ' · FOCUSED' : ''}</small></div>`;
        b.onclick = () => openPanel(w);
        list.appendChild(b);
      });
    } catch (e) {
      list.innerHTML = `<p class="hint">${esc(
        /agent|not running|did not respond|Panel control is off/i.test(e.message)
          ? 'Panel control needs the UTSUSHI app with panel control turned on (on the PC: Settings → Connection → Turn on panel control).'
          : e.message
      )}</p>`;
    }
  }
  $('#panelsReload').addEventListener('click', loadPanels);

  function openPanel(w) {
    panel = { id: w.id, title: w.title || w.pkg, w: w.w, h: w.h };
    $('#panelTitle').textContent = `PANEL // ${panel.title}`;
    $('#panelView').hidden = false;
    openDrawer(null);
    refreshShot();
  }
  function closePanel() {
    panel = null;
    clearTimeout(shotTimer);
    $('#panelView').hidden = true;
  }
  $('[data-close-panel]').addEventListener('click', closePanel);

  async function refreshShot() {
    clearTimeout(shotTimer);
    if (!panel || shotBusy) return;
    shotBusy = true;
    const id = panel.id;
    try {
      const res = await fetch(`api/panels/shot?id=${id}&t=${Date.now()}`);
      if (res.ok) {
        const blob = await res.blob();
        const img = $('#panelImg');
        const old = img.src;
        img.src = URL.createObjectURL(blob);
        if (old.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(old), 1000);
      } else if (res.status === 404) {
        shotBusy = false;
        toast('That app window was closed', true);
        return closePanel();
      }
    } catch {}
    shotBusy = false;
    if (panel && panel.id === id) shotTimer = setTimeout(refreshShot, 380);
  }

  function panelPoint(e) {
    const img = $('#panelImg');
    const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    const rip = $('#panelRipple');
    const cr = img.parentElement.getBoundingClientRect();
    rip.style.left = `${e.clientX - cr.left}px`;
    rip.style.top = `${e.clientY - cr.top}px`;
    rip.classList.remove('go');
    void rip.offsetWidth;
    rip.classList.add('go');
    return { x: Math.round(fx * panel.w), y: Math.round(fy * panel.h) };
  }
  async function panelAction(body) {
    try {
      const r = await api('api/panels/action', { id: panel.id, ...body });
      if (r && r.ok === false && r.message) toast(r.message, true);
    } catch (e) {
      report(e);
    }
    setTimeout(refreshShot, 150);
  }
  $('#panelImg').addEventListener('click', (e) => {
    const p = panelPoint(e);
    if (p) panelAction({ type: 'tap', ...p });
  });
  $('#panelImg').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = panelPoint(e);
    if (p) panelAction({ type: 'longpress', ...p });
  });
  let wheelLock = 0;
  $('#panelImg').addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (Date.now() - wheelLock < 350) return;
      wheelLock = Date.now();
      const img = $('#panelImg').getBoundingClientRect();
      const x = Math.round(((e.clientX - img.left) / img.width) * panel.w);
      const y = Math.round(((e.clientY - img.top) / img.height) * panel.h);
      const dir = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? (e.deltaX > 0 ? 'right' : 'left') : e.deltaY > 0 ? 'down' : 'up';
      panelAction({ type: 'scroll', x, y, dir });
    },
    { passive: false }
  );
  let touchStart = null;
  $('#panelImg').addEventListener('touchstart', (e) => (touchStart = e.touches[0]), { passive: true });
  $('#panelImg').addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.clientX, dy = t.clientY - touchStart.clientY;
    if (Math.hypot(dx, dy) > 40) {
      e.preventDefault();
      const img = $('#panelImg').getBoundingClientRect();
      const x = Math.round(((touchStart.clientX - img.left) / img.width) * panel.w);
      const y = Math.round(((touchStart.clientY - img.top) / img.height) * panel.h);
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'right' : 'left') : dy < 0 ? 'down' : 'up';
      panelAction({ type: 'scroll', x, y, dir });
    }
    touchStart = null;
  });
  $('#panelTextForm').addEventListener('submit', (e) => {
    e.preventDefault();
    panelAction({ type: 'text', text: $('#panelText').value, enter: $('#panelEnter').checked });
    $('#panelText').value = '';
  });

  // ------------------------------------------------------------------ misc
  function toggleFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }
  $('#btnFull').addEventListener('click', toggleFullscreen);
  if (!document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen) $('#btnFull').hidden = true;
  $('#btnSnap').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = `snapshot.jpg?download=1&t=${Date.now()}`;
    a.download = `quest-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    a.click();
    toast('Screenshot saved');
  });
  $('#stage').addEventListener('dblclick', (e) => e.target === video && toggleFullscreen());

  // Hide the chrome after a few idle seconds (clean picture on TVs).
  let idleTimer;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const busy = isOpen($('#controlDrawer')) || isOpen($('#settingsDrawer')) || !$('#panelView').hidden || !$('#overlay').classList.contains('hidden');
      if (!busy) document.body.classList.add('idle');
    }, 3500);
  };
  ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));
  wake();

  // ------------------------------------------------------------------ PIN
  function showPinGate() {
    $('#pinGate').hidden = false;
    $('#pinInput').focus();
  }
  $('#pinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('#pinInput').value }) });
      if (!res.ok) throw new Error('WRONG PIN');
      $('#pinGate').hidden = true;
      boot();
    } catch (err) {
      $('#pinError').textContent = err.message;
    }
  });

  // ------------------------------------------------------------------ boot
  async function boot() {
    try {
      const s = await api('api/status');
      if (!s.you.authed) return showPinGate();
      applyStatus(s);
      startStream();
      connectEvents();
      if (location.hash === '#link' && s.you.local) openLinkOverlay(true);
    } catch (e) {
      if (e.message !== 'PIN required') setTimeout(boot, 2000);
    }
  }
  boot();
})();
