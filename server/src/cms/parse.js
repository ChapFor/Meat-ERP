// Parsing CMS's server-rendered HTML.
//
// Everything here is driven by the HEADER TEXT of the table, never by column
// position, so a reordered or newly inserted column does not silently shift the
// data. If a required header is missing we throw rather than guess — a wrong cut
// list is worse than a loud failure.
//
// Pure functions: feed them the fixtures in server/fixtures/ to test offline.
import * as cheerio from 'cheerio';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export function num(v) {
  if (v === null || v === undefined) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// "3 of 8" -> { packed: 3, total: 8 }
export function parseXofY(text) {
  const m = String(text || '').match(/(\d+)\s*of\s*(\d+)/i);
  return m ? { packed: Number(m[1]), total: Number(m[2]) } : { packed: null, total: null };
}

// CMS date text -> ISO date, keeping the original for display.
export function parseDate(text) {
  const t = norm(text);
  if (!t) return null;
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Find the table whose header row contains all `must` headers, and return its
 * rows as objects keyed by slugged header, plus the row element for link digging.
 */
export function parseTable(html, must = []) {
  const $ = cheerio.load(html);
  const wanted = must.map(slug);

  for (const table of $('table').toArray()) {
    const $t = $(table);
    // header row = the first row that has th cells, else the first row
    let $head = $t.find('tr').filter((_, tr) => $(tr).find('th').length > 0).first();
    if (!$head.length) $head = $t.find('tr').first();
    const headers = $head.find('th,td').toArray().map((c) => slug($(c).text()));
    if (!headers.length) continue;
    if (!wanted.every((w) => headers.some((h) => h.includes(w)))) continue;

    const idx = {};
    headers.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });
    const at = (want) => {
      const w = slug(want);
      if (idx[w] !== undefined) return idx[w];
      const hit = headers.findIndex((h) => h.includes(w));
      return hit >= 0 ? hit : -1;
    };

    const rows = [];
    const all = $t.find('tr').toArray();
    const start = all.indexOf($head[0]) + 1;
    for (const tr of all.slice(start)) {
      const $tr = $(tr);
      const cells = $tr.find('td').toArray().map((c) => norm($(c).text()));
      if (!cells.length || cells.every((c) => !c)) continue;
      rows.push({
        cells,
        get: (want) => { const i = at(want); return i >= 0 ? (cells[i] ?? null) : null; },
        links: $tr.find('a').toArray().map((a) => ({
          href: $(a).attr('href') || null,
          onclick: $(a).attr('onclick') || null,
          title: $(a).attr('title') || null,
          html: $.html(a),
        })),
        html: $.html(tr),
      });
    }
    return { headers, rows, at };
  }
  throw new Error(`no table found containing headers: ${must.join(', ')}`);
}

// Pull whatever looks like the "Open" link for an order row. CMS may use an
// href or a javascript handler; both are captured so discovery can confirm.
export function detailUrlFrom(row) {
  for (const l of row.links) {
    if (l.href && !/^#|^javascript:/i.test(l.href)) return l.href;
  }
  for (const l of row.links) {
    const src = `${l.onclick || ''} ${l.href || ''}`;
    const m = src.match(/['"]([^'"]*\.odb[^'"]*)['"]/i) || src.match(/['"](\/[^'"\s]+)['"]/);
    if (m) return m[1];
  }
  return null;
}

/** Order list page (spec §2). Only Active rows are the floor's business. */
export function parseOrderList(html) {
  const { rows } = parseTable(html, ['Shopper', 'Customer', 'Order Status']);
  return rows.map((r) => {
    const xofy = parseXofY(r.get('Active Items'));
    const requestedText = r.get('Requested By Date') || r.get('Requested By');
    return {
      order_no: r.get('Shopper'),
      created_text: r.get('Created'),
      customer: r.get('Customer'),
      items_packed: xofy.packed,
      items_total: xofy.total,
      pre_items: num(r.get('PreItems')),
      notes: r.get('Notes') || r.get('Comments'),
      requested_text: requestedText,
      requested_by: parseDate(requestedText),
      pickup_method: r.get('Pick Up Method'),
      status: r.get('Order Status'),
      detail_url: detailUrlFrom(r),
    };
  }).filter((o) => o.order_no);
}

/** Order detail lines (spec §3), in whichever mode the page was fetched. */
export function parseOrderLines(html) {
  const { rows } = parseTable(html, ['Product']);
  return rows.map((r) => ({
    item_no: num(r.get('Item')),
    pkg: num(r.get('Pkg')),
    qty: num(r.get('Total Qty')) ?? num(r.get('Qty')),
    // Order UOM is what the customer ordered in and drives the whole cut list;
    // Sold UOM is pricing only.
    order_uom: r.get('Order UOM'),
    sold_uom: r.get('Sold UOM'),
    product_name: r.get('Product'),
    item_status: r.get('Item Status') || r.get('Status'),
  })).filter((l) => l.product_name);
}

// Change detection (spec §4.2): skip the detail fetch when nothing moved.
export function rowHash(o) {
  return [o.order_no, `${o.items_packed}of${o.items_total}`, o.pre_items,
    o.status, o.requested_by].join('|');
}

export const isActive = (status) => /^\s*active\s*$/i.test(String(status || ''));
