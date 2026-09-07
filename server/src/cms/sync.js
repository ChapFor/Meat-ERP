// The 5-minute poll (spec §4). Keeps cms_* tables in step with CMS.
//
// Failure policy: never destroy good data. A failed sync leaves the last known
// orders in place and is recorded in cms_sync_log; the floor screen decides for
// itself that the data is stale (>30 min) and says so in red.
import { q, pool } from '../db.js';
import { CmsClient, pause, cmsConfigured } from './client.js';
import { parseOrderList, parseOrderLines, rowHash, isActive } from './parse.js';

const LIST_PATHS = ['/custommeats/Retail_main.odb', '/Retail_main.odb'];
const DETAIL_PAUSE_MS = 800;      // be gentle between order pages

// Opening an order is a form POST (the pencil icon submits retail_checkout.odb
// with retail_id and retail_tagnum), and one fetch is enough: every line carries
// retaild_preqty (demand) AND retaild_qty (packed), so there is no need to
// toggle Pre-Order Mode and no window in which the two views could disagree.
// PreOrderFlag=yes keeps the page in the mode that renders both.
async function fetchLines(cms, order) {
  if (!order.detail?.action) throw new Error(`order ${order.order_no} has no open form`);
  const path = order.detail.action.startsWith('/')
    ? order.detail.action
    : '/custommeats/' + order.detail.action;
  const { html } = await cms.postPage(path, { ...order.detail.fields, PreOrderFlag: 'yes' });
  return { lines: parseOrderLines(html) };
}

export async function syncOnce({ force = false, log = console.log } = {}) {
  if (!cmsConfigured()) throw new Error('CMS_USERNAME / CMS_PASSWORD are not set');

  const runId = (await q(
    `INSERT INTO cms_sync_log (started_at) VALUES (now()) RETURNING id`)).rows[0].id;
  const finish = (ok, seen, read, error) => q(
    `UPDATE cms_sync_log SET finished_at=now(), ok=$2, orders_seen=$3, orders_read=$4, error=$5
     WHERE id=$1`, [runId, ok, seen, read, error ? String(error).slice(0, 500) : null]);

  const cms = new CmsClient({ log });
  let seen = 0, read = 0;
  try {
    // Say WHY each candidate failed. Swallowing these produced a bare "could
    // not load the CMS order list page", which is useless from a deploy log.
    let listHtml = null;
    const attempts = [];
    for (const p of LIST_PATHS) {
      try {
        const { html } = await cms.getPage(p);
        if (/Shopper/i.test(html)) { listHtml = html; break; }
        attempts.push(`${p}: loaded ${html.length}b but no Shopper column`);
      } catch (e) { attempts.push(`${p}: ${e.message}`); }
    }
    if (!listHtml)
      throw new Error(`could not load the CMS order list page — ${attempts.join(' | ')}`);

    const all = parseOrderList(listHtml);
    const active = all.filter((o) => isActive(o.status));
    seen = active.length;

    const existing = new Map((await q(
      `SELECT order_no, row_hash FROM cms_orders`)).rows.map((r) => [r.order_no, r.row_hash]));

    for (const o of active) {
      const hash = rowHash(o);
      await q(
        `INSERT INTO cms_orders (order_no, customer, created_text, requested_by, requested_text,
            status, pickup_method, notes, items_packed, items_total, pre_items, row_hash,
            detail_url, last_seen_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),NULL)
         ON CONFLICT (order_no) DO UPDATE SET
           customer=EXCLUDED.customer, created_text=EXCLUDED.created_text,
           requested_by=EXCLUDED.requested_by, requested_text=EXCLUDED.requested_text,
           status=EXCLUDED.status, pickup_method=EXCLUDED.pickup_method,
           notes=EXCLUDED.notes, items_packed=EXCLUDED.items_packed,
           items_total=EXCLUDED.items_total, pre_items=EXCLUDED.pre_items,
           row_hash=EXCLUDED.row_hash, detail_url=COALESCE(EXCLUDED.detail_url, cms_orders.detail_url),
           last_seen_at=now(), closed_at=NULL`,
        [o.order_no, o.customer, o.created_text, o.requested_by, o.requested_text,
         o.status, o.pickup_method, o.notes, o.items_packed, o.items_total,
         o.pre_items, hash, o.detail?.fields?.retail_id || o.detail_url]);

      // unchanged since last poll -> reuse cached lines, skip the detail fetch
      if (!force && existing.get(o.order_no) === hash) continue;
      if (!o.detail?.action) { log(`cms: order ${o.order_no} has no open form, skipping lines`); continue; }

      await pause(DETAIL_PAUSE_MS);
      const { lines } = await fetchLines(cms, o);
      read++;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM cms_order_lines WHERE order_no=$1', [o.order_no]);
        for (const l of lines) {
          await client.query(
            `INSERT INTO cms_order_lines
               (order_no, kind, item_no, pkg, qty, order_uom, sold_uom, product_name, item_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [o.order_no, l.kind, l.item_no, l.pkg, l.qty, l.order_uom, l.sold_uom,
             l.product_name, l.item_status]);
          // surface new products so the floor flags them instead of hiding them
          await client.query(
            `INSERT INTO cms_products (product_name) VALUES ($1) ON CONFLICT DO NOTHING`,
            [l.product_name]);
        }
        await client.query(
          `UPDATE cms_orders SET lines_synced_at=now() WHERE order_no=$1`, [o.order_no]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
      finally { client.release(); }
    }

    // gone from the Active list -> closed, never deleted (spec §4.5)
    if (active.length) {
      await q(
        `UPDATE cms_orders SET closed_at=now()
         WHERE closed_at IS NULL AND order_no <> ALL($1)`, [active.map((o) => o.order_no)]);
    }

    await finish(true, seen, read, null);
    log(`cms: sync ok — ${seen} active, ${read} detail page(s) read`);
    return { ok: true, orders_seen: seen, orders_read: read };
  } catch (e) {
    await finish(false, seen, read, e.message);
    log(`cms: sync FAILED — ${e.message}`);
    throw e;
  }
}

// Poll loop with backoff. Only starts when credentials are present, so a deploy
// without them stays quiet instead of erroring every five minutes.
let timer = null;
export function startCmsSync({ everyMs = 5 * 60 * 1000, log = console.log } = {}) {
  if (!cmsConfigured()) {
    log('cms: sync disabled (CMS_USERNAME / CMS_PASSWORD not set)');
    return;
  }
  let fails = 0;
  const tick = async () => {
    try { await syncOnce({ log }); fails = 0; }
    catch { fails = Math.min(fails + 1, 5); }
    const wait = everyMs * (fails ? Math.pow(2, fails) : 1);   // back off on failure
    timer = setTimeout(tick, Math.min(wait, 60 * 60 * 1000));
  };
  log(`cms: sync every ${Math.round(everyMs / 60000)} min`);
  timer = setTimeout(tick, 5000);
}
export function stopCmsSync() { if (timer) clearTimeout(timer); timer = null; }
