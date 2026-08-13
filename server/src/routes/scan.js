import { Router } from 'express';
import { q } from '../db.js';
import { parseScan } from '../gs1.js';
const r = Router();

// Scan-in after printing: PENDING -> IN_STOCK.
// If the station upload never arrived, the barcode itself carries enough
// to create the case (self-healing).
r.post('/in', async (req, res, next) => {
  try {
    const p = parseScan(req.body.barcode);
    let c = (await q('SELECT * FROM cases WHERE serial=$1', [p.serial])).rows[0];

    if (!c) {
      if (!p.itemCode || !p.lotCode || !p.weightLb)
        return res.status(404).json({ error: 'case not found and barcode incomplete — cannot create' });
      const prod = (await q('SELECT * FROM products WHERE code=$1', [p.itemCode])).rows[0];
      if (!prod) return res.status(400).json({ error: `unknown item code ${p.itemCode}` });
      let lot = (await q('SELECT * FROM lots WHERE lot_code=$1', [p.lotCode])).rows[0];
      if (!lot) {
        const [d, b] = p.lotCode.split('-B');
        const packDate = `20${d.slice(0,2)}-${d.slice(2,4)}-${d.slice(4,6)}`;
        lot = (await q(
          `INSERT INTO lots (lot_code, pack_date, batch_no) VALUES ($1,$2,$3) RETURNING *`,
          [p.lotCode, packDate, Number(b) || 1])).rows[0];
      }
      c = (await q(
        `INSERT INTO cases (serial, product_id, lot_id, net_weight_lb)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [p.serial, prod.id, lot.id, p.weightLb])).rows[0];
    }

    if (c.status === 'IN_STOCK')
      return res.status(200).json({ ...c, warning: 'already scanned in' });
    if (c.status !== 'PENDING')
      return res.status(409).json({ error: `case is ${c.status}, cannot scan in` });

    const { rows } = await q(
      `UPDATE cases SET status='IN_STOCK', scanned_in_at=now() WHERE id=$1 RETURNING *`, [c.id]);
    const full = (await q(
      `SELECT c.*, p.name AS product_name, l.lot_code FROM cases c
       JOIN products p ON p.id=c.product_id JOIN lots l ON l.id=c.lot_id WHERE c.id=$1`,
      [rows[0].id])).rows[0];
    res.json(full);
  } catch (e) { next(e); }
});

// Pack to order: scan a case against an order; matches to an open line for that product.
r.post('/pack', async (req, res, next) => {
  try {
    const { barcode, order_id } = req.body;
    const p = parseScan(barcode);
    const c = (await q(
      `SELECT c.*, pr.code AS item_code, pr.name AS product_name FROM cases c
       JOIN products pr ON pr.id = c.product_id WHERE serial=$1`, [p.serial])).rows[0];
    if (!c) return res.status(404).json({ error: 'case not found — scan it in first' });
    if (c.status !== 'IN_STOCK')
      return res.status(409).json({ error: `case is ${c.status}, not available` });

    const line = (await q(
      `SELECT ol.*, 
         (SELECT COUNT(*) FROM cases x WHERE x.order_line_id = ol.id AND x.status IN ('ALLOCATED','SHIPPED')) AS packed_cases,
         (SELECT COALESCE(SUM(x.net_weight_lb),0) FROM cases x WHERE x.order_line_id = ol.id AND x.status IN ('ALLOCATED','SHIPPED')) AS packed_lb
       FROM order_lines ol
       WHERE ol.order_id=$1 AND ol.product_id=$2
       ORDER BY ol.id`, [order_id, c.product_id])).rows[0];
    if (!line)
      return res.status(409).json({ error: `${c.product_name} is not on this order` });

    const overCases = line.qty_cases && Number(line.packed_cases) >= line.qty_cases;
    const overLb = line.qty_lb && Number(line.packed_lb) >= Number(line.qty_lb);
    const warning = (overCases || overLb) ? 'line already at/over ordered quantity' : null;

    await q(`UPDATE cases SET status='ALLOCATED', order_line_id=$2 WHERE id=$1`, [c.id, line.id]);
    await q(`INSERT INTO pack_scans (case_id, order_line_id) VALUES ($1,$2)`, [c.id, line.id]);
    await q(`UPDATE orders SET status='PACKING' WHERE id=$1 AND status='OPEN'`, [order_id]);
    res.json({ case: { ...c, status: 'ALLOCATED' }, line_id: line.id, warning });
  } catch (e) { next(e); }
});

// undo a pack scan (wrong order, wrong case)
r.post('/unpack', async (req, res, next) => {
  try {
    const p = parseScan(req.body.barcode);
    const { rows } = await q(
      `UPDATE cases SET status='IN_STOCK', order_line_id=NULL
       WHERE serial=$1 AND status='ALLOCATED' RETURNING *`, [p.serial]);
    if (!rows[0]) return res.status(409).json({ error: 'case is not allocated' });
    await q(`UPDATE pack_scans SET undone=TRUE WHERE case_id=$1 AND undone=FALSE`, [rows[0].id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
export default r;
