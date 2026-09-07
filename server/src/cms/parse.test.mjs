// Parser tests. The HTML here mirrors the REAL CMS markup found during
// discovery, not the idealised table in the brief — mixed th/td cells, status
// in a data-status attribute, quantities in hidden inputs.
//   cd server && node src/cms/parse.test.mjs
import { parseOrderList, parseOrderLines, parseActiveItems, parseDate, rowHash, isActive }
  from './parse.js';

let bad = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- order list -----------------------------------------------------------
// Real shape: header is all th; data rows are <th><td>..<td><th><th> with the
// status on the row, and the status CELL carries the order total too.
const openForm = (id, tag) => `<th><form name="updateform1" method="POST" action="retail_checkout.odb">
  <input type="hidden" name="username" value="Devon Kint">
  <input type="hidden" name="animaltype" value="retail">
  <input type="hidden" name="retail_id" value="${id}">
  <input type="hidden" name="retail_tagnum" value="${tag}">
  <button type="submit"></button></form></th>`;

// The real Customer cell: an invisible sort key, the display name, then phone
// lines in 8px print. Only "Moo Cow Creamery" is what a person sees.
const customerCell = `<td nowrap style="border-bottom:1px dashed #999;">
   <font style="font-size:0px;">Creamery Moo Cow<br></font>
   Moo Cow Creamery
<div style="font-size:8px;">P: (240) 367-7568</div>
<div style="font-size:8px;">M: (240) 367-7568</div>
   </td>`;

const listHtml = `<table>
 <tr class="altbluetable"><th>Open</th><th>Shopper</th><th>Created</th><th>Customer</th>
   <th>Active Items</th><th>Notes/Comments</th><th>Requested By Date</th>
   <th>Pick Up Method</th><th>Order Status</th><th></th></tr>
 <tr class="bluetable" data-status="Active">
   ${openForm('1957220', '333')}
   <td>333</td><td>20260911 09/11/20267:14PM</td>${customerCell}
   <td>0 of 0 PreItems: 6</td><td>Moo Cow Label 10 lbs liver</td>
   <td>20260911 09/11/2026</td><td>Checkout Pickup</td><th>Active $0.00</th><th></th></tr>
 <tr class="bluetable" data-status="Picked Up">
   ${openForm('1404780', '73')}
   <td>73</td><td>20260302 03/02/20266:57PM</td><td>Dabney</td>
   <td>0 of 1 PreItems: 1</td><td></td>
   <td>20260305 03/05/2026</td><td>Delivery</td><th>Picked Up $108.90</th><th></th></tr>
 <tr><th></th></tr>
</table>`;

const orders = parseOrderList(listHtml);
chk('spacer row ignored', orders.length, 2);
chk('order number from the right column', orders[0].order_no, '333');
chk('customer not shifted by the th/td mix', orders[0].customer, 'Moo Cow Creamery');
chk('customer is the visible name, not sort key + phones', orders[0].customer, 'Moo Cow Creamery');
chk('a plain customer cell still reads whole', orders[1].customer, 'Dabney');
chk('status from data-status', orders[0].status, 'Active');
chk('status strips the order total', orders[1].status, 'Picked Up');
chk('Active filter', orders.filter((o) => isActive(o.status)).length, 1);
chk('PreItems read out of Active Items', orders[0].pre_items, 6);
chk('X of Y still read', [orders[1].items_packed, orders[1].items_total], [0, 1]);
chk('date from the sortable stamp', orders[0].requested_by, '2026-09-11');
chk('notes reach the floor', orders[0].notes, 'Moo Cow Label 10 lbs liver');
chk('open form captured, not a link', orders[0].detail.action, 'retail_checkout.odb');
chk('retail_id captured', orders[0].detail.fields.retail_id, '1957220');
chk('retail_id surfaced', orders[0].retail_id, '1957220');

// header-driven: a reordered or inserted column must not shift anything
const moved = listHtml
  .replace('<th>Created</th><th>Customer</th>', '<th>Customer</th><th>Created</th>')
  .replace(`<td>20260911 09/11/20267:14PM</td>${customerCell}`,
           `${customerCell}<td>20260911 09/11/20267:14PM</td>`);
chk('survives reordered columns', parseOrderList(moved)[0].customer, 'Moo Cow Creamery');

// --- order lines ----------------------------------------------------------
// Real shape: demand and packed are BOTH on the row as hidden inputs, so one
// fetch yields both and Pre-Order Mode never needs toggling.
const line = (n, pkg, pre, packed, uom, sold, product) => `<tr>
  <td>${n} PLU: 110${n}${product}</td>
  <td><input name="oldretaildpkg${n}" value="${pkg}"><input name="retaild_pkg${n}" value="${pkg}.000000">${pkg}</td>
  <td><input name="oldretaildqty${n}" value="0.000"><input name="retaild_preqty${n}" value="${pre}">
      <input name="retaild_qty${n}" value="${packed}">${uom}</td>
  <td>${sold}</td><td>${product}</td><td></td><td>0.00</td>
  <td><input type="hidden" name="retaild_status${n}" value="PreOrder">PreOrder</td><td>&times;</td></tr>`;

const detailHtml = `<table>
 <tr><th>Current Shopping Cart</th><th></th><th>Item Status</th><th></th></tr>
 <tr><th>Item</th><th>Pkg</th><th>Total Qty</th><th>UOM</th><th>Product Item / Description</th>
     <th>Adj</th><th>Item Total</th><th>A</th><th>C</th><th></th></tr>
 ${line(1, 1, '50.00', '0.00', 'Each', 'lb', 'Boneless Breast Skin Off')}
 ${line(2, 5, '5.00', '0.00', 'Each', 'Each', 'Chicken Bone Broth')}
 ${line(3, 1, '15.00', '0.00', 'lb', 'lb', 'Chicken Organs')}
 ${line(4, 1, '20.00', '8.00', 'Each', 'lb', 'Leg/Thigh Quarters')}
</table>`;

const lines = parseOrderLines(detailHtml);
const pre = lines.filter((l) => l.kind === 'PREORDER');
const packed = lines.filter((l) => l.kind === 'PACKED');
chk('demand lines', pre.length, 4);
chk('only genuinely packed lines', packed.length, 1);
chk('the brief’s example: 50 Each', [pre[0].qty, pre[0].order_uom], [50, 'Each']);
chk('product name off the right cell', pre[0].product_name, 'Boneless Breast Skin Off');
chk('sold UOM kept separate', pre[0].sold_uom, 'lb');
chk('pkg from the hidden input', pre[1].pkg, 5);
chk('lb line keeps its unit', [pre[2].qty, pre[2].order_uom], [15, 'lb']);
chk('packed quantity read', [packed[0].qty, packed[0].product_name], [8, 'Leg/Thigh Quarters']);
chk('zero-packed lines are not emitted', packed.some((l) => l.qty === 0), false);
chk('item status', pre[0].item_status, 'PreOrder');

// --- helpers --------------------------------------------------------------
chk('Active Items cell', parseActiveItems('0 of 6 PreItems: 8'),
  { packed: 0, total: 6, pre_items: 8 });
chk('date: sortable stamp wins', parseDate('20260305 03/05/2026'), '2026-03-05');
chk('date: plain US', parseDate('8/5/26'), '2026-08-05');
chk('hash moves when packing moves',
  rowHash({ ...orders[0], items_packed: 4 }) !== rowHash(orders[0]), true);

let threw = false;
try { parseOrderList('<table><tr><td>nope</td></tr></table>'); } catch { threw = true; }
chk('unrecognisable page throws', threw, true);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall green');
process.exit(bad ? 1 : 0);
