import React, { useEffect, useState } from 'react';
import { api, passcode } from './api.js';
import Station from './pages/Station.jsx';
import Ship from './pages/Ship.jsx';
import Lookup from './pages/Lookup.jsx';
import Orders from './pages/Orders.jsx';
import Inventory from './pages/Inventory.jsx';
import Items from './pages/Items.jsx';
import Lots from './pages/Lots.jsx';
import QuickBooks from './pages/QuickBooks.jsx';

// Plant = floor terminals; Admin = office. A display split for convenience —
// both use the same passcode.
const SHELLS = {
  plant: [['station', 'Label'], ['ship', 'Ship / Pack to order'], ['lookup', 'Lookup / Void']],
  admin: [['orders', 'Orders'], ['inventory', 'Inventory'], ['items', 'Items'], ['lots', 'Lots'], ['qbo', 'QuickBooks'],
    ['station', 'Label'], ['ship', 'Ship'], ['lookup', 'Lookup']],
};
const PAGES = { station: Station, ship: Ship, lookup: Lookup, orders: Orders, inventory: Inventory, items: Items, lots: Lots, qbo: QuickBooks };

function Login({ onOk }) {
  const [p, setP] = useState('');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/api/login', { passcode: p }); passcode.set(p); onOk(); }
    catch { setErr('Wrong passcode'); }
  };
  return (
    <form className="panel login" onSubmit={submit}>
      <h2>Chapel Ford ERP</h2>
      <input className="txt" type="password" autoFocus placeholder="Passcode" value={p} onChange={(e) => setP(e.target.value)} style={{ width: '100%' }} />
      {err && <div className="notice bad" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn primary" style={{ width: '100%', marginTop: 10 }}>Sign in</button>
    </form>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [shell, setShell] = useState(localStorage.getItem('cf_shell') || 'plant');
  const [tab, setTab] = useState(localStorage.getItem('cf_tab') || 'station');

  useEffect(() => {
    api.get('/api/products').then(() => setAuthed(true)).catch((e) => setAuthed(e.status === 401 ? false : true));
    const out = () => setAuthed(false);
    window.addEventListener('cf-logout', out);
    return () => window.removeEventListener('cf-logout', out);
  }, []);
  useEffect(() => { localStorage.setItem('cf_shell', shell); localStorage.setItem('cf_tab', tab); }, [shell, tab]);
  useEffect(() => {
    // returning from QuickBooks sign-in
    const p = new URLSearchParams(location.search);
    if (p.has('qbo') || p.has('qbo_error')) { setShell('admin'); setTab('qbo'); }
  }, []);

  if (authed === null) return null;
  if (!authed) return <Login onOk={() => setAuthed(true)} />;

  const tabs = SHELLS[shell];
  const current = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  const Page = PAGES[current];
  return (
    <>
      <header className="top">
        <span className="brand">Chapel Ford ERP</span>
        <nav>{tabs.map(([k, label]) => <button key={k} className={k === current ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</nav>
        <span className="spacer" />
        <div className="shell">
          {['plant', 'admin'].map((s) => <button key={s} className={s === shell ? 'on' : ''} onClick={() => setShell(s)}>{s === 'plant' ? 'Plant' : 'Office'}</button>)}
        </div>
      </header>
      <main><Page go={setTab} /></main>
    </>
  );
}
