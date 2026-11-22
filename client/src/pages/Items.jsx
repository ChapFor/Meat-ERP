import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = { code: '', name: '', label_name: '', tare_lb: '0', min_lb: '', max_lb: '', shelf_life_days: '', qbo_item_id: '' };

// Products (PLUs) and their link to QuickBooks items. A QuickBooks item whose
// SKU equals the PLU links itself.
export default function Items() {
  const [items, setItems] = useState([]);
  const [qboItems, setQboItems] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.get('/api/products').then(setItems);
  useEffect(() => {
    load();
    api.get('/api/qbo/status').then((s) => s.connected && api.get('/api/qbo/items').then((q) => { setQboItems(q); load(); })).catch(() => {});
  }, []);

  const save = async () => {
    setErr(null);
    try {
      const qi = qboItems?.find((q) => q.id === edit.qbo_item_id);
      const body = { ...edit, qbo_item_id: edit.qbo_item_id || null, qbo_item_name: qi?.name || (edit.qbo_item_id ? edit.qbo_item_name : null) };
      delete body.id; delete body.in_stock; delete body.in_stock_lb; delete body.created_at;
      if (edit.id) await api.put(`/api/products/${edit.id}`, body); else await api.post('/api/products', body);
      setEdit(null); load();
    } catch (e) { setErr(e.message); }
  };
  const f = (k) => ({ value: edit[k] ?? '', onChange: (e) => setEdit({ ...edit, [k]: e.target.value }) });

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Items</h2>
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>Add item</button>
      </div>
      {edit && (
        <div className="panel" style={{ background: '#faf8f4' }}>
          <div className="form-grid">
            <label>PLU (digits)<input className="txt mono" {...f('code')} /></label>
            <label>Name<input className="txt" {...f('name')} /></label>
            <label>Name on label (optional)<input className="txt" {...f('label_name')} /></label>
            <label>Tare lb (box + liner)<input className="txt mono" {...f('tare_lb')} /></label>
            <label>Min net lb<input className="txt mono" {...f('min_lb')} /></label>
            <label>Max net lb<input className="txt mono" {...f('max_lb')} /></label>
            <label>Shelf life days<input className="txt mono" {...f('shelf_life_days')} /></label>
            <label>QuickBooks item
              {qboItems ? (
                <select className="txt" {...f('qbo_item_id')}>
                  <option value="">— not linked —</option>
                  {qboItems.map((q) => <option key={q.id} value={q.id}>{q.name}{q.sku ? ` (SKU ${q.sku})` : ''}</option>)}
                </select>
              ) : <input className="txt" disabled value={edit.qbo_item_name || 'connect QuickBooks first'} />}
            </label>
            <label>Active
              <select className="txt" value={edit.active === false ? 'no' : 'yes'} onChange={(e) => setEdit({ ...edit, active: e.target.value === 'yes' })}>
                <option value="yes">yes</option><option value="no">no</option>
              </select>
            </label>
          </div>
          {err && <div className="notice bad" style={{ marginTop: 10 }}>{err}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={() => { setEdit(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      <table className="t">
        <thead><tr><th>PLU</th><th>Name</th><th className="num">Tare</th><th className="num">Min–max</th><th className="num">Shelf life</th><th>QuickBooks item</th><th className="num">In stock</th></tr></thead>
        <tbody>{items.map((p) => (
          <tr key={p.id} className="click" onClick={() => setEdit({ ...p, tare_lb: String(p.tare_lb ?? 0) })} style={p.active ? {} : { opacity: 0.5 }}>
            <td className="mono">{p.code}</td><td>{p.name}{p.label_name && <div className="muted">{p.label_name}</div>}</td>
            <td className="num">{Number(p.tare_lb).toFixed(2)}</td>
            <td className="num">{p.min_lb ?? '—'}–{p.max_lb ?? '—'}</td>
            <td className="num">{p.shelf_life_days ? `${p.shelf_life_days} d` : '—'}</td>
            <td>{p.qbo_item_name || <span className="chip warn">not linked</span>}</td>
            <td className="num">{p.in_stock}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
