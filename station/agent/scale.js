// Scale reader with fast, request/response polling.
// The old station polled every 250 ms and needed 3 matching readings inside
// 1.2 s (~750 ms+). Here the next poll goes out as soon as the previous answer
// arrives (plus pollMs), so a Mettler Toledo BC at 9600 baud gives ~15–20
// readings a second and stability is known ~150–200 ms after the case settles.
import { parseWeightLb } from './parse-weight.js';

export class Scale {
  constructor(cfg, onReading) {
    this.cfg = { pollCmd: 'W\r', pollMs: 40, baudRate: 9600, divisor: 100, ...cfg };
    this.onReading = onReading;
    this.readings = [];       // {lb, at}
    this.error = null;
    this.connected = false;
    this.lastAt = 0;
  }

  push(lb) {
    const at = Date.now();
    this.readings.push({ lb, at });
    if (this.readings.length > 30) this.readings.shift();
    this.lastAt = at;
    this.connected = true;
    this.error = null;
    this.onReading?.(lb, at);
  }

  // Stable = the last `count` readings agree within `tolerance` lb and are all
  // from the last `windowMs`.
  state({ count = 3, tolerance = 0.02, windowMs = 500 } = {}) {
    const now = Date.now();
    const last = this.readings[this.readings.length - 1];
    if (!last || now - last.at > 1500) return { lb: null, stable: false };
    const recent = this.readings.slice(-count);
    const stable = recent.length === count && recent.every((r) => now - r.at <= windowMs) &&
      Math.max(...recent.map((r) => r.lb)) - Math.min(...recent.map((r) => r.lb)) <= tolerance;
    return { lb: last.lb, stable };
  }

  health() {
    if (this.connected && Date.now() - this.lastAt < 2000) return { ok: true };
    return { ok: false, error: this.error || 'no weight from the scale' };
  }

  async start() {
    if (this.cfg.sim) return this.startSim();
    let SerialPort;
    try { ({ SerialPort } = await import('serialport')); }
    catch { this.error = 'serialport package missing — run install.bat'; return; }
    const open = () => {
      const sp = new SerialPort({ path: this.cfg.port, baudRate: this.cfg.baudRate, autoOpen: false });
      let buf = '', waiting = false, timer = null;
      const poll = () => {
        if (!sp.isOpen || !this.cfg.pollCmd) return;
        waiting = true;
        sp.write(this.cfg.pollCmd);
        clearTimeout(timer);
        timer = setTimeout(() => { waiting = false; schedule(); }, 400); // no answer: try again
      };
      const schedule = () => setTimeout(poll, this.cfg.pollMs);
      sp.on('data', (d) => {
        buf += d.toString('latin1');
        // one message per CR (or LF); keep any partial tail
        let i;
        while ((i = buf.search(/[\r\n]/)) >= 0) {
          const msg = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!msg.trim()) continue;
          const lb = parseWeightLb(msg, { divisor: this.cfg.divisor });
          if (lb === null) this.error = `unreadable scale message ${JSON.stringify(msg.slice(0, 20))}`;
          else this.push(lb);
          if (waiting) { waiting = false; clearTimeout(timer); schedule(); }
        }
        if (buf.length > 200) buf = buf.slice(-50);
      });
      sp.on('close', () => { this.connected = false; this.error = `${this.cfg.port} closed`; setTimeout(open, 2000); });
      sp.on('error', (e) => { this.error = e.message; });
      sp.open((e) => {
        if (e) { this.error = `cannot open ${this.cfg.port}: ${e.message}`; setTimeout(open, 3000); return; }
        poll();
      });
    };
    open();
  }

  // Simulated scale: setTarget(lb) "places a case"; the reading wobbles for
  // simSettleMs and then settles, like a real platform.
  startSim() {
    this.simTarget = 0; this.simSince = Date.now();
    const settle = this.cfg.simSettleMs ?? 250;
    setInterval(() => {
      const t = Date.now() - this.simSince;
      const noise = t < settle ? (Math.random() - 0.5) * 0.3 : 0;
      this.push(Math.max(0, Math.round((this.simTarget + noise) * 100) / 100));
    }, this.cfg.simIntervalMs ?? 50);
  }
  setTarget(lb) { this.simTarget = Number(lb) || 0; this.simSince = Date.now(); }
}
