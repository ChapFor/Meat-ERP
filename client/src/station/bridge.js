// Client for the local hardware bridge (station/bridge/) running on the
// station PC. Separate from api.js on purpose: different origin, short
// timeouts, and it must keep working when the cloud is unreachable.
export const bridgeUrl = () => localStorage.getItem('cf_bridge_url') || 'http://localhost:9410';

async function breq(path, { method = 'GET', body, timeout = 3000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(bridgeUrl() + path, {
      method,
      signal: ctl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `bridge ${res.status}`);
    return data;
  } finally {
    clearTimeout(t);
  }
}

export const bridge = {
  weight: () => breq('/weight'),
  health: () => breq('/health', { timeout: 4000 }),
  print: (zpl) => breq('/print', { method: 'POST', body: { zpl }, timeout: 8000 }),
};
