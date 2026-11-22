// Chapel Ford station agent — runs on the scale PC.
//
// The whole print cycle happens here, with nothing on the network in the way:
//   scale settles → label built from cached product data → serial taken from a
//   pre-leased block → ZPL sent over an already-open printer channel
// The case record is uploaded to the server right after the label is out.
//
// The Station screen in the browser only sets the job (product, lot, order line)
// and displays status; it talks to this agent at http://localhost:9410.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Scale } from './scale.js';
import { makePrinter } from './printer.js';
import { buildCaseZpl } from '../../shared/label.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SIM = process.argv.includes('--sim');
const cfgPath = process.env.AGENT_CONFIG || path.join(dir, 'config.json');
const exampleCfg = path.join(dir, 'config.example.json');
const config = JSON.parse(fs.readFileSync(fs.existsSync(cfgPath) ? cfgPath : exampleCfg, 'utf8').replace(/^﻿/, ''));
if (SIM) { config.scale.sim = true; config.printer.sim = true; }

const STATION = config.station || os.hostname();
const SERVER = (config.server || 'http://localhost:3001').replace(/\/$/, '');
const AUTO = { minLb: 0.5, rearmLb: 0.3, ...(config.autoPrint || {}) };
const STABLE = { count: 3, tolerance: 0.02, windowMs: 500, ...(config.stable || {}) };
const LEASE_SIZE = config.leaseSize || 50;
const QUEUE_FILE = path.join(dir, 'upload-queue.json');

const templatePath = fs.existsSync(path.join(dir, 'label.zpl')) ? path.join(dir, 'label.zpl')
  : path.join(dir, '..', '..', 'shared', 'case-label.zpl');
const TEMPLATE = fs.readFileSync(templatePath, 'utf8');
const PREAMBLE = fs.existsSync(path.join(dir, 'preamble.zpl')) ? fs.readFileSync(path.join(dir, 'preamble.zpl'), 'utf8') : '';

// ---------------------------------------------------------------- server I/O
const server = { ok: false, error: null, lastOkAt: 0 };
async function api(method, p, body, timeoutMs = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(SERVER + p, {
      method, signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Passcode': config.passcode || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    server.ok = true; server.lastOkAt = Date.now(); server.error = null;
    if (!res.ok) { const e = new Error(data.error || `server ${res.status}`); e.status = res.status; throw e; }
    return data;
  } catch (e) {
    if (!e.status) { server.ok = false; server.error = e.name === 'AbortError' ? 'server timed out' : e.message; }
    throw e;
  } finally { clearTimeout(t); }
}

let master = { products: [], lots: [], orders: [] };
async function refreshMaster() {
  master = await api('GET', '/api/station/config');
  return master;
}

// ---------------------------------------------------------------- serial leases
// leases[lot] = [{ next, last }]. Printing only reads from memory.
const leases = new Map();
const leasing = new Map();
function serialsLeft(lot) {
  return (leases.get(lot) || []).reduce((s, b) => s + (b.last - b.next + 1), 0);
}
function topUp(lot) {
  if (serialsLeft(lot) >= LEASE_SIZE / 3 || leasing.get(lot)) return leasing.get(lot);
  const p = api('POST', '/api/station/lease', { lot_code: lot, station: STATION, count: LEASE_SIZE })
    .then((l) => { const arr = leases.get(lot) || []; arr.push({ next: l.first, last: l.last }); leases.set(lot, arr); })
    .catch((e) => { lastError = `could not reserve serial numbers: ${e.message}`; })
    .finally(() => leasing.delete(lot));
  leasing.set(lot, p);
  return p;
}
function takeSerial(lot) {
  const arr = leases.get(lot) || [];
  while (arr.length && arr[0].next > arr[0].last) arr.shift();
  if (!arr.length) return null;
  const n = arr[0].next++;
  topUp(lot);
  return `${lot}-${String(n).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- upload queue
// Persisted so a crash or reboot never loses a case whose label is already on a box.
let queue = [];
try { queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch { queue = []; }
const saveQueue = () => fs.writeFile(QUEUE_FILE, JSON.stringify(queue), () => {});
let flushing = false;
async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.slice(0, 50);
  try {
    const { results } = await api('POST', '/api/station/cases', { cases: batch }, 10000);
    const done = new Set();
    for (const r of results) {
      if (r.ok || r.permanent) done.add(r.serial);
      const rec = recent.find((x) => x.serial === r.serial);
      if (rec) { rec.uploaded = r.ok; rec.uploadError = r.ok ? null : r.error; rec.warning = r.warning || null; }
    }
    queue = queue.filter((c) => !done.has(c.serial));
    saveQueue();
  } catch { /* server unreachable: keep the queue, try again shortly */ }
  finally { flushing = false; }
}
setInterval(flush, 1000);

// ---------------------------------------------------------------- printer + scale
const printer = makePrinter(config.printer);
let printerHealth = { ok: false, error: 'checking…' };
async function checkPrinter() { printerHealth = await printer.check(); }
if (PREAMBLE) printer.send(PREAMBLE).catch((e) => console.error('preamble:', e.message));

let job = null;            // { product, lot, line, order, auto }
let armed = true;          // must be re-armed by lifting the case off
let stableSince = null;    // when the current stable reading began
let printing = false;
let lastError = null;
let lastStamp = null;      // what the operator sees after each attempt
const recent = [];         // last 50 prints (with ZPL for reprint)
const timings = [];        // ms from stable weight to printer accepted

const scale = new Scale(config.scale, onReading);

function netWeight(gross) {
  if (gross == null || !job) return gross;
  return Math.round((gross - Number(job.product.tare_lb || 0)) * 100) / 100;
}

function onReading() {
  const st = scale.state(STABLE);
  const net = netWeight(st.lb);
  if (!st.stable) { stableSince = null; }
  else if (!stableSince) stableSince = Date.now();
  if (net !== null && net < AUTO.rearmLb) armed = true;
  if (job?.auto && armed && st.stable && net >= AUTO.minLb && !printing) {
    armed = false;
    printCase(net, stableSince).catch(() => {});
  }
}

function lineCounts() {
  if (!job?.line) return null;
  const packed = job.line.cases_packed + recent.filter((r) => r.lineId === job.line.id && !r.failed).length;
  return { ordered: Number(job.line.qty_ordered), packed, remaining: Math.max(0, Math.ceil(job.line.qty_ordered) - packed) };
}

async function printCase(net, t0 = Date.now()) {
  if (!job) throw new Error('pick a product and lot first');
  const p = job.product;
  if (p.min_lb != null && net < Number(p.min_lb)) return stamp('bad', `UNDER SPEC ${net.toFixed(2)} lb`, `minimum for ${p.name} is ${Number(p.min_lb).toFixed(2)} lb`);
  if (p.max_lb != null && net > Number(p.max_lb)) return stamp('bad', `OVER SPEC ${net.toFixed(2)} lb`, `maximum for ${p.name} is ${Number(p.max_lb).toFixed(2)} lb`);
  const lc = lineCounts();
  if (lc && lc.remaining <= 0) return stamp('bad', 'LINE COMPLETE', `${lc.packed} of ${lc.ordered} cases packed for ${job.order.customer_name}`);

  const serial = takeSerial(job.lot);
  if (!serial) { topUp(job.lot); return stamp('bad', 'NO SERIAL NUMBERS', server.error ? `server unreachable: ${server.error}` : 'reserving serial numbers — try again in a second'); }

  printing = true;
  const zpl = buildCaseZpl(TEMPLATE, {
    product: p, lotCode: job.lot, serial, weightLb: net, farmName: config.farmName,
    customer: job.order?.customer_name, orderDoc: job.order?.doc_number,
  });
  const rec = { serial, product: p.name, code: p.code, lb: net, at: new Date().toISOString(), lineId: job.line?.id || null, customer: job.order?.customer_name || null, zpl };
  try {
    await printer.send(zpl);
    const ms = Date.now() - t0;
    rec.ms = ms;
    timings.push(ms); if (timings.length > 100) timings.shift();
    queue.push({ serial, product_code: p.code, lot_code: job.lot, weight_lb: net, printed_at: rec.at,
      station: STATION, order_line_id: job.line?.id || null, print_ms: ms });
    saveQueue();
    setImmediate(flush);
    recent.unshift(rec); if (recent.length > 50) recent.pop();
    const lc3 = lineCounts();
    stamp('ok', `${net.toFixed(2)} lb`, `${p.name} · ${serial}${lc3 ? ` · ${lc3.remaining} to go` : ''}`);
    if (config.logTimings !== false) console.log(`printed ${serial} ${net.toFixed(2)} lb in ${ms} ms (stable → printer accepted)`);
    return rec;
  } catch (e) {
    // the serial is burned (never printed) — that is fine, gaps are allowed
    rec.failed = true;
    lastError = `print failed: ${e.message}`;
    stamp('bad', 'PRINT FAILED', e.message);
    throw e;
  } finally { printing = false; }
}

function stamp(kind, title, detail) {
  lastStamp = { kind, title, detail, at: Date.now() };
  return null;
}

async function setJob(body) {
  if (body.stop) { job = null; return; }
  if (!master.products.length || body.refresh) await refreshMaster().catch(() => {});
  const product = master.products.find((p) => p.id === Number(body.product_id));
  if (!product) throw new Error('unknown product — refresh the station');
  const lot = body.lot_code;
  if (!master.lots.some((l) => l.code === lot)) throw new Error(`lot ${lot} is not open`);
  let order = null, line = null;
  if (body.order_line_id) {
    order = master.orders.find((o) => o.lines.some((l) => l.id === Number(body.order_line_id)));
    line = order?.lines.find((l) => l.id === Number(body.order_line_id));
    if (!line) throw new Error('order line not found — refresh the station');
    if (line.product_id !== product.id) throw new Error('that order line is for a different product');
    line = { ...line, cases_packed: Number(line.cases_packed) - recent.filter((r) => r.lineId === line.id && !r.failed).length };
  }
  job = { product, lot, order, line, auto: body.auto !== false };
  armed = !(scale.state(STABLE).lb > AUTO.rearmLb); // a case already sitting there does not auto-print
  await topUp(lot);
}

// ---------------------------------------------------------------- HTTP API
function status() {
  const st = scale.state(STABLE);
  const sorted = [...timings].sort((a, b) => a - b);
  return {
    station: STATION, sim: !!config.scale.sim,
    weight: { gross: st.lb, net: netWeight(st.lb), stable: st.stable },
    scale: scale.health(), printer: printerHealth,
    server: { ok: server.ok, error: server.error, url: SERVER },
    job: job && { product_id: job.product.id, product: job.product.name, code: job.product.code, tare_lb: job.product.tare_lb,
      lot: job.lot, auto: job.auto, order_line_id: job.line?.id || null,
      order: job.order && { doc_number: job.order.doc_number, customer_name: job.order.customer_name }, line: lineCounts() },
    armed, serials_left: job ? serialsLeft(job.lot) : null, upload_queue: queue.length,
    stamp: lastStamp, last_error: lastError,
    timing: sorted.length ? { last: timings[timings.length - 1], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], n: sorted.length } : null,
    recent: recent.slice(0, 15).map(({ zpl, ...r }) => r),
  };
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
function body(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

const httpServer = http.createServer(async (req, res) => {
  // The Station page is served from the cloud; Chrome also asks before a
  // public page may call a localhost service (Private Network Access).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && url === '/status') return send(res, 200, status());
    if (req.method === 'POST' && url === '/job') { await setJob(await body(req)); return send(res, 200, status()); }
    if (req.method === 'POST' && url === '/refresh') { await refreshMaster(); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && url === '/print') {
      const st = scale.state(STABLE);
      if (!st.stable) return send(res, 409, { error: 'weight is not stable yet' });
      const rec = await printCase(netWeight(st.lb));
      return send(res, 200, { ok: !!rec, stamp: lastStamp });
    }
    if (req.method === 'POST' && url === '/reprint') {
      const { serial } = await body(req);
      const rec = recent.find((r) => r.serial === serial && !r.failed);
      if (!rec) return send(res, 404, { error: 'only the last 50 labels can be reprinted here' });
      await printer.send(rec.zpl);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/sim/weight' && config.scale.sim) {
      scale.setTarget((await body(req)).lb);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 400, { error: e.message }); }
});

const PORT = config.port || 9410;
httpServer.listen(PORT, '127.0.0.1', async () => {
  console.log(`station agent "${STATION}" on http://localhost:${PORT}  →  server ${SERVER}${SIM ? '  (SIMULATED scale + printer)' : ''}`);
  scale.start();
  await checkPrinter();
  setInterval(checkPrinter, 15000);
  refreshMaster().catch((e) => console.error('server:', e.message));
  setInterval(() => refreshMaster().catch(() => {}), 30000);
});
