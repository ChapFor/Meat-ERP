import React, { useState } from 'react';
import Station from './pages/Station.jsx';
import ScanIn from './pages/ScanIn.jsx';
import Inventory from './pages/Inventory.jsx';
import Orders from './pages/Orders.jsx';
import Packing from './pages/Packing.jsx';
import Customers from './pages/Customers.jsx';
import Items from './pages/Items.jsx';
import Batches from './pages/Batches.jsx';

const ALL = { Station, 'Scan in': ScanIn, Inventory, Batches, Orders, Packing, Customers, Items };

// Two shells for two jobs. Plant is the floor terminal: produce, scan, pack —
// no costing and no master data. Admin is the office and sees everything.
// This is a display split, NOT a security boundary — there is no auth yet, so
// the API still serves costs to anyone who asks. Revisit when the shared
// passcode lands.
const SHELLS = {
  plant: ['Station', 'Scan in', 'Inventory', 'Packing'],
  admin: Object.keys(ALL),
};

export default function App() {
  const [shell, setShell] = useState(() =>
    SHELLS[localStorage.getItem('cf_shell')] ? localStorage.getItem('cf_shell') : 'admin');
  const tabs = SHELLS[shell];

  const [page, setPage] = useState(() => {
    const saved = localStorage.getItem('cf_page');
    return saved && SHELLS[localStorage.getItem('cf_shell') || 'admin']?.includes(saved)
      ? saved : 'Station';
  });

  const go = (p) => { if (tabs.includes(p)) { setPage(p); localStorage.setItem('cf_page', p); } };
  const switchShell = (s) => {
    setShell(s); localStorage.setItem('cf_shell', s);
    if (!SHELLS[s].includes(page)) go2(SHELLS[s][0], s);
  };
  const go2 = (p, s) => { setPage(p); localStorage.setItem('cf_page', p); };

  const Page = ALL[tabs.includes(page) ? page : tabs[0]];
  return (
    <>
      <header className="topbar">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="brand"><h1>Chapel Ford</h1><span>Meat ERP</span></div>
          <div className="shellswitch">
            {['plant', 'admin'].map((s) => (
              <button key={s} className={s === shell ? 'on' : ''}
                onClick={() => switchShell(s)}>{s}</button>
            ))}
          </div>
        </div>
        <nav className="tabs">
          {tabs.map((p) => (
            <button key={p} className={p === page ? 'on' : ''} onClick={() => go(p)}>{p}</button>
          ))}
        </nav>
      </header>
      <main><Page go={go} shell={shell} /></main>
    </>
  );
}
