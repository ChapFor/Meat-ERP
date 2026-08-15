import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function ScanIn() {
  const [scan, setScan] = useState('');
  const [stamp, setStamp] = useState(null);
  const [today, setToday] = useState([]);
  const [pending, setPending] = useState([]);
  const inputRef = useRef();

  const refresh = async () => {
    setPending(await api.get('/api/reports/pending'));
    const cases = await api.get('/api/cases?status=IN_STOCK');
    const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
    setToday(cases.filter((c) => new Date(c.scanned_in_at) >= cutoff));
  };
  useEffect(() => { refresh(); inputRef.current?.focus(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!scan.trim()) return;
    try {
      const c = await api.post('/api/scan/in', { barcode: scan });
      const what = c.pack_count ? `CASE — ${c.pack_count} packs · ` : '';
      setStamp({
        kind: c.warning ? 'warn' : 'ok',
        title: c.warning ? 'ALREADY IN STOCK' : 'IN STOCK',
        detail: `${what}${c.product_name} · ${c.net_weight_lb} lb · lot ${c.lot_code} · ${c.serial}`,
      });
      refresh();
    } catch (err) {
      setStamp({ kind: 'bad', title: 'REJECTED', detail: err.message });
    }
    setScan('');
    inputRef.current?.focus();
  };

  const voidCase = async (id) => {
    if (!confirm('Void this label? It will not count as inventory.')) return;
    await api.post(`/api/cases/${id}/void`, { reason: 'misprint' });
    refresh();
  };

  return (
    <>
      <div className="eyebrow">Scan a pack or case label to commit it to inventory</div>
      <form onSubmit={submit}>
        <input ref={inputRef} className="scanbox" value={scan} placeholder="Scan barcode…"
          onChange={(e) => setScan(e.target.value)} autoComplete="off" />
      </form>
      {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

      {pending.length > 0 && (
        <div className="panel">
          <div className="eyebrow" style={{ marginTop: 0 }}>Printed, not yet scanned ({pending.length})</div>
          <table><tbody>
            {pending.map((c) => (
              <tr key={c.id}>
                <td>{c.product_name}
                  {c.pack_count > 0 && <span className="custmeta"> · case of {c.pack_count}</span>}</td>
                <td className="num">{c.net_weight_lb} lb</td>
                <td><span className="serial">{c.serial}</span></td>
                <td><button className="btn danger" style={{ minHeight: 36, padding: '6px 12px' }}
                  onClick={() => voidCase(c.id)}>Void</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <div className="eyebrow">Scanned in today ({today.length})</div>
      <div className="panel">
        {today.length === 0 ? <div className="empty">Nothing scanned yet today.</div> : (
          <table><tbody>
            {today.map((c) => (
              <tr key={c.id}>
                <td>{c.product_name}</td>
                <td className="num">{c.net_weight_lb} lb</td>
                <td><span className="serial">{c.serial}</span></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
