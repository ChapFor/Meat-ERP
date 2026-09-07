// Parsing CMS's server-rendered HTML.
//
// Everything here is driven by the HEADER TEXT of the table, never by column
// position, so a reordered or newly inserted column does not silently shift the
// data. If a required header is missing we throw rather than guess — a wrong cut
// list is worse than a loud failure.
//
// Pure functions: feed them the fixtures in server/fixtures/ to test offline.
// cheerio/slim, not cheerio: the full entry point pulls in undici for its
// fromURL() helper, and undici 7 dereferences a global File that does not exist
// before Node 20 — which crashed the whole server on Railway's Node 18. We only
// ever parse strings, so the slim build is all we need and it loads no undici.
import * as cheerio from 'cheerio/slim';

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
  // CMS date cells lead with a sortable stamp: "20260305 03/05/2026". Take it
  // first — it is unambiguous, unlike the display half.
  let m = t.match(/\b(\d{4})(\d{2})(\d{2})\b/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31)
    return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
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
    const trs = $t.find('tr').toArray();

    // The header is the first row whose own cells carry every wanted heading.
    // "First row containing a th" is not good enough here: CMS data rows mix th
    // and td, so that test picks a data row on some tables.
    let headIdx = -1, headers = [];
    for (let i = 0; i < Math.min(trs.length, 6); i++) {
      const cells = $(trs[i]).children('th,td').toArray().map((c) => slug($(c).text()));
      if (cells.length && wanted.every((w) => cells.some((h) => h.includes(w)))) {
        headIdx = i; headers = cells; break;
      }
    }
    if (headIdx < 0) continue;

    const idx = {};
    headers.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });
    const at = (want) => {
      const w = slug(want);
      if (idx[w] !== undefined) return idx[w];
      const hit = headers.findIndex((h) => h.includes(w));
      return hit >= 0 ? hit : -1;
    };

    const rows = [];
    for (const tr of trs.slice(headIdx + 1)) {
      const $tr = $(tr);
      // children('th,td'), not find('td'): a CMS row is <th><td>...<td><th><th>,
      // so reading only td drops the first cell and shifts every column by one.
      // children() also stops us pulling cells out of a nested table.
      const $cells = $tr.children('th,td');
      if ($cells.length < Math.max(2, headers.length - 2)) continue;   // spacer row
      const cells = $cells.toArray().map((c) => norm($(c).text()));
      if (cells.every((c) => !c)) continue;

      // What a person SEES in a cell. The Customer cell stacks three things:
      // an invisible sort key (<font style="font-size:0px">Creamery Moo Cow</font>),
      // the display name, and 8px phone lines (P: / M:). text() welds them into
      // "Creamery Moo Cow Moo Cow Creamery P: (240) …", so the hidden and the
      // fine-print parts are dropped first. Falls back to the whole cell.
      const visible = (cell) => {
        const $c = $(cell).clone();
        $c.find('[style]').each((_, el) => {
          const m = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/i.exec($(el).attr('style') || '');
          if (m && Number(m[1]) <= 9) $(el).remove();
        });
        return norm($c.text()) || norm($(cell).text());
      };

      const $form = $tr.find('form').first();
      rows.push({
        cells,
        attrs: $tr.attr() || {},
        get: (want) => { const i = at(want); return i >= 0 ? (cells[i] ?? null) : null; },
        seen: (want) => { const i = at(want); return i >= 0 ? (visible($cells.get(i)) || null) : null; },
        // Opening an order is a form POST, not a link.
        form: $form.length ? {
          action: $form.attr('action') || null,
          method: (($form.attr('method') || 'GET').toUpperCase()),
          fields: Object.fromEntries($form.find('input[type=hidden]').toArray()
            .map((h) => [$(h).attr('name'), $(h).attr('value')])
            .filter(([k]) => k)),
        } : null,
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

// "0 of 6 PreItems: 8" — CMS packs both numbers into the Active Items cell
// rather than giving PreItems a column of its own.
export function parseActiveItems(text) {
  const t = String(text || '');
  const xy = t.match(/(\d+)\s*of\s*(\d+)/i);
  const pre = t.match(/PreItems:\s*(\d+)/i);
  return {
    packed: xy ? Number(xy[1]) : null,
    total: xy ? Number(xy[2]) : null,
    pre_items: pre ? Number(pre[1]) : null,
  };
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
    const items = parseActiveItems(r.get('Active Items'));
    const requestedText = r.get('Requested By Date') || r.get('Requested By');
    // The status CELL is "Picked Up $108.90" — status welded to the order total.
    // The row's data-status attribute is the clean value, so prefer it.
    const cellStatus = String(r.get('Order Status') || '')
      .replace(/\$[\d,.]+/g, '').trim();
    return {
      order_no: r.get('Shopper'),
      created_text: r.get('Created'),
      // the display name only — the priority strip and the floor show this
      customer: r.seen('Customer'),
      items_packed: items.packed,
      items_total: items.total,
      pre_items: items.pre_items,
      notes: r.get('Notes') || r.get('Comments'),
      requested_text: requestedText,
      requested_by: parseDate(requestedText),
      pickup_method: r.get('Pick Up Method'),
      status: r.attrs?.['data-status'] || cellStatus || null,
      // Opening an order posts a form; keep the whole thing, not a URL.
      detail: r.form && r.form.action ? r.form : null,
      detail_url: detailUrlFrom(r),
      retail_id: r.form?.fields?.retail_id || null,
    };
  }).filter((o) => o.order_no && /\d/.test(o.order_no));
}

/**
 * Order detail lines (spec §3).
 *
 * The brief assumed two fetches per order — Pre-Order Mode ON for demand, OFF
 * for the cart. The real page carries BOTH on every row as hidden inputs:
 *     retaild_preqty{n}  what the customer ordered   -> PREORDER
 *     retaild_qty{n}     what has been packed        -> PACKED
 * so one fetch gives us both, halving the requests and removing any chance of
 * the two modes disagreeing because something changed between them.
 *
 * Rows are anchored on those input names rather than on column position: the
 * header has ten cells and the data rows nine, so index mapping does not line
 * up, and the quantity inputs live in the same cell as the Order UOM text.
 */
export function parseOrderLines(html) {
  const $ = cheerio.load(html);
  const out = [];

  for (const tr of $('tr').toArray()) {
    const $tr = $(tr);
    const $qty = $tr.find('input[name^="retaild_preqty"]').first();
    if (!$qty.length) continue;

    const n = (String($qty.attr('name')).match(/(\d+)$/) || [])[1];
    const val = (sel) => $tr.find(sel).first().attr('value');
    const preQty = num($qty.attr('value'));
    const packedQty = num(val(`input[name="retaild_qty${n}"]`));
    const pkg = num(val(`input[name="retaild_pkg${n}"]`)) ?? 1;

    // Walk right from the cell holding the quantity inputs: that cell's text is
    // the Order UOM, then Sold UOM, then the product description.
    const $cells = $tr.children('th,td');
    const qtyCellIdx = $cells.toArray().findIndex((c) => $(c).find(`input[name="retaild_preqty${n}"]`).length);
    const cellText = (i) => (i >= 0 && i < $cells.length ? norm($cells.eq(i).text()) : '');
    const orderUom = cellText(qtyCellIdx);
    const soldUom = cellText(qtyCellIdx + 1);
    const product = cellText(qtyCellIdx + 2);

    const status = norm($tr.find(`input[name="retaild_status${n}"]`).attr('value') || '')
      || cellText(qtyCellIdx + 5);
    if (!product) continue;

    const base = {
      item_no: Number(n),
      pkg,
      order_uom: orderUom,
      sold_uom: soldUom,
      product_name: product,
      item_status: status,
    };
    if (preQty !== null && preQty > 0) out.push({ ...base, kind: 'PREORDER', qty: preQty });
    if (packedQty !== null && packedQty > 0) out.push({ ...base, kind: 'PACKED', qty: packedQty });
  }
  return out;
}

// Change detection (spec §4.2): skip the detail fetch when nothing moved.
export function rowHash(o) {
  return [o.order_no, `${o.items_packed}of${o.items_total}`, o.pre_items,
    o.status, o.requested_by].join('|');
}

export const isActive = (status) => /^\s*active\s*$/i.test(String(status || ''));
