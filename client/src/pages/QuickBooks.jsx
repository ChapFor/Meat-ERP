import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { dateTime } from '../format.js';

export default function QuickBooks() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => api.get('/api/qbo/status').then(setS);
  useEffect(() => {
    load();
    const p = new URLSearchParams(location.search);
    if (p.get('qbo') === 'connected') setMsg({ kind: 'ok', text: 'QuickBooks connected. Pulling open estimates now.' });
    if (p.get('qbo_error')) setMsg({ kind: 'bad', text: p.get('qbo_error') });
    if (p.has('qbo') || p.has('qbo_error')) history.replaceState(null, '', '/');
  }, []);

  const connect = async () => { try { location.href = (await api.get('/api/qbo/connect-url')).url; } catch (e) { setMsg({ kind: 'bad', text: e.message }); } };
  const sync = async (full) => {
    setMsg({ kind: 'warn', text: 'Syncing…' });
    try { const r = await api.post('/api/qbo/sync', { full }); setMsg({ kind: 'ok', text: `Done: ${JSON.stringify(r)}` }); }
    catch (e) { setMsg({ kind: 'bad', text: e.message }); }
    load();
  };
  const disconnect = async () => { if (confirm('Disconnect QuickBooks?')) { await api.post('/api/qbo/disconnect'); load(); } };
  if (!s) return null;

  return (
    <div className="panel">
      <h2>QuickBooks Online</h2>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
      {!s.configured && (
        <div className="notice warn">
          The server has no QuickBooks app keys yet. Create an app at developer.intuit.com, then set
          <span className="mono"> QBO_CLIENT_ID</span>, <span className="mono">QBO_CLIENT_SECRET</span>, <span className="mono">QBO_ENVIRONMENT</span> and
          <span className="mono"> PUBLIC_URL</span> in Railway. Add this redirect URI to the app: <span className="mono">{s.redirect_uri}</span>
        </div>
      )}
      <table className="t" style={{ maxWidth: 700 }}><tbody>
        <tr><th>Status</th><td>{s.connected ? <span className="chip ok">connected</span> : <span className="chip bad">not connected</span>} <span className="muted">{s.environment}</span></td></tr>
        {s.connected && <tr><th>Company ID</th><td className="mono">{s.realm_id}</td></tr>}
        <tr><th>Last sync</th><td>{dateTime(s.last_sync_at)}{s.last_sync_error && <div className="notice bad">{s.last_sync_error}</div>}</td></tr>
        <tr><th>After manifest</th><td>Estimate lines are updated to shipped pounds{s.create_invoice ? ', and an invoice is created' : ' (set QBO_CREATE_INVOICE=true to also create the invoice)'}</td></tr>
        {s.refresh_expires && <tr><th>Sign-in valid until</th><td>{dateTime(s.refresh_expires)}</td></tr>}
      </tbody></table>
      <div className="row" style={{ marginTop: 12 }}>
        {!s.connected && <button className="btn primary" disabled={!s.configured} onClick={connect}>Connect to QuickBooks</button>}
        {s.connected && <button className="btn primary" onClick={() => sync(false)}>Sync now</button>}
        {s.connected && <button className="btn" onClick={() => sync(true)}>Full re-sync (60 days)</button>}
        {s.connected && <button className="btn danger" onClick={disconnect}>Disconnect</button>}
      </div>
      <h3>How orders flow</h3>
      <ol>
        <li>Enter the order in QuickBooks as an <b>Estimate</b>: quantity in <b>cases</b>, rate in <b>$ per lb</b>.</li>
        <li>It appears here within a minute (Orders, Ship, and Pack to order on the station).</li>
        <li>Cases are packed to the order at the scale, or scanned onto it at the dock.</li>
        <li>On <b>Finish &amp; manifest</b>, each line's quantity in QuickBooks becomes the shipped pounds, and the description gets "Ordered 10 cs, shipped 10 cs, 412.60 lb".</li>
      </ol>
      <p className="muted">Each QuickBooks item must be linked to a PLU under Items (automatic when the item's SKU equals the PLU).</p>
    </div>
  );
}
