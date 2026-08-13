import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const UNITS = ['lb', 'case', 'each'];
const BLANK = { code: '', name: '', unit: 'lb' };

export default function Items() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [edit, setEdit] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [stamp, setStamp] = useState(null);

  const refresh = async () => {
    try {
      const rows = await api.get(`/api/products${showInactive ? '?all=1' : ''}`);
      setItems(rows);
      // the Station screen falls back to this cache when the cloud is unreachable
      localStorage.setItem('cf_products_cache', JSON.stringify(rows.filter((p) => p.active)));
    } catch (err) { setStamp({ kind: 'bad', title: 'COULD NOT LOAD', detail: err.message }); }
  };
  useEffect(() => { refresh(); }, [showInactive]);

  const add = async () => {
    if (!form.code.trim() || !form.name.trim())
      return setStamp({ kind: 'bad', title: 'MISSING FIELD', detail: 'Item code and name are both required.' });
    setSaving(true);
    try {
      const p = await api.post('/api/products', form);
      setStamp({ kind: 'ok', title: 'ITEM ADDED', detail: `${p.name} · code ${p.code} — now on the label station` });
      setForm(BLANK); setAdding(false); await refresh();
    } catch (err) {
      setStamp({ kind: 'bad', title: 'NOT ADDED', detail: err.message });
    } finally { setSaving(false); }
  };

  const saveEdit = async (id) => {
    setSaving(true);
    try {
      await api.patch(`/api/products/${id}`, edit);
      setStamp({ kind: 'ok', title: 'SAVED', detail: edit.name });
      setEditing(null); await refresh();
    } catch (err) {
      setStamp({ kind: 'bad', title: 'NOT SAVED', detail: err.message });
    } finally { setSaving(false); }
  };

  const setActive = async (p, active) => {
    if (!active && !confirm(`Deactivate ${p.name}? It drops off the label station and order entry. Existing cases keep their history.`)) return;
    try { await api.patch(`/api/products/${p.id}`, { active }); await refresh(); }
    catch (err) { setStamp({ kind: 'bad', title: 'NOT SAVED', detail: err.message }); }
  };

  const shown = items.filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || String(p.code).toLowerCase().includes(q);
  });

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Items ({shown.length})</div>
        <button className="btn" onClick={() => { setAdding(!adding); setStamp(null); }}>
          {adding ? 'Close' : 'New item'}
        </button>
      </div>
      <div className="eyebrow" style={{ marginTop: 4, letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
        The item code is the PLU printed into the barcode as AI (91). Every item here
        appears in the label station's product list and on order entry.
      </div>

      {adding && (
        <div className="panel">
          <div className="row">
            <div className="field" style={{ maxWidth: 140 }}><label>Item code (PLU) *</label>
              <input value={form.code} autoFocus placeholder="176"
                onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div className="field"><label>Name *</label>
              <input value={form.name} placeholder="Whole Chicken"
                onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field" style={{ maxWidth: 120 }}><label>Unit</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select></div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={add} disabled={saving}>{saving ? 'Saving…' : 'Add item'}</button>
          </div>
        </div>
      )}

      {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

      <div className="row" style={{ marginTop: 12 }}>
        <div className="field"><input placeholder="Search items…" value={query}
          onChange={(e) => setQuery(e.target.value)} autoComplete="off" /></div>
        <label className="autotoggle">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated
        </label>
      </div>

      <div className="panel">
        {shown.length === 0 ? <div className="empty">No items. Add one so the label station can print it.</div> : (
          <table>
            <thead><tr>
              <th>Code</th><th>Name</th><th>Unit</th><th className="num">Cases</th><th></th>
            </tr></thead>
            <tbody>
              {shown.map((p) => editing === p.id ? (
                <tr key={p.id}>
                  <td><input style={{ width: 80 }} value={edit.code}
                    onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></td>
                  <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                  <td><select value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></td>
                  <td className="num">{p.case_count}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn mini" onClick={() => saveEdit(p.id)} disabled={saving}>Save</button>{' '}
                    <button className="btn secondary mini" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} style={p.active ? undefined : { opacity: .5 }}>
                  <td><span className="serial">{p.code}</span></td>
                  <td>{p.name}{!p.active && <span className="chip VOID" style={{ marginLeft: 8 }}>INACTIVE</span>}</td>
                  <td>{p.unit}</td>
                  <td className="num">{p.case_count}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn secondary mini" onClick={() => {
                      setEdit({ code: p.code, name: p.name, unit: p.unit }); setEditing(p.id); setStamp(null);
                    }}>Edit</button>{' '}
                    {p.active
                      ? <button className="btn danger mini" onClick={() => setActive(p, false)}>Deactivate</button>
                      : <button className="btn secondary mini" onClick={() => setActive(p, true)}>Reactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
