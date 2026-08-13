import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

r.get('/', async (_req, res, next) => {
  try { res.json((await q('SELECT * FROM customers WHERE active ORDER BY name')).rows); }
  catch (e) { next(e); }
});
r.post('/', async (req, res, next) => {
  try {
    const { name, contact, email, phone, notes } = req.body;
    const { rows } = await q(
      'INSERT INTO customers (name, contact, email, phone, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, contact, email, phone, notes]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
export default r;
