import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

r.get('/', async (_req, res, next) => {
  try { res.json((await q('SELECT * FROM products ORDER BY name')).rows); }
  catch (e) { next(e); }
});
r.post('/', async (req, res, next) => {
  try {
    const { code, name, unit = 'lb' } = req.body;
    const { rows } = await q(
      'INSERT INTO products (code, name, unit) VALUES ($1,$2,$3) RETURNING *',
      [code, name, unit]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
r.patch('/:id', async (req, res, next) => {
  try {
    const { name, unit, active, code } = req.body;
    const { rows } = await q(
      `UPDATE products SET
         name = COALESCE($2,name), unit = COALESCE($3,unit),
         active = COALESCE($4,active), code = COALESCE($5,code)
       WHERE id=$1 RETURNING *`,
      [req.params.id, name, unit, active, code]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
export default r;
