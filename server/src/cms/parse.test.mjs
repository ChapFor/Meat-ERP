// Parser tests against synthetic HTML shaped like the spec describes.
// These prove the header-driven logic; they are NOT a substitute for running
// them against real fixtures from server/fixtures/ once discovery has run.
//   cd server && node src/cms/parse.test.mjs
import { parseOrderList, parseOrderLines, parseXofY, parseDate, rowHash, isActive } from './parse.js';

let bad = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

const listHtml = `
<html><body>
<table class="grid">
  <tr><th>Open</th><th>Shopper</th><th>Created</th><th>Customer</th>
      <th>Active Items</th><th>PreItems</th><th>Notes/Comments</th>
      <th>Requested By Date</th><th>Pick Up Method</th><th>Order Status</th></tr>
  <tr>
    <td><a href="/custommeats/Retail_order.odb?shopper=1001" title="Open"><i class="fa fa-pencil"></i></a></td>
    <td>1001</td><td>08/20/2026</td><td>Green Grocer</td>
    <td>3 of 8</td><td>PreItems: 8</td><td>Moo Cow Label</td>
    <td>8/22/2026</td><td>Delivery</td><td>Active</td>
  </tr>
  <tr>
    <td><a href="/custommeats/Retail_order.odb?shopper=1002" title="Open">edit</a></td>
    <td>1002</td><td>08/21/2026</td><td>Bricktown Butcher</td>
    <td>0 of 4</td><td>PreItems: 4</td><td>10 lbs liver 5 lbs heart</td>
    <td>2026-08-24</td><td>Pick Up</td><td>Active</td>
  </tr>
  <tr>
    <td><a href="/custommeats/Retail_order.odb?shopper=1003">edit</a></td>
    <td>1003</td><td>08/01/2026</td><td>Old Order</td>
    <td>5 of 5</td><td>PreItems: 5</td><td></td>
    <td>8/05/2026</td><td>Pick Up</td><td>Picked Up</td>
  </tr>
</table>
</body></html>`;

const orders = parseOrderList(listHtml);
chk('parses every row', orders.length, 3);
chk('order number', orders[0].order_no, '1001');
chk('customer', orders[0].customer, 'Green Grocer');
chk('X of Y packed', orders[0].items_packed, 3);
chk('X of Y total', orders[0].items_total, 8);
chk('PreItems number', orders[0].pre_items, 8);
chk('notes reach the floor', orders[0].notes, 'Moo Cow Label');
chk('US date', orders[0].requested_by, '2026-08-22');
chk('ISO date', orders[1].requested_by, '2026-08-24');
chk('detail link found', orders[0].detail_url, '/custommeats/Retail_order.odb?shopper=1001');
chk('Active filter keeps 2', orders.filter((o) => isActive(o.status)).length, 2);
chk('Picked Up is not Active', isActive('Picked Up'), false);

// column order must not matter — headers drive it
const reordered = listHtml
  .replace('<th>Shopper</th><th>Created</th>', '<th>Created</th><th>Shopper</th>')
  .replace('<td>1001</td><td>08/20/2026</td>', '<td>08/20/2026</td><td>1001</td>');
chk('survives reordered columns', parseOrderList(reordered)[0].order_no, '1001');

// a new column inserted by the vendor must not shift anything
const extra = listHtml
  .replace('<th>Customer</th>', '<th>Customer</th><th>Rep</th>')
  .replace('<td>Green Grocer</td>', '<td>Green Grocer</td><td>JD</td>');
chk('survives an inserted column', parseOrderList(extra)[0].pre_items, 8);

const detailHtml = `
<html><body>
<table>
  <tr><th>Item #</th><th>Pkg</th><th>Total Qty</th><th>Order UOM</th>
      <th>Sold UOM</th><th>Product</th><th>Item Status</th></tr>
  <tr><td>1</td><td>5</td><td>50.00</td><td>Each</td><td>lb</td>
      <td>Boneless Breast Skin Off</td><td>PreOrder</td></tr>
  <tr><td>2</td><td>1</td><td>15.00</td><td>lb</td><td>lb</td>
      <td>Chicken Organs</td><td>PreOrder</td></tr>
</table>
</body></html>`;

const lines = parseOrderLines(detailHtml);
chk('two lines', lines.length, 2);
chk('pkg', lines[0].pkg, 5);
chk('total qty', lines[0].qty, 50);
chk('order UOM drives the cut list', lines[0].order_uom, 'Each');
chk('sold UOM is informational', lines[0].sold_uom, 'lb');
chk('product name', lines[0].product_name, 'Boneless Breast Skin Off');
chk('item status', lines[0].item_status, 'PreOrder');
chk('lb line', lines[1].order_uom, 'lb');

chk('X of Y helper', parseXofY('12 of 40'), { packed: 12, total: 40 });
chk('date helper, 2-digit year', parseDate('8/5/26'), '2026-08-05');
chk('hash changes when packing moves',
  rowHash({ ...orders[0], items_packed: 4 }) !== rowHash(orders[0]), true);
chk('hash stable when nothing moved', rowHash(orders[0]), rowHash(orders[0]));

// a page we cannot understand must fail loudly, not return junk
let threw = false;
try { parseOrderList('<html><body><table><tr><td>nope</td></tr></table></body></html>'); }
catch { threw = true; }
chk('unrecognised page throws', threw, true);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall green');
process.exit(bad ? 1 : 0);
