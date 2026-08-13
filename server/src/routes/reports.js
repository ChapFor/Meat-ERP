import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

// live inventory by product
r.get('/inventory', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.id, p.code, p.name,
              COUNT(c.id) FILTER (WHERE c.status='IN_STOCK')  AS cases_in_stock,
              COALESCE(SUM(c.net_weight_lb) FILTER (WHERE c.status='IN_STOCK'),0) AS lb_in_stock,
              COUNT(c.id) FILTER (WHERE c.status='ALLOCATED') AS cases_allocated,
              COUNT(c.id) FILTER (WHERE c.status='PENDING')   AS cases_pending
       FROM products p LEFT JOIN cases c ON c.product_id=p.id
       WHERE p.active GROUP BY p.id ORDER BY p.name`);
    res.json(rows);
  } catch (e) { next(e); }
});

// end-of-day stragglers: printed but never scanned in
r.get('/pending', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT c.*, p.name AS product_name, l.lot_code
       FROM cases c JOIN products p ON p.id=c.product_id JOIN lots l ON l.id=c.lot_id
       WHERE c.status='PENDING' ORDER BY c.printed_at`);
    res.json(rows);
  } catch (e) { next(e); }
});
export default r;
