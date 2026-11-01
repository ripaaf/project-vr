// Talking to the PC host. The space is opened from localhost (the cable/ADB tunnel), which makes
// it "this PC" for the host; the PC-screen routes also want the link secret, fetched once here.

let token = null;

export async function api(path, body, { method } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (path.startsWith('/api/pc/') && path !== '/api/pc/token') {
    if (!token) await pcToken();
    if (token) headers['X-QM-Token'] = token;
  }
  let r;
  try {
    r = await fetch(path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    // nothing answered: say who is missing, in plain words
    throw Object.assign(new Error(location.port === '8770' ? 'The space on the Quest stopped. Open the UTSUSHI app once, then try again.' : 'The PC is not answering. Is UTSUSHI running there?'), { status: 0 });
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${r.status}`), { status: r.status });
  return data;
}

export async function pcToken() {
  if (token) return token;
  try {
    const r = await fetch('/api/pc/token');
    if (r.ok) token = (await r.json()).token;
  } catch {}
  return token;
}

export function tokenSync() {
  return token;
}

/** Server-sent events with automatic reconnect. Returns a close function. */
export function events(path, onMessage, onState) {
  let es = null;
  let stopped = false;
  const open = () => {
    if (stopped) return;
    es = new EventSource(path);
    es.onopen = () => onState && onState(true);
    es.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {}
    };
    es.onerror = () => {
      onState && onState(false);
      es.close();
      setTimeout(open, 2000);
    };
  };
  open();
  return () => {
    stopped = true;
    if (es) es.close();
  };
}
