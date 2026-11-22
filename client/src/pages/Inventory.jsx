import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { lb, date, dateTime } from '../format.js';

export default function Inventory() {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [cases, setCases] = useState([]);
  useEffect(() => { api.get('/api/cases/summary').then(setRows); }, []);
  const open = async (p) => { setSel(p); setCases(await api.get(`/api/cases?status=IN_STOCK&product_id=${p.id}`)); };
  const tot = rows.reduce((a, r) => ({ cs: a.cs + r.in_stock, lb: a.lb + Number(r.in_stock_lb) }), { cs: 0, lb: 0 });

  if (sel) {
    // oldest first: that is the order to ship in
    const list = [...cases].sort((a, b) => String(a.lot_code).localeCompare(String(b.lot_code)) || String(a.serial).localeCompare(String(b.serial)));
    return (
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{sel.name} — {list.length} cases in stock</h2>
          <button className="btn" onClick={() => setSel(null)}>Back</button>
        </div>
        <table className="t">
          <thead><tr><th>Serial</th><th>Lot</th><th className="num">Net lb</th><th>Printed</th><th>Station</th></tr></thead>
          <tbody>{list.map((c) => <tr key={c.id}><td className="mono">{c.serial}</td><td className="mono">{c.lot_code}</td><td className="num">{Number(c.weight_lb).toFixed(2)}</td><td>{dateTime(c.printed_at)}</td><td>{c.station}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="panel">
      <h2>Inventory on hand</h2>
      <table className="t">
        <thead><tr><th>Item</th><th>PLU</th><th className="num">In stock</th><th className="num">lb</th><th className="num">On orders</th><th className="num">lb</th><th>Oldest pack</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="click" onClick={() => open(r)}>
            <td>{r.name}</td><td className="mono">{r.code}</td>
            <td className="num">{r.in_stock}</td><td className="num">{Number(r.in_stock_lb).toFixed(2)}</td>
            <td className="num">{r.allocated}</td><td className="num">{Number(r.allocated_lb).toFixed(2)}</td>
            <td>{date(r.oldest_pack_date)}</td>
          </tr>))}</tbody>
        <tfoot><tr><th>Total</th><th></th><th className="num">{tot.cs}</th><th className="num">{lb(tot.lb)}</th><th colSpan={3}></th></tr></tfoot>
      </table>
    </div>
  );
}
