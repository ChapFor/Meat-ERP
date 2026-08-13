import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT o.*, cu.name AS customer_name,
        (SELECT json_agg(json_build_object(
           'id', ol.id, 'product_id', ol.product_id, 'product_name', p.name,
           'item_code', p.code, 'qty_cases', ol.qty_cases, 'qty_lb', ol.qty_lb, 'notes', ol.notes,
           'packed_cases', (SELECT COUNT(*) FROM cases c WHERE c.order_line_id = ol.id AND c.status IN ('ALLOCATED','SHIPPED')),
           'packed_lb', COALESCE((SELECT SUM(c.net_weight_lb) FROM cases c WHERE c.order_line_id = ol.id AND c.status IN ('ALLOCATED','SHIPPED')),0)
         ) ORDER BY ol.id)
         FROM order_lines ol JOIN products p ON p.id = ol.product_id
         WHERE ol.order_id = o.id) AS lines
       FROM orders o JOIN customers cu ON cu.id = o.customer_id
       WHERE ($1::order_status IS NULL OR o.status = $1::order_status)
       ORDER BY o.ship_date NULLS LAST, o.id DESC LIMIT 200`,
      [req.query.status || null]);
    res.json(rows);
  } catch (e) { next(e); }
});

r.post('/', async (req, res, next) => {
  const client = await (await import('../db.js')).pool.connect();
  try {
    const { customer_id, po_number, ship_date, notes, lines = [] } = req.body;
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO orders (customer_id, po_number, ship_date, notes)
       VALUES ($1,$2,$3,$4) RETURNING *`, [customer_id, po_number, ship_date || null, notes]);
    const order = rows[0];
    for (const ln of lines) {
      await client.query(
        `INSERT INTO order_lines (order_id, product_id, qty_cases, qty_lb, notes)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.id, ln.product_id, ln.qty_cases || null, ln.qty_lb || null, ln.notes || null]);
    }
    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

r.patch('/:id', async (req, res, next) => {
  try {
    const { status, ship_date, po_number, notes } = req.body;
    const { rows } = await q(
      `UPDATE orders SET status=COALESCE($2,status), ship_date=COALESCE($3,ship_date),
        po_number=COALESCE($4,po_number), notes=COALESCE($5,notes)
       WHERE id=$1 RETURNING *`,
      [req.params.id, status, ship_date, po_number, notes]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
export default r;
