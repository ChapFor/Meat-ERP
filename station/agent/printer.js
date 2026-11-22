// Printer channels. Each keeps its connection open so sending a label costs
// milliseconds, not a process start.
//   usb      Windows printer via the spooler, RAW datatype (printer-worker.ps1, started once)
//   network  ZT411 Ethernet/Wi-Fi on TCP 9100, one persistent socket
//   sim      logs the ZPL; used for testing without hardware
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

class UsbPrinter {
  constructor(name) {
    this.name = name;
    this.pending = new Map();
    this.seq = 0;
    this.ready = false;
    this.error = null;
    this.start();
  }
  start() {
    const ps = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    this.proc = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'printer-worker.ps1')],
      { env: { ...process.env, CF_PRINTER: this.name }, windowsHide: true });
    let buf = '';
    this.proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'READY') { this.ready = true; this.error = null; continue; }
        const [st, id, ...rest] = line.split(' ');
        const p = this.pending.get(id);
        if (!p) continue;
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (st === 'OK') { this.error = null; p.resolve(); } else { this.error = rest.join(' '); p.reject(new Error(this.error)); }
      }
    });
    this.proc.stderr.on('data', (d) => { this.error = d.toString().trim().slice(0, 300); });
    this.proc.on('exit', () => {
      this.ready = false;
      for (const p of this.pending.values()) p.reject(new Error('print worker stopped'));
      this.pending.clear();
      setTimeout(() => this.start(), 1000);   // keep it alive
    });
    this.proc.on('error', (e) => { this.error = `cannot start PowerShell: ${e.message}`; });
  }
  cmd(kind, payload = '', timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.exitCode !== null) return reject(new Error('print worker not running'));
      const id = String(++this.seq);
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('printer did not answer in 5 s')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${kind} ${id}${payload ? ' ' + payload : ''}\n`);
    });
  }
  send(zpl) { return this.cmd('PRINT', Buffer.from(zpl, 'utf8').toString('base64')); }
  async check() { try { await this.cmd('PING'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
}

class NetworkPrinter {
  constructor(host, port = 9100) { this.host = host; this.port = port; this.sock = null; this.error = null; }
  connect() {
    if (this.sock && !this.sock.destroyed && this.sock.connected) return Promise.resolve(this.sock);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port });
      s.setNoDelay(true);
      s.setKeepAlive(true, 10000);
      const t = setTimeout(() => { s.destroy(); reject(new Error(`no answer from ${this.host}:${this.port}`)); }, 3000);
      s.once('connect', () => { clearTimeout(t); s.connected = true; this.sock = s; this.error = null; resolve(s); });
      s.once('error', (e) => { clearTimeout(t); this.error = e.message; reject(e); });
      s.on('close', () => { s.connected = false; });
      s.on('data', () => {});            // ignore anything the printer sends back
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async send(zpl) {
    const s = await this.connect();
    await new Promise((resolve, reject) => s.write(zpl, (e) => (e ? reject(e) : resolve())));
  }
  async check() { try { await this.connect(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
}

class SimPrinter {
  constructor(latencyMs = 15) { this.latency = latencyMs; this.sent = []; }
  async send(zpl) {
    await new Promise((r) => setTimeout(r, this.latency));
    this.sent.push(zpl);
    if (this.sent.length > 20) this.sent.shift();
  }
  async check() { return { ok: true, sim: true }; }
}

export function makePrinter(cfg) {
  if (cfg.sim) return new SimPrinter(cfg.simLatencyMs);
  if (cfg.mode === 'network') return new NetworkPrinter(cfg.host, cfg.port || 9100);
  if (!cfg.name) throw new Error('printer.name is not set in config.json (run list-printers.bat to find it)');
  return new UsbPrinter(cfg.name);
}
