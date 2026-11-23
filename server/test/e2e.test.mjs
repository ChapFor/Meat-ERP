// End-to-end: mock QuickBooks → order sync → station agent (simulated scale and
// printer) packs to order and to inventory → dock scanning with every refusal
// rule → manifest → shipped pounds written back to the QuickBooks estimate.
//
//   TEST_DATABASE_URL=postgres://... node --test test/
// The test database is wiped.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { humanReadable } from '../../shared/gs1.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.TEST_DATABASE_URL;
const PASS = 'e2e-pass';
const SERVER = 'http://localhost:3101', AGENT = 'http://localhost:9411', MOCK_PORT = 3999;
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- mock QuickBooks Online
const estimate = {
  Id: '501', SyncToken: '0', DocNumber: '1043', TxnDate: '2026-11-22', ShipDate: '2026-11-24', TxnStatus: 'Pending',
  CustomerRef: { value: '77', name: 'Maketto' }, PrivateNote: 'deliver before 10am',
  Line: [
    { Id: '1', LineNum: 1, DetailType: 'SalesItemLineDetail', Amount: 20.85, Description: 'Whole birds',
      SalesItemLineDetail: { ItemRef: { value: '10', name: 'Whole Chicken' }, Qty: 3, UnitPrice: 6.95 } },
    { Id: '2', LineNum: 2, DetailType: 'SalesItemLineDetail', Amount: 27.5,
      SalesItemLineDetail: { ItemRef: { value: '11', name: 'Boneless Breast' }, Qty: 2, UnitPrice: 13.75 } },
    { DetailType: 'SubTotalLineDetail', Amount: 48.35, SubTotalLineDetail: {} },
  ],
  MetaData: { LastUpdatedTime: '2026-11-22T08:00:00-05:00' },
};
const qboPosts = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname.endsWith('/query')) {
      const sql = u.searchParams.get('query');
      assert.doesNotMatch(sql, /TxnStatus/, 'QuickBooks rejects TxnStatus in a query');
      if (sql.includes('FROM Estimate')) return json({ QueryResponse: { Estimate: sql.includes('STARTPOSITION 1 ') ? [estimate] : [] } });
      if (sql.includes('FROM Item')) return json({ QueryResponse: { Item: [] } });
    }
    if (req.method === 'GET' && u.pathname.endsWith('/estimate/501')) return json({ Estimate: estimate });
    if (req.method === 'POST' && u.pathname.endsWith('/estimate')) {
      const b = JSON.parse(body);
      qboPosts.push(b);
      assert.equal(b.SyncToken, estimate.SyncToken, 'write-back must use the current SyncToken');
      Object.assign(estimate, { Line: b.Line, PrivateNote: b.PrivateNote, SyncToken: String(Number(estimate.SyncToken) + 1) });
      return json({ Estimate: estimate });
    }
    res.writeHead(404); res.end('{}');
  });
});

async function call(method, p, body) {
  const res = await fetch(SERVER + p, { method, headers: { 'Content-Type': 'application/json', 'X-Passcode': PASS }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const agentCall = async (method, p, body) => (await fetch(AGENT + p, { method, body: body ? JSON.stringify(body) : undefined })).json();
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t > ms) throw new Error('timed out'); await sleep(100); } };

async function place(lb) {
  await agentCall('POST', '/sim/weight', { lb });
  await sleep(700);
  await agentCall('POST', '/sim/weight', { lb: 0 });
  await sleep(300);
}

let lot, products;
before(async () => {
  assert.ok(DB, 'set TEST_DATABASE_URL');
  const c = new pg.Client({ connectionString: DB }); await c.connect();
  await c.query('DROP SCHEMA IF EXISTS erp_v2 CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
  await new Promise((r) => mock.listen(MOCK_PORT, r));

  const env = { ...process.env, DATABASE_URL: DB, PORT: '3101', APP_PASSCODE: PASS, QBO_CLIENT_ID: 'x', QBO_CLIENT_SECRET: 'y',
    QBO_API_BASE: `http://localhost:${MOCK_PORT}` };
  const srv = spawn('node', ['src/index.js'], { cwd: path.join(root, 'server'), env, stdio: 'pipe' });
  procs.push(srv);
  srv.stderr.on('data', (d) => process.stderr.write(d));
  await waitFor(async () => (await fetch(SERVER + '/api/health')).ok);

  const db = new pg.Client({ connectionString: DB }); await db.connect();
  await db.query(`INSERT INTO erp_v2.qbo_connection (realm_id, access_token, refresh_token, access_expires) VALUES ('123','a','r', now() + interval '1 day')`);
  await db.end();

  products = {
    whole: (await call('POST', '/api/products', { code: '176', name: 'Whole Chicken', tare_lb: 0.5, min_lb: 3, max_lb: 60, qbo_item_id: '10' })).body,
    breast: (await call('POST', '/api/products', { code: '168', name: 'Boneless Breast', qbo_item_id: '11' })).body,
  };
  lot = (await call('POST', '/api/lots', {})).body.code;

  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'station', 'agent', 'config.example.json'), 'utf8'));
  Object.assign(cfg, { server: SERVER, passcode: PASS, station: 'E2E', port: 9411, logTimings: false });
  const cfgPath = path.join(os.tmpdir(), `agent-e2e-${process.pid}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const ag = spawn('node', ['agent.js', '--sim'], { cwd: path.join(root, 'station', 'agent'), env: { ...process.env, AGENT_CONFIG: cfgPath }, stdio: 'pipe' });
  procs.push(ag);
  await waitFor(async () => (await agentCall('GET', '/status')).server.ok);
});

after(async () => {
  for (const p of procs) p.kill();
  mock.close();
  try { fs.unlinkSync(path.join(root, 'station', 'agent', 'upload-queue.json')); } catch {}
});

let order;
test('QuickBooks estimate becomes an order with mapped lines', async () => {
  const s = await call('POST', '/api/qbo/sync', { full: true });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const list = (await call('GET', '/api/orders')).body;
  assert.equal(list.length, 1);
  order = (await call('GET', `/api/orders/${list[0].id}`)).body;
  assert.equal(order.doc_number, '1043');
  assert.equal(order.customer_name, 'Maketto');
  assert.deepEqual(order.lines.map((l) => [l.product_code, Number(l.qty_ordered)]), [['176', 3], ['168', 2]]);
});

test('station packs whole birds to order: tare off, spec enforced, line stops when full, under 1 s', async () => {
  await agentCall('POST', '/refresh');
  const line = order.lines[0];
  const st = await agentCall('POST', '/job', { product_id: products.whole.id, lot_code: lot, order_line_id: line.id });
  assert.equal(st.job.line.remaining, 3);
  await place(2.9);                       // 2.40 net: under the 3 lb minimum
  let s = await agentCall('GET', '/status');
  assert.match(s.stamp.title, /UNDER SPEC/);
  for (const w of [5.12, 4.87, 5.33]) await place(w);
  await place(5.0);                       // fourth bird: line is complete
  s = await agentCall('GET', '/status');
  assert.equal(s.stamp.title, 'LINE COMPLETE');
  assert.deepEqual(s.recent.filter((r) => !r.failed).map((r) => r.lb), [4.83, 4.37, 4.62]);
  assert.ok(s.timing.max < 1000, `print took ${s.timing.max} ms`);
  await waitFor(async () => (await agentCall('GET', '/status')).upload_queue === 0);
  const o = (await call('GET', `/api/orders/${order.id}`)).body;
  assert.equal(o.lines[0].cases_packed, 3);
  assert.equal(o.lines[0].lb_packed, 13.82);
});

let breastScans;
test('pack breast to inventory, then dock scanning enforces every rule', async () => {
  await agentCall('POST', '/job', { product_id: products.breast.id, lot_code: lot });
  for (const w of [10.11, 10.42, 9.96, 10.2]) await place(w);
  const s = await agentCall('GET', '/status');
  await waitFor(async () => (await agentCall('GET', '/status')).upload_queue === 0);
  const recs = s.recent.filter((r) => r.code === '168');
  breastScans = recs.map((r) => humanReadable({ itemCode: '168', weightLb: r.lb, lotCode: lot, serial: r.serial }));
  const wholeScan = humanReadable({ itemCode: '176', weightLb: 4.83, lotCode: lot, serial: s.recent.find((r) => r.code === '176' && !r.failed).serial });

  let r = await call('POST', `/api/orders/${order.id}/scan`, { scan: breastScans[0] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('POST', `/api/orders/${order.id}/scan`, { scan: breastScans[0] });
  assert.equal(r.status, 409); assert.match(r.body.error, /already scanned on this order/);
  r = await call('POST', `/api/orders/${order.id}/scan`, { scan: wholeScan });
  assert.equal(r.status, 409); assert.match(r.body.error, /already scanned on this order/);
  // void a misprint, then try to ship it
  r = await call('POST', '/api/cases/void', { scan: breastScans[3], reason: 'misprint' });
  assert.equal(r.status, 200);
  r = await call('POST', `/api/orders/${order.id}/scan`, { scan: breastScans[3] });
  assert.equal(r.status, 409); assert.match(r.body.error, /VOIDED/);
  r = await call('POST', `/api/orders/${order.id}/scan`, { scan: breastScans[1] });
  assert.equal(r.status, 200);
  r = await call('POST', `/api/orders/${order.id}/scan`, { scan: breastScans[2] });
  assert.equal(r.status, 409); assert.match(r.body.error, /already full/);
  // a scanner that drops FNC1 still works (raw element string with no separators)
  const look = await call('POST', '/api/cases/lookup', { scan: breastScans[2].replace(/[()]/g, '') });
  assert.equal(look.status, 200); assert.equal(look.body.status, 'IN_STOCK');
});

test('manifest ships the cases and writes pounds back to the QuickBooks estimate', async () => {
  const r = await call('POST', `/api/orders/${order.id}/manifest`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.qbo.ok, true, JSON.stringify(r.body.qbo));
  assert.equal(r.body.order.status, 'MANIFESTED');
  const post = qboPosts.at(-1);
  assert.equal(post.sparse, true);
  const [l1, l2] = post.Line;
  assert.equal(post.Line.length, 2, 'subtotal line dropped, item lines kept');
  assert.equal(l1.SalesItemLineDetail.Qty, 13.82);
  assert.equal(l1.SalesItemLineDetail.UnitPrice, 6.95);
  assert.equal(l1.Amount, 96.05);
  assert.equal(l1.Description, 'Whole birds — Ordered 3 cs, shipped 3 cs, 13.82 lb');
  assert.equal(l2.SalesItemLineDetail.Qty, 20.16);
  assert.equal(l2.Amount, 277.2);
  assert.match(post.PrivateNote, /^deliver before 10am \| Shipped 5 cs \/ 33\.98 lb/);
  const after = (await call('GET', `/api/cases?order_id=${order.id}`)).body;
  assert.ok(after.length === 5 && after.every((c) => c.status === 'SHIPPED'));
  // shipped cases can no longer be voided or rescanned
  const v = await call('POST', '/api/cases/void', { scan: breastScans[0] });
  assert.equal(v.status, 409);
  // a re-sync must not reopen or alter a manifested order
  await call('POST', '/api/qbo/sync', { full: true });
  assert.equal((await call('GET', `/api/orders/${order.id}`)).body.status, 'MANIFESTED');
});
