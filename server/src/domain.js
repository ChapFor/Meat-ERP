// Case and order rules shared by the station upload, scanning and manifest routes.
import { q, tx } from './db.js';
import { parseScan, expandSerial } from '../../shared/gs1.js';
import { bad, conflict, notFound } from './util.js';

export const CASE_SELECT = `
  SELECT c.*, p.code AS product_code, p.name AS product_name, l.code AS lot_code,
         o.id AS order_id, o.doc_number AS order_doc, o.customer_name
  FROM cases c
  JOIN products p ON p.id = c.product_id
  JOIN lots l ON l.id = c.lot_id
  LEFT JOIN order_lines ol ON ol.id = c.order_line_id
  LEFT JOIN orders o ON o.id = ol.order_id`;

export async function getCase(db, serial) {
  const { rows } = await db.query(`${CASE_SELECT} WHERE c.serial = $1`, [serial]);
  return rows[0] || null;
}

// Record one printed label. Idempotent on serial: a station retrying an upload
// that already landed gets the existing row back.
// orderLineId set = packed to order at the station → goes straight to ALLOCATED.
export async function recordCase(db, { serial, productCode, lotCode, weightLb, printedAt, station, orderLineId, printMs }) {
  const existing = await getCase(db, serial);
  if (existing) return { case: existing, created: false };

  const prod = (await db.query('SELECT id FROM products WHERE code = $1', [String(productCode)])).rows[0];
  if (!prod) throw bad(`unknown PLU ${productCode}`);
  const lot = (await db.query('SELECT id FROM lots WHERE code = $1', [lotCode])).rows[0];
  if (!lot) throw bad(`unknown lot ${lotCode}`);
  if (!(Number(weightLb) > 0)) throw bad('weight must be > 0');

  let status = 'IN_STOCK', lineId = null, warning = null;
  if (orderLineId) {
    const line = (await db.query(`
      SELECT ol.id, ol.product_id, o.status FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE ol.id = $1`, [orderLineId])).rows[0];
    if (line && line.status === 'OPEN' && line.product_id === prod.id) { status = 'ALLOCATED'; lineId = line.id; }
    else warning = 'order line was no longer open for this product — case went to inventory';
  }

  const { rows } = await db.query(`
    INSERT INTO cases (serial, product_id, lot_id, weight_lb, status, order_line_id, station, printed_at, allocated_at, print_ms)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $5 = 'ALLOCATED' THEN now() END, $9)
    ON CONFLICT (serial) DO NOTHING
    RETURNING id`,
    [serial, prod.id, lot.id, weightLb, status, lineId, station || null, printedAt || new Date(), printMs ?? null]);
  if (rows[0]) {
    await db.query(`INSERT INTO case_events (case_id, event, detail) VALUES ($1, 'PRINTED', $2)`, [rows[0].id, station || null]);
    if (lineId) await db.query(`
      INSERT INTO case_events (case_id, event, order_id, detail)
      SELECT $1, 'ALLOCATED', order_id, 'packed to order at station' FROM order_lines WHERE id = $2`, [rows[0].id, lineId]);
  }
  return { case: await getCase(db, serial), created: !!rows[0], warning };
}

// Resolve a scanned barcode to a case. If the station's upload has not landed
// yet, the barcode alone carries enough to create the record.
export async function caseFromScan(db, raw) {
  let parsed;
  try { parsed = parseScan(raw); } catch (e) { throw bad(`not a case label: ${e.message}`); }
  const found = await getCase(db, parsed.serial);
  if (found) return found;
  if (!parsed.itemCode || !parsed.lotCode || !parsed.weightLb) throw notFound(`case ${parsed.serial} is not in the system`);
  const { case: c } = await recordCase(db, {
    serial: parsed.serial, productCode: parsed.itemCode, lotCode: parsed.lotCode,
    weightLb: parsed.weightLb, station: 'scan-recovered',
  });
  return c;
}

// Progress for each line of an order. Lines are counted in cases.
export async function orderLines(db, orderId) {
  const { rows } = await db.query(`
    SELECT ol.*, p.code AS product_code, p.name AS product_name,
      count(c.id) FILTER (WHERE c.status IN ('ALLOCATED','SHIPPED'))::int AS cases_packed,
      coalesce(sum(c.weight_lb) FILTER (WHERE c.status IN ('ALLOCATED','SHIPPED')), 0) AS lb_packed
    FROM order_lines ol
    LEFT JOIN products p ON p.id = ol.product_id
    LEFT JOIN cases c ON c.order_line_id = ol.id
    WHERE ol.order_id = $1
    GROUP BY ol.id, p.code, p.name
    ORDER BY ol.line_no`, [orderId]);
  return rows.map((l) => ({ ...l, cases_remaining: Math.max(0, Math.ceil(Number(l.qty_ordered)) - l.cases_packed) }));
}

export async function getOrder(db, id) {
  const o = (await db.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
  if (!o) throw notFound('order not found');
  return { ...o, lines: await orderLines(db, id) };
}

// Scan a case onto an order (shipping dock or pack-to-order screen).
// Refuses anything that would make the paperwork wrong, with a reason the
// operator can act on.
export async function allocateScan(orderId, raw) {
  return tx(async (db) => {
    const order = (await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
    if (!order) throw notFound('order not found');
    if (order.status !== 'OPEN') throw conflict(`order ${order.doc_number} is ${order.status.toLowerCase()}`);

    const c = await caseFromScan(db, raw);
    const tag = `${c.product_name} ${c.serial}`;
    if (c.status === 'VOID') throw conflict(`VOIDED label — ${tag} must not ship`);
    if (c.status === 'SHIPPED') throw conflict(`already shipped on order ${c.order_doc} — ${tag}`);
    if (c.status === 'ALLOCATED') {
      if (c.order_id === order.id) throw conflict(`already scanned on this order — ${tag}`, { duplicate: true });
      throw conflict(`belongs to order ${c.order_doc} (${c.customer_name}) — ${tag}`);
    }

    const lines = await orderLines(db, order.id);
    const forProduct = lines.filter((l) => l.product_id === c.product_id);
    if (!forProduct.length) throw conflict(`${c.product_name} is not on order ${order.doc_number}`);
    const line = forProduct.find((l) => l.cases_remaining > 0);
    if (!line) {
      const l = forProduct[0];
      throw conflict(`${c.product_name} line is already full (${l.cases_packed} of ${Number(l.qty_ordered)} cases)`);
    }

    const upd = await db.query(`UPDATE cases SET status = 'ALLOCATED', order_line_id = $2, allocated_at = now()
                                WHERE id = $1 AND status = 'IN_STOCK'`, [c.id, line.id]);
    if (!upd.rowCount) throw conflict(`${tag} was just taken by another scan — scan again`);
    await db.query(`INSERT INTO case_events (case_id, event, order_id) VALUES ($1, 'ALLOCATED', $2)`, [c.id, order.id]);
    return { case: await getCase(db, c.serial), order: await getOrder(db, order.id), line_id: line.id };
  });
}

// Take a case back off an open order (wrong box scanned).
export async function unallocateScan(orderId, raw) {
  return tx(async (db) => {
    const c = await caseFromScan(db, raw);
    if (c.order_id !== Number(orderId) || c.status !== 'ALLOCATED') throw conflict(`${c.serial} is not on this order`);
    const o = (await db.query('SELECT status FROM orders WHERE id = $1', [orderId])).rows[0];
    if (o.status !== 'OPEN') throw conflict('order is already manifested');
    await db.query(`UPDATE cases SET status = 'IN_STOCK', order_line_id = NULL, allocated_at = NULL WHERE id = $1`, [c.id]);
    await db.query(`INSERT INTO case_events (case_id, event, order_id) VALUES ($1, 'UNALLOCATED', $2)`, [c.id, orderId]);
    return { case: await getCase(db, c.serial), order: await getOrder(db, orderId) };
  });
}

export async function voidScan(raw, reason) {
  return tx(async (db) => {
    const c = await caseFromScan(db, raw);
    if (c.status === 'VOID') throw conflict(`${c.serial} is already void`);
    if (c.status === 'SHIPPED') throw conflict(`${c.serial} shipped on order ${c.order_doc} — it cannot be voided`);
    await db.query(`UPDATE cases SET status = 'VOID', voided_at = now(), void_reason = $2, order_line_id = NULL WHERE id = $1`,
      [c.id, reason || null]);
    await db.query(`INSERT INTO case_events (case_id, event, order_id, detail) VALUES ($1, 'VOIDED', $2, $3)`,
      [c.id, c.order_id || null, reason || null]);
    return getCase(db, c.serial);
  });
}

export { expandSerial };
