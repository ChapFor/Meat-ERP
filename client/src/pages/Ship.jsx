import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { beepOk, beepBad } from '../beep.js';
import { lb, date } from '../format.js';
import { LineTable } from './Orders.jsx';

// Shipping dock: scan the pick ticket, then every case. Wrong, duplicate and
// voided labels are refused with three beeps; the order closes with a manifest
// and the shipped pounds go to QuickBooks.
export default function Ship() {
  const [orders, setOrders] = useState([]);
  const [order, setOrder] = useState(null);
  const [scan, setScan] = useState('');
  const [msg, setMsg] = useState(null);
  const [removeMode, setRemoveMode] = useState(false);
  const [short, setShort] = useState(null);
  const [done, setDone] = useState(null);
  const input = useRef(null);

  const loadList = () => api.get('/api/orders?status=OPEN').then(setOrders).catch(() => {});
  useEffect(() => { loadList(); }, []);
  const focus = () => setTimeout(() => input.current?.focus(), 0);
  useEffect(() => { focus(); });

  const open = async (id) => {
    try { setOrder(await api.get(`/api/orders/${id}`)); setMsg(null); setShort(null); setDone(null); }
    catch (e) { setMsg({ kind: 'bad', text: e.message }); beepBad(); }
  };

  const onScan = async (e) => {
    e.preventDefault();
    const raw = scan.trim(); setScan('');
    if (!raw) return;
    const m = /^ORD:(\d+)$/i.exec(raw);
    if (m) return open(m[1]);
    if (!order) { setMsg({ kind: 'bad', text: 'Scan the pick ticket first (or pick an order)' }); beepBad(); return; }
    try {
      const out = await api.post(`/api/orders/${order.id}/${removeMode ? 'unscan' : 'scan'}`, { scan: raw });
      setOrder((o) => ({ ...o, ...out.order }));
      const c = out.case;
      setMsg({ kind: 'ok', text: `${removeMode ? 'REMOVED' : 'OK'} · ${c.product_name} · ${Number(c.weight_lb).toFixed(2)} lb · ${c.serial}` });
      beepOk();
    } catch (err) {
      setMsg({ kind: 'bad', text: err.message });
      beepBad();
    }
  };

  const manifest = async (force = false) => {
    try {
      const out = await api.post(`/api/orders/${order.id}/manifest`, { force });
      setDone(out); setOrder(out.order); setShort(null); loadList();
    } catch (err) {
      if (err.data?.short) setShort(err.data.short);
      else { setMsg({ kind: 'bad', text: err.message }); beepBad(); }
    }
  };

  const totals = order?.lines?.reduce((a, l) => ({ cs: a.cs + l.cases_packed, ord: a.ord + Math.ceil(Number(l.qty_ordered)), lb: a.lb + Number(l.lb_packed) }), { cs: 0, ord: 0, lb: 0 });

  return (
    <div onClick={focus}>
      <form className="panel" onSubmit={onScan}>
        <input ref={input} className="scan" value={scan} onChange={(e) => setScan(e.target.value)}
          placeholder={order ? (removeMode ? 'Scan a case to REMOVE it from this order' : 'Scan cases…') : 'Scan pick ticket…'} autoFocus />
        {msg && <div className={`stamp ${msg.kind}`}><div className="title" style={{ fontSize: 24 }}>{msg.text}</div></div>}
      </form>

      {!order && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Open orders</h3>
          <table className="t">
            <thead><tr><th>Order</th><th>Customer</th><th>Ships</th><th className="num">Cases</th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id} className="click" onClick={() => open(o.id)}>
                <td className="mono">{o.doc_number}</td><td>{o.customer_name}</td><td>{date(o.ship_date)}</td>
                <td className="num">{o.cases_packed} / {o.cases_ordered}</td>
              </tr>))}</tbody>
          </table>
          {!orders.length && <div className="muted">No open orders. Orders come from QuickBooks estimates.</div>}
        </div>
      )}

      {order && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ marginBottom: 2 }}>{order.doc_number} · {order.customer_name}</h2>
              <div className="muted">{order.status} · ships {date(order.ship_date)}{order.memo ? ` · ${order.memo}` : ''}</div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => { setOrder(null); setMsg(null); setDone(null); loadList(); }}>Close</button>
              {order.status === 'OPEN' && <button className={`btn ${removeMode ? 'danger' : ''}`} onClick={() => setRemoveMode(!removeMode)}>{removeMode ? 'Removing — tap to stop' : 'Remove a case'}</button>}
              {order.status === 'OPEN' && <button className="btn primary big" onClick={() => manifest(false)}>Finish &amp; manifest</button>}
            </div>
          </div>
          <LineTable lines={order.lines} />
          <div className="row mono" style={{ justifyContent: 'flex-end', marginTop: 8, fontSize: 18 }}>
            {totals.cs} of {totals.ord} cases · {lb(totals.lb)}
          </div>
          {short && (
            <div className="notice warn" style={{ marginTop: 10 }}>
              <b>This order is short:</b>
              <ul>{short.map((s) => <li key={s.item}>{s.item}: {s.packed} of {s.ordered} cases ({s.short} short)</li>)}</ul>
              <button className="btn danger" onClick={() => manifest(true)}>Ship it short</button>{' '}
              <button className="btn" onClick={() => setShort(null)}>Keep packing</button>
            </div>
          )}
          {done && (
            <div className={`notice ${done.qbo?.ok || done.qbo?.skipped ? 'ok' : 'bad'}`} style={{ marginTop: 10 }}>
              Manifested. {done.qbo?.ok ? 'Shipped weights written to QuickBooks.' : done.qbo?.skipped ? `QuickBooks: ${done.qbo.skipped}.` : `QuickBooks update failed: ${done.qbo?.error} — retry from Office → Orders.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
