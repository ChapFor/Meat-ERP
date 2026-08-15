import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Inventory() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/api/reports/inventory').then(setRows); }, []);
  const totLb = rows.reduce((s, r) => s + Number(r.lb_in_stock), 0);
  return (
    <>
      <div className="eyebrow">
        Sellable inventory · {totLb.toFixed(1)} lb total
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          {' '}— packs count every sellable unit; cases counts boxes still intact
        </span>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Product</th><th className="num">Packs</th><th className="num">Cases</th>
            <th className="num">Lb</th>
            <th className="num">Allocated</th><th className="num">Pending</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num">{r.packs_in_stock}</td>
                <td className="num">{Number(r.cases_in_stock) || ''}</td>
                <td className="num">{Number(r.lb_in_stock).toFixed(1)}</td>
                <td className="num">{r.packs_allocated}</td>
                <td className="num">{r.packs_pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
