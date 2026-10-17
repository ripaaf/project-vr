'use strict';

const BOUNDARY = 'qmframe';

/**
 * Fans JPEG frames out to multipart/x-mixed-replace HTTP clients. Slow clients
 * just skip frames (never queue), so one weak Wi-Fi viewer can't lag the rest.
 */
class MjpegHub {
  constructor(getMaxFps) {
    this.getMaxFps = getMaxFps;
    this.clients = new Set();
    this.latest = null;
    this.latestAt = 0;
    this.pollers = new Map(); // snapshot-polling viewers (fallback mode): id -> last seen
  }

  get viewerCount() {
    const now = Date.now();
    for (const [id, t] of this.pollers) if (now - t > 5000) this.pollers.delete(id);
    return this.clients.size + this.pollers.size;
  }

  attach(req, res) {
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'close',
      'X-Accel-Buffering': 'no',
    });
    if (res.socket) res.socket.setNoDelay(true);
    const client = { res, busy: false, last: 0 };
    this.clients.add(client);
    const drop = () => this.clients.delete(client);
    req.on('close', drop);
    res.on('error', drop);
    if (this.latest && Date.now() - this.latestAt < 3000) this.send(client, this.latest);
  }

  send(client, frame) {
    const { res } = client;
    res.cork();
    res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    res.write(frame);
    const ok = res.write('\r\n');
    res.uncork();
    client.last = Date.now();
    if (!ok) {
      client.busy = true;
      res.once('drain', () => (client.busy = false));
    }
  }

  push(frame) {
    this.latest = frame;
    this.latestAt = Date.now();
    // Frames arrive in bursts, so allow some slack below the nominal interval.
    const minGap = (1000 / this.getMaxFps()) * 0.7;
    for (const c of this.clients) {
      if (c.busy || this.latestAt - c.last < minGap) continue;
      this.send(c, frame);
    }
  }

  touchPoller(id) {
    this.pollers.set(id, Date.now());
  }

  closeAll() {
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }
}

module.exports = { MjpegHub };
