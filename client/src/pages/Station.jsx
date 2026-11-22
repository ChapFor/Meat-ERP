import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { agent, agentUrl } from '../agentClient.js';
import { beepBad } from '../beep.js';

// The weigh-label station. Printing itself happens in the station agent on this
// PC; this screen chooses what to print and shows the scale and results.
export default function Station() {
  const [cfg, setCfg] = useState(null);
  const [st, setSt] = useState(null);
  const [agentErr, setAgentErr] = useState(null);
  const [mode, setMode] = useState('inventory');
  const [productId, setProductId] = useState(null);
  const [lot, setLot] = useState('');
  const [orderId, setOrderId] = useState('');
  const [lineId, setLineId] = useState('');
  const [auto, setAuto] = useState(true);
  const [err, setErr] = useState(null);
  const lastStampAt = useRef(0);

  const loadCfg = async () => {
    const c = await api.get('/api/station/config');
    setCfg(c);
    setLot((l) => l || c.lots[0]?.code || '');
  };
  useEffect(() => { loadCfg().catch((e) => setErr(e.message)); }, []);

  // fast status poll so the weight display keeps up with the scale
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await agent.status();
        if (!alive) return;
        setSt(s); setAgentErr(null);
        if (s.stamp && s.stamp.at !== lastStampAt.current) {
          if (lastStampAt.current && s.stamp.kind === 'bad') beepBad();
          lastStampAt.current = s.stamp.at;
        }
      } catch (e) { if (alive) setAgentErr(e.message); }
      if (alive) setTimeout(tick, 200);
    };
    tick();
    return () => { alive = false; };
  }, []);

  // adopt whatever job the agent is already running (page reload)
  useEffect(() => {
    if (st?.job && productId === null) {
      setProductId(st.job.product_id); setLot(st.job.lot); setAuto(st.job.auto);
      if (st.job.order_line_id) {
        setMode('order'); setLineId(String(st.job.order_line_id));
        const o = cfg?.orders.find((o) => o.lines.some((l) => l.id === st.job.order_line_id));
        if (o) setOrderId(String(o.id));
      }
    }
  }, [st, cfg]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async (patch = {}) => {
    const next = { productId, lot, lineId: mode === 'order' ? lineId : '', auto, ...patch };
    setErr(null);
    if (!next.productId || !next.lot) return;
    try {
      await agent.setJob({ product_id: next.productId, lot_code: next.lot, order_line_id: next.lineId || null, auto: next.auto, refresh: patch.refresh });
    } catch (e) { setErr(e.message); }
  };

  const newLot = async () => {
    try {
      const l = await api.post('/api/lots', {});
      await loadCfg(); await agent.refresh().catch(() => {});
      setLot(l.code); apply({ lot: l.code, refresh: true });
    } catch (e) { setErr(e.message); }
  };

  const order = cfg?.orders.find((o) => String(o.id) === String(orderId));
  const products = cfg?.products || [];
  const productName = (id) => products.find((p) => p.id === id)?.name || 'Unmapped item';
  const w = st?.weight;
  const health = [
    ['Agent', !agentErr, agentErr && `not running at ${agentUrl()} — start the station agent on this PC`],
    ['Scale', st?.scale?.ok, st?.scale?.error], ['Printer', st?.printer?.ok, st?.printer?.error], ['Server', st?.server?.ok, st?.server?.error],
  ];

  return (
    <div className="grid2">
      <div>
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">{health.map(([n, ok, e]) => <span key={n} className={`chip ${ok ? 'ok' : 'bad'}`} title={e || ''}>{n}</span>)}</div>
            {st?.timing && <span className="muted mono" title="stable weight → label sent to printer">print {st.timing.last} ms · median {st.timing.median} ms</span>}
          </div>
          {health.filter(([, ok, e]) => !ok && e).map(([n, , e]) => <div key={n} className="notice bad" style={{ marginTop: 8 }}>{n}: {e}</div>)}
          <div className={`weight ${w?.stable ? '' : 'unstable'}`}>
            {w?.net != null ? w.net.toFixed(2) : '—.——'} <small>lb {w?.stable ? 'STABLE' : 'settling'}</small>
          </div>
          {st?.job && <div className="muted" style={{ textAlign: 'center' }}>gross {w?.gross?.toFixed(2) ?? '—'} − tare {Number(st.job.tare_lb).toFixed(2)}</div>}
          {st?.stamp && Date.now() - st.stamp.at < 20000 && (
            <div className={`stamp ${st.stamp.kind}`}><div className="title">{st.stamp.title}</div><div className="detail">{st.stamp.detail}</div></div>
          )}
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary big" disabled={!st?.job || !w?.stable} onClick={() => agent.print().catch((e) => setErr(e.message))}>Print now</button>
            <label className="row"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); apply({ auto: e.target.checked }); }} /> Auto-print when stable</label>
          </div>
          {st?.job?.line && (
            <div className="notice ok" style={{ marginTop: 10, textAlign: 'center', fontSize: 20 }}>
              {st.job.order.customer_name} · {st.job.line.packed} of {st.job.line.ordered} cases · <b>{st.job.line.remaining} to go</b>
            </div>
          )}
          {err && <div className="notice bad" style={{ marginTop: 10 }}>{err}</div>}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Last labels</h3>
          <table className="t">
            <thead><tr><th>Serial</th><th>Product</th><th className="num">Net</th><th className="num">ms</th><th></th><th></th></tr></thead>
            <tbody>
              {(st?.recent || []).map((r) => (
                <tr key={r.serial}>
                  <td className="mono">{r.serial}</td>
                  <td>{r.product}{r.customer && <div className="muted">{r.customer}</div>}</td>
                  <td className="num">{r.lb.toFixed(2)}</td>
                  <td className="num">{r.ms ?? '—'}</td>
                  <td>{r.failed ? <span className="chip bad">not printed</span>
                    : r.uploaded === false ? <span className="chip bad" title={r.uploadError}>upload error</span>
                    : r.uploaded ? <span className="chip ok">saved</span> : <span className="chip warn">uploading</span>}</td>
                  <td>{!r.failed && <button className="btn small" onClick={() => agent.reprint(r.serial)}>Reprint</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {st?.upload_queue > 0 && <div className="muted">{st.upload_queue} label(s) waiting to upload</div>}
        </div>
      </div>

      <div>
        <div className="panel">
          <div className="row">
            <button className={`btn ${mode === 'inventory' ? 'primary' : ''}`} onClick={() => { setMode('inventory'); setLineId(''); apply({ lineId: '' }); }}>Pack to inventory</button>
            <button className={`btn ${mode === 'order' ? 'primary' : ''}`} onClick={() => setMode('order')}>Pack to order</button>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label>Lot&nbsp;
              <select className="txt" value={lot} onChange={(e) => { setLot(e.target.value); apply({ lot: e.target.value }); }}>
                {!cfg?.lots.length && <option value="">no open lot</option>}
                {cfg?.lots.map((l) => <option key={l.id} value={l.code}>{l.code}{l.note ? ` — ${l.note}` : ''}</option>)}
              </select>
            </label>
            <button className="btn" onClick={newLot}>Start new lot</button>
            {st?.serials_left != null && <span className="muted">{st.serials_left} serials reserved</span>}
          </div>
          {mode === 'order' && (
            <div style={{ marginTop: 10 }}>
              <select className="txt" style={{ width: '100%' }} value={orderId} onChange={(e) => { setOrderId(e.target.value); setLineId(''); }}>
                <option value="">Choose an order…</option>
                {cfg?.orders.map((o) => <option key={o.id} value={o.id}>{o.doc_number} · {o.customer_name}{o.ship_date ? ` · ships ${o.ship_date}` : ''}</option>)}
              </select>
              {order && (
                <div className="tiles" style={{ marginTop: 10 }}>
                  {order.lines.map((l) => (
                    <button key={l.id} className={`tile ${String(l.id) === lineId ? 'on' : ''}`}
                      onClick={() => { setLineId(String(l.id)); setProductId(l.product_id); apply({ lineId: String(l.id), productId: l.product_id }); }}>
                      <div className="name">{productName(l.product_id)}</div>
                      <div className="code">{l.cases_packed} of {Number(l.qty_ordered)} cs</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {mode === 'inventory' && (
          <div className="panel">
            <div className="tiles">
              {products.map((p) => (
                <button key={p.id} className={`tile ${p.id === productId ? 'on' : ''}`} onClick={() => { setProductId(p.id); apply({ productId: p.id }); }}>
                  <div className="name">{p.label_name || p.name}</div>
                  <div className="code">PLU {p.code}{Number(p.tare_lb) ? ` · tare ${Number(p.tare_lb).toFixed(2)}` : ''}</div>
                </button>
              ))}
            </div>
            {!products.length && <div className="muted">No items yet — add them under Office → Items.</div>}
          </div>
        )}
        {st?.sim && <SimScale />}
      </div>
    </div>
  );
}

// Only shown when the agent runs with --sim: put a "case" on the fake scale.
function SimScale() {
  const [v, setV] = useState('12.40');
  const set = (lb) => fetch(agentUrl() + '/sim/weight', { method: 'POST', body: JSON.stringify({ lb }) });
  return (
    <div className="panel">
      <b>Simulated scale</b>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="txt mono" value={v} onChange={(e) => setV(e.target.value)} style={{ width: 100 }} />
        <button className="btn" onClick={() => set(Number(v))}>Place case</button>
        <button className="btn" onClick={() => set(0)}>Lift off</button>
      </div>
    </div>
  );
}
