import { Router } from 'express';
import { q, pool } from '../db.js';
import { parseScan } from '../gs1.js';
const r = Router();

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Output of a batch = the leaf cases printed into its lot. Leaf-only, because a
// container case and its packs both sit in the lot and counting both would
// double the yield.
const OUTPUT_SQL = `
  SELECT p.id AS product_id, p.code, p.name, p.market_value_per_lb,
         COUNT(c.id)::int AS packs,
         COALESCE(SUM(c.net_weight_lb),0)::numeric AS weight_lb
  FROM cases c JOIN products p ON p.id = c.product_id
  WHERE c.lot_id = $1 AND c.status <> 'VOID'
    AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = c.id)
  GROUP BY p.id ORDER BY p.name`;

const withLot = `
  SELECT b.*, l.lot_code, l.pack_date, l.batch_no, l.parent_lot_id,
         (SELECT lp.lot_code FROM lots lp WHERE lp.id = l.parent_lot_id) AS parent_lot_code
  FROM production_batches b JOIN lots l ON l.id = b.lot_id`;

// list — ?status=OPEN for the station/plant picker
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `${withLot}
       WHERE ($1::batch_status IS NULL OR b.status = $1::batch_status)
       ORDER BY b.opened_at DESC LIMIT 200`, [req.query.status || null]);
    // a cheap output summary so the list can show progress without N calls
    for (const b of rows) {
      const o = (await q(
        `SELECT COUNT(*)::int AS packs, COALESCE(SUM(net_weight_lb),0)::numeric AS lb
         FROM cases c WHERE c.lot_id=$1 AND c.status <> 'VOID'
           AND NOT EXISTS (SELECT 1 FROM cases ch WHERE ch.parent_id = c.id)`,
        [b.lot_id])).rows[0];
      b.output_packs = o.packs;
      b.output_lb = Number(o.lb);
    }
    res.json(rows);
  } catch (e) { next(e); }
});

// Open a batch. Creates (or reuses) the lot it will print into: the batch owns
// a lot, so everything the station prints while it is open belongs to it.
r.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { batch_type = 'CUT', pack_date, batch_no, input_weight_lb,
            bird_count, input_cost, notes, parent_lot_code } = req.body ?? {};
    if (!['CUT', 'FORMULATE'].includes(batch_type))
      return res.status(400).json({ error: 'batch_type must be CUT or FORMULATE' });

    await client.query('BEGIN');
    const d = pack_date || new Date().toISOString().slice(0, 10);
    // next free batch number for the day unless one was given
    let n = Number(batch_no);
    if (!n) {
      const { rows } = await client.query(
        'SELECT COALESCE(MAX(batch_no),0)+1 AS n FROM lots WHERE pack_date=$1', [d]);
      n = rows[0].n;
    }
    const code = d.slice(2).replaceAll('-', '') + '-B' + n;
    const lot = (await client.query(
      `INSERT INTO lots (lot_code, pack_date, batch_no) VALUES ($1,$2,$3)
       ON CONFLICT (pack_date, batch_no) DO UPDATE SET lot_code = lots.lot_code
       RETURNING *`, [code, d, n])).rows[0];

    const open = (await client.query(
      `SELECT id FROM production_batches WHERE lot_id=$1 AND status='OPEN'`, [lot.id])).rows[0];
    if (open) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `lot ${lot.lot_code} already has an open batch` });
    }

    if (parent_lot_code) {
      const p = (await client.query('SELECT id FROM lots WHERE lot_code=$1', [parent_lot_code])).rows[0];
      if (p) await client.query('UPDATE lots SET parent_lot_id=$2 WHERE id=$1', [lot.id, p.id]);
    }

    const b = (await client.query(
      `INSERT INTO production_batches
         (batch_type, lot_id, input_weight_lb, bird_count, input_cost, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [batch_type, lot.id, num(input_weight_lb), num(bird_count), num(input_cost), notes || null])).rows[0];
    await client.query('COMMIT');
    res.status(201).json({ ...b, lot_code: lot.lot_code, pack_date: lot.pack_date, batch_no: lot.batch_no });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

r.patch('/:id', async (req, res, next) => {
  try {
    const { input_weight_lb, bird_count, input_cost, notes } = req.body ?? {};
    const { rows } = await q(
      `UPDATE production_batches SET
         input_weight_lb = COALESCE($2, input_weight_lb),
         bird_count      = COALESCE($3, bird_count),
         input_cost      = COALESCE($4, input_cost),
         notes           = COALESCE($5, notes)
       WHERE id=$1 RETURNING *`,
      [req.params.id, num(input_weight_lb), num(bird_count), num(input_cost), notes ?? null]);
    if (!rows[0]) return res.status(404).json({ error: 'batch not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

r.post('/:id/close', async (req, res, next) => {
  try {
    const { rows } = await q(
      `UPDATE production_batches SET status='CLOSED', closed_at=now()
       WHERE id=$1 AND status='OPEN' RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(409).json({ error: 'batch is not open' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

r.post('/:id/reopen', async (req, res, next) => {
  try {
    const { rows } = await q(
      `UPDATE production_batches SET status='OPEN', closed_at=NULL
       WHERE id=$1 AND status='CLOSED' RETURNING *`, [req.params.id]);
    if (!rows[0]) return res.status(409).json({ error: 'batch is not closed' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Add an input: either a scanned case (weight and product come from it, and the
// batch's lot inherits that case's lot as its parent for traceability) or a
// manual product + qty.
r.post('/:id/inputs', async (req, res, next) => {
  try {
    const b = (await q('SELECT * FROM production_batches WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'batch not found' });
    if (b.status !== 'OPEN') return res.status(409).json({ error: 'batch is closed' });

    let { barcode, product_id, qty, unit = 'lb' } = req.body ?? {};
    let case_id = null;

    if (barcode) {
      const p = parseScan(barcode);
      const c = (await q('SELECT * FROM cases WHERE serial=$1', [p.serial])).rows[0];
      if (!c) return res.status(404).json({ error: 'input case not found — scan it in first' });
      if (c.lot_id === b.lot_id)
        return res.status(409).json({ error: 'that case is output of this batch, not input' });
      case_id = c.id;
      product_id = c.product_id;
      qty = Number(c.net_weight_lb);
      unit = 'lb';
      // consumed by production, so it leaves sellable stock
      await q(`UPDATE cases SET status='SHIPPED' WHERE id=$1 AND status='IN_STOCK'`, [c.id]);
      await q(`UPDATE lots SET parent_lot_id=$2 WHERE id=$1 AND parent_lot_id IS NULL`,
        [b.lot_id, c.lot_id]);
    }
    if (!product_id || !qty) return res.status(400).json({ error: 'need a barcode, or product_id and qty' });
    if (!['lb', 'each'].includes(unit)) return res.status(400).json({ error: 'unit must be lb or each' });

    const { rows } = await q(
      `INSERT INTO batch_inputs (batch_id, product_id, case_id, qty, unit)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.id, product_id, case_id, qty, unit]);

    // keep the declared carcass weight in step with what was actually scanned
    if (unit === 'lb') {
      await q(
        `UPDATE production_batches SET input_weight_lb =
           (SELECT COALESCE(SUM(qty),0) FROM batch_inputs WHERE batch_id=$1 AND unit='lb')
         WHERE id=$1 AND EXISTS (SELECT 1 FROM batch_inputs WHERE batch_id=$1 AND case_id IS NOT NULL)`,
        [b.id]);
    }
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

r.get('/:id/inputs', async (req, res, next) => {
  try {
    res.json((await q(
      `SELECT bi.*, p.name AS product_name, p.code AS item_code, c.serial
       FROM batch_inputs bi
       LEFT JOIN products p ON p.id = bi.product_id
       LEFT JOIN cases c ON c.id = bi.case_id
       WHERE bi.batch_id=$1 ORDER BY bi.id`, [req.params.id])).rows);
  } catch (e) { next(e); }
});

// Yield report.
//   yield %          = product output lb / input lb
//   unaccounted      = input lb - total output lb  (bone, trim, drip, loss)
//   cost allocation  = by RELATIVE MARKET VALUE, not by weight: a pound of
//                      breast carries more of the carcass cost than a pound of
//                      backs. share = (out_lb x value/lb) / total of that.
//                      Dollars need input_cost; shares need only prices.
r.get('/:id/yield', async (req, res, next) => {
  try {
    const b = (await q(`${withLot} WHERE b.id=$1`, [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'batch not found' });

    const outputs = (await q(OUTPUT_SQL, [b.lot_id])).rows.map((o) => ({
      ...o,
      weight_lb: Number(o.weight_lb),
      market_value_per_lb: o.market_value_per_lb === null ? null : Number(o.market_value_per_lb),
    }));

    const inputLb = b.input_weight_lb === null ? null : Number(b.input_weight_lb);
    const totalOut = outputs.reduce((s, o) => s + o.weight_lb, 0);

    const unpriced = outputs.filter((o) => o.market_value_per_lb === null).map((o) => o.name);
    const totalValue = outputs.reduce(
      (s, o) => s + o.weight_lb * (o.market_value_per_lb ?? 0), 0);
    const canAllocate = outputs.length > 0 && unpriced.length === 0 && totalValue > 0;
    const cost = b.input_cost === null ? null : Number(b.input_cost);

    const rows = outputs.map((o) => {
      const value = o.market_value_per_lb === null ? null : o.weight_lb * o.market_value_per_lb;
      const share = canAllocate ? value / totalValue : null;
      return {
        product_id: o.product_id, code: o.code, name: o.name,
        packs: o.packs,
        weight_lb: Number(o.weight_lb.toFixed(2)),
        yield_pct: inputLb ? Number((100 * o.weight_lb / inputLb).toFixed(2)) : null,
        market_value_per_lb: o.market_value_per_lb,
        market_value: value === null ? null : Number(value.toFixed(2)),
        value_share_pct: share === null ? null : Number((100 * share).toFixed(2)),
        allocated_cost: share !== null && cost !== null ? Number((cost * share).toFixed(2)) : null,
        cost_per_lb: share !== null && cost !== null && o.weight_lb
          ? Number((cost * share / o.weight_lb).toFixed(4)) : null,
      };
    });

    const unaccounted = inputLb === null ? null : Number((inputLb - totalOut).toFixed(2));
    res.json({
      batch: {
        id: b.id, batch_type: b.batch_type, status: b.status, lot_code: b.lot_code,
        parent_lot_code: b.parent_lot_code, opened_at: b.opened_at, closed_at: b.closed_at,
        notes: b.notes,
      },
      input: {
        weight_lb: inputLb, bird_count: b.bird_count, cost,
        avg_bird_lb: inputLb && b.bird_count ? Number((inputLb / b.bird_count).toFixed(2)) : null,
      },
      outputs: rows,
      totals: {
        output_lb: Number(totalOut.toFixed(2)),
        output_packs: outputs.reduce((s, o) => s + o.packs, 0),
        yield_pct: inputLb ? Number((100 * totalOut / inputLb).toFixed(2)) : null,
      },
      unaccounted: unaccounted === null ? null : {
        weight_lb: unaccounted,
        pct: inputLb ? Number((100 * unaccounted / inputLb).toFixed(2)) : null,
        note: unaccounted < 0
          ? 'output exceeds declared input — check the carcass weight'
          : 'bone, trim, drip and loss',
      },
      costing: {
        basis: 'relative market value',
        allocatable: canAllocate,
        blocked_by: canAllocate ? [] : (outputs.length === 0
          ? ['no output yet']
          : unpriced.length ? unpriced.map((n) => `${n} has no market value per lb`)
            : ['market values are all zero']),
        input_cost_set: cost !== null,
      },
    });
  } catch (e) { next(e); }
});

export default r;
