import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

// Live inventory by product. Counts leaves only — a container case and the packs
// inside it would otherwise both be counted, doubling the weight on hand.
r.get('/inventory', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.id, p.code, p.name,
              COUNT(c.id) FILTER (WHERE c.status='IN_STOCK')  AS packs_in_stock,
              COALESCE(SUM(c.net_weight_lb) FILTER (WHERE c.status='IN_STOCK'),0) AS lb_in_stock,
              COUNT(c.id) FILTER (WHERE c.status='ALLOCATED') AS packs_allocated,
              COUNT(c.id) FILTER (WHERE c.status='PENDING')   AS packs_pending,
              -- intact cases: containers still whole, nothing picked out of them
              (SELECT COUNT(*) FROM cases b
                 WHERE b.product_id = p.id AND b.status='IN_STOCK'
                   AND EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = b.id)
                   AND NOT EXISTS (SELECT 1 FROM cases ch
                                   WHERE ch.parent_id = b.id AND ch.status <> 'IN_STOCK')) AS cases_in_stock
       FROM products p
       LEFT JOIN cases c ON c.product_id=p.id
         AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = c.id)
       WHERE p.active GROUP BY p.id ORDER BY p.name`);
    res.json(rows);
  } catch (e) { next(e); }
});

// end-of-day stragglers: printed but never scanned in
r.get('/pending', async (_req, res, next) => {
  try {
    const { rows } = await q(
      // packs already boxed are covered by scanning their case, so list the box
      `SELECT c.*, p.name AS product_name, l.lot_code,
         (SELECT COUNT(*) FROM cases ch WHERE ch.parent_id = c.id)::int AS pack_count
       FROM cases c JOIN products p ON p.id=c.product_id JOIN lots l ON l.id=c.lot_id
       WHERE c.status='PENDING' AND c.parent_id IS NULL ORDER BY c.printed_at`);
    res.json(rows);
  } catch (e) { next(e); }
});
export default r;
