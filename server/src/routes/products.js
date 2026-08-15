import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

const UNITS = ['lb', 'case', 'each'];
// The code is printed into GS1 AI (91) and into the ZPL stream. ^ and ~ are ZPL
// control chars and parens break the human-readable parse, so keep it to
// alphanumerics and dashes.
const CODE_RE = /^[A-Za-z0-9-]{1,20}$/;

// ?all=1 includes deactivated items (the Items screen manages those).
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.*,
         (SELECT COUNT(*) FROM cases c WHERE c.product_id = p.id AND c.status <> 'VOID'
            AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = c.id))::int AS pack_count
       FROM products p
       WHERE ($1::bool IS TRUE OR p.active)
       ORDER BY p.name`, [req.query.all === '1']);
    res.json(rows);
  } catch (e) { next(e); }
});

r.post('/', async (req, res, next) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    const unit = String(req.body?.unit ?? 'lb').trim() || 'lb';
    if (!code || !name) return res.status(400).json({ error: 'item code and name are required' });
    if (!CODE_RE.test(code))
      return res.status(400).json({ error: 'item code must be 1-20 letters, numbers or dashes' });
    if (!UNITS.includes(unit))
      return res.status(400).json({ error: `unit must be one of ${UNITS.join(', ')}` });

    const dup = (await q('SELECT id, name, active FROM products WHERE lower(code)=lower($1)', [code])).rows[0];
    if (dup) return res.status(409).json({
      error: `item code ${code} is already used by "${dup.name}"${dup.active ? '' : ' (deactivated)'}` });

    const { rows } = await q(
      'INSERT INTO products (code, name, unit) VALUES ($1,$2,$3) RETURNING *', [code, name, unit]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

r.patch('/:id', async (req, res, next) => {
  try {
    const { name, unit, active, code } = req.body ?? {};
    if (code !== undefined) {
      const c = String(code).trim();
      if (!CODE_RE.test(c))
        return res.status(400).json({ error: 'item code must be 1-20 letters, numbers or dashes' });
      const dup = (await q(
        'SELECT id FROM products WHERE lower(code)=lower($1) AND id <> $2', [c, req.params.id])).rows[0];
      if (dup) return res.status(409).json({ error: `item code ${c} is already in use` });
    }
    if (unit !== undefined && !UNITS.includes(String(unit)))
      return res.status(400).json({ error: `unit must be one of ${UNITS.join(', ')}` });
    if (name !== undefined && !String(name).trim())
      return res.status(400).json({ error: 'item name is required' });

    const { rows } = await q(
      `UPDATE products SET
         name = COALESCE($2,name), unit = COALESCE($3,unit),
         active = COALESCE($4,active), code = COALESCE($5,code)
       WHERE id=$1 RETURNING *`,
      [req.params.id, name?.trim(), unit, active, code?.trim()]);
    if (!rows[0]) return res.status(404).json({ error: 'item not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});
export default r;
