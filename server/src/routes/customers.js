import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

const FIELDS = ['name', 'contact', 'email', 'phone', 'notes', 'payment_terms',
  'address_line1', 'address_line2', 'city', 'state', 'zip'];

// blank strings from the form mean "not set", not empty-string
const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// list — ?all=1 includes deactivated. Carries order-history summary for the cards.
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT cu.*,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = cu.id)::int AS order_count,
         (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = cu.id) AS last_order_date,
         COALESCE((SELECT SUM(c.net_weight_lb) FROM cases c
                   JOIN order_lines ol ON ol.id = c.order_line_id
                   JOIN orders o ON o.id = ol.order_id
                   WHERE o.customer_id = cu.id AND c.status IN ('ALLOCATED','SHIPPED')),0) AS lifetime_lb
       FROM customers cu
       WHERE ($1::bool IS TRUE OR cu.active)
       ORDER BY cu.name`,
      [req.query.all === '1']);
    res.json(rows);
  } catch (e) { next(e); }
});

// order history for one customer — packed/shipped lb is the catch-weight number
// that will drive invoicing, so it is what we show rather than ordered qty.
r.get('/:id/orders', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT o.id, o.po_number, o.order_date, o.ship_date, o.status,
         (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id)::int AS line_count,
         (SELECT COUNT(*) FROM cases c JOIN order_lines ol ON ol.id = c.order_line_id
            WHERE ol.order_id = o.id AND c.status IN ('ALLOCATED','SHIPPED'))::int AS cases_packed,
         COALESCE((SELECT SUM(c.net_weight_lb) FROM cases c JOIN order_lines ol ON ol.id = c.order_line_id
            WHERE ol.order_id = o.id AND c.status IN ('ALLOCATED','SHIPPED')),0) AS lb_packed
       FROM orders o WHERE o.customer_id = $1
       ORDER BY o.order_date DESC, o.id DESC LIMIT 100`,
      [req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

r.post('/', async (req, res, next) => {
  try {
    const name = clean(req.body?.name);
    if (!name) return res.status(400).json({ error: 'customer name is required' });
    const dup = (await q('SELECT id FROM customers WHERE lower(name)=lower($1)', [name])).rows[0];
    if (dup) return res.status(409).json({ error: `"${name}" is already in the directory` });
    const vals = FIELDS.map((f) => (f === 'name' ? name : clean(req.body?.[f])));
    const { rows } = await q(
      `INSERT INTO customers (${FIELDS.join(',')})
       VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

r.patch('/:id', async (req, res, next) => {
  try {
    const sets = [], vals = [req.params.id];
    for (const f of FIELDS) {
      if (req.body?.[f] === undefined) continue;
      const v = clean(req.body[f]);
      if (f === 'name' && !v) return res.status(400).json({ error: 'customer name is required' });
      vals.push(v);
      sets.push(`${f}=$${vals.length}`);
    }
    if (req.body?.active !== undefined) {
      vals.push(!!req.body.active);
      sets.push(`active=$${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    const { rows } = await q(
      `UPDATE customers SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: 'customer not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});
export default r;
