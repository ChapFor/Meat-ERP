// QuickBooks Online ⇄ ERP.
//   Pull:  open Estimates → orders (customers come along with them).
//   Push:  on manifest, each estimate line's quantity becomes the shipped
//          pounds (price stays $/lb), with "ordered X cs, shipped Y cs, Z lb"
//          added to the line description. Optionally an invoice is created.
import { q, tx } from '../db.js';
import { query, qbo, getConnection, qboConfigured } from './client.js';
import { orderLines } from '../domain.js';
import { round2 } from '../util.js';

const isoNoMs = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function upsertCustomer(db, ref) {
  if (!ref?.value) return null;
  const { rows } = await db.query(`
    INSERT INTO customers (qbo_id, name) VALUES ($1, $2)
    ON CONFLICT (qbo_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id`, [ref.value, ref.name || `Customer ${ref.value}`]);
  return rows[0].id;
}

// Apply one QuickBooks Estimate to the local order table.
export async function applyEstimate(est) {
  return tx(async (db) => {
    const existing = (await db.query('SELECT * FROM orders WHERE qbo_id = $1 FOR UPDATE', [est.Id])).rows[0];
    // QBO keeps the estimate after we write back; once manifested, ours is final.
    if (existing && existing.status !== 'OPEN') {
      await db.query('UPDATE orders SET qbo_sync_token = $2 WHERE id = $1', [existing.id, est.SyncToken]);
      return 'kept';
    }
    const open = est.TxnStatus === 'Pending' || est.TxnStatus === 'Accepted' || !est.TxnStatus;
    if (!existing && !open) return 'skipped';

    const customerId = await upsertCustomer(db, est.CustomerRef);
    const fields = [
      est.SyncToken, est.DocNumber || `EST-${est.Id}`, customerId, est.CustomerRef?.name || '',
      est.TxnDate || null, est.ShipDate || null,
      [est.CustomerMemo?.value, est.PrivateNote].filter(Boolean).join(' | ') || null,
      JSON.stringify(est.Line || []), est.MetaData?.LastUpdatedTime || null,
    ];
    let orderId;
    if (existing) {
      orderId = existing.id;
      await db.query(`UPDATE orders SET qbo_sync_token=$2, doc_number=$3, customer_id=$4, customer_name=$5,
        txn_date=$6, ship_date=$7, memo=$8, qbo_lines_raw=$9, qbo_updated_at=$10 WHERE id=$1`, [orderId, ...fields]);
      if (!open) {
        // closed or rejected in QuickBooks: cancel, and release anything packed
        const packed = (await db.query(`SELECT count(*)::int n FROM cases c JOIN order_lines ol ON ol.id = c.order_line_id
                                        WHERE ol.order_id = $1 AND c.status = 'ALLOCATED'`, [orderId])).rows[0].n;
        if (!packed) { await db.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [orderId]); return 'cancelled'; }
      }
    } else {
      orderId = (await db.query(`INSERT INTO orders (qbo_id, qbo_sync_token, doc_number, customer_id, customer_name,
        txn_date, ship_date, memo, qbo_lines_raw, qbo_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [est.Id, ...fields])).rows[0].id;
    }

    const items = (est.Line || []).filter((l) => l.DetailType === 'SalesItemLineDetail');
    const seen = [];
    for (const [i, l] of items.entries()) {
      const d = l.SalesItemLineDetail;
      const product = d.ItemRef?.value
        ? (await db.query('SELECT id FROM products WHERE qbo_item_id = $1', [d.ItemRef.value])).rows[0] : null;
      const vals = [orderId, l.Id, i + 1, product?.id || null, d.ItemRef?.value || null, d.ItemRef?.name || null,
        l.Description || null, Number(d.Qty || 0), d.UnitPrice != null ? Number(d.UnitPrice) : null];
      const row = (await db.query(`
        INSERT INTO order_lines (order_id, qbo_line_id, line_no, product_id, qbo_item_id, item_name, description, qty_ordered, unit_price)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (order_id, line_no) DO UPDATE SET qbo_line_id=$2, product_id=$4, qbo_item_id=$5, item_name=$6,
          description=$7, qty_ordered=$8, unit_price=$9
        RETURNING id`, vals)).rows[0];
      seen.push(row.id);
    }
    // lines removed in QuickBooks go away unless cases are already packed on them
    await db.query(`DELETE FROM order_lines ol WHERE ol.order_id = $1 AND NOT (ol.id = ANY($2::int[]))
      AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.order_line_id = ol.id)`, [orderId, seen]);
    return existing ? 'updated' : 'created';
  });
}

let running = null;
export async function pullOrders({ full = false } = {}) {
  if (running) return running;
  running = (async () => {
    const conn = await getConnection();
    if (!conn) return { skipped: 'not connected' };
    const since = !full && conn.last_sync_at ? new Date(new Date(conn.last_sync_at) - 5 * 60000) : null;
    const where = since
      ? `MetaData.LastUpdatedTime > '${isoNoMs(since)}'`
      : `TxnStatus = 'Pending' AND TxnDate > '${new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)}'`;
    const started = new Date();
    try {
      const estimates = await query('Estimate', where);
      const counts = {};
      for (const est of estimates) {
        const r = await applyEstimate(est);
        counts[r] = (counts[r] || 0) + 1;
      }
      await q('UPDATE qbo_connection SET last_sync_at = $1, last_sync_error = NULL', [started]);
      return { estimates: estimates.length, ...counts };
    } catch (e) {
      await q('UPDATE qbo_connection SET last_sync_error = $1', [e.message]);
      throw e;
    }
  })().finally(() => { running = null; });
  return running;
}

// The QuickBooks items list, for mapping PLUs. Items whose SKU equals a PLU
// are linked automatically.
export async function listItems() {
  const items = await query('Item', "Active = true");
  const sellable = items.filter((i) => ['Inventory', 'NonInventory', 'Service'].includes(i.Type));
  for (const it of sellable) {
    if (!it.Sku || !/^\d{1,8}$/.test(it.Sku)) continue;
    await q(`UPDATE products SET qbo_item_id = $1, qbo_item_name = $2
             WHERE code = $3 AND qbo_item_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM products WHERE qbo_item_id = $1)`, [it.Id, it.FullyQualifiedName || it.Name, it.Sku]);
  }
  return sellable.map((i) => ({ id: i.Id, name: i.FullyQualifiedName || i.Name, sku: i.Sku || null, price: i.UnitPrice ?? null, type: i.Type }));
}

// Build the updated Line array for an estimate from what actually shipped.
export function buildShippedLines(qboLines, lines) {
  const byQboLine = new Map(lines.filter((l) => l.qbo_line_id).map((l) => [String(l.qbo_line_id), l]));
  return qboLines
    .filter((l) => l.DetailType !== 'SubTotalLineDetail') // QuickBooks recomputes subtotals
    .map((ql) => {
      const ours = byQboLine.get(String(ql.Id));
      if (ql.DetailType !== 'SalesItemLineDetail' || !ours || !ours.product_id) return ql;
      const lb = round2(ours.lb_packed);
      const price = Number(ql.SalesItemLineDetail.UnitPrice ?? ours.unit_price ?? 0);
      const note = `Ordered ${Number(ours.qty_ordered)} cs, shipped ${ours.cases_packed} cs, ${lb.toFixed(2)} lb`;
      const base = (ql.Description || '').replace(/\s*[—-]\s*Ordered [\d.]+ cs, shipped \d+ cs, [\d.]+ lb$/, '');
      return {
        ...ql,
        Description: base ? `${base} — ${note}` : note,
        Amount: round2(lb * price),
        SalesItemLineDetail: { ...ql.SalesItemLineDetail, Qty: lb, UnitPrice: price },
      };
    });
}

// Write shipped weights back to the order's estimate. Safe to retry.
export async function writeBack(orderId) {
  const order = (await q('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  if (!order?.qbo_id) return { skipped: 'order did not come from QuickBooks' };
  if (!qboConfigured() || !(await getConnection())) {
    await q(`UPDATE orders SET qbo_writeback_status = 'PENDING', qbo_writeback_error = 'QuickBooks not connected' WHERE id = $1`, [orderId]);
    return { skipped: 'QuickBooks not connected' };
  }
  try {
    const lines = await orderLines({ query: q }, orderId);
    // always start from the live estimate so the SyncToken and lines are current
    const est = (await qbo('GET', `estimate/${order.qbo_id}`)).Estimate;
    const totalCases = lines.reduce((s, l) => s + l.cases_packed, 0);
    const totalLb = round2(lines.reduce((s, l) => s + Number(l.lb_packed), 0));
    const stamp = `Shipped ${totalCases} cs / ${totalLb.toFixed(2)} lb (ERP manifest ${new Date(order.manifested_at || Date.now()).toLocaleDateString('en-US')})`;
    const updated = (await qbo('POST', 'estimate', {
      Id: est.Id, SyncToken: est.SyncToken, sparse: true,
      Line: buildShippedLines(est.Line || [], lines),
      PrivateNote: [String(est.PrivateNote || '').replace(/\s*\|?\s*Shipped \d+ cs \/ [\d.]+ lb \(ERP manifest [^)]*\)/, ''), stamp]
        .filter(Boolean).join(' | ').slice(0, 4000),
    })).Estimate;

    let invoiceId = order.qbo_invoice_id;
    if (process.env.QBO_CREATE_INVOICE === 'true' && !invoiceId) {
      const inv = (await qbo('POST', 'invoice', {
        CustomerRef: updated.CustomerRef,
        Line: (updated.Line || []).filter((l) => l.DetailType === 'SalesItemLineDetail')
          .map(({ Id, LineNum, ...rest }) => rest),
        LinkedTxn: [{ TxnId: updated.Id, TxnType: 'Estimate' }],
        ShipDate: new Date().toISOString().slice(0, 10),
        PrivateNote: stamp,
      })).Invoice;
      invoiceId = inv.Id;
    }
    await q(`UPDATE orders SET qbo_writeback_status = 'DONE', qbo_writeback_error = NULL,
             qbo_sync_token = $2, qbo_invoice_id = $3 WHERE id = $1`, [orderId, updated.SyncToken, invoiceId || null]);
    return { ok: true, invoice_id: invoiceId || null };
  } catch (e) {
    await q(`UPDATE orders SET qbo_writeback_status = 'ERROR', qbo_writeback_error = $2 WHERE id = $1`, [orderId, e.message]);
    return { ok: false, error: e.message };
  }
}

// Background loop: pull every minute; push write-backs queued while QuickBooks
// was disconnected. Errors are retried from the order screen, not in a loop.
export function startSyncLoop() {
  if (!qboConfigured()) { console.log('qbo: QBO_CLIENT_ID/SECRET not set — QuickBooks sync disabled'); return; }
  const tick = async () => {
    try {
      if (!(await getConnection())) return;
      await pullOrders();
      const { rows } = await q(`SELECT id FROM orders WHERE status = 'MANIFESTED' AND qbo_writeback_status = 'PENDING'
                                AND manifested_at > now() - interval '7 days'`);
      for (const r of rows) await writeBack(r.id);
    } catch (e) { console.error('qbo sync:', e.message); }
  };
  setTimeout(tick, 5000);
  setInterval(tick, 60000);
}
