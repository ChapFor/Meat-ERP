import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const BLANK = { batch_type: 'CUT', input_weight_lb: '', bird_count: '', input_cost: '',
  parent_lot_code: '', notes: '' };
const money = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);
const lb = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1));
const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);
const when = (d) => (d ? new Date(d).toLocaleString('en-US',
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export default function Batches() {
  const [batches, setBatches] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [open, setOpen] = useState(null);      // expanded batch id
  const [yields, setYields] = useState({});    // id -> yield report
  const [inputs, setInputs] = useState({});    // id -> input rows
  const [stamp, setStamp] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { setBatches(await api.get('/api/batches')); }
    catch (e) { setStamp({ kind: 'bad', title: 'COULD NOT LOAD', detail: e.message }); }
  };
  useEffect(() => { refresh(); }, []);

  // an open batch is live production, so keep its numbers moving
  useEffect(() => {
    const t = setInterval(() => {
      if (batches.some((b) => b.status === 'OPEN')) refresh();
      if (open) loadYield(open, true);
    }, 10000);
    return () => clearInterval(t);
  }, [batches, open]);

  const loadYield = async (id, quiet) => {
    try {
      const [y, i] = await Promise.all([
        api.get(`/api/batches/${id}/yield`), api.get(`/api/batches/${id}/inputs`),
      ]);
      setYields((m) => ({ ...m, [id]: y }));
      setInputs((m) => ({ ...m, [id]: i }));
    } catch (e) {
      if (!quiet) setStamp({ kind: 'bad', title: 'COULD NOT LOAD YIELD', detail: e.message });
    }
  };

  const expand = async (b) => {
    if (open === b.id) return setOpen(null);
    setOpen(b.id);
    await loadYield(b.id);
  };

  const openBatch = async () => {
    if (!form.input_weight_lb) return setStamp({ kind: 'bad', title: 'NEED INPUT WEIGHT',
      detail: 'Enter the carcass weight going into the batch.' });
    setBusy(true);
    try {
      const b = await api.post('/api/batches', form);
      setStamp({ kind: 'ok', title: 'BATCH OPEN',
        detail: `${b.batch_type} · lot ${b.lot_code} — the station can now print into it` });
      setForm(BLANK); setAdding(false); await refresh();
    } catch (e) { setStamp({ kind: 'bad', title: 'NOT OPENED', detail: e.message }); }
    finally { setBusy(false); }
  };

  const close = async (b) => {
    if (!confirm(`Close batch ${b.lot_code}? No more output can be printed into it.`)) return;
    try {
      await api.post(`/api/batches/${b.id}/close`);
      setStamp({ kind: 'ok', title: 'BATCH CLOSED', detail: `lot ${b.lot_code}` });
      await refresh(); if (open === b.id) await loadYield(b.id);
    } catch (e) { setStamp({ kind: 'bad', title: 'NOT CLOSED', detail: e.message }); }
  };

  const reopen = async (b) => {
    try {
      await api.post(`/api/batches/${b.id}/reopen`);
      setStamp({ kind: 'warn', title: 'BATCH REOPENED', detail: `lot ${b.lot_code} — yield will change` });
      await refresh(); if (open === b.id) await loadYield(b.id);
    } catch (e) { setStamp({ kind: 'bad', title: 'NOT REOPENED', detail: e.message }); }
  };

  const addInput = async (b) => {
    const barcode = prompt('Scan the input case to consume into this batch:');
    if (!barcode) return;
    try {
      await api.post(`/api/batches/${b.id}/inputs`, { barcode });
      await refresh(); await loadYield(b.id);
      setStamp({ kind: 'ok', title: 'INPUT ADDED', detail: 'consumed into the batch' });
    } catch (e) { setStamp({ kind: 'bad', title: 'INPUT NOT ADDED', detail: e.message }); }
  };

  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Batches</div>
        <button className="btn" onClick={() => { setAdding(!adding); setStamp(null); }}>
          {adding ? 'Close' : 'Open a batch'}
        </button>
      </div>

      {adding && (
        <div className="panel">
          <div className="row">
            <div className="field" style={{ maxWidth: 150 }}><label>Type</label>
              <select {...f('batch_type')}>
                <option value="CUT">Cut</option>
                <option value="FORMULATE">Formulate</option>
              </select></div>
            <div className="field" style={{ maxWidth: 170 }}><label>Carcass weight in (lb) *</label>
              <input inputMode="decimal" placeholder="480.5" {...f('input_weight_lb')} /></div>
            <div className="field" style={{ maxWidth: 130 }}><label>Bird count</label>
              <input inputMode="numeric" placeholder="120" {...f('bird_count')} /></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field" style={{ maxWidth: 170 }}><label>Input cost ($)</label>
              <input inputMode="decimal" placeholder="optional" {...f('input_cost')} /></div>
            <div className="field" style={{ maxWidth: 190 }}><label>From lot</label>
              <input placeholder="260813-B1 (optional)" {...f('parent_lot_code')} /></div>
            <div className="field"><label>Notes</label><input {...f('notes')} /></div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={openBatch} disabled={busy}>
              {busy ? 'Opening…' : 'Open batch'}</button>
          </div>
        </div>
      )}

      {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

      {batches.length === 0 && (
        <div className="panel"><div className="empty">
          No batches yet. Open one so the station has somewhere to print.
        </div></div>
      )}

      {batches.map((b) => {
        const y = yields[b.id];
        return (
          <div className="panel custcard" key={b.id}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <button className="linkish" onClick={() => expand(b)}>
                <strong>{b.lot_code}</strong>{' '}
                <span className={`chip ${b.status === 'OPEN' ? 'PENDING' : 'IN_STOCK'}`}>{b.status}</span>{' '}
                <span className="custmeta">{b.batch_type}</span>
                <div className="custmeta">
                  opened {when(b.opened_at)}{b.closed_at ? ` · closed ${when(b.closed_at)}` : ''}
                  {b.parent_lot_code ? ` · from ${b.parent_lot_code}` : ''}
                </div>
              </button>
              <div style={{ textAlign: 'right' }}>
                <div className="custmeta">{b.output_packs} packs out</div>
                <div className="custmeta">{lb(b.output_lb)} lb / {lb(b.input_weight_lb)} lb in</div>
              </div>
            </div>

            {open === b.id && (
              <div style={{ marginTop: 12 }}>
                {!y ? <div className="empty">Loading…</div> : (
                  <>
                    <table><tbody>
                      <tr><td className="lbl">Input</td><td>
                        {lb(y.input.weight_lb)} lb
                        {y.input.bird_count ? ` · ${y.input.bird_count} birds` : ''}
                        {y.input.avg_bird_lb ? ` · ${y.input.avg_bird_lb} lb/bird` : ''}
                        {y.input.cost !== null ? ` · ${money(y.input.cost)}` : ''}
                      </td></tr>
                      {(inputs[b.id] || []).length > 0 && (
                        <tr><td className="lbl">Consumed</td><td>
                          {inputs[b.id].map((i) => (
                            <div key={i.id} className="custmeta">
                              {i.product_name} · {Number(i.qty).toFixed(2)} {i.unit}
                              {i.serial ? ` · ${i.serial}` : ''}
                            </div>
                          ))}
                        </td></tr>
                      )}
                    </tbody></table>

                    <div className="eyebrow">Yield</div>
                    {y.outputs.length === 0 ? <div className="empty">Nothing printed into this batch yet.</div> : (
                      <table>
                        <thead><tr>
                          <th>Product</th><th className="num">Packs</th><th className="num">Lb</th>
                          <th className="num">Yield</th><th className="num">$/lb</th>
                          <th className="num">Value</th><th className="num">Share</th>
                          <th className="num">Cost</th>
                        </tr></thead>
                        <tbody>
                          {y.outputs.map((o) => (
                            <tr key={o.product_id}>
                              <td>{o.name}</td>
                              <td className="num">{o.packs}</td>
                              <td className="num">{lb(o.weight_lb)}</td>
                              <td className="num">{pct(o.yield_pct)}</td>
                              <td className="num">{o.market_value_per_lb === null ? '—' : money(o.market_value_per_lb)}</td>
                              <td className="num">{money(o.market_value)}</td>
                              <td className="num">{pct(o.value_share_pct)}</td>
                              <td className="num">{money(o.allocated_cost)}</td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700 }}>
                            <td>Total output</td>
                            <td className="num">{y.totals.output_packs}</td>
                            <td className="num">{lb(y.totals.output_lb)}</td>
                            <td className="num">{pct(y.totals.yield_pct)}</td>
                            <td colSpan={4}></td>
                          </tr>
                          {y.unaccounted && (
                            <tr style={{ color: 'var(--muted)' }}>
                              <td>Unaccounted <span className="custmeta">— {y.unaccounted.note}</span></td>
                              <td className="num"></td>
                              <td className="num">{lb(y.unaccounted.weight_lb)}</td>
                              <td className="num">{pct(y.unaccounted.pct)}</td>
                              <td colSpan={4}></td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}

                    <div className="custmeta" style={{ marginTop: 8 }}>
                      Cost allocated by <strong>relative market value</strong>, not by weight.
                      {!y.costing.allocatable && y.costing.blocked_by.length > 0 && (
                        <> Not allocated yet: {y.costing.blocked_by.join('; ')}.
                          {' '}Set market values on the Items screen.</>
                      )}
                      {y.costing.allocatable && !y.costing.input_cost_set &&
                        <> Shares shown; enter an input cost on the batch for dollars.</>}
                    </div>

                    <div className="row" style={{ marginTop: 12 }}>
                      {b.status === 'OPEN' ? <>
                        <button className="btn secondary mini" onClick={() => addInput(b)}>Add input case</button>
                        <button className="btn mini" onClick={() => close(b)}>Close batch</button>
                      </> : (
                        <button className="btn secondary mini" onClick={() => reopen(b)}>Reopen</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
