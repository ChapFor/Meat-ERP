import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const TERMS = ['COD', 'Prepaid', 'Net 7', 'Net 14', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];
const BLANK = {
  name: '', contact: '', phone: '', email: '', payment_terms: '',
  address_line1: '', address_line2: '', city: '', state: '', zip: '', notes: '',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US',
  { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');

function CustomerForm({ value, onChange, onSave, onCancel, saving, title }) {
  const f = (k) => ({ value: value[k] || '', onChange: (e) => onChange({ ...value, [k]: e.target.value }) });
  return (
    <div className="panel">
      <div className="eyebrow" style={{ marginTop: 0 }}>{title}</div>
      <div className="row">
        <div className="field"><label>Business name *</label><input {...f('name')} autoFocus /></div>
        <div className="field"><label>Contact person</label><input {...f('contact')} /></div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="field"><label>Phone</label><input type="tel" {...f('phone')} /></div>
        <div className="field"><label>Email</label><input type="email" {...f('email')} /></div>
        <div className="field" style={{ maxWidth: 170 }}><label>Payment terms</label>
          <input list="cf-terms" placeholder="Net 30" {...f('payment_terms')} />
          <datalist id="cf-terms">{TERMS.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="field"><label>Address</label><input placeholder="Street" {...f('address_line1')} /></div>
        <div className="field"><label>Address line 2</label><input placeholder="Suite, dock…" {...f('address_line2')} /></div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="field"><label>City</label><input {...f('city')} /></div>
        <div className="field" style={{ maxWidth: 90 }}><label>State</label><input maxLength={2} {...f('state')} /></div>
        <div className="field" style={{ maxWidth: 120 }}><label>ZIP</label><input {...f('zip')} /></div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="field"><label>Notes</label><input placeholder="Delivery window, dock hours, standing order…" {...f('notes')} /></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save customer'}</button>
        <button className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(null);        // expanded customer id
  const [history, setHistory] = useState({});    // id -> orders[]
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);  // id being edited
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [stamp, setStamp] = useState(null);

  const refresh = async (all = showInactive) => {
    try { setCustomers(await api.get(`/api/customers${all ? '?all=1' : ''}`)); }
    catch (err) { setStamp({ kind: 'bad', title: 'COULD NOT LOAD', detail: err.message }); }
  };
  useEffect(() => { refresh(); }, [showInactive]);

  const openCustomer = async (c) => {
    if (open === c.id) return setOpen(null);
    setOpen(c.id);
    if (history[c.id]) return;
    try {
      const rows = await api.get(`/api/customers/${c.id}/orders`);
      setHistory((h) => ({ ...h, [c.id]: rows }));
    } catch (err) {
      setStamp({ kind: 'bad', title: 'COULD NOT LOAD ORDERS', detail: err.message });
    }
  };

  const startAdd = () => { setForm(BLANK); setAdding(true); setEditing(null); setStamp(null); };
  const startEdit = (c) => {
    setForm({ ...BLANK, ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, c[k] ?? ''])) });
    setEditing(c.id); setAdding(false); setStamp(null);
  };

  const save = async () => {
    if (!form.name.trim()) return setStamp({ kind: 'bad', title: 'NAME REQUIRED', detail: 'Enter the business name.' });
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/customers/${editing}`, form);
        setStamp({ kind: 'ok', title: 'SAVED', detail: form.name.trim() });
      } else {
        await api.post('/api/customers', form);
        setStamp({ kind: 'ok', title: 'CUSTOMER ADDED', detail: form.name.trim() });
      }
      setAdding(false); setEditing(null); setForm(BLANK);
      await refresh();
    } catch (err) {
      setStamp({ kind: 'bad', title: 'NOT SAVED', detail: err.message });
    } finally { setSaving(false); }
  };

  const setActive = async (c, active) => {
    if (!active && !confirm(`Deactivate ${c.name}? They stay in the directory but drop off order entry.`)) return;
    try { await api.patch(`/api/customers/${c.id}`, { active }); await refresh(); }
    catch (err) { setStamp({ kind: 'bad', title: 'NOT SAVED', detail: err.message }); }
  };

  const shown = customers.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.contact, c.city, c.phone, c.email]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Customer directory ({shown.length})</div>
        <button className="btn" onClick={adding ? () => setAdding(false) : startAdd}>
          {adding ? 'Close' : 'New customer'}
        </button>
      </div>

      {adding && <CustomerForm title="New customer" value={form} onChange={setForm} onSave={save}
        onCancel={() => setAdding(false)} saving={saving} />}
      {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

      <div className="row" style={{ marginTop: 12 }}>
        <div className="field"><input placeholder="Search name, contact, city…" value={query}
          onChange={(e) => setQuery(e.target.value)} autoComplete="off" /></div>
        <label className="autotoggle">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated
        </label>
      </div>

      {shown.length === 0 && (
        <div className="panel"><div className="empty">
          {customers.length === 0 ? 'No customers yet. Add one to start taking orders.' : 'No matches.'}
        </div></div>
      )}

      {shown.map((c) => (
        <div className="panel custcard" key={c.id}>
          {editing === c.id ? (
            <CustomerForm title={`Edit ${c.name}`} value={form} onChange={setForm} onSave={save}
              onCancel={() => setEditing(null)} saving={saving} />
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <button className="linkish" onClick={() => openCustomer(c)}>
                  <strong>{c.name}</strong>{!c.active && <span className="chip VOID" style={{ marginLeft: 8 }}>INACTIVE</span>}
                  <div className="custmeta">
                    {c.contact ? c.contact + ' · ' : ''}
                    {c.city ? `${c.city}${c.state ? ', ' + c.state : ''} · ` : ''}
                    {c.payment_terms || 'terms not set'}
                  </div>
                </button>
                <div style={{ textAlign: 'right' }}>
                  <div className="custmeta">{c.order_count} order{c.order_count === 1 ? '' : 's'}</div>
                  <div className="custmeta">{Number(c.lifetime_lb).toFixed(0)} lb shipped</div>
                </div>
              </div>

              {open === c.id && (
                <div style={{ marginTop: 12 }}>
                  <table><tbody>
                    <tr><td className="lbl">Phone</td><td>{c.phone
                      ? <a href={telHref(c.phone)}>{c.phone}</a> : '—'}</td></tr>
                    <tr><td className="lbl">Email</td><td>{c.email
                      ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td></tr>
                    <tr><td className="lbl">Address</td><td>
                      {c.address_line1 ? <>
                        {c.address_line1}{c.address_line2 ? <><br />{c.address_line2}</> : null}
                        <br />{[c.city, c.state].filter(Boolean).join(', ')} {c.zip || ''}
                      </> : '—'}
                    </td></tr>
                    <tr><td className="lbl">Terms</td><td>{c.payment_terms || '—'}</td></tr>
                    <tr><td className="lbl">Last order</td><td>{fmtDate(c.last_order_date)}</td></tr>
                    {c.notes && <tr><td className="lbl">Notes</td><td>{c.notes}</td></tr>}
                  </tbody></table>

                  <div className="eyebrow">Order history</div>
                  {!history[c.id] ? <div className="empty">Loading…</div>
                    : history[c.id].length === 0 ? <div className="empty">No orders yet.</div> : (
                    <table>
                      <thead><tr>
                        <th>Order</th><th>Ordered</th><th>Ship</th>
                        <th className="num">Cases</th><th className="num">lb</th><th>Status</th>
                      </tr></thead>
                      <tbody>
                        {history[c.id].map((o) => (
                          <tr key={o.id}>
                            <td>#{o.id}{o.po_number ? <span className="custmeta"> PO {o.po_number}</span> : null}</td>
                            <td>{fmtDate(o.order_date)}</td>
                            <td>{fmtDate(o.ship_date)}</td>
                            <td className="num">{o.cases_packed}</td>
                            <td className="num">{Number(o.lb_packed).toFixed(1)}</td>
                            <td><span className={`chip ${o.status === 'OPEN' ? 'PENDING'
                              : o.status === 'PACKING' ? 'ALLOCATED' : 'IN_STOCK'}`}>{o.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn secondary mini" onClick={() => startEdit(c)}>Edit</button>
                    {c.active
                      ? <button className="btn danger mini" onClick={() => setActive(c, false)}>Deactivate</button>
                      : <button className="btn secondary mini" onClick={() => setActive(c, true)}>Reactivate</button>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}
