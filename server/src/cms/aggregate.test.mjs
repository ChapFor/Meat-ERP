import { buildCutList, lineDisplay, bucketFor }
  from './aggregate.js';

let bad = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? `  (${JSON.stringify(got)})` : ''}`);
  if (!ok) console.log(`      got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const today = '2026-08-24';
const products = [
  { product_name: 'Boneless Breast Skin Off', category: 'Chicken', pieces_per_pack: 2, birds_per_pack: 1 },
  { product_name: 'Leg/Thigh Quarters', category: 'Chicken', pieces_per_pack: null, birds_per_pack: null },
  { product_name: 'Chicken Organs', category: 'Chicken', pieces_per_pack: null, birds_per_pack: null },
  { product_name: 'Rib Chops', category: 'Lamb', pieces_per_pack: null, birds_per_pack: 0 },
];
const orders = [
  { order_no: '1001', customer: 'Green Grocer', requested_by: '2026-08-22', notes: 'Moo Cow Label' },
  { order_no: '1002', customer: 'Bricktown',    requested_by: '2026-08-24', notes: '10 lbs liver 5 lbs heart' },
  { order_no: '1003', customer: 'Keystone',     requested_by: '2026-08-30', notes: null },
];
const lines = [
  // spec §3 example: 50 Each Boneless Breast = 50 packs = 100 breasts = 50 birds
  { order_no: '1002', kind: 'PREORDER', pkg: 5, qty: 50, order_uom: 'Each', product_name: 'Boneless Breast Skin Off' },
  // past due, partially packed: 20 ordered, 8 packed -> 12 remaining
  { order_no: '1001', kind: 'PREORDER', pkg: 1, qty: 20, order_uom: 'Each', product_name: 'Boneless Breast Skin Off' },
  { order_no: '1001', kind: 'PACKED',   pkg: 1, qty: 8,  order_uom: 'Each', product_name: 'Boneless Breast Skin Off' },
  // fully packed -> must disappear from the cut list
  { order_no: '1001', kind: 'PREORDER', pkg: 1, qty: 6,  order_uom: 'Each', product_name: 'Leg/Thigh Quarters' },
  { order_no: '1001', kind: 'PACKED',   pkg: 1, qty: 6,  order_uom: 'Each', product_name: 'Leg/Thigh Quarters' },
  // sold by lb: no pack/piece/bird maths allowed
  { order_no: '1002', kind: 'PREORDER', pkg: 1, qty: 15, order_uom: 'lb', product_name: 'Chicken Organs' },
  // unmapped product still shows
  { order_no: '1003', kind: 'PREORDER', pkg: 1, qty: 4,  order_uom: 'Each', product_name: 'Mystery Sausage' },
  { order_no: '1003', kind: 'PREORDER', pkg: 1, qty: 3,  order_uom: 'Each', product_name: 'Rib Chops' },
];

const r = buildCutList({ orders, lines, products, today, syncedAt: new Date().toISOString() });
const sec = (k) => r.sections.find((s) => s.key === k);
const prod = (k, name) => sec(k).categories.flatMap((c) => c.products).find((p) => p.product_name === name);

// pg returns DATE columns as Date objects, not strings — the string-only tests
// missed this and every order silently fell into Upcoming.
const asDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
chk('bucket: Date object, past',   bucketFor(asDate('2026-08-22'), today), 'past_due');
chk('bucket: Date object, today',  bucketFor(asDate(today), today), 'due_today');
chk('bucket: Date object, future', bucketFor(asDate('2026-08-30'), today), 'upcoming');

const dateOrders = orders.map((o) => ({ ...o, requested_by: asDate(o.requested_by) }));
const rd = buildCutList({ orders: dateOrders, lines, products, today, syncedAt: new Date().toISOString() });
const rdProd = (k, name) => rd.sections.find((s) => s.key === k)
  .categories.flatMap((c) => c.products).find((p) => p.product_name === name);
chk('Date objects still split sections',
  [rdProd('past_due', 'Boneless Breast Skin Off').remaining,
   rdProd('due_today', 'Boneless Breast Skin Off').remaining], [12, 50]);

chk('bucket: before today', bucketFor('2026-08-22', today), 'past_due');
chk('bucket: today',        bucketFor('2026-08-24', today), 'due_today');
chk('bucket: after today',  bucketFor('2026-08-30', today), 'upcoming');
chk('bucket: no date',      bucketFor(null, today), 'upcoming');

chk('Pkg>1 keeps packaging visible', lineDisplay(5, 50, 'Each'), '5 pk × 10 Each');
chk('Pkg=1 plain',                   lineDisplay(1, 20, 'Each'), '20 Each');

// spec §3: 50 packs -> 100 breasts -> 50 birds
const breastToday = prod('due_today', 'Boneless Breast Skin Off');
chk('50 Each = 50 packs remaining', breastToday.remaining, 50);
chk('50 packs = 100 pieces',        breastToday.pieces, 100);
chk('50 packs = 50 birds',          breastToday.birds, 50);

// partial packing
const breastPast = prod('past_due', 'Boneless Breast Skin Off');
chk('20 ordered - 8 packed = 12',   breastPast.remaining, 12);
chk('12 packs = 24 pieces',         breastPast.pieces, 24);

// finished line drops off entirely
chk('fully packed line is gone',    prod('past_due', 'Leg/Thigh Quarters'), undefined);

// lb lines must not get pack maths
const organs = prod('due_today', 'Chicken Organs');
chk('lb line remaining',            organs.remaining, 15);
chk('lb line has no pieces',        organs.pieces, null);
chk('lb line has no birds',         organs.birds, null);

// unmapped
chk('unmapped listed',              r.unmapped, ['Mystery Sausage']);
chk('unmapped still on the floor',  prod('upcoming', 'Mystery Sausage').remaining, 4);
chk('unmapped category is Misc',    prod('upcoming', 'Mystery Sausage').category, 'Misc');
chk('mapped-but-no-pack-size flag', prod('upcoming', 'Rib Chops').needs_pack_size, true);

// bird roll-up: 50 (today) + 12 (past due) + Rib Chops 0
chk('bird equivalent total',        r.totals.bird_equivalent, 62);
chk('fresh sync is not stale',      r.stale, false);
chk('order notes reach the floor',  breastToday.orders[0].notes, '10 lbs liver 5 lbs heart');

const old = buildCutList({ orders, lines, products, today,
  syncedAt: new Date(Date.now() - 45 * 60000).toISOString() });
chk('45 min old is stale',          old.stale, true);
const never = buildCutList({ orders, lines, products, today, syncedAt: null });
chk('never synced is stale',        never.stale, true);

// ---- new-order flash + floor priority ----------------------------------
// first_seen_at is set on the first sync that saw the order, so an order that
// appeared a minute ago flashes and one from ten minutes ago does not.
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const nOrders = [
  { ...orders[0], first_seen_at: ago(1) },    // Green Grocer, past due, NEW
  { ...orders[1], first_seen_at: ago(10) },   // Bricktown,    due today
  { ...orders[2], first_seen_at: null },      // Keystone,     never stamped
];
const rn = buildCutList({ orders: nOrders, lines, products, today, syncedAt: new Date().toISOString() });
const nProd = (k, name) => rn.sections.find((s) => s.key === k)
  .categories.flatMap((c) => c.products).find((p) => p.product_name === name);

chk('1 min ago is new',             nProd('past_due', 'Boneless Breast Skin Off').orders[0].is_new, true);
chk('10 min ago is not new',        nProd('due_today', 'Boneless Breast Skin Off').orders[0].is_new, false);
chk('no first_seen_at is not new',  nProd('upcoming', 'Mystery Sausage').orders[0].is_new, false);
chk('first_seen_at is echoed',      nProd('past_due', 'Boneless Breast Skin Off').orders[0].first_seen_at,
  nOrders[0].first_seen_at);
chk('null first_seen_at stays null', nProd('upcoming', 'Mystery Sausage').orders[0].first_seen_at, null);
chk('product is_new rolls up',      [nProd('past_due', 'Boneless Breast Skin Off').is_new,
                                     nProd('due_today', 'Boneless Breast Skin Off').is_new], [true, false]);
// 1001 is new and appears once; the other two are not
chk('new_orders counts distinct',   rn.totals.new_orders, 1);

// pg gives TIMESTAMPTZ back as a Date, same trap as the DATE columns
const dateSeen = nOrders.map((o) => ({ ...o, first_seen_at: o.first_seen_at ? new Date(o.first_seen_at) : null }));
const rds = buildCutList({ orders: dateSeen, lines, products, today, syncedAt: new Date().toISOString() });
chk('Date first_seen_at still new', rds.sections.find((s) => s.key === 'past_due')
  .categories.flatMap((c) => c.products)
  .find((p) => p.product_name === 'Boneless Breast Skin Off').orders[0].is_new, true);
chk('Date first_seen_at counted',   rds.totals.new_orders, 1);

// newForMin is tunable: at 30 min both stamped orders flash
const wide = buildCutList({ orders: nOrders, lines, products, today,
  syncedAt: new Date().toISOString(), newForMin: 30 });
chk('newForMin widens the window',  wide.totals.new_orders, 2);

// priority: ranked customers first in rank order, unranked after by date.
// Breast is ordered by Green Grocer (08-22) and Bricktown (08-24) — same
// product, so one array to sort. Bricktown is ranked, so it leads.
const pOrders = [
  { order_no: '2001', customer: 'Green Grocer', requested_by: '2026-08-20', first_seen_at: null },
  { order_no: '2002', customer: 'Bricktown',    requested_by: '2026-08-21', first_seen_at: null },
  { order_no: '2003', customer: 'Keystone',     requested_by: '2026-08-19', first_seen_at: null },
];
const pLines = pOrders.map((o) => (
  { order_no: o.order_no, kind: 'PREORDER', pkg: 1, qty: 5, order_uom: 'Each',
    product_name: 'Boneless Breast Skin Off' }));
const pr = (priority) => buildCutList({ orders: pOrders, lines: pLines, products, today,
  syncedAt: new Date().toISOString(), priority })
  .sections.find((s) => s.key === 'past_due').categories.flatMap((c) => c.products)
  .find((p) => p.product_name === 'Boneless Breast Skin Off').orders.map((o) => o.customer);

chk('no priority: by date',         pr([]), ['Keystone', 'Green Grocer', 'Bricktown']);
chk('ranked first, unranked after', pr(['Bricktown', 'Green Grocer']),
  ['Bricktown', 'Green Grocer', 'Keystone']);
chk('rank order is respected',      pr(['Keystone', 'Bricktown']),
  ['Keystone', 'Bricktown', 'Green Grocer']);
chk('unknown priority name is inert', pr(['Nobody Inc']),
  ['Keystone', 'Green Grocer', 'Bricktown']);

const pFull = buildCutList({ orders: pOrders, lines: pLines, products, today,
  syncedAt: new Date().toISOString(), priority: ['Bricktown'] });
chk('priority is echoed',           pFull.priority, ['Bricktown']);
chk('customers distinct and sorted', pFull.customers, ['Bricktown', 'Green Grocer', 'Keystone']);
chk('customers dedupe repeats',
  buildCutList({ orders: [...pOrders, { order_no: '2004', customer: 'Bricktown', requested_by: '2026-08-25' }],
    lines: pLines, products, today, syncedAt: null }).customers,
  ['Bricktown', 'Green Grocer', 'Keystone']);
chk('priority defaults to empty',   r.priority, []);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall green');
process.exit(bad ? 1 : 0);
