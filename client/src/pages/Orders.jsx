import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ customer_id: '', po_number: '', ship_date: '', lines: [] });
  const [newCust, setNewCust] = useState('');

  const refresh = async () => {
    setOrders(await api.get('/api/orders'));
    setCustomers(await api.get('/api/customers'));
    setProducts(await api.get('/api/products'));
  };
  useEffect(() => { refresh(); }, []);

  const addLine = () => setForm((f) => ({ ...f,
    lines: [...f.lines, { product_id: '', qty_cases: '', qty_lb: '' }] }));
  const setLine = (i, k, v) => setForm((f) => {
    const lines = [...f.lines]; lines[i] = { ...lines[i], [k]: v }; return { ...f, lines };
  });

  const addCustomer = async () => {
    if (!newCust.trim()) return;
    const c = await api.post('/api/customers', { name: newCust.trim() });
    setNewCust(''); await refresh();
    setForm((f) => ({ ...f, customer_id: c.id }));
  };

  const save = async () => {
    const lines = form.lines
      .filter((l) => l.product_id)
      .map((l) => ({ product_id: Number(l.product_id),
        qty_cases: l.qty_cases ? Number(l.qty_cases) : null,
        qty_lb: l.qty_lb ? Number(l.qty_lb) : null }));
    if (!form.customer_id || lines.length === 0) return alert('Pick a customer and add at least one line.');
    await api.post('/api/orders', { ...form, customer_id: Number(form.customer_id), lines });
    setForm({ customer_id: '', po_number: '', ship_date: '', lines: [] });
    setShowNew(false); refresh();
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
                <option value="">Select…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>PO #</label>
              <input value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} /></div>
            <div className="field"><label>Ship date</label>
              <input type="date" value={form.ship_date} onChange={(e) => setForm({ ...form, ship_date: e.target.value })} /></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field"><label>Add customer</label>
              <input value={newCust} placeholder="Name" onChange={(e) => setNewCust(e.target.value)} /></div>
            <button className="btn secondary" onClick={addCustomer}>Add</button>
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
              <div className="field"><label>Cases</label>
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
                  {l.qty_cases ? `${l.packed_cases}/${l.qty_cases} cs` : `${Number(l.packed_lb).toFixed(1)}/${Number(l.qty_lb).toFixed(1)} lb`}
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
