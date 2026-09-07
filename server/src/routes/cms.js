import { Router } from 'express';
import { q, pool } from '../db.js';
import { buildCutList } from '../cms/aggregate.js';
import { syncOnce } from '../cms/sync.js';
import { cmsConfigured } from '../cms/client.js';
const r = Router();

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The floor screen reads this and nothing else — it never touches CMS, so a CMS
// outage shows as stale data rather than an empty wall display.
r.get('/floor', async (_req, res, next) => {
  try {
    const orders = (await q(
      `SELECT * FROM cms_orders WHERE closed_at IS NULL ORDER BY requested_by NULLS LAST`)).rows;
    const lines = orders.length ? (await q(
      `SELECT * FROM cms_order_lines WHERE order_no = ANY($1)`,
      [orders.map((o) => o.order_no)])).rows : [];
    const products = (await q('SELECT * FROM cms_products')).rows;
    const last = (await q(
      `SELECT finished_at FROM cms_sync_log WHERE ok ORDER BY finished_at DESC LIMIT 1`)).rows[0];
    const priority = (await q(
      `SELECT customer FROM cms_priority ORDER BY position`)).rows.map((p) => p.customer);

    res.json({
      ...buildCutList({
        orders, lines, products,
        today: todayLocal(),
        syncedAt: last?.finished_at || null,
        priority,
      }),
      configured: cmsConfigured(),
    });
  } catch (e) { next(e); }
});

// Cut-first customer order, dragged on the floor screen. Stored server-side so
// the wall tablet and the office agree; names not listed here are simply
// unranked and sort after the ranked ones.
r.get('/priority', async (_req, res, next) => {
  try {
    res.json({
      customers: (await q(`SELECT customer FROM cms_priority ORDER BY position`))
        .rows.map((p) => p.customer),
    });
  } catch (e) { next(e); }
});

// Whole-list replace: a drag reorders everything, and half a saved ordering is
// worse than none, so it goes in one transaction.
r.put('/priority', async (req, res, next) => {
  const raw = req.body?.customers;
  if (!Array.isArray(raw))
    return res.status(400).json({ error: 'customers must be an array of customer names' });
  if (raw.length > 200)
    return res.status(400).json({ error: 'at most 200 customers can be ranked' });

  const customers = [];
  const seen = new Set();
  for (const v of raw) {
    if (typeof v !== 'string' || !v.trim())
      return res.status(400).json({ error: 'each customer must be a non-empty string' });
    const name = v.trim();
    if (name.length > 200)
      return res.status(400).json({ error: `customer name is too long (max 200): ${name.slice(0, 40)}…` });
    if (seen.has(name)) continue;            // a dupe is a UI slip, not an error
    seen.add(name);
    customers.push(name);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM cms_priority');
    for (const [i, name] of customers.entries())
      await client.query(
        `INSERT INTO cms_priority (customer, position, updated_at) VALUES ($1, $2, now())`,
        [name, i]);
    await client.query('COMMIT');
    res.json({ customers });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
});

r.get('/status', async (_req, res, next) => {
  try {
    const runs = (await q(
      `SELECT id, started_at, finished_at, ok, orders_seen, orders_read, error
       FROM cms_sync_log ORDER BY started_at DESC LIMIT 10`)).rows;
    const counts = (await q(
      `SELECT COUNT(*) FILTER (WHERE closed_at IS NULL)::int AS open_orders,
              COUNT(*)::int AS all_orders FROM cms_orders`)).rows[0];
    // Who fetched the data does not matter to the floor. When CMS blocks cloud
    // egress the farm PC syncs instead, so "is it fresh?" is the real question —
    // not "does THIS server hold credentials?".
    const lastOk = (await q(
      `SELECT finished_at FROM cms_sync_log WHERE ok ORDER BY finished_at DESC LIMIT 1`)).rows[0];
    // which credentials the server can see — names only, never values
    res.json({
      configured: cmsConfigured(),
      credentials: {
        CMS_USERNAME: !!process.env.CMS_USERNAME,
        CMS_PASSWORD: !!process.env.CMS_PASSWORD,
        CMS_PIN: !!process.env.CMS_PIN,
        CMS_BASE_URL: process.env.CMS_BASE_URL || '(default)',
      },
      node: process.version,
      last_ok_at: lastOk?.finished_at || null,
      minutes_since_ok: lastOk?.finished_at
        ? Math.round((Date.now() - new Date(lastOk.finished_at).getTime()) / 60000) : null,
      syncs_here: cmsConfigured(),   // false when the farm PC does the syncing
      runs, ...counts,
    });
  } catch (e) { next(e); }
});

// manual "sync now"
r.post('/sync', async (req, res, next) => {
  try {
    if (!cmsConfigured())
      return res.status(409).json({ error: 'CMS_USERNAME / CMS_PASSWORD are not set on the server' });
    res.json(await syncOnce({ force: req.body?.force === true }));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// product master (spec §5) — the owner fills in pack contents
r.get('/products', async (_req, res, next) => {
  try {
    res.json((await q(
      `SELECT p.*,
         (SELECT COUNT(*) FROM cms_order_lines l
           WHERE l.product_name = p.product_name AND l.kind='PREORDER')::int AS line_count
       FROM cms_products p ORDER BY p.category, p.product_name`)).rows);
  } catch (e) { next(e); }
});

r.patch('/products/:name', async (req, res, next) => {
  try {
    const { category, pieces_per_pack, birds_per_pack, notes, erp_product_id } = req.body ?? {};
    const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    for (const [k, v] of [['pieces_per_pack', pieces_per_pack], ['birds_per_pack', birds_per_pack]]) {
      if (v !== undefined && v !== '' && v !== null && !(Number.isFinite(Number(v)) && Number(v) >= 0))
        return res.status(400).json({ error: `${k} must be a positive number` });
    }
    const { rows } = await q(
      `UPDATE cms_products SET
         category        = COALESCE($2, category),
         pieces_per_pack = CASE WHEN $3::bool THEN $4::numeric ELSE pieces_per_pack END,
         birds_per_pack  = CASE WHEN $5::bool THEN $6::numeric ELSE birds_per_pack END,
         notes           = COALESCE($7, notes),
         erp_product_id  = COALESCE($8, erp_product_id),
         updated_at      = now()
       WHERE product_name=$1 RETURNING *`,
      [req.params.name, category || null,
       pieces_per_pack !== undefined, numOrNull(pieces_per_pack),
       birds_per_pack !== undefined, numOrNull(birds_per_pack),
       notes ?? null, erp_product_id ?? null]);
    if (!rows[0]) return res.status(404).json({ error: 'product not in the CMS master' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default r;
