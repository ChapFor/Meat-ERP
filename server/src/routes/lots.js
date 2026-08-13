import { Router } from 'express';
import { q } from '../db.js';
const r = Router();

r.get('/', async (_req, res, next) => {
  try {
    res.json((await q(
      `SELECT l.*, COUNT(c.id) FILTER (WHERE c.status <> 'VOID') AS case_count
       FROM lots l LEFT JOIN cases c ON c.lot_id = l.id
       GROUP BY l.id ORDER BY l.pack_date DESC, l.batch_no DESC LIMIT 100`)).rows);
  } catch (e) { next(e); }
});

// find-or-create a lot for (pack_date, batch_no). Lot code = YYMMDD-B{n}
r.post('/', async (req, res, next) => {
  try {
    const { pack_date, batch_no, species, notes } = req.body;
    const d = pack_date || new Date().toISOString().slice(0, 10);
    const code = d.slice(2).replaceAll('-', '') + '-B' + batch_no;
    const { rows } = await q(
      `INSERT INTO lots (lot_code, pack_date, batch_no, species, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (pack_date, batch_no) DO UPDATE SET species = COALESCE(EXCLUDED.species, lots.species)
       RETURNING *`,
      [code, d, batch_no, species, notes]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
export default r;
