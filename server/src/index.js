import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './env.js';
import { migrate } from './migrate.js';

// server/.env for local runs; on Railway the real environment already has these
// and loadEnv never overwrites what is already set.
loadEnv();
import products from './routes/products.js';
import customers from './routes/customers.js';
import lots from './routes/lots.js';
import cases from './routes/cases.js';
import orders from './routes/orders.js';
import scan from './routes/scan.js';
import reports from './routes/reports.js';
import batches from './routes/batches.js';

const app = express();
const origins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : {}));
app.use(express.json());

app.use('/api/products', products);
app.use('/api/customers', customers);
app.use('/api/lots', lots);
app.use('/api/cases', cases);
app.use('/api/orders', orders);
app.use('/api/scan', scan);
app.use('/api/reports', reports);
app.use('/api/batches', batches);

// The CMS cut list is an optional office integration that reaches a third-party
// site and pulls in an HTML parser. Load it defensively: if anything about it
// fails to import, the floor terminal, scan-in and packing must still come up.
// Imported one at a time and each guarded on its own. A previous version loaded
// both with Promise.all inside a single try; the failure still escaped and took
// the process down, so nothing here relies on a shared catch any more.
let startCmsSync = () => console.warn('cms: integration not loaded');
let cmsRoutes = null;
try { cmsRoutes = (await import('./routes/cms.js')).default; }
catch (e) { console.error(`cms: routes unavailable (${e.message})`); }
try { startCmsSync = (await import('./cms/sync.js')).startCmsSync; }
catch (e) { console.error(`cms: sync unavailable (${e.message})`); }

if (cmsRoutes) app.use('/api/cms', cmsRoutes);
else {
  console.error('cms: serving 503 for /api/cms — the rest of the ERP is unaffected');
  app.use('/api/cms', (_req, res) =>
    res.status(503).json({ error: 'the CMS integration failed to load on this server' }));
}

// serve built client in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '../../client/dist');
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'), () => {}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

// Migrate before serving: a half-migrated schema would fail in confusing ways
// on the plant floor, so refuse to come up instead.
const port = process.env.PORT || 3001;
migrate()
  .then(() => app.listen(port, () => {
    console.log(`meat-erp api on :${port}`);
    startCmsSync();          // no-op until CMS credentials are set
  }))
  .catch((e) => { console.error(`startup aborted — ${e.message}`); process.exit(1); });
