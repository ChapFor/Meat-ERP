import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { lb, date, dateTime, num } from '../format.js';
import { code128Svg } from '../code128.js';

export function LineTable({ lines }) {
  return (
    <table className="t">
      <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Packed</th><th style={{ width: '25%' }}></th><th className="num">To go</th><th className="num">Net lb</th><th className="num">$/lb</th></tr></thead>
      <tbody>{lines.map((l) => {
        const ord = Math.ceil(Number(l.qty_ordered));
        const pct = ord ? Math.min(100, (100 * l.cases_packed) / ord) : 0;
        return (
          <tr key={l.id}>
            <td>{l.product_name || <span className="chip bad" title="Map this QuickBooks item to a PLU under Office → Items">{l.item_name || 'item'} — not mapped</span>}
              {l.description && <div className="muted" style={{ fontSize: 12 }}>{l.description}</div>}</td>
            <td className="num">{num(l.qty_ordered)} cs</td>
            <td className="num">{l.cases_packed}</td>
            <td><div className={`bar ${l.cases_remaining === 0 ? 'done' : ''}`}><div style={{ width: `${pct}%` }} /></div></td>
            <td className="num" style={{ fontWeight: 700 }}>{l.cases_remaining}</td>
            <td className="num">{Number(l.lb_packed).toFixed(2)}</td>
            <td className="num">{l.unit_price != null ? Number(l.unit_price).toFixed(2) : '—'}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

const STATUS_CHIP = { OPEN: 'warn', MANIFESTED: 'ok', CANCELLED: 'bad' };
const WB_CHIP = { DONE: ['ok', 'in QuickBooks'], PENDING: ['warn', 'QB pending'], ERROR: ['bad', 'QB error'] };

export default function Orders() {
  const [status, setStatus] = useState('OPEN');
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = () => api.get(`/api/orders?status=${status}`).then(setList).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (id) => setSel(await api.get(`/api/orders/${id}`));
  const print = (kind) => { setPrinting(kind); setTimeout(() => { window.print(); setPrinting(null); }, 50); };
  const retry = async () => {
    const r = await api.post(`/api/orders/${sel.id}/writeback`);
    setMsg(r.ok ? 'Written to QuickBooks' : r.error || r.skipped); open(sel.id); load();
  };

  if (sel) {
    const totLb = sel.lines.reduce((s, l) => s + Number(l.lb_packed), 0);
    const totCs = sel.lines.reduce((s, l) => s + l.cases_packed, 0);
    const wb = WB_CHIP[sel.qbo_writeback_status];
    return (
      <div>
        <div className="panel no-print">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ marginBottom: 2 }}>{sel.doc_number} · {sel.customer_name}</h2>
              <div className="muted">Ordered {date(sel.txn_date)} · ships {date(sel.ship_date)}{sel.memo ? ` · ${sel.memo}` : ''}</div>
            </div>
            <div className="row">
              <span className={`chip ${STATUS_CHIP[sel.status]}`}>{sel.status}</span>
              {wb && <span className={`chip ${wb[0]}`} title={sel.qbo_writeback_error || ''}>{wb[1]}</span>}
              <button className="btn" onClick={() => print('pick')}>Print pick ticket</button>
              {sel.status === 'MANIFESTED' && <button className="btn" onClick={() => print('manifest')}>Print manifest</button>}
              {sel.status === 'MANIFESTED' && sel.qbo_writeback_status !== 'DONE' && sel.qbo_id && <button className="btn primary" onClick={retry}>Send to QuickBooks</button>}
              <button className="btn" onClick={() => { setSel(null); setMsg(null); load(); }}>Back</button>
            </div>
          </div>
          {sel.qbo_writeback_error && <div className="notice bad" style={{ marginTop: 8 }}>{sel.qbo_writeback_error}</div>}
          {msg && <div className="notice ok" style={{ marginTop: 8 }}>{msg}</div>}
          <LineTable lines={sel.lines} />
          <div className="mono right" style={{ marginTop: 8 }}>{totCs} cases · {lb(totLb)}</div>
          <h3>Cases on this order</h3>
          <table className="t">
            <thead><tr><th>Serial</th><th>Product</th><th>Lot</th><th className="num">Net lb</th><th>Status</th><th>Scanned</th></tr></thead>
            <tbody>{sel.cases.map((c) => (
              <tr key={c.id}><td className="mono">{c.serial}</td><td>{c.product_name}</td><td className="mono">{c.lot_code}</td>
                <td className="num">{Number(c.weight_lb).toFixed(2)}</td><td>{c.status}</td><td>{dateTime(c.allocated_at)}</td></tr>))}</tbody>
          </table>
        </div>
        {printing && <PrintDoc kind={printing} order={sel} />}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Orders</h2>
        <div className="row">
          {['OPEN', 'MANIFESTED', 'ALL'].map((s) => <button key={s} className={`btn ${s === status ? 'primary' : ''}`} onClick={() => setStatus(s)}>{s === 'ALL' ? 'All (90 days)' : s[0] + s.slice(1).toLowerCase()}</button>)}
        </div>
      </div>
      {msg && <div className="notice bad">{msg}</div>}
      <table className="t">
        <thead><tr><th>Order</th><th>Customer</th><th>Ships</th><th className="num">Cases</th><th className="num">Packed lb</th><th>Status</th></tr></thead>
        <tbody>{list.map((o) => {
          const wb = WB_CHIP[o.qbo_writeback_status];
          return (
            <tr key={o.id} className="click" onClick={() => open(o.id)}>
              <td className="mono">{o.doc_number}</td>
              <td>{o.customer_name}{o.unmapped_lines > 0 && <> <span className="chip bad">{o.unmapped_lines} unmapped</span></>}</td>
              <td>{date(o.ship_date)}</td>
              <td className="num">{o.cases_packed} / {o.cases_ordered}</td>
              <td className="num">{Number(o.lb_packed).toFixed(2)}</td>
              <td><span className={`chip ${STATUS_CHIP[o.status]}`}>{o.status}</span> {wb && <span className={`chip ${wb[0]}`}>{wb[1]}</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {!list.length && <div className="muted" style={{ marginTop: 8 }}>Nothing here. Orders are created as estimates in QuickBooks and appear within a minute.</div>}
    </div>
  );
}

// Printable pick ticket (scan its barcode at the dock to open the order) and
// shipping weight manifest.
function PrintDoc({ kind, order }) {
  const totLb = order.lines.reduce((s, l) => s + Number(l.lb_packed), 0);
  return (
    <div className="print-only" style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>CHAPEL FORD FARM</div>
          <div>2345 Taneytown Road, Gettysburg, PA</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>{kind === 'pick' ? 'PICK TICKET' : 'SHIPPING WEIGHT MANIFEST'}</div>
          <div>Order {order.doc_number} · {order.customer_name}</div>
          <div>Ship date {order.ship_date || '—'}{order.memo ? ` · ${order.memo}` : ''}</div>
        </div>
        <div dangerouslySetInnerHTML={{ __html: code128Svg(`ORD:${order.id}`, { height: 60, module: 2 }) }} />
      </div>
      {kind === 'pick' ? (
        <table className="t" style={{ marginTop: 16 }}>
          <thead><tr><th>Item</th><th>PLU</th><th className="num">Cases</th><th>Notes</th></tr></thead>
          <tbody>{order.lines.map((l) => <tr key={l.id}><td>{l.product_name || l.item_name}</td><td className="mono">{l.product_code || '—'}</td><td className="num">{num(l.qty_ordered)}</td><td>{l.description || ''}</td></tr>)}</tbody>
        </table>
      ) : (
        <>
          {order.lines.map((l) => (
            <div key={l.id} style={{ marginTop: 14 }}>
              <b>{l.product_name || l.item_name}</b> — {l.cases_packed} of {num(l.qty_ordered)} cases · {lb(l.lb_packed)}
              <table className="t"><tbody>
                {order.cases.filter((c) => c.order_line_id === l.id).map((c) => (
                  <tr key={c.id}><td className="mono">{c.serial}</td><td className="mono">Lot {c.lot_code}</td><td className="num">{Number(c.weight_lb).toFixed(2)} lb</td></tr>))}
              </tbody></table>
            </div>
          ))}
          <div style={{ marginTop: 14, fontSize: 16, fontWeight: 700 }}>
            Total: {order.cases.length} cases · {lb(totLb)}
          </div>
          <div style={{ marginTop: 40 }}>Received by: ______________________  Date: __________</div>
        </>
      )}
    </div>
  );
}
