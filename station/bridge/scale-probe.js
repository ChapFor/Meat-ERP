// Scale diagnostic. Lists serial ports, then tries the common scale framings and
// poll commands and dumps whatever comes back, as hex and as text.
//
//   node scale-probe.js           probe the port from config.json
//   node scale-probe.js COM4      probe a specific port
//
// The point is to find out what the scale actually speaks, rather than guessing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

let SerialPort;
try {
  ({ SerialPort } = await import('serialport'));
} catch {
  console.log('\n  The serialport package is missing. Re-copy the folder from the flash drive.\n');
  process.exit(1);
}

// ---- which port ----------------------------------------------------------
let want = process.argv[2];
if (!want) {
  try {
    const cfgPath = path.join(dir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''));
    want = cfg.scale?.port;
  } catch { /* no config yet */ }
}

console.log('\n==================================================');
console.log('  SCALE DIAGNOSTIC');
console.log('==================================================\n');

const ports = await SerialPort.list();
console.log('Serial ports Windows can see:\n');
if (!ports.length) {
  console.log('  (none)\n');
  console.log('  The scale cable is not detected at all. Check the USB-to-serial');
  console.log('  adapter is plugged in and has a driver in Device Manager.\n');
  process.exit(1);
}
for (const p of ports) {
  const bits = [p.manufacturer, p.friendlyName].filter(Boolean).join(' · ');
  console.log(`  ${String(p.path).padEnd(8)} ${bits || '(no description)'}`);
}
console.log('');

if (!want) {
  console.log('  No port configured. Re-run as:  node scale-probe.js COM3\n');
  process.exit(1);
}
if (!ports.some((p) => p.path.toUpperCase() === want.toUpperCase())) {
  console.log(`  !! ${want} is NOT in the list above. Fix "port" in config.json.\n`);
  process.exit(1);
}
console.log(`Probing ${want}. This takes about a minute.\n`);

// ---- what to try ---------------------------------------------------------
const FRAMINGS = [
  { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 },
  { baudRate: 9600, dataBits: 7, parity: 'even', stopBits: 1 },
  { baudRate: 9600, dataBits: 7, parity: 'odd', stopBits: 1 },
  { baudRate: 19200, dataBits: 8, parity: 'none', stopBits: 1 },
  { baudRate: 4800, dataBits: 7, parity: 'even', stopBits: 1 },
  { baudRate: 2400, dataBits: 7, parity: 'even', stopBits: 1 },
];
const COMMANDS = [
  { label: 'listen only (continuous mode)', send: null },
  { label: 'W CR            (NCI)', send: 'W\r' },
  { label: 'S CRLF          (SICS stable)', send: 'S\r\n' },
  { label: 'SI CRLF         (SICS immediate)', send: 'SI\r\n' },
  { label: 'ENQ 0x05        (Toledo 8217)', send: '\x05' },
  { label: 'P CR', send: 'P\r' },
];

const show = (buf) => {
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const txt = [...buf].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
  return { hex, txt };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const looksLikeWeight = (s) => /\d/.test(s) && /[\d][\d. ]{2,}/.test(s);

const findings = [];

for (const fr of FRAMINGS) {
  const label = `${fr.baudRate} ${fr.dataBits}${fr.parity[0].toUpperCase()}${fr.stopBits}`;
  let sp;
  try {
    sp = await new Promise((resolve, reject) => {
      const s = new SerialPort({ path: want, ...fr, autoOpen: true }, (e) => e ? reject(e) : resolve(s));
    });
  } catch (e) {
    console.log(`--- ${label}: cannot open (${e.message})`);
    if (/Access denied|busy/i.test(e.message)) {
      console.log('    Something else has the port open - close any old scale software.\n');
      break;
    }
    continue;
  }

  console.log(`--- ${label} ------------------------------------`);
  let got = Buffer.alloc(0);
  sp.on('data', (d) => { got = Buffer.concat([got, d]); });
  sp.on('error', () => {});

  for (const cmd of COMMANDS) {
    got = Buffer.alloc(0);
    if (cmd.send) { try { sp.write(cmd.send); } catch {} }
    await wait(cmd.send ? 900 : 1600);
    if (got.length) {
      const { hex, txt } = show(got.subarray(0, 64));
      console.log(`  ${cmd.label}`);
      console.log(`      text: ${JSON.stringify(txt)}`);
      console.log(`      hex : ${hex}${got.length > 64 ? ' ...' : ''}`);
      findings.push({ framing: label, fr, cmd: cmd.send, txt, plausible: looksLikeWeight(txt) });
    }
  }
  if (!findings.some((f) => f.framing === label)) console.log('  (silence)');
  console.log('');
  await new Promise((r) => sp.close(() => r()));
}

// ---- verdict -------------------------------------------------------------
console.log('==================================================');
console.log('  RESULT');
console.log('==================================================\n');

if (!findings.length) {
  console.log('  The scale sent nothing at any setting.\n');
  console.log('  Most likely one of:');
  console.log('    - the cable is a null-modem/straight mismatch, or not seated');
  console.log('    - the scale is set to print-on-demand only: press its PRINT key');
  console.log('      while this runs and see if anything appears');
  console.log('    - the scale needs its serial output turned on in its own setup menu\n');
} else {
  const best = findings.find((f) => f.plausible) || findings[0];
  console.log(`  The scale answered at  ${best.framing}`);
  console.log(`  ${best.cmd ? 'after sending ' + JSON.stringify(best.cmd) : 'on its own, continuously (no poll needed)'}`);
  console.log(`  and it looks like:  ${JSON.stringify(best.txt.slice(0, 40))}\n`);
  console.log('  Put this in config.json under "scale":\n');
  console.log('        "port": ' + JSON.stringify(want) + ',');
  console.log('        "baud": ' + best.fr.baudRate + ',');
  console.log('        "dataBits": ' + best.fr.dataBits + ',');
  console.log('        "parity": "' + best.fr.parity + '",');
  console.log('        "stopBits": ' + best.fr.stopBits + ',');
  console.log('        "pollCmd": ' + (best.cmd ? JSON.stringify(best.cmd) : '""') + '\n');
  console.log('  Then restart with 2-start-station.bat.\n');
}
console.log('  Send this whole window if it still will not read.\n');
process.exit(0);
