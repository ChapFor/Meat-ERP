// Cloud API client. The passcode is kept in this browser after login.
const key = 'cf_passcode';
export const passcode = { get: () => localStorage.getItem(key) || '', set: (p) => localStorage.setItem(key, p), clear: () => localStorage.removeItem(key) };

export class ApiError extends Error {
  constructor(status, data) { super(data?.error || `error ${status}`); this.status = status; this.data = data; }
}

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Passcode': passcode.get() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('cf-logout'));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b || {}),
  put: (p, b) => req('PUT', p, b || {}),
};
