import React, { useState } from 'react';
import Station from './pages/Station.jsx';
import ScanIn from './pages/ScanIn.jsx';
import Inventory from './pages/Inventory.jsx';
import Orders from './pages/Orders.jsx';
import Packing from './pages/Packing.jsx';

const PAGES = { Station, 'Scan in': ScanIn, Inventory, Orders, Packing };

export default function App() {
  // remember the last tab so the station PC reopens on Station after a reload
  const [page, setPage] = useState(() => {
    const saved = localStorage.getItem('cf_page');
    return PAGES[saved] ? saved : 'Scan in';
  });
  const Page = PAGES[page];
  return (
    <>
      <header className="topbar">
        <div className="brand"><h1>Chapel Ford</h1><span>Meat ERP</span></div>
        <nav className="tabs">
          {Object.keys(PAGES).map((p) => (
            <button key={p} className={p === page ? 'on' : ''}
              onClick={() => { setPage(p); localStorage.setItem('cf_page', p); }}>{p}</button>
          ))}
        </nav>
      </header>
      <main><Page /></main>
    </>
  );
}
