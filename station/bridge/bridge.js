// Chapel Ford station bridge.
// Runs on the weigh-label station PC. The ERP's Station tab (served from the
// cloud) talks to this over http://localhost:9410 — the browser can't open a
// COM port or a raw TCP socket, so this does both:
//   GET  /health  → scale/printer status
//   GET  /weight  → latest reading { lb, stable }
//   POST /print   → { zpl } sent raw to the ZT411 on port 9100
// No cloud dependency: the bridge works identically when the internet is down.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = path.join(dir, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('No config.json — copy config.example.json to config.json and edit it.');
  process.exit(1);
}
// tolerate a UTF-8 BOM — Windows editors/PowerShell often add one
const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));

// ---------------- scale ----------------
// Readings ring buffer; "stable" = ≥3 readings in the last 1.2s within 0.02 lb.
// (The BC scale reports motion status too, but deriving stability from repeated
// readings works across NCI/Toledo/8217 protocol variants without parsing
// status bytes.)
const readings = [];
let scaleConnected = false;
let scaleError = null;

function pushReading(lb) {
  readings.push({ lb, at: Date.now() });
  if (readings.length > 12) readings.shift();
}
function currentWeight() {
  const now = Date.now();
  const last = readings[readings.length - 1];
  if (!last || now - last.at > 2000) return { lb: null, stable: false };
  const recent = readings.filter((r) => now - r.at < 1200).map((r) => r.lb);
  const stable = recent.length >= 3 &&
    Math.max(...recent) - Math.min(...recent) <= 0.02;
  return { lb: last.lb, stable };
}

// Tolerant parse: pull the last "number + unit" out of whatever the scale sent.
// NCI 'W' poll replies look like  \n  14.50LB\r\n<status>\r\x03  — variants differ
// in padding/status, but the weight+unit token is common to all of them.
function parseScaleChunk(buf) {
  const matches = [...buf.matchAll(/(-?\d+\.\d+)\s*(lb|kg)/gi)];
  if (!matches.length) return null;
  const m = matches[matches.length - 1];
  let lb = Number(m[1]);
  if (m[2].toLowerCase() === 'kg') lb = lb * 2.20462;
  return Math.round(lb * 100) / 100;
}

async function startScale() {
  if (config.scale.sim) return startScaleSim();
  let SerialPort;
  try {
    ({ SerialPort } = await import('serialport'));
  } catch {
    scaleError = 'serialport package not installed — run npm install (or set scale.sim=true)';
    console.error(scaleError);
    return;
  }
  const open = () => {
    const sp = new SerialPort(
      { path: config.scale.port, baudRate: config.scale.baud || 9600 },
      (err) => {
        if (err) {
          scaleError = err.message;
          scaleConnected = false;
          setTimeout(open, 3000);
        }
      });
    let buf = '';
    let poller = null;
    sp.on('open', () => {
      scaleConnected = true;
      scaleError = null;
      console.log(`scale: open on ${config.scale.port}`);
      poller = setInterval(() => sp.write(config.scale.pollCmd ?? 'W\r'),
        config.scale.pollMs ?? 250);
    });
    sp.on('data', (d) => {
      buf += d.toString('latin1');
      const lb = parseScaleChunk(buf);
      if (lb !== null) pushReading(lb);
      if (buf.length > 512) buf = buf.slice(-128);
    });
    const down = (why) => {
      if (poller) clearInterval(poller);
      poller = null;
      if (scaleConnected) console.error(`scale: down (${why}), retrying`);
      scaleConnected = false;
      setTimeout(open, 3000);
    };
    sp.on('error', (e) => { scaleError = e.message; down(e.message); sp.close(() => {}); });
    sp.on('close', () => down('closed'));
  };
  open();
}

// Sim: empty → ramp to a random case weight → hold → empty. For dev/testing.
function startScaleSim() {
  scaleConnected = true;
  let phase = 0, target = 0, lb = 0;
  setInterval(() => {
    phase += 0.25;
    if (phase < 3) lb = 0;
    else if (phase < 5) { if (!target) target = 8 + Math.random() * 10; lb = Math.min(target, lb + target / 4); }
    else if (phase < 9) lb = target;
    else { phase = 0; target = 0; lb = 0; }
    pushReading(Math.round(lb * 100) / 100);
  }, 250);
  console.log('scale: SIMULATED');
}

// ---------------- printer ----------------
function printZpl(zpl, cb) {
  if (config.printer.sim) {
    console.log('printer: SIMULATED —\n' + zpl);
    return cb(null);
  }
  const sock = net.createConnection({
    host: config.printer.host,
    port: config.printer.port || 9100,
    timeout: 4000,
  });
  let done = false;
  const finish = (err) => { if (!done) { done = true; sock.destroy(); cb(err); } };
  sock.on('connect', () => sock.end(zpl, () => finish(null)));
  sock.on('timeout', () => finish(new Error('printer connection timed out')));
  sock.on('error', (e) => finish(e));
}

function checkPrinter(cb) {
  if (config.printer.sim) return cb(true);
  const sock = net.createConnection({
    host: config.printer.host,
    port: config.printer.port || 9100,
    timeout: 2000,
  });
  let done = false;
  const finish = (ok) => { if (!done) { done = true; sock.destroy(); cb(ok); } };
  sock.on('connect', () => finish(true));
  sock.on('timeout', () => finish(false));
  sock.on('error', () => finish(false));
}

// ---------------- http ----------------
// CORS wide open + Private-Network-Access header: the ERP page is served over
// HTTPS from the cloud and fetches this local origin; Chrome preflights that.
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.headers['access-control-request-private-network'])
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && req.url === '/weight') {
    return send(200, { ...currentWeight(), scaleConnected, sim: !!config.scale.sim });
  }
  if (req.method === 'GET' && req.url === '/health') {
    return checkPrinter((printerOk) => send(200, {
      ok: true,
      scale: { connected: scaleConnected, sim: !!config.scale.sim, error: scaleError },
      printer: { reachable: printerOk, sim: !!config.printer.sim, host: config.printer.host },
    }));
  }
  if (req.method === 'POST' && req.url === '/print') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      let zpl;
      try { zpl = JSON.parse(body).zpl; } catch { return send(400, { error: 'bad json' }); }
      if (!zpl || !zpl.includes('^XA')) return send(400, { error: 'missing zpl' });
      printZpl(zpl, (err) => err
        ? send(502, { error: `printer: ${err.message}` })
        : send(200, { ok: true }));
    });
    return;
  }
  send(404, { error: 'not found' });
});

server.listen(config.port || 9410, '127.0.0.1', () =>
  console.log(`station bridge on http://localhost:${config.port || 9410}` +
    ` (scale ${config.scale.sim ? 'sim' : config.scale.port},` +
    ` printer ${config.printer.sim ? 'sim' : config.printer.host + ':' + (config.printer.port || 9100)})`));
startScale();
