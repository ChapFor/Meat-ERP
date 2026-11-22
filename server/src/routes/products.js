import { Router } from 'express';
import { q } from '../db.js';
import { h, bad, notFound } from '../util.js';

const r = Router();
const FIELDS = ['code', 'name', 'label_name', 'tare_lb', 'min_lb', 'max_lb', 'shelf_life_days', 'qbo_item_id', 'qbo_item_name', 'active'];

function clean(body) {
  const out = {};
  for (const f of FIELDS) if (f in body) out[f] = body[f] === '' ? null : body[f];
  if ('code' in out && !/^\d{1,8}$/.test(String(out.code ?? ''))) throw bad('PLU must be 1–8 digits (it is printed into the barcode)');
  if ('name' in out && !String(out.name ?? '').trim()) throw bad('name is required');
  for (const f of ['tare_lb', 'min_lb', 'max_lb']) if (out[f] != null && !(Number(out[f]) >= 0)) throw bad(`${f} must be a number ≥ 0`);
  if (out.min_lb != null && out.max_lb != null && Number(out.min_lb) > Number(out.max_lb)) throw bad('min weight is above max weight');
  if (out.tare_lb === null) out.tare_lb = 0;
  return out;
}

r.get('/', h(async (req, res) => {
  const { rows } = await q(`
    SELECT p.*,
      (SELECT count(*)::int FROM cases c WHERE c.product_id = p.id AND c.status = 'IN_STOCK') AS in_stock,
      (SELECT coalesce(sum(weight_lb),0) FROM cases c WHERE c.product_id = p.id AND c.status = 'IN_STOCK') AS in_stock_lb
    FROM products p ORDER BY p.active DESC, p.name`);
  res.json(rows);
}));

r.post('/', h(async (req, res) => {
  const p = clean(req.body);
  if (!p.code || !p.name) throw bad('PLU and name are required');
  const cols = Object.keys(p);
  const { rows } = await q(
    `INSERT INTO products (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    cols.map((c) => p[c]));
  res.status(201).json(rows[0]);
}));

r.put('/:id', h(async (req, res) => {
  const p = clean(req.body);
  const cols = Object.keys(p);
  if (!cols.length) throw bad('nothing to update');
  const { rows } = await q(
    `UPDATE products SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [req.params.id, ...cols.map((c) => p[c])]);
  if (!rows[0]) throw notFound('product not found');
  // a newly mapped QuickBooks item links any open order lines already waiting on it
  if (rows[0].qbo_item_id) {
    await q(`UPDATE order_lines ol SET product_id = $1 FROM orders o
             WHERE ol.order_id = o.id AND o.status = 'OPEN' AND ol.product_id IS NULL AND ol.qbo_item_id = $2`,
      [rows[0].id, rows[0].qbo_item_id]);
  }
  res.json(rows[0]);
}));

export default r;
