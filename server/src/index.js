import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrate } from './migrate.js';
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
let startCmsSync = () => console.warn('cms: integration not loaded');
try {
  const [{ default: cms }, sync] = await Promise.all([
    import('./routes/cms.js'), import('./cms/sync.js'),
  ]);
  app.use('/api/cms', cms);
  startCmsSync = sync.startCmsSync;
} catch (e) {
  console.error(`cms: integration unavailable (${e.message}) — the rest of the ERP is unaffected`);
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
