import { Router } from 'express';
import { h, bad } from '../util.js';
import { qboConfigured, authorizeUrl, getConnection, disconnect, redirectUri } from '../qbo/client.js';
import { pullOrders, listItems } from '../qbo/sync.js';

// /api/qbo/* (passcode-protected)
export const api = Router();

api.get('/status', h(async (req, res) => {
  const c = await getConnection();
  res.json({
    configured: qboConfigured(), connected: !!c, environment: process.env.QBO_ENVIRONMENT || 'sandbox',
    realm_id: c?.realm_id || null, last_sync_at: c?.last_sync_at || null, last_sync_error: c?.last_sync_error || null,
    refresh_expires: c?.refresh_expires || null, redirect_uri: redirectUri(),
    create_invoice: process.env.QBO_CREATE_INVOICE === 'true',
  });
}));
api.get('/connect-url', h(async (req, res) => {
  if (!qboConfigured()) throw bad('set QBO_CLIENT_ID and QBO_CLIENT_SECRET on the server first');
  res.json({ url: authorizeUrl() });
}));
api.post('/sync', h(async (req, res) => res.json(await pullOrders({ full: !!req.body.full }))));
api.get('/items', h(async (req, res) => res.json(await listItems())));
api.post('/disconnect', h(async (req, res) => { await disconnect(); res.json({ ok: true }); }));

// /qbo/callback — Intuit redirects the browser here; no passcode header on a redirect,
// so it is protected by the single-use OAuth state instead.
export const callback = Router();
callback.get('/callback', async (req, res) => {
  const { handleCallback } = await import('../qbo/client.js');
  try {
    if (req.query.error) throw new Error(req.query.error_description || req.query.error);
    await handleCallback({ code: req.query.code, state: req.query.state, realmId: req.query.realmId });
    pullOrders({ full: true }).catch((e) => console.error('qbo first sync:', e.message));
    res.redirect('/?qbo=connected');
  } catch (e) {
    res.redirect('/?qbo_error=' + encodeURIComponent(e.message));
  }
});
