import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  splitChips, insertionIndex, moveWithin, insertAt, removeAt,
} from '../priorityOrder.js';

// Wall display (spec §7). Dark, large type, readable from 10 ft, refreshing
// itself every 60 s from our own database — never from CMS.
//
// Two columns: what has to happen now (Past Due, then Due Today) on the left,
// Upcoming on the right. New orders flash; `is_new` is computed server-side on
// a 5-minute window, so the flash stops by itself on a later poll and there is
// deliberately no client timer for it.
const REFRESH_MS = 60000;

const clock = (d) => (d ? new Date(d).toLocaleTimeString('en-US',
  { hour: 'numeric', minute: '2-digit' }) : '—');
const qty = (n) => (Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(2));

const SECTION_LABEL = { past_due: 'Past Due', due_today: 'Due Today', upcoming: 'Upcoming' };
const SECTION_EMPTY = {
  past_due: 'Nothing past due', due_today: 'Nothing due today', upcoming: 'Nothing upcoming',
};

function ProductRow({ p }) {
  const [open, setOpen] = useState(false);
  const orders = p.orders || [];
  return (
    <>
      <tr className={`floorrow${p.is_new ? ' isnew' : ''}`} onClick={() => setOpen(!open)}>
        <td className="fname">
          {p.product_name}
          {p.is_new && <span className="floorflag new">new</span>}
          {!p.mapped && <span className="floorflag">unmapped</span>}
          {p.needs_pack_size && <span className="floorflag">needs pack size</span>}
        </td>
        <td className="fqty">{qty(p.remaining)}<span className="fuom">{p.order_uom}</span></td>
        <td className="fsub">{p.pieces !== null && p.pieces !== undefined ? `${qty(p.pieces)} pcs` : ''}</td>
        <td className="fsub">{p.birds !== null && p.birds !== undefined ? `${qty(p.birds)} birds` : ''}</td>
        <td className="fsub">{orders.length} order{orders.length === 1 ? '' : 's'} ▾</td>
      </tr>
      {open && orders.map((o, i) => (
        <tr className={`floorsub${o.is_new ? ' isnew' : ''}`} key={`${o.order_no}-${i}`}>
          <td colSpan={5}>
            <span className="fo">#{o.order_no}</span> {o.customer}
            {o.is_new && <span className="floorflag new">new</span>}
            <span className="fo"> · {o.display}</span>
            {o.requested_text ? <span className="fo"> · {o.requested_text}</span> : null}
            {o.notes ? <span className="fnote"> — {o.notes}</span> : null}
          </td>
        </tr>
      ))}
    </>
  );
}

// Customer priority: a compact strip of numbered chips under the header.
// Reordering uses pointer events, not HTML5 drag-and-drop, because the wall
// tablet is a touchscreen and HTML5 dnd never fires there. Pointer moves are
// written straight to the dragged node inside a rAF; React only re-renders
// when the insertion slot actually changes.
function PriorityStrip({ priority, customers, onReorder, error }) {
  const { ranked, unranked } = splitChips(priority, customers);
  const els = useRef([]);
  const drag = useRef(null);
  const [slot, setSlot] = useState(null);   // { name, at } while dragging

  useEffect(() => () => {                   // never leave a rAF running
    if (drag.current?.raf) cancelAnimationFrame(drag.current.raf);
  }, []);

  const frame = () => {
    const d = drag.current;
    if (!d) return;
    d.raf = 0;
    d.el.style.transform = `translate(${d.x - d.x0}px, ${d.y - d.y0}px)`;
    const at = insertionIndex(d.rects, d.x, d.y);
    if (at !== d.at) { d.at = at; setSlot({ name: d.name, at }); }
  };

  const down = (e, name, from) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    drag.current = {
      name, from, el, id: e.pointerId, x0: e.clientX, y0: e.clientY,
      x: e.clientX, y: e.clientY, moved: false, rects: [], at: null, raf: 0,
    };
  };

  const move = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.moved) {
      if (Math.abs(d.x - d.x0) + Math.abs(d.y - d.y0) < 6) return;   // a tap, not a drag
      d.moved = true;
      d.rects = els.current.slice(0, ranked.length)
        .filter(Boolean).map((n) => n.getBoundingClientRect());
      d.el.classList.add('dragging');
    }
    if (!d.raf) d.raf = requestAnimationFrame(frame);
  };

  const end = (e, commit) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    try { d.el.releasePointerCapture(d.id); } catch { /* already gone */ }
    d.el.style.transform = '';
    d.el.classList.remove('dragging');
    setSlot(null);
    if (!commit || !d.moved || d.at === null) return;
    const next = d.from === null
      ? insertAt(ranked, d.name, d.at)
      : moveWithin(ranked, d.from, d.at);
    const same = next.length === ranked.length && next.every((n, i) => n === ranked[i]);
    if (!same) onReorder(next);
  };

  const chipClass = (i) => {
    if (!slot || slot.at === null) return '';
    if (slot.at === i) return ' dropbefore';
    if (slot.at === ranked.length && i === ranked.length - 1) return ' dropafter';
    return '';
  };

  if (!ranked.length && !unranked.length && !error) return null;

  return (
    <div className="floorpri">
      <span className="prilabel rank">priority</span>
      {ranked.length === 0 && <span className="prinone">drag a customer here</span>}
      {ranked.map((name, i) => (
        <div
          key={name}
          className={`prichip${slot?.name === name ? ' held' : ''}${chipClass(i)}`}
          title={name}
          ref={(n) => { els.current[i] = n; }}
          onPointerDown={(e) => down(e, name, i)}
          onPointerMove={move}
          onPointerUp={(e) => end(e, true)}
          onPointerCancel={(e) => end(e, false)}
        >
          <span className="prirank">{i + 1}</span>
          <span className="priname">{name}</span>
          <button
            type="button"
            className="prix"
            title={`Unrank ${name}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onReorder(removeAt(ranked, i))}
          >×</button>
        </div>
      ))}
      {unranked.length > 0 && <span className="prilabel">unranked</span>}
      {unranked.map((name) => (
        <div
          key={name}
          className={`prichip un${slot?.name === name ? ' held' : ''}`}
          title={name}
          onPointerDown={(e) => down(e, name, null)}
          onPointerMove={move}
          onPointerUp={(e) => end(e, true)}
          onPointerCancel={(e) => end(e, false)}
        >
          <span className="priname">{name}</span>
        </div>
      ))}
      {error && <span className="prierr">{error}</span>}
    </div>
  );
}

// Fallback for an API that predates `customers`: the names are all on the list
// already, so the strip still works rather than showing nothing to drag.
function customersFrom(data) {
  if (Array.isArray(data?.customers)) return data.customers;
  const seen = new Set();
  for (const s of data?.sections || [])
    for (const c of s.categories || [])
      for (const p of c.products || [])
        for (const o of p.orders || []) if (o.customer) seen.add(o.customer);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export default function Floor() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [priority, setPriority] = useState([]);
  const [priErr, setPriErr] = useState(null);
  const stamp = useRef(0);            // bumped on every local ranking change

  const load = async () => {
    const at = stamp.current;
    try {
      const d = await api.get('/api/cms/floor');
      setData(d); setErr(null);
      // A poll that was in flight while somebody dragged must not undo the drag.
      if (stamp.current === at) setPriority(Array.isArray(d?.priority) ? d.priority : []);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const reorder = async (next) => {
    const prev = priority;
    stamp.current += 1;
    setPriority(next);
    setPriErr(null);
    try {
      const res = await api.put('/api/cms/priority', { customers: next });
      stamp.current += 1;
      setPriority(Array.isArray(res?.customers) ? res.customers : next);
    } catch (e) {
      stamp.current += 1;
      setPriority(prev);                                  // the server is truth
      setPriErr(e.message || 'could not save priority');
    }
  };

  if (!data && !err) return <div className="floor"><div className="floorhead">Loading…</div></div>;

  const newOrders = Number(data?.totals?.new_orders) || 0;

  const section = (key) => {
    const s = (data?.sections || []).find((x) => x.key === key);
    const cats = (s?.categories || []).filter((c) => (c.products || []).length);
    return (
      <div className={`floorsection ${key}`}>
        <div className="floorsectionhead">{s?.label || SECTION_LABEL[key]}</div>
        {cats.length === 0
          ? <div className="floornothing">{SECTION_EMPTY[key]}</div>
          : cats.map((c) => (
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
    );
  };

  return (
    <div className="floor">
      <div className="floorhead">
        <div>
          <span className="floortitle">CUT LIST</span>
          {data?.totals?.bird_equivalent !== null && data?.totals?.bird_equivalent !== undefined && (
            <span className="floorbirds">{qty(data.totals.bird_equivalent)} birds</span>
          )}
          {newOrders > 0 && (
            <span className="floornewcount">{newOrders} new</span>
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

      <PriorityStrip
        priority={priority}
        customers={customersFrom(data)}
        onReorder={reorder}
        error={priErr}
      />

      <div className="floorcols">
        <div className="floorcol">
          {section('past_due')}
          {section('due_today')}
        </div>
        <div className="floorcol">
          {section('upcoming')}
        </div>
      </div>
    </div>
  );
}
