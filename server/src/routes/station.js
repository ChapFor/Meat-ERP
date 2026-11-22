// Endpoints the station agent calls. Printing never waits on these: the agent
// leases serial numbers ahead of time and uploads cases after the label is out.
import { Router } from 'express';
import { q, tx } from '../db.js';
import { h, bad, conflict, notFound } from '../util.js';
import { recordCase } from '../domain.js';

const r = Router();

// Everything the station needs to run, in one call.
r.get('/config', h(async (req, res) => {
  const [products, lots, orders] = await Promise.all([
    q(`SELECT id, code, name, label_name, tare_lb, min_lb, max_lb, shelf_life_days
       FROM products WHERE active ORDER BY name`),
    q(`SELECT id, code, pack_date, batch_no, note FROM lots WHERE status = 'OPEN' ORDER BY pack_date DESC, batch_no DESC`),
    q(`SELECT o.id, o.doc_number, o.customer_name, o.ship_date,
         coalesce(json_agg(json_build_object(
           'id', ol.id, 'product_id', ol.product_id, 'qty_ordered', ol.qty_ordered,
           'cases_packed', (SELECT count(*) FROM cases c WHERE c.order_line_id = ol.id AND c.status IN ('ALLOCATED','SHIPPED')))
           ORDER BY ol.line_no) FILTER (WHERE ol.product_id IS NOT NULL), '[]') AS lines
       FROM orders o LEFT JOIN order_lines ol ON ol.order_id = o.id
       WHERE o.status = 'OPEN'
       GROUP BY o.id ORDER BY o.ship_date NULLS LAST, o.doc_number`),
  ]);
  res.json({ products: products.rows, lots: lots.rows, orders: orders.rows, server_time: new Date().toISOString() });
}));

// Reserve the next block of serial suffixes for a lot.
r.post('/lease', h(async (req, res) => {
  const { lot_code, station } = req.body;
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 50, 1), 500);
  if (!station) throw bad('station is required');
  const lease = await tx(async (db) => {
    const lot = (await db.query('SELECT * FROM lots WHERE code = $1 FOR UPDATE', [lot_code])).rows[0];
    if (!lot) throw notFound(`lot ${lot_code} not found`);
    if (lot.status !== 'OPEN') throw conflict(`lot ${lot_code} is closed`);
    const first = lot.next_serial, last = first + count - 1;
    if (last > 9999) throw conflict(`lot ${lot_code} has used all 9,999 serials — start a new lot`);
    await db.query('UPDATE lots SET next_serial = $2 WHERE id = $1', [lot.id, last + 1]);
    await db.query('INSERT INTO serial_leases (lot_id, station, first_no, last_no) VALUES ($1,$2,$3,$4)',
      [lot.id, station, first, last]);
    return { lot_code, first, last };
  });
  res.json(lease);
}));

// Upload printed cases (the agent batches whatever is queued). Idempotent.
r.post('/cases', h(async (req, res) => {
  const list = Array.isArray(req.body.cases) ? req.body.cases : [req.body];
  const results = [];
  for (const c of list) {
    try {
      const out = await tx((db) => recordCase(db, {
        serial: c.serial, productCode: c.product_code, lotCode: c.lot_code, weightLb: c.weight_lb,
        printedAt: c.printed_at, station: c.station, orderLineId: c.order_line_id, printMs: c.print_ms,
      }));
      results.push({ serial: c.serial, ok: true, status: out.case.status, warning: out.warning || null });
    } catch (e) {
      // a permanently bad record (unknown PLU) is reported, not retried forever
      results.push({ serial: c.serial, ok: false, error: e.message, permanent: (e.status || 500) < 500 });
    }
  }
  res.json({ results });
}));

export default r;
