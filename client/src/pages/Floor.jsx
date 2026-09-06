import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// Wall display (spec §7). Dark, large type, readable from 10 ft, refreshing
// itself every 60 s from our own database — never from CMS.
const REFRESH_MS = 60000;

const clock = (d) => (d ? new Date(d).toLocaleTimeString('en-US',
  { hour: 'numeric', minute: '2-digit' }) : '—');
const qty = (n) => (Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(2));

function ProductRow({ p }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="floorrow" onClick={() => setOpen(!open)}>
        <td className="fname">
          {p.product_name}
          {!p.mapped && <span className="floorflag">unmapped</span>}
          {p.needs_pack_size && <span className="floorflag">needs pack size</span>}
        </td>
        <td className="fqty">{qty(p.remaining)}<span className="fuom">{p.order_uom}</span></td>
        <td className="fsub">{p.pieces !== null ? `${qty(p.pieces)} pcs` : ''}</td>
        <td className="fsub">{p.birds !== null ? `${qty(p.birds)} birds` : ''}</td>
        <td className="fsub">{p.orders.length} order{p.orders.length === 1 ? '' : 's'} ▾</td>
      </tr>
      {open && p.orders.map((o, i) => (
        <tr className="floorsub" key={`${o.order_no}-${i}`}>
          <td colSpan={5}>
            <span className="fo">#{o.order_no}</span> {o.customer}
            <span className="fo"> · {o.display}</span>
            {o.requested_text ? <span className="fo"> · {o.requested_text}</span> : null}
            {o.notes ? <span className="fnote"> — {o.notes}</span> : null}
          </td>
        </tr>
      ))}
    </>
  );
}

export default function Floor() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = async () => {
    try { setData(await api.get('/api/cms/floor')); setErr(null); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (!data && !err) return <div className="floor"><div className="floorhead">Loading…</div></div>;

  const sections = (data?.sections || []).filter((s) =>
    s.categories.some((c) => c.products.length));

  return (
    <div className="floor">
      <div className="floorhead">
        <div>
          <span className="floortitle">CUT LIST</span>
          {data?.totals?.bird_equivalent !== null && data?.totals?.bird_equivalent !== undefined && (
            <span className="floorbirds">{qty(data.totals.bird_equivalent)} birds</span>
          )}
        </div>
        <div className="floorsync">Last synced {clock(data?.synced_at)}</div>
      </div>

      {!data?.configured && (
        <div className="floorbanner">
          CMS SYNC NOT CONFIGURED — set CMS_USERNAME and CMS_PASSWORD on the server
        </div>
      )}
      {err && <div className="floorbanner">CANNOT REACH THE ERP — {err}</div>}
      {data?.configured && data?.stale && (
        <div className="floorbanner">
          SYNC STALE — last good sync {data.age_min === null ? 'never' : `${data.age_min} min ago`}
        </div>
      )}
      {data?.unmapped?.length > 0 && (
        <div className="floornotice">
          Unmapped products on this list: {data.unmapped.join(', ')}
        </div>
      )}

      {sections.length === 0 && !err && (
        <div className="floorempty">Nothing to cut.</div>
      )}

      {sections.map((s) => (
        <div className={`floorsection ${s.key}`} key={s.key}>
          <div className="floorsectionhead">{s.label}</div>
          {s.categories.map((c) => (
            <div key={c.category}>
              <div className="floorcat">{c.category}</div>
              <table className="floortable"><tbody>
                {c.products.map((p) => (
                  <ProductRow key={`${p.product_name}-${p.order_uom}`} p={p} />
                ))}
              </tbody></table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
