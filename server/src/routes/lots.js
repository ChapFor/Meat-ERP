import { Router } from 'express';
import { q } from '../db.js';
import { h, bad, notFound, todayISO } from '../util.js';
import { yymmdd } from '../../../shared/gs1.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const { rows } = await q(`
    SELECT l.*,
      (SELECT count(*)::int FROM cases c WHERE c.lot_id = l.id AND c.status <> 'VOID') AS cases,
      (SELECT coalesce(sum(weight_lb),0) FROM cases c WHERE c.lot_id = l.id AND c.status <> 'VOID') AS lb
    FROM lots l
    WHERE l.status = 'OPEN' OR l.pack_date >= current_date - 14
    ORDER BY l.pack_date DESC, l.batch_no DESC`);
  res.json(rows);
}));

// Start the next run of the day: 261122-B1, -B2, ...
r.post('/', h(async (req, res) => {
  const date = req.body.pack_date || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('pack_date must be YYYY-MM-DD');
  const { rows } = await q(`
    INSERT INTO lots (code, pack_date, batch_no, note)
    SELECT $2 || '-B' || n, $1::date, n, $3
    FROM (SELECT coalesce(max(batch_no), 0) + 1 AS n FROM lots WHERE pack_date = $1::date) x
    RETURNING *`, [date, yymmdd(date), req.body.note || null]);
  res.status(201).json(rows[0]);
}));

r.put('/:id', h(async (req, res) => {
  const { status, note } = req.body;
  if (status && !['OPEN', 'CLOSED'].includes(status)) throw bad('status must be OPEN or CLOSED');
  const { rows } = await q(
    `UPDATE lots SET status = coalesce($2, status), note = coalesce($3, note) WHERE id = $1 RETURNING *`,
    [req.params.id, status || null, note ?? null]);
  if (!rows[0]) throw notFound('lot not found');
  res.json(rows[0]);
}));

export default r;
