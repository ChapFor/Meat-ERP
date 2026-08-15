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

    // A case label stands for everything in it: scanning the box scans in its packs.
    const packs = (await q(
      `SELECT * FROM cases WHERE parent_id=$1`, [c.id])).rows;

    if (c.status === 'IN_STOCK' && !packs.some((p) => p.status === 'PENDING'))
      return res.status(200).json({ ...c, pack_count: packs.length, warning: 'already scanned in' });
    if (!['PENDING', 'IN_STOCK'].includes(c.status))
      return res.status(409).json({ error: `case is ${c.status}, cannot scan in` });

    await q(
      `UPDATE cases SET status='IN_STOCK', scanned_in_at=now()
       WHERE (id=$1 OR parent_id=$1) AND status='PENDING'`, [c.id]);
    const full = (await q(
      `SELECT c.*, p.name AS product_name, l.lot_code,
         (SELECT COUNT(*) FROM cases ch WHERE ch.parent_id = c.id)::int AS pack_count
       FROM cases c JOIN products p ON p.id=c.product_id JOIN lots l ON l.id=c.lot_id
       WHERE c.id=$1`, [c.id])).rows[0];
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

    // packed totals count leaves only: a container and its packs both carry the
    // order line, and counting both would double the shipped weight
    const line = (await q(
      `SELECT ol.*,
         (SELECT COUNT(*) FROM cases x WHERE x.order_line_id = ol.id AND x.status IN ('ALLOCATED','SHIPPED')
            AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = x.id)) AS packed_packs,
         (SELECT COUNT(*) FROM cases x WHERE x.order_line_id = ol.id AND x.status IN ('ALLOCATED','SHIPPED')
            AND EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = x.id)) AS packed_cases,
         (SELECT COALESCE(SUM(x.net_weight_lb),0) FROM cases x WHERE x.order_line_id = ol.id AND x.status IN ('ALLOCATED','SHIPPED')
            AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = x.id)) AS packed_lb
       FROM order_lines ol
       WHERE ol.order_id=$1 AND ol.product_id=$2
       ORDER BY ol.id`, [order_id, c.product_id])).rows[0];
    if (!line)
      return res.status(409).json({ error: `${c.product_name} is not on this order` });

    // compare like with like: a line ordered in cases is measured in cases
    const packedInUnit = line.qty_unit === 'case' ? line.packed_cases : line.packed_packs;
    const overQty = line.qty_cases && Number(packedInUnit) >= line.qty_cases;
    const overLb = line.qty_lb && Number(line.packed_lb) >= Number(line.qty_lb);
    const warning = (overQty || overLb) ? 'line already at/over ordered quantity' : null;

    // Scanning a case label allocates the packs inside it, not the box: the
    // packs carry the catch weights that drive invoicing. Scanning one pack
    // off a broken-open case allocates just that pack.
    const packs = (await q(
      `SELECT * FROM cases WHERE parent_id=$1 AND status='IN_STOCK'`, [c.id])).rows;
    const units = packs.length ? packs : [c];

    await q(`UPDATE cases SET status='ALLOCATED', order_line_id=$2 WHERE id = ANY($1)`,
      [units.map((u) => u.id), line.id]);
    for (const u of units)
      await q(`INSERT INTO pack_scans (case_id, order_line_id) VALUES ($1,$2)`, [u.id, line.id]);
    if (packs.length)   // the emptied box follows its packs; not a leaf, so it
      await q(`UPDATE cases SET status='ALLOCATED', order_line_id=$2 WHERE id=$1`,
        [c.id, line.id]);                       // never counts toward the totals
    await q(`UPDATE orders SET status='PACKING' WHERE id=$1 AND status='OPEN'`, [order_id]);

    const lb = units.reduce((s, u) => s + Number(u.net_weight_lb), 0);
    res.json({
      case: { ...c, status: 'ALLOCATED', net_weight_lb: lb.toFixed(2) },
      packs_allocated: units.length,
      is_case: packs.length > 0,
      line_id: line.id,
      warning,
    });
  } catch (e) { next(e); }
});

// undo a pack scan (wrong order, wrong case)
r.post('/unpack', async (req, res, next) => {
  try {
    const p = parseScan(req.body.barcode);
    const before = (await q('SELECT * FROM cases WHERE serial=$1', [p.serial])).rows[0];
    if (!before || before.status !== 'ALLOCATED')
      return res.status(409).json({ error: 'case is not allocated' });

    const { rows } = await q(
      `UPDATE cases SET status='IN_STOCK', order_line_id=NULL WHERE id=$1 RETURNING *`, [before.id]);
    // Releases only the packs that went out on this same line. Packs picked off
    // this case for a different order stay where they are.
    const { rows: kids } = await q(
      `UPDATE cases SET status='IN_STOCK', order_line_id=NULL
       WHERE parent_id=$1 AND status='ALLOCATED' AND order_line_id=$2 RETURNING id`,
      [before.id, before.order_line_id]);
    const ids = [before.id, ...kids.map((k) => k.id)];
    await q(`UPDATE pack_scans SET undone=TRUE WHERE case_id = ANY($1) AND undone=FALSE`, [ids]);
    res.json({ ...rows[0], packs_released: kids.length });
  } catch (e) { next(e); }
});
export default r;
