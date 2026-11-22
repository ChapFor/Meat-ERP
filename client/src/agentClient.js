// The station agent on this PC (station/agent). Separate origin, short timeouts.
export const agentUrl = () => localStorage.getItem('cf_agent_url') || 'http://localhost:9410';
async function areq(method, path, body, timeout = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(agentUrl() + path, {
      method, signal: ctl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `agent ${res.status}`);
    return data;
  } finally { clearTimeout(t); }
}
export const agent = {
  status: () => areq('GET', '/status', null, 1500),
  setJob: (job) => areq('POST', '/job', job),
  stop: () => areq('POST', '/job', { stop: true }),
  print: () => areq('POST', '/print'),
  reprint: (serial) => areq('POST', '/reprint', { serial }),
  refresh: () => areq('POST', '/refresh'),
};
