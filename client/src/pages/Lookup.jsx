import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { beepBad, beepOk } from '../beep.js';
import { dateTime } from '../format.js';

// Scan any label to see its history; void a misprint or damaged case.
export default function Lookup() {
  const [scan, setScan] = useState('');
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState(null);
  const [voidMode, setVoidMode] = useState(false);
  const [reason, setReason] = useState('misprint');
  const input = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    const raw = scan.trim(); setScan(''); setErr(null);
    if (!raw) return;
    try {
      if (voidMode) { await api.post('/api/cases/void', { scan: raw, reason }); beepOk(); }
      setRec(await api.post('/api/cases/lookup', { scan: raw }));
    } catch (e2) { setErr(e2.message); setRec(null); beepBad(); }
    input.current?.focus();
  };

  return (
    <div>
      <form className="panel" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 10 }}>
          <button type="button" className={`btn ${!voidMode ? 'primary' : ''}`} onClick={() => setVoidMode(false)}>Look up</button>
          <button type="button" className={`btn ${voidMode ? 'danger' : ''}`} onClick={() => setVoidMode(true)}>Void</button>
          {voidMode && (
            <select className="txt" value={reason} onChange={(e) => setReason(e.target.value)}>
              {['misprint', 'damaged', 'wrong product', 'wrong weight', 'test label'].map((r) => <option key={r}>{r}</option>)}
            </select>
          )}
        </div>
        <input ref={input} className="scan" autoFocus value={scan} onChange={(e) => setScan(e.target.value)}
          placeholder={voidMode ? 'Scan the label to VOID' : 'Scan a label'} />
      </form>
      {err && <div className="stamp bad"><div className="title" style={{ fontSize: 22 }}>{err}</div></div>}
      {rec && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="mono">{rec.serial}</h2>
            <span className={`chip ${rec.status === 'VOID' ? 'bad' : rec.status === 'IN_STOCK' ? 'ok' : 'warn'}`}>{rec.status}</span>
          </div>
          <table className="t"><tbody>
            <tr><th>Product</th><td>{rec.product_name} (PLU {rec.product_code})</td></tr>
            <tr><th>Net weight</th><td className="mono">{Number(rec.weight_lb).toFixed(2)} lb</td></tr>
            <tr><th>Lot</th><td className="mono">{rec.lot_code}</td></tr>
            <tr><th>Printed</th><td>{dateTime(rec.printed_at)} · {rec.station || '—'}</td></tr>
            {rec.order_doc && <tr><th>Order</th><td>{rec.order_doc} · {rec.customer_name}</td></tr>}
            {rec.void_reason && <tr><th>Void reason</th><td>{rec.void_reason}</td></tr>}
          </tbody></table>
          <h3>History</h3>
          <table className="t"><tbody>
            {rec.events.map((ev, i) => <tr key={i}><td>{dateTime(ev.at)}</td><td>{ev.event}</td><td>{ev.doc_number || ''}</td><td className="muted">{ev.detail || ''}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
