import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Orders({ go }) {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ customer_id: '', po_number: '', ship_date: '', lines: [] });
  const [stamp, setStamp] = useState(null);

  // fetched independently: one failing endpoint must not blank the whole screen
  const refresh = async () => {
    const [o, c, p] = await Promise.allSettled([
      api.get('/api/orders'), api.get('/api/customers'), api.get('/api/products'),
    ]);
    if (o.status === 'fulfilled') setOrders(o.value);
    if (c.status === 'fulfilled') setCustomers(c.value);
    if (p.status === 'fulfilled') setProducts(p.value);
    const failed = [o, c, p].find((r) => r.status === 'rejected');
    if (failed) setStamp({ kind: 'bad', title: 'COULD NOT LOAD', detail: failed.reason.message });
  };
  useEffect(() => { refresh(); }, []);

  const addLine = () => setForm((f) => ({ ...f,
    lines: [...f.lines, { product_id: '', qty_cases: '', qty_lb: '' }] }));
  const setLine = (i, k, v) => setForm((f) => {
    const lines = [...f.lines]; lines[i] = { ...lines[i], [k]: v }; return { ...f, lines };
  });

  const save = async () => {
    const lines = form.lines
      .filter((l) => l.product_id)
      .map((l) => ({ product_id: Number(l.product_id),
        qty_cases: l.qty_cases ? Number(l.qty_cases) : null,
        qty_lb: l.qty_lb ? Number(l.qty_lb) : null }));
    if (!form.customer_id || lines.length === 0)
      return setStamp({ kind: 'bad', title: 'INCOMPLETE', detail: 'Pick a customer and add at least one line.' });
    try {
      const o = await api.post('/api/orders', { ...form, customer_id: Number(form.customer_id), lines });
      setForm({ customer_id: '', po_number: '', ship_date: '', lines: [] });
      setShowNew(false);
      setStamp({ kind: 'ok', title: 'ORDER SAVED', detail: `#${o.id} · ${lines.length} line${lines.length === 1 ? '' : 's'}` });
      refresh();
    } catch (err) {
      setStamp({ kind: 'bad', title: 'NOT SAVED', detail: err.message });
    }
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Orders</div>
        <button className="btn" onClick={() => setShowNew(!showNew)}>
          {showNew ? 'Close' : 'New order'}
        </button>
      </div>

      {showNew && (
        <div className="panel">
          <div className="row">
            <div className="field"><label>Customer</label>
              <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">{customers.length ? 'Select…' : 'No customers yet'}</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>PO #</label>
              <input value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} /></div>
            <div className="field"><label>Ship date</label>
              <input type="date" value={form.ship_date} onChange={(e) => setForm({ ...form, ship_date: e.target.value })} /></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn secondary mini" onClick={() => go?.('Customers')}>
              {customers.length ? 'Manage customers' : 'Add a customer first'}
            </button>
            <button className="btn secondary mini" onClick={() => go?.('Items')}>Manage items</button>
          </div>
          <div className="eyebrow">Lines</div>
          {form.lines.map((l, i) => (
            <div className="row" key={i} style={{ marginBottom: 8 }}>
              <div className="field"><label>Product</label>
                <select value={l.product_id} onChange={(e) => setLine(i, 'product_id', e.target.value)}>
                  <option value="">Select…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Packs</label>
                <input inputMode="numeric" value={l.qty_cases} onChange={(e) => setLine(i, 'qty_cases', e.target.value)} /></div>
              <div className="field"><label>Or lb</label>
                <input inputMode="decimal" value={l.qty_lb} onChange={(e) => setLine(i, 'qty_lb', e.target.value)} /></div>
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn secondary" onClick={addLine}>Add line</button>
            <button className="btn" onClick={save}>Save order</button>
          </div>
        </div>
      )}

      {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

      {orders.length === 0 && <div className="panel"><div className="empty">No orders yet. Create one to start packing.</div></div>}
      {orders.map((o) => (
        <div className="panel" key={o.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>#{o.id} · {o.customer_name}</strong>
            <span className={`chip ${o.status === 'OPEN' ? 'PENDING' : o.status === 'PACKING' ? 'ALLOCATED' : 'IN_STOCK'}`}>{o.status}</span>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>
            {o.po_number ? `PO ${o.po_number} · ` : ''}ship {o.ship_date ? o.ship_date.slice(0, 10) : 'TBD'}
          </div>
          <table style={{ marginTop: 8 }}><tbody>
            {(o.lines || []).map((l) => (
              <tr key={l.id}>
                <td>{l.product_name}</td>
                <td className="num">
                  {l.qty_cases ? `${l.packed_cases}/${l.qty_cases} packs` : `${Number(l.packed_lb).toFixed(1)}/${Number(l.qty_lb).toFixed(1)} lb`}
                </td>
                <td style={{ width: '40%' }}>
                  <div className="progress"><div style={{ width: `${Math.min(100,
                    100 * (l.qty_cases ? l.packed_cases / l.qty_cases : l.packed_lb / (l.qty_lb || 1)))}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ))}
    </>
  );
}
