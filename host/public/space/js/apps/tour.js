// GUIDE — how everything works, one short page per thing, each with "Try it". The first time you
// enter, it walks you through the basics and waits for you to actually do them (open the apps, take
// a photo). Later it lives in Apps › Guide. Controllers get their own wording.
import { App } from '../panels.js';
import { T, chrome, text, mono, button, cutPath, icon, hudTag, paragraph } from '../theme.js';

const TOPICS = [
  { group: 'Basics', id: 'touch', icon: 'center', title: 'Touch and pinch', hand: 'Bring a window within reach and touch it with a fingertip, or point at it from afar and pinch your thumb and index finger. Buttons light up under your pointer before you press.', ctrl: 'Point at anything and pull the trigger. The thumbstick scrolls the window you point at.' },
  { group: 'Basics', id: 'windows', icon: 'pc', title: 'Move and resize', hand: 'Pinch the grip under a window and move it; it keeps its size as it comes closer. Pull a bottom corner to resize. ✕ closes it. Raise both palms, or pinch twice, to bring every window back in front of you.', ctrl: 'Hold the grip button while pointing at a window to move it. B / Y brings every window back in front of you.' },
  { group: 'Basics', id: 'apps', icon: 'apps', title: 'Quick ring and apps', hand: 'Raise one open palm to the sky and hold it: five shortcuts fan out above your hand. The Apps tab rests below your windows, and your left wrist shows the time and four shortcuts when you look at it. Your apps also float around you as small charms: pinch one to open it, pinch and move it to put it anywhere.', ctrl: 'A / X opens the quick ring, pressing the thumbstick opens Apps. The Apps tab also rests below your windows.', wait: 'launcher', try: 'launcher' },
  { group: 'Basics', id: 'gestures', icon: 'settings', title: 'Gestures', hand: 'Swipe a hand left or right to turn the windows around you. Push an open palm toward a window to send it away. Every gesture can be switched off in Settings › Gestures.', ctrl: 'Gestures are for hands; with controllers everything is in the quick ring and Apps.', try: 'gestures' },
  { group: 'Capture and make', id: 'photo', icon: 'camera', title: 'Photos', hand: 'Make an L with each hand to frame something: the frame shows what will be taken. Curl one index finger to snap. Or open Camera, size the frame, and press the shutter.', ctrl: 'Open Camera from the quick ring, size the frame and press the shutter.', wait: 'photo', try: 'camera' },
  { group: 'Capture and make', id: 'notes', icon: 'notes', title: 'Notes, in 3D', hand: 'Type with the keyboard, sketch with the pencil, draw lines in the air with your pinch or the pencil tip, and place text cards anywhere around you; drag a card to move it, pull its corner to resize.', try: 'note' },
  { group: 'Capture and make', id: 'models', icon: 'cube', title: 'Studio: models', hand: 'Open Studio and put a model on the stage. Pull the rim to turn it, pinch the model to lift it close and turn your hand, use both hands to scale it, and 1:1 for its real size. Your room is there too, in miniature.', try: 'models' },
  { group: 'Capture and make', id: 'scan', icon: 'scan', title: 'Studio: scan a thing', hand: 'In Studio press Scan. Put the thing in the box on a table (pull its red corner to size the box), press Scan and walk slowly around it. The ring under the box fills as you cover each side. Save keeps it in Models and puts it on the stage.', try: 'scan' },
  { group: 'Connect', id: 'web', icon: 'globe', title: 'Web and YouTube', hand: 'Pages run in Edge on your PC and stream in, sound included. Pinch to click, drag up or down to scroll, drag sideways to drag a slider. The keyboard comes up when you tap a text field.', try: 'web' },
  { group: 'Connect', id: 'pc', icon: 'files', title: 'Your PC', hand: 'PC screen shows your monitors here. Files reaches both the Quest and the PC. Terminal is a real shell on the headset; type linux for Alpine Linux, where apk add installs packages. Devices talks to your ESP32 and Cardputer.', try: 'pc' },
  { group: 'Connect', id: 'alone', icon: 'room', title: 'Without the PC', hand: 'Open UTSUSHI on the Quest without the cable and the space runs on the headset by itself: notes, models, coloured scans, photos with the Quest camera, the web, your files and a terminal with a Linux toolbox all stay on the Quest. Only the PC screen and the boards need the PC.' },
];
const FIRST = ['touch', 'windows', 'apps', 'photo'];

export class Tour extends App {
  constructor() {
    super('tour', 'Guide', '', [1.1, 0.7]);
    this.at = 0;
    this.done = new Set();
  }

  opened() {
    this.first = !this.world.settings.toured;
    this.path = this.first ? FIRST : TOPICS.map((t) => t.id);
    this.at = 0;
    this.topic = this.path[0];
  }

  hands() {
    return this.world.input.pointers.some((p) => p.active && p.isHand) || !this.world.xrActive;
  }

  get t() {
    return TOPICS.find((x) => x.id === this.topic);
  }

  /** Called by the world for gestures, the launcher and photos. */
  signal(kind) {
    if (!this.panel || this.panel.state !== 'open') return;
    const t = this.t;
    if (t.wait && t.wait === kind && !this.done.has(t.id)) {
      this.done.add(t.id);
      this.world.sound.chime(this.panel.group.position, this.at);
      if (this.first) setTimeout(() => this.next(), 900);
      this.invalidate();
    }
  }

  next() {
    const i = this.path.indexOf(this.topic);
    if (i < this.path.length - 1) this.topic = this.path[i + 1];
    else if (this.first) return this.finish();
    else this.topic = this.path[0];
    this.invalidate();
  }

  finish() {
    this.world.panels.close(this);
    this.world.tourDone();
  }

  tryIt(what) {
    const W = this.world;
    const A = W.apps;
    if (what === 'launcher') {
      if (!W.launcher.expanded) W.launcher.toggle();
    } else if (what === 'camera') W.cameraBox.open();
    else if (what === 'gestures') {
      A.set.section = 'gestures';
      W.panels.open(A.set);
    } else if (what === 'note') W.quick.choose('note');
    else if (what === 'models') {
      W.panels.open(A.models);
      A.models.sel = { type: 'sample', id: 'room' };
      A.models.show();
    } else if (what === 'scan') W.scanner.open();
    else if (what === 'web') W.panels.open(A.web);
    else if (what === 'pc') W.panels.open(A.pc);
  }

  click(id, data) {
    if (id === 'topic') this.topic = data;
    else if (id === 'next') this.next();
    else if (id === 'try') this.tryIt(this.t.try);
    else if (id === 'skip') return this.finish();
    this.invalidate();
  }

  draw(g, ui, W, H) {
    const i = this.path.indexOf(this.topic);
    const top = chrome(g, ui, W, H, { title: 'Guide', sub: this.first ? `Getting started · ${i + 1} of ${this.path.length}` : 'How everything works' });
    // topics, grouped
    const lx = 32;
    const lw = 340;
    let y = top + 6;
    let group = '';
    for (const t of TOPICS) {
      if (this.first && !FIRST.includes(t.id)) continue;
      if (t.group !== group) {
        group = t.group;
        mono(g, group, lx + 4, y + 26, { size: 14, color: T.ink3 });
        y += 36;
      }
      const on = t.id === this.topic;
      if (on) {
        cutPath(g, lx, y, lw, 44, 6);
        g.fillStyle = T.bg3;
        g.fill();
        g.fillStyle = T.seal;
        g.fillRect(lx, y + 6, 4, 32);
      }
      icon(g, t.icon, lx + 16, y + 11, 22, on ? T.ink : T.ink2);
      text(g, t.title, lx + 52, y + 29, { size: 18, weight: on ? 600 : 400, color: on ? T.ink : T.ink2, max: lw - 90 });
      if (this.done.has(t.id)) {
        g.fillStyle = T.seal;
        g.fillRect(lx + lw - 22, y + 19, 7, 7);
      }
      ui.hit('topic', lx, y, lw, 44, t.id);
      y += 46;
    }
    // the page
    const t = this.t;
    const rx = lx + lw + 40;
    const rw = W - rx - 40;
    g.fillStyle = T.line;
    g.fillRect(rx - 20, top + 10, 1, H - top - 40);
    hudTag(g, rx, top + 22, t.group, { variant: 'line', size: 14 });
    icon(g, t.icon, rx, top + 86, 40, T.ink);
    text(g, t.title, rx + 60, top + 118, { size: 34, weight: 600, color: T.ink, max: rw - 60 });
    const words = this.hands() || !t.ctrl ? t.hand : t.ctrl;
    const end = paragraph(g, words, rx, top + 180, rw, { size: 21, lh: 1.55, color: T.ink2, maxLines: 8 });
    if (t.wait) {
      if (this.done.has(t.id)) hudTag(g, rx, end + 14, 'Done', { variant: 'seal', size: 14 });
      else text(g, 'Waiting for you to try it…', rx, end + 34, { size: 18, family: 'mono', color: T.ink3 });
    }
    // actions
    const by = H - 104;
    const last = i === this.path.length - 1;
    button(g, ui, 'next', W - 40 - 220, by, 220, 68, this.first && last ? 'Finish' : 'Next', { iconName: this.first && last ? null : 'next', primary: !t.try || this.done.has(t.id) });
    if (t.try) button(g, ui, 'try', W - 40 - 220 - 14 - 220, by, 220, 68, 'Try it', { primary: !this.done.has(t.id) });
    if (this.first) button(g, ui, 'skip', rx, by, 200, 68, 'Skip guide', { small: true });
  }
}
