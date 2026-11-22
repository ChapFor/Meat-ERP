// QuickBooks Online API client: OAuth 2.0 tokens + a thin request helper.
// Tokens live in the qbo_connection table and refresh themselves.
import crypto from 'node:crypto';
import { q } from '../db.js';

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const MINOR_VERSION = 75;

export const qboConfigured = () => !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
// QBO_API_BASE overrides the endpoint (used by the test suite's mock QuickBooks).
const apiBase = () => process.env.QBO_API_BASE || (process.env.QBO_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com');
export const redirectUri = () => `${(process.env.PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '')}/qbo/callback`;
const basicAuth = () => 'Basic ' + Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');

// OAuth state values are single-use and expire after 10 minutes.
const states = new Map();
export function authorizeUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  states.set(state, Date.now());
  for (const [k, t] of states) if (Date.now() - t > 600000) states.delete(k);
  const p = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID, response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting', redirect_uri: redirectUri(), state,
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QuickBooks token error: ${data.error_description || data.error || res.status}`);
  return data;
}

async function saveTokens(realmId, t) {
  await q(`
    INSERT INTO qbo_connection (id, realm_id, access_token, refresh_token, access_expires, refresh_expires)
    VALUES (1, $1, $2, $3, now() + make_interval(secs => $4), now() + make_interval(secs => $5))
    ON CONFLICT (id) DO UPDATE SET realm_id = $1, access_token = $2, refresh_token = $3,
      access_expires = now() + make_interval(secs => $4), refresh_expires = now() + make_interval(secs => $5)`,
    [realmId, t.access_token, t.refresh_token, t.expires_in || 3600, t.x_refresh_token_expires_in || 8640000]);
}

export async function handleCallback({ code, state, realmId }) {
  if (!state || !states.has(state)) throw new Error('QuickBooks sign-in expired or was not started here — try Connect again');
  states.delete(state);
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  await saveTokens(realmId, t);
}

export async function getConnection() {
  return (await q('SELECT * FROM qbo_connection WHERE id = 1')).rows[0] || null;
}

let refreshing = null;
async function accessToken() {
  const c = await getConnection();
  if (!c) throw new Error('QuickBooks is not connected');
  if (new Date(c.access_expires) - Date.now() > 120000) return c;
  // one refresh at a time; Intuit rotates the refresh token on every use
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refresh_token })
    .then((t) => saveTokens(c.realm_id, t))
    .finally(() => { refreshing = null; });
  await refreshing;
  return getConnection();
}

export async function disconnect() {
  const c = await getConnection();
  if (c) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: basicAuth(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: c.refresh_token }),
    }).catch(() => {});
  }
  await q('DELETE FROM qbo_connection');
}

// Low-level request. path is relative to /v3/company/{realm}/
export async function qbo(method, path, body) {
  const c = await accessToken();
  const sep = path.includes('?') ? '&' : '?';
  const url = `${apiBase()}/v3/company/${c.realm_id}/${path}${sep}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${c.access_token}`, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.Fault?.Error?.[0];
    throw new Error(`QuickBooks ${res.status}: ${err ? `${err.Message} — ${err.Detail || ''}` : JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// Run a QuickBooks query, paging through every result.
export async function query(entity, where = '', pageSize = 500) {
  const out = [];
  for (let start = 1; ; start += pageSize) {
    const sql = `SELECT * FROM ${entity}${where ? ' WHERE ' + where : ''} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const data = await qbo('GET', `query?query=${encodeURIComponent(sql)}`);
    const rows = data.QueryResponse?.[entity] || [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
