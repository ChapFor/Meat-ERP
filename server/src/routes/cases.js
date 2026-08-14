import { Router } from 'express';
import { q } from '../db.js';
import { humanReadable, zplFieldData } from '../gs1.js';
const r = Router();

// Called by the weigh-label station right after printing.
// Creates the case as PENDING. Accepts a station-generated serial (works offline-queued),
// or generates one server-side: {lot_code}-{seq}.
r.post('/', async (req, res, next) => {
  try {
    const { item_code, lot_code, net_weight_lb, serial } = req.body;
    const prod = (await q('SELECT * FROM products WHERE code=$1', [item_code])).rows[0];
    if (!prod) return res.status(400).json({ error: `unknown item code ${item_code}` });
    let lot = (await q('SELECT * FROM lots WHERE lot_code=$1', [lot_code])).rows[0];
    if (!lot) {
      // self-heal like scan-in: the station may have created the lot while offline
      const m = /^(\d{6})-B(\d+)$/.exec(lot_code || '');
      if (!m) return res.status(400).json({ error: `unknown lot ${lot_code}` });
      const [, d, b] = m;
      const packDate = `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
      lot = (await q(
        `INSERT INTO lots (lot_code, pack_date, batch_no) VALUES ($1,$2,$3)
         ON CONFLICT (pack_date, batch_no) DO UPDATE SET lot_code = lots.lot_code
         RETURNING *`,
        [lot_code, packDate, Number(b)])).rows[0];
    }

    let sn = serial;
    if (!sn) {
      const { rows } = await q(
        `SELECT COUNT(*)::int AS n FROM cases WHERE lot_id=$1`, [lot.id]);
      sn = `${lot.lot_code}-${String(rows[0].n + 1).padStart(4, '0')}`;
    }
    const { rows } = await q(
      `INSERT INTO cases (serial, product_id, lot_id, net_weight_lb)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (serial) DO UPDATE SET serial = EXCLUDED.serial
       RETURNING *`,
      [sn, prod.id, lot.id, net_weight_lb]);
    const c = rows[0];
    const barcode = {
      itemCode: prod.code, weightLb: c.net_weight_lb,
      packDate: lot.pack_date, lotCode: lot.lot_code, serial: c.serial,
    };
    res.status(201).json({
      ...c,
      human_readable: humanReadable(barcode),
      zpl_field_data: zplFieldData(barcode),
    });
  } catch (e) { next(e); }
});

// Close a case: group already-printed packs into a container and return its
// label. The container takes the next serial in the lot — parent_id is what
// marks it a container, so no special serial format is needed (and a 5-digit
// one would land on an odd digit count and widen the symbol past the label).
// Packs must share a product and lot, because pack-to-order matches an order
// line by product and a mixed container would be ambiguous.
r.post('/container', async (req, res, next) => {
  try {
    const serials = req.body?.child_serials;
    if (!Array.isArray(serials) || serials.length === 0)
      return res.status(400).json({ error: 'child_serials is required' });

    const { rows: kids } = await q(
      `SELECT c.*, p.code AS item_code, l.lot_code
       FROM cases c JOIN products p ON p.id=c.product_id JOIN lots l ON l.id=c.lot_id
       WHERE c.serial = ANY($1)`, [serials]);
    if (kids.length !== serials.length) {
      const found = new Set(kids.map((k) => k.serial));
      return res.status(404).json({ error: `unknown pack ${serials.find((s) => !found.has(s))}` });
    }
    const already = kids.find((k) => k.parent_id);
    if (already) return res.status(409).json({ error: `pack ${already.serial} is already in a case` });
    const bad = kids.find((k) => !['PENDING', 'IN_STOCK'].includes(k.status));
    if (bad) return res.status(409).json({ error: `pack ${bad.serial} is ${bad.status}` });
    if (new Set(kids.map((k) => k.product_id)).size > 1)
      return res.status(409).json({ error: 'a case must hold one product' });
    if (new Set(kids.map((k) => k.lot_id)).size > 1)
      return res.status(409).json({ error: 'a case must hold one lot' });

    const { product_id, lot_id, item_code, lot_code } = kids[0];
    const net = kids.reduce((s, k) => s + Number(k.net_weight_lb), 0);
    const seq = (await q('SELECT COUNT(*)::int AS n FROM cases WHERE lot_id=$1', [lot_id])).rows[0].n;
    const sn = `${lot_code}-${String(seq + 1).padStart(4, '0')}`;

    // container inherits the packs' status so a case closed after scan-in is
    // not stuck at PENDING
    const status = kids.every((k) => k.status === 'IN_STOCK') ? 'IN_STOCK' : 'PENDING';
    const box = (await q(
      `INSERT INTO cases (serial, product_id, lot_id, net_weight_lb, status, scanned_in_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [sn, product_id, lot_id, net.toFixed(2), status,
       status === 'IN_STOCK' ? new Date() : null])).rows[0];
    await q('UPDATE cases SET parent_id=$1 WHERE id = ANY($2)', [box.id, kids.map((k) => k.id)]);

    const barcode = { itemCode: item_code, weightLb: box.net_weight_lb, lotCode: lot_code, serial: box.serial };
    res.status(201).json({
      ...box,
      pack_count: kids.length,
      item_code, lot_code,
      human_readable: humanReadable(barcode),
      zpl_field_data: zplFieldData(barcode),
    });
  } catch (e) { next(e); }
});

r.post('/:id/void', async (req, res, next) => {
  try {
    const { rows } = await q(
      `UPDATE cases SET status='VOID', voided_at=now(), void_reason=$2
       WHERE id=$1 AND status IN ('PENDING','IN_STOCK') RETURNING *`,
      [req.params.id, req.body?.reason || 'voided']);
    if (!rows[0]) return res.status(409).json({ error: 'case not voidable in current status' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

r.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const { rows } = await q(
      `SELECT c.*, p.name AS product_name, p.code AS item_code, l.lot_code,
         (SELECT COUNT(*) FROM cases ch WHERE ch.parent_id = c.id)::int AS pack_count
       FROM cases c JOIN products p ON p.id=c.product_id JOIN lots l ON l.id=c.lot_id
       WHERE ($1::case_status IS NULL OR c.status = $1::case_status)
       ORDER BY c.printed_at DESC LIMIT 500`, [status || null]);
    res.json(rows);
  } catch (e) { next(e); }
});
export default r;
