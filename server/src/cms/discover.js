// Phase 1 discovery. Logs in, dumps raw HTML to server/fixtures/, and reports
// what it could and could not parse — so the parser can be finished against
// real pages instead of guesses.
//
//   cd server
//   set CMS_USERNAME=... & set CMS_PASSWORD=...      (or put them in server/.env)
//   npm run cms:discover
//
// Credentials are read from the environment and never printed. The fixtures it
// writes are YOUR ORDER DATA — they are gitignored; do not commit them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../env.js';
import { CmsClient, pause, cmsConfigured } from './client.js';
import { parseOrderList, parseOrderLines, isActive, detailUrlFrom, parseTable } from './parse.js';

loadEnv();

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');
fs.mkdirSync(dir, { recursive: true });
const save = (name, html) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, html);
  console.log(`   saved ${name}  (${(html.length / 1024).toFixed(0)} kB)`);
  return f;
};
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 50 - t.length))}`);

if (!cmsConfigured()) {
  const miss = [];
  if (!process.env.CMS_USERNAME) miss.push('CMS_USERNAME');
  if (!process.env.CMS_PASSWORD) miss.push('CMS_PASSWORD');
  console.error(`\nStill missing in server/.env: ${miss.join(' and ')}\n\n` +
    'Open server/.env and fill in the blank(s), one per line, no quotes:\n' +
    '   CMS_USERNAME=yourlogin\n   CMS_PASSWORD=yourpassword\n\n' +
    'That file is gitignored, so it never leaves this PC.\n');
  process.exit(1);
}

const cms = new CmsClient({ log: (m) => console.log('   ' + m) });

head('1. login');
await cms.login();
console.log('   ok — session cookies:', [...cms.jar.keys()].join(', ') || '(none)');

head('2. order list');
const listPaths = ['/custommeats/Retail_main.odb', '/Retail_main.odb', '/custommeats/'];
let list = null;
for (const p of listPaths) {
  try {
    const { html, url } = await cms.getPage(p);
    if (/Shopper/i.test(html)) { list = { html, url, path: p }; break; }
    console.log(`   ${p} loaded but has no Shopper column`);
  } catch (e) { console.log(`   ${p} -> ${e.message}`); }
}
if (!list) { console.error('   could not find the order list page'); process.exit(1); }
console.log(`   found at ${list.path}  (final url ${list.url})`);
save('order-list.html', list.html);

let orders = [];
try {
  orders = parseOrderList(list.html);
  console.log(`   parsed ${orders.length} rows, ${orders.filter((o) => isActive(o.status)).length} Active`);
  console.table(orders.slice(0, 5).map((o) => ({
    order: o.order_no, customer: o.customer, status: o.status,
    items: `${o.items_packed} of ${o.items_total}`, pre: o.pre_items,
    requested: o.requested_by, link: o.detail_url,
  })));
} catch (e) {
  console.log(`   PARSE FAILED: ${e.message}`);
  try {
    const { headers } = parseTable(list.html, []);
    console.log('   first table headers were:', headers.join(' | '));
  } catch { /* nothing to say */ }
}

head('3. status filter');
console.log('   distinct Order Status values:',
  [...new Set(orders.map((o) => o.status))].join(', ') || '(none)');

head('4. one order, both modes');
const target = orders.find((o) => isActive(o.status) && o.detail_url)
  || orders.find((o) => o.detail_url);
if (!target) {
  console.log('   no row exposed an Open link — dumping one row so the pattern can be found:');
  try {
    const { rows } = parseTable(list.html, ['Shopper']);
    if (rows[0]) { save('order-row.html', rows[0].html); console.log(rows[0].html.slice(0, 600)); }
  } catch { /* already reported */ }
} else {
  console.log(`   opening order ${target.order_no} via ${target.detail_url}`);
  await pause(1000);
  const { html, url } = await cms.getPage(target.detail_url);
  save(`order-${target.order_no}-asfound.html`, html);
  console.log(`   final url: ${url}`);

  try {
    const lines = parseOrderLines(html);
    console.log(`   parsed ${lines.length} lines in the as-found mode`);
    console.table(lines.slice(0, 8));
  } catch (e) { console.log(`   line parse failed: ${e.message}`); }

  // Pre-Order Mode is a checkbox; find how it is wired so sync can toggle it.
  head('5. Pre-Order Mode control');
  const hits = html.match(/[^\n]*[Pp]re-?[Oo]rder[^\n]*/g) || [];
  console.log(`   ${hits.length} mentions; first few:`);
  hits.slice(0, 6).forEach((h) => console.log('     ' + h.trim().slice(0, 200)));
  const inputs = html.match(/<input[^>]*(?:pre|order)[^>]*>/gi) || [];
  console.log('   candidate inputs:');
  inputs.slice(0, 6).forEach((h) => console.log('     ' + h.trim().slice(0, 200)));
  const forms = html.match(/<form[^>]*>/gi) || [];
  console.log('   forms on the page:');
  forms.slice(0, 6).forEach((h) => console.log('     ' + h.trim().slice(0, 200)));
}

head('done');
console.log(`   fixtures are in ${dir}`);
console.log('   Send those files over (they are gitignored) and the parser can be');
console.log('   finished and unit-tested against them.\n');
process.exit(0);
