import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { date, lb } from '../format.js';

export default function Lots() {
  const [lots, setLots] = useState([]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const load = () => api.get('/api/lots').then(setLots);
  useEffect(() => { load(); }, []);
  const add = async () => { try { await api.post('/api/lots', { note }); setNote(''); load(); } catch (e) { setErr(e.message); } };
  const setStatus = async (l, status) => { await api.put(`/api/lots/${l.id}`, { status }); load(); };
  return (
    <div className="panel">
      <h2>Lots</h2>
      <p className="muted">A lot is one production run within a day (YYMMDD-B1, -B2 …). Every label prints into an open lot.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="txt" placeholder="Note (e.g. 400 birds, flock 12)" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 280 }} />
        <button className="btn primary" onClick={add}>Start today's next lot</button>
      </div>
      {err && <div className="notice bad">{err}</div>}
      <table className="t">
        <thead><tr><th>Lot</th><th>Pack date</th><th>Note</th><th className="num">Cases</th><th className="num">lb</th><th>Status</th><th></th></tr></thead>
        <tbody>{lots.map((l) => (
          <tr key={l.id}>
            <td className="mono">{l.code}</td><td>{date(l.pack_date)}</td><td>{l.note}</td>
            <td className="num">{l.cases}</td><td className="num">{Number(l.lb).toFixed(2)}</td>
            <td><span className={`chip ${l.status === 'OPEN' ? 'ok' : ''}`}>{l.status}</span></td>
            <td>{l.status === 'OPEN' ? <button className="btn small" onClick={() => setStatus(l, 'CLOSED')}>Close</button>
              : <button className="btn small" onClick={() => setStatus(l, 'OPEN')}>Reopen</button>}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
