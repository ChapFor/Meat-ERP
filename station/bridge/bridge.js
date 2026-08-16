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
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --sim forces scale and printer simulation and falls back to the example
// config, so the pack can be proven on a PC before any hardware is set up.
const SIM = process.argv.includes('--sim');
const dir = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = fs.existsSync(path.join(dir, 'config.json'))
  ? path.join(dir, 'config.json')
  : (SIM ? path.join(dir, 'config.example.json') : null);
if (!cfgPath) {
  console.error('No config.json — run 1-configure.bat (or copy config.example.json to config.json).');
  process.exit(1);
}
// tolerate a UTF-8 BOM — Windows editors/PowerShell often add one
const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
if (SIM) { config.scale.sim = true; config.printer.sim = true; }

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
// Two ways to reach a ZT411:
//   usb     — through the Windows spooler with the RAW datatype, so the driver
//             passes ZPL to the printer instead of rendering it as text.
//             Done by running print-raw.ps1, which P/Invokes winspool; that
//             avoids a native npm module and any build tools on the station.
//   network — a raw socket to tcp/9100.
const mode = () => (config.printer.sim ? 'sim' : (config.printer.mode || 'usb'));
const psExe = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';
const rawPrintPs = path.join(dir, 'print-raw.ps1');

// -EncodedCommand runs the script inline, so the execution policy never applies
function runPs(script, vars, cb) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFile(psExe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { env: { ...process.env, ...vars }, timeout: 20000, windowsHide: true },
    (err, stdout, stderr) => cb(err, String(stdout).trim(), String(stderr).trim()));
}

const PRINTER_STATUS_PS = `
$ErrorActionPreference = 'Stop'
$n = $env:CF_PRINTER
$p = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $n }
if (-not $p) { Write-Output 'NOTFOUND'; exit 1 }
if ($p.WorkOffline) { Write-Output 'OFFLINE'; exit 1 }
Write-Output 'OK'`;

const LIST_PRINTERS_PS =
  `Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name`;

function printZpl(zpl, cb) {
  if (config.printer.sim) {
    console.log('printer: SIMULATED —\n' + zpl);
    return cb(null);
  }
  if (mode() === 'network') {
    const sock = net.createConnection({
      host: config.printer.host, port: config.printer.port || 9100, timeout: 4000,
    });
    let done = false;
    const finish = (err) => { if (!done) { done = true; sock.destroy(); cb(err); } };
    sock.on('connect', () => sock.end(zpl, () => finish(null)));
    sock.on('timeout', () => finish(new Error('printer connection timed out')));
    sock.on('error', (e) => finish(e));
    return;
  }
  // usb: hand the bytes to the spooler as RAW. ^CI28 declares UTF-8, so the
  // file is written UTF-8 and sent through byte for byte.
  if (!config.printer.name)
    return cb(new Error('no printer name set — run 1-configure.bat and set "name"'));
  const tmp = path.join(os.tmpdir(), `cf-label-${process.pid}-${Date.now()}.zpl`);
  try { fs.writeFileSync(tmp, zpl, 'utf8'); }
  catch (e) { return cb(new Error(`cannot write temp file: ${e.message}`)); }
  const script = fs.readFileSync(rawPrintPs, 'utf8');
  runPs(script, { CF_PRINTER: config.printer.name, CF_ZPL_FILE: tmp }, (err, out) => {
    fs.unlink(tmp, () => {});
    if (out.startsWith('ERR ')) return cb(new Error(out.slice(4)));
    if (err) return cb(new Error(out || err.message));
    cb(null);
  });
}

// Spawning PowerShell on every health poll would be wasteful, so cache briefly.
let printerCache = { at: 0, ok: false, error: null };
function checkPrinter(cb) {
  if (config.printer.sim) return cb(true, null);
  if (mode() === 'network') {
    const sock = net.createConnection({
      host: config.printer.host, port: config.printer.port || 9100, timeout: 2000,
    });
    let done = false;
    const finish = (ok, err) => { if (!done) { done = true; sock.destroy(); cb(ok, err); } };
    sock.on('connect', () => finish(true, null));
    sock.on('timeout', () => finish(false, 'no answer on port 9100'));
    sock.on('error', (e) => finish(false, e.message));
    return;
  }
  if (!config.printer.name) return cb(false, 'no printer name set in config.json');
  if (Date.now() - printerCache.at < 10000) return cb(printerCache.ok, printerCache.error);
  runPs(PRINTER_STATUS_PS, { CF_PRINTER: config.printer.name }, (err, out) => {
    let ok = false, error = null;
    if (out === 'OK') ok = true;
    else if (out === 'NOTFOUND') error = `no Windows printer named "${config.printer.name}" — run list-printers.bat`;
    else if (out === 'OFFLINE') error = 'printer is offline — check power and the USB cable';
    else error = 'could not read printer status';
    printerCache = { at: Date.now(), ok, error };
    cb(ok, error);
  });
}

function listPrinters(cb) {
  runPs(LIST_PRINTERS_PS, {}, (err, out) =>
    cb(err ? [] : out.split('\n').map((s) => s.trim()).filter(Boolean)));
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
    return checkPrinter((printerOk, printerError) => send(200, {
      ok: true,
      scale: { connected: scaleConnected, sim: !!config.scale.sim, error: scaleError },
      printer: {
        reachable: printerOk, sim: !!config.printer.sim, mode: mode(),
        name: config.printer.name || null, host: config.printer.host || null,
        error: printerError || null,
      },
    }));
  }
  // lets the operator see the exact Windows printer name to paste into config
  if (req.method === 'GET' && req.url === '/printers') {
    return listPrinters((names) => send(200, { printers: names }));
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

const printerLabel = () => config.printer.sim ? 'sim'
  : mode() === 'network' ? `${config.printer.host}:${config.printer.port || 9100}`
  : `USB "${config.printer.name || '(not set)'}"`;

server.listen(config.port || 9410, '127.0.0.1', () => {
  console.log(`station bridge on http://localhost:${config.port || 9410}`);
  console.log(`  scale:   ${config.scale.sim ? 'sim' : config.scale.port}`);
  console.log(`  printer: ${printerLabel()}`);
});
startScale();
