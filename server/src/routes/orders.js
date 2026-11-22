import { Router } from 'express';
import { q, tx } from '../db.js';
import { h, bad, conflict } from '../util.js';
import { getOrder, orderLines, allocateScan, unallocateScan, CASE_SELECT } from '../domain.js';
import { writeBack } from '../qbo/sync.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const status = req.query.status || 'OPEN';
  const { rows } = await q(`
    SELECT o.*,
      (SELECT coalesce(sum(ceil(qty_ordered)),0)::int FROM order_lines WHERE order_id = o.id) AS cases_ordered,
      (SELECT count(*)::int FROM cases c JOIN order_lines ol ON ol.id = c.order_line_id
         WHERE ol.order_id = o.id AND c.status IN ('ALLOCATED','SHIPPED')) AS cases_packed,
      (SELECT coalesce(sum(c.weight_lb),0) FROM cases c JOIN order_lines ol ON ol.id = c.order_line_id
         WHERE ol.order_id = o.id AND c.status IN ('ALLOCATED','SHIPPED')) AS lb_packed,
      (SELECT count(*)::int FROM order_lines WHERE order_id = o.id AND product_id IS NULL) AS unmapped_lines
    FROM orders o
    WHERE ($1 = 'ALL' OR o.status = $1)
      AND ($1 = 'OPEN' OR o.created_at > now() - interval '90 days')
    ORDER BY o.ship_date NULLS LAST, o.doc_number
    LIMIT 500`, [status]);
  res.json(rows);
}));

r.get('/:id', h(async (req, res) => {
  const order = await getOrder({ query: q }, req.params.id);
  const { rows: cases } = await q(`${CASE_SELECT} WHERE o.id = $1 AND c.status IN ('ALLOCATED','SHIPPED')
                                   ORDER BY c.allocated_at`, [req.params.id]);
  res.json({ ...order, cases });
}));

// Scan a case onto the order. Rejections come back as 409 with a reason.
r.post('/:id/scan', h(async (req, res) => {
  if (!req.body.scan) throw bad('scan is required');
  res.json(await allocateScan(req.params.id, req.body.scan));
}));

r.post('/:id/unscan', h(async (req, res) => {
  if (!req.body.scan) throw bad('scan is required');
  res.json(await unallocateScan(req.params.id, req.body.scan));
}));

// Close the order: packed cases become SHIPPED and the weights go to QuickBooks.
// A short order needs force=true (the operator confirmed shipping short).
r.post('/:id/manifest', h(async (req, res) => {
  const id = req.params.id;
  await tx(async (db) => {
    const o = (await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!o) throw bad('order not found');
    if (o.status !== 'OPEN') throw conflict(`order is already ${o.status.toLowerCase()}`);
    const lines = await orderLines(db, id);
    const packed = lines.reduce((s, l) => s + l.cases_packed, 0);
    if (!packed) throw conflict('nothing has been packed on this order');
    const short = lines.filter((l) => l.cases_remaining > 0)
      .map((l) => ({ item: l.product_name || l.item_name, ordered: Number(l.qty_ordered), packed: l.cases_packed, short: l.cases_remaining }));
    if (short.length && !req.body.force) throw conflict(`order is short ${short.reduce((s, x) => s + x.short, 0)} cases`, { short });
    await db.query(`WITH s AS (
                      UPDATE cases c SET status = 'SHIPPED', shipped_at = now()
                      FROM order_lines ol WHERE ol.id = c.order_line_id AND ol.order_id = $1 AND c.status = 'ALLOCATED'
                      RETURNING c.id)
                    INSERT INTO case_events (case_id, event, order_id) SELECT id, 'SHIPPED', $1 FROM s`, [id]);
    await db.query(`UPDATE orders SET status = 'MANIFESTED', manifested_at = now(),
                    qbo_writeback_status = CASE WHEN qbo_id IS NULL THEN NULL ELSE 'PENDING' END WHERE id = $1`, [id]);
  });
  const qbo = await writeBack(id);
  res.json({ order: await getOrder({ query: q }, id), qbo });
}));

r.post('/:id/writeback', h(async (req, res) => {
  const o = (await q('SELECT status FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (o?.status !== 'MANIFESTED') throw conflict('only a manifested order can be written back');
  res.json(await writeBack(req.params.id));
}));

export default r;
