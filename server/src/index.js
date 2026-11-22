import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';
import { HttpError } from './util.js';
import products from './routes/products.js';
import lots from './routes/lots.js';
import station from './routes/station.js';
import cases from './routes/cases.js';
import orders from './routes/orders.js';
import { api as qboApi, callback as qboCallback } from './routes/qbo.js';
import { startSyncLoop } from './qbo/sync.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

// The station agent runs at http://localhost:9410 and the browser page is served
// from here; only the agent needs cross-origin access, and it sends the passcode.
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Passcode');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const PASS = process.env.APP_PASSCODE || '';
if (!PASS) console.warn('APP_PASSCODE is not set — the API is open to anyone. Set it before connecting QuickBooks.');
const passOk = (given) => !PASS || (given && given.length === PASS.length &&
  crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PASS)));

app.get('/api/health', (req, res) => res.json({ ok: true, auth: !!PASS }));
app.post('/api/login', (req, res) => (passOk(String(req.body.passcode || ''))
  ? res.json({ ok: true }) : res.status(401).json({ error: 'wrong passcode' })));
app.use('/api', (req, res, next) => (passOk(req.get('X-Passcode') || '') ? next() : res.status(401).json({ error: 'passcode required' })));

app.use('/api/products', products);
app.use('/api/lots', lots);
app.use('/api/station', station);
app.use('/api/cases', cases);
app.use('/api/orders', orders);
app.use('/api/qbo', qboApi);
app.use('/qbo', qboCallback);
app.use('/api', (req, res) => res.status(404).json({ error: 'no such endpoint' }));

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : (err.status || 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message, ...(err.extra || {}) });
});

const port = process.env.PORT || 3001;
migrate()
  .then(() => {
    app.listen(port, () => console.log(`ERP server on :${port}`));
    startSyncLoop();
  })
  .catch((e) => { console.error('startup failed:', e.message); process.exit(1); });
