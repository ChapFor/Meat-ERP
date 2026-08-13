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
  .then(() => app.listen(port, () => console.log(`meat-erp api on :${port}`)))
  .catch((e) => { console.error(`startup aborted — ${e.message}`); process.exit(1); });
