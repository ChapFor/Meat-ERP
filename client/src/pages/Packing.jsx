import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Packing() {
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [scan, setScan] = useState('');
  const [stamp, setStamp] = useState(null);
  const inputRef = useRef();

  const refresh = async () => {
    const all = await api.get('/api/orders');
    setOrders(all.filter((o) => ['OPEN', 'PACKING'].includes(o.status)));
  };
  useEffect(() => { refresh(); }, []);
  const order = orders.find((o) => o.id === Number(orderId));

  const submit = async (e) => {
    e.preventDefault();
    if (!scan.trim() || !order) return;
    try {
      const res = await api.post('/api/scan/pack', { barcode: scan, order_id: order.id });
      setStamp({
        kind: res.warning ? 'warn' : 'ok',
        title: res.warning ? 'PACKED — OVER QTY' : 'PACKED',
        detail: `${res.case.product_name} · ${res.case.net_weight_lb} lb · ${res.case.serial}${res.warning ? ' — ' + res.warning : ''}`,
      });
      refresh();
    } catch (err) {
      setStamp({ kind: 'bad', title: 'REJECTED', detail: err.message });
    }
    setScan('');
    inputRef.current?.focus();
  };

  const undo = async () => {
    const code = prompt('Scan or type the case barcode to un-pack:');
    if (!code) return;
    try { await api.post('/api/scan/unpack', { barcode: code }); refresh(); }
    catch (err) { setStamp({ kind: 'bad', title: 'UNDO FAILED', detail: err.message }); }
  };

  const markPacked = async () => {
    await api.patch(`/api/orders/${order.id}`, { status: 'PACKED' });
    setOrderId(''); refresh();
  };

  return (
    <>
      <div className="eyebrow">Pack to order</div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>Order</label>
        <select value={orderId} onChange={(e) => { setOrderId(e.target.value); setStamp(null);
          setTimeout(() => inputRef.current?.focus(), 50); }}>
          <option value="">Select an open order…</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>#{o.id} — {o.customer_name} ({o.status})</option>
          ))}
        </select>
      </div>

      {order && (
        <>
          <form onSubmit={submit}>
            <input ref={inputRef} className="scanbox" value={scan} placeholder="Scan case…"
              onChange={(e) => setScan(e.target.value)} autoComplete="off" />
          </form>
          {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

          <div className="panel">
            <table><tbody>
              {(order.lines || []).map((l) => {
                const done = l.qty_cases ? l.packed_cases >= l.qty_cases
                  : Number(l.packed_lb) >= Number(l.qty_lb || 0);
                return (
                  <tr key={l.id}>
                    <td>{l.product_name}</td>
                    <td className="num">
                      {l.qty_cases ? `${l.packed_cases}/${l.qty_cases} cs` : `${Number(l.packed_lb).toFixed(1)}/${Number(l.qty_lb).toFixed(1)} lb`}
                    </td>
                    <td>{done ? <span className="chip IN_STOCK">DONE</span> : <span className="chip PENDING">OPEN</span>}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
          <div className="row">
            <button className="btn secondary" onClick={undo}>Un-pack a case</button>
            <button className="btn" onClick={markPacked}>Mark order packed</button>
          </div>
        </>
      )}
    </>
  );
}
