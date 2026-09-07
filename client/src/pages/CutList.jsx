import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// Admin side of the CMS feed: sync health and the product master (spec §5).
// The floor screen only counts pieces and birds for products mapped here.
const CATEGORIES = ['Chicken', 'Lamb', 'Beef', 'Sausage', 'Misc'];

export default function CutList() {
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState(null);
  const [editing, setEditing] = useState(null);
  const [edit, setEdit] = useState({});
  const [stamp, setStamp] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [p, s] = await Promise.all([api.get('/api/cms/products'), api.get('/api/cms/status')]);
      setProducts(p); setStatus(s);
    } catch (e) { setStamp({ kind: 'bad', title: 'COULD NOT LOAD', detail: e.message }); }
  };
  useEffect(() => { refresh(); }, []);

  const syncNow = async () => {
    setBusy(true); setStamp({ kind: 'warn', title: 'SYNCING…', detail: 'reading CMS' });
    try {
      const r = await api.post('/api/cms/sync', {});
      setStamp({ kind: 'ok', title: 'SYNCED',
        detail: `${r.orders_seen} active order(s), ${r.orders_read} detail page(s) read` });
      await refresh();
    } catch (e) { setStamp({ kind: 'bad', title: 'SYNC FAILED', detail: e.message }); }
    finally { setBusy(false); }
  };

  const save = async (name) => {
    try {
      await api.patch(`/api/cms/products/${encodeURIComponent(name)}`, edit);
      setEditing(null); await refresh();
      setStamp({ kind: 'ok', title: 'SAVED', detail: name });
    } catch (e) { setStamp({ kind: 'bad', title: 'NOT SAVED', detail: e.message }); }
  };

  const last = status?.runs?.[0];
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="eyebrow" style={{ margin: 0 }}>CMS cut list</div>
        <button className="btn" onClick={syncNow} disabled={busy || !status?.syncs_here}
          title={status?.syncs_here ? '' : 'This server cannot reach CMS; the farm PC syncs on a timer'}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {/* What matters is whether the data is fresh, not which machine fetched
          it: CMS blocks the cloud server, so the farm PC does the syncing. */}
      {status && status.minutes_since_ok === null && (
        <div className="stamp warn">NO SYNC HAS SUCCEEDED YET
          <small>{status.syncs_here
            ? 'This server has CMS credentials but has not completed a sync — check the runs below.'
            : 'This server does not sync. The farm PC does, on a 5 minute task — check that it is on and that farm-sync\\sync.log looks healthy.'}</small>
        </div>
      )}
      {status && status.minutes_since_ok !== null && status.minutes_since_ok > 30 && (
        <div className="stamp warn">SYNC IS STALE
          <small>Last good sync {status.minutes_since_ok} minutes ago.
            {status.syncs_here ? '' : ' The farm PC does the syncing — check it is on and online.'}</small>
        </div>
      )}
      {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

      <div className="panel">
        <table><tbody>
          <tr><td className="lbl">Open orders</td><td>{status?.open_orders ?? '—'}</td></tr>
          <tr><td className="lbl">Last sync</td><td>
            {!last ? 'never' : `${last.ok ? 'ok' : 'FAILED'} · ${new Date(last.started_at).toLocaleString()}`}
            {last && !last.ok && last.error && <div style={{ color: 'var(--bad)' }}>{last.error}</div>}
          </td></tr>
          <tr><td className="lbl">Last good</td><td>
            {status?.minutes_since_ok === null || status?.minutes_since_ok === undefined
              ? 'never'
              : `${status.minutes_since_ok} min ago`}
          </td></tr>
          <tr><td className="lbl">Synced by</td><td>
            {status?.syncs_here ? 'this server' : 'the farm PC (CMS blocks the cloud server)'}
          </td></tr>
        </tbody></table>
      </div>

      <div className="eyebrow">Product master ({products.length})</div>
      <div className="eyebrow" style={{ marginTop: 0, letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
        "Each" on a CMS order means a retail pack, not a piece — so pieces and birds
        only appear on the floor once pack contents are filled in here. Products with
        no pack size still show on the floor, flagged.
      </div>
      <div className="panel">
        {products.length === 0 ? (
          <div className="empty">Nothing yet. Products appear here as soon as a sync sees them.</div>
        ) : (
          <table>
            <thead><tr>
              <th>CMS product</th><th>Category</th>
              <th className="num">Pieces/pack</th><th className="num">Birds/pack</th>
              <th className="num">Lines</th><th></th>
            </tr></thead>
            <tbody>
              {products.map((p) => editing === p.product_name ? (
                <tr key={p.product_name}>
                  <td>{p.product_name}</td>
                  <td><select value={edit.category}
                    onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                  <td><input style={{ width: 70 }} inputMode="decimal" value={edit.pieces_per_pack}
                    onChange={(e) => setEdit({ ...edit, pieces_per_pack: e.target.value })} /></td>
                  <td><input style={{ width: 70 }} inputMode="decimal" value={edit.birds_per_pack}
                    onChange={(e) => setEdit({ ...edit, birds_per_pack: e.target.value })} /></td>
                  <td className="num">{p.line_count}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn mini" onClick={() => save(p.product_name)}>Save</button>{' '}
                    <button className="btn secondary mini" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={p.product_name}>
                  <td>{p.product_name}</td>
                  <td>{p.category}</td>
                  <td className="num">{p.pieces_per_pack ?? <span style={{ color: 'var(--bad)' }}>—</span>}</td>
                  <td className="num">{p.birds_per_pack ?? '—'}</td>
                  <td className="num">{p.line_count}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn secondary mini" onClick={() => {
                      setEdit({
                        category: p.category || 'Misc',
                        pieces_per_pack: p.pieces_per_pack ?? '',
                        birds_per_pack: p.birds_per_pack ?? '',
                      });
                      setEditing(p.product_name); setStamp(null);
                    }}>Edit</button>
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
