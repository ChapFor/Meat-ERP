import { Router } from 'express';
import { q } from '../db.js';
import { h, bad } from '../util.js';
import { CASE_SELECT, caseFromScan, voidScan } from '../domain.js';

const r = Router();

// Inventory summary: one row per product with cases on hand.
r.get('/summary', h(async (req, res) => {
  const { rows } = await q(`
    SELECT p.id, p.code, p.name,
      count(c.id) FILTER (WHERE c.status = 'IN_STOCK')::int AS in_stock,
      coalesce(sum(c.weight_lb) FILTER (WHERE c.status = 'IN_STOCK'), 0) AS in_stock_lb,
      count(c.id) FILTER (WHERE c.status = 'ALLOCATED')::int AS allocated,
      coalesce(sum(c.weight_lb) FILTER (WHERE c.status = 'ALLOCATED'), 0) AS allocated_lb,
      min(l.pack_date) FILTER (WHERE c.status = 'IN_STOCK') AS oldest_pack_date
    FROM products p
    LEFT JOIN cases c ON c.product_id = p.id AND c.status IN ('IN_STOCK','ALLOCATED')
    LEFT JOIN lots l ON l.id = c.lot_id
    GROUP BY p.id HAVING count(c.id) > 0 OR p.active
    ORDER BY p.name`);
  res.json(rows);
}));

// Case list with filters: ?status=IN_STOCK&product_id=3&lot=261122-B1&limit=500
r.get('/', h(async (req, res) => {
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.status) add('c.status = ?', req.query.status);
  if (req.query.product_id) add('c.product_id = ?', req.query.product_id);
  if (req.query.lot) add('l.code = ?', req.query.lot);
  if (req.query.order_id) add('o.id = ?', req.query.order_id);
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
  const { rows } = await q(`${CASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.printed_at DESC LIMIT ${limit}`, params);
  res.json(rows);
}));

// What is this label? Accepts a raw scan.
r.post('/lookup', h(async (req, res) => {
  if (!req.body.scan) throw bad('scan is required');
  const c = await caseFromScan({ query: q }, req.body.scan);
  const { rows: events } = await q(`
    SELECT e.event, e.detail, e.at, o.doc_number FROM case_events e
    LEFT JOIN orders o ON o.id = e.order_id WHERE e.case_id = $1 ORDER BY e.at`, [c.id]);
  res.json({ ...c, events });
}));

r.post('/void', h(async (req, res) => {
  if (!req.body.scan) throw bad('scan is required');
  res.json(await voidScan(req.body.scan, req.body.reason));
}));

export default r;
