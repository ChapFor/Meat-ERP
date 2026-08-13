import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { bridge, bridgeUrl } from '../station/bridge.js';
import { humanReadable, zplFieldData, offlineSerial } from '../station/gs1.js';
import { fillLabel } from '../station/label.js';
import { cloudDown, enqueue, flushQueue, loadQueue } from '../station/queue.js';

const AUTO_MIN_LB = 1;    // auto-print ignores anything lighter
const REARM_LB = 0.5;     // weight must drop below this before the next auto-print

// local date, not toISOString() — UTC would roll to tomorrow mid-evening
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const printsKey = () => 'cf_station_prints_' + todayISO();
const loadPrints = () => JSON.parse(localStorage.getItem(printsKey()) || '[]');

export default function Station() {
  const [products, setProducts] = useState(() => JSON.parse(localStorage.getItem('cf_products_cache') || '[]'));
  const [itemCode, setItemCode] = useState(localStorage.getItem('cf_station_item') || '');
  const [lot, setLot] = useState(() => JSON.parse(localStorage.getItem('cf_station_lot') || 'null'));
  const [packDate, setPackDate] = useState(todayISO());
  const [batchNo, setBatchNo] = useState('1');
  const [stationId] = useState(() => localStorage.getItem('cf_station_id') || 'S1');

  const [wt, setWt] = useState({ lb: null, stable: false, scaleConnected: false });
  const [bridgeOk, setBridgeOk] = useState(null);   // null = unknown yet
  const [health, setHealth] = useState(null);
  const [cloudOk, setCloudOk] = useState(true);
  const [queued, setQueued] = useState(loadQueue().length);
  const [manualLb, setManualLb] = useState('');
  const [auto, setAuto] = useState(false);
  const [stamp, setStamp] = useState(null);
  const [prints, setPrints] = useState(loadPrints());

  const armedRef = useRef(true);
  const printingRef = useRef(false);
  const product = products.find((p) => p.code === itemCode);

  // stale-lot guard: a lot from a previous day never carries over
  useEffect(() => {
    if (lot && lot.pack_date !== todayISO()) { setLot(null); localStorage.removeItem('cf_station_lot'); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const ps = await api.get('/api/products');
        setProducts(ps.filter((p) => p.active !== false));
        localStorage.setItem('cf_products_cache', JSON.stringify(ps));
        setCloudOk(true);
      } catch { setCloudOk(false); }
    })();
  }, []);

  // live weight @ 400ms; bridge health @ 5s; queue flush @ 30s
  useEffect(() => {
    let alive = true;
    const wtTimer = setInterval(async () => {
      try {
        const w = await bridge.weight();
        if (alive) { setWt(w); setBridgeOk(true); }
      } catch { if (alive) { setBridgeOk(false); setWt({ lb: null, stable: false }); } }
    }, 400);
    const healthTimer = setInterval(async () => {
      try { const h = await bridge.health(); if (alive) setHealth(h); } catch { if (alive) setHealth(null); }
    }, 5000);
    const flushTimer = setInterval(async () => {
      const n = await flushQueue(api);
      if (alive) setQueued(n);
    }, 30000);
    return () => { alive = false; clearInterval(wtTimer); clearInterval(healthTimer); clearInterval(flushTimer); };
  }, []);

  const setLotFromForm = async () => {
    const code = packDate.slice(2).replaceAll('-', '') + '-B' + batchNo;
    try {
      const l = await api.post('/api/lots', { pack_date: packDate, batch_no: Number(batchNo) });
      setLot(l); localStorage.setItem('cf_station_lot', JSON.stringify(l));
      setCloudOk(true);
    } catch (err) {
      if (!cloudDown(err)) return setStamp({ kind: 'bad', title: 'LOT REJECTED', detail: err.message });
      // offline: build the lot locally; the server self-heals it on first upload/scan
      const l = { lot_code: code, pack_date: packDate, batch_no: Number(batchNo), local: true };
      setLot(l); localStorage.setItem('cf_station_lot', JSON.stringify(l));
      setCloudOk(false);
    }
  };

  const doPrint = async (weightLb) => {
    if (printingRef.current) return;
    if (!product || !lot) return setStamp({ kind: 'bad', title: 'NOT READY', detail: 'Pick a product and set the lot first.' });
    if (!weightLb || weightLb <= 0) return setStamp({ kind: 'bad', title: 'NO WEIGHT', detail: 'No stable weight on the scale.' });
    printingRef.current = true;
    try {
      const payload = { item_code: product.code, lot_code: lot.lot_code, net_weight_lb: weightLb };
      let serial, zfd, hr, caseId = null, offline = false;
      try {
        const c = await api.post('/api/cases', payload);
        serial = c.serial; zfd = c.zpl_field_data; hr = c.human_readable; caseId = c.id;
        setCloudOk(true);
      } catch (err) {
        if (!cloudDown(err)) throw err;                  // real rejection (bad item/lot)
        offline = true; setCloudOk(false);
        serial = offlineSerial(lot.lot_code, stationId);
        const bc = { itemCode: product.code, weightLb, packDate: lot.pack_date, lotCode: lot.lot_code, serial };
        zfd = zplFieldData(bc); hr = humanReadable(bc);
        enqueue({ ...payload, serial });
        setQueued(loadQueue().length);
      }
      const zpl = fillLabel({
        productName: product.name, weightLb, packDate: lot.pack_date,
        lotCode: lot.lot_code, serial, zplFieldData: zfd, humanReadable: hr,
      });
      let printed = true, printErr = null;
      try { await bridge.print(zpl); }
      catch (err) { printed = false; printErr = err.message; }

      const rec = { serial, caseId, productName: product.name, weightLb, zpl, at: Date.now(), printed };
      const next = [rec, ...loadPrints()].slice(0, 200);
      localStorage.setItem(printsKey(), JSON.stringify(next));
      setPrints(next);
      setStamp(printed
        ? { kind: offline ? 'warn' : 'ok', title: offline ? 'PRINTED — OFFLINE' : 'PRINTED',
            detail: `${product.name} · ${weightLb.toFixed(2)} lb · ${serial}${offline ? ' — upload queued' : ''}` }
        : { kind: 'bad', title: 'PRINT FAILED', detail: `${printErr} — case ${serial} saved; use Reprint.` });
    } catch (err) {
      setStamp({ kind: 'bad', title: 'REJECTED', detail: err.message });
    } finally {
      printingRef.current = false;
    }
  };

  // auto-print on stable weight, re-armed once the case is lifted off
  useEffect(() => {
    if (wt.lb !== null && wt.lb < REARM_LB) armedRef.current = true;
    if (auto && armedRef.current && wt.stable && wt.lb >= AUTO_MIN_LB && product && lot) {
      armedRef.current = false;
      doPrint(wt.lb);
    }
  }, [wt]);

  const reprint = async (rec) => {
    try {
      await bridge.print(rec.zpl);
      setStamp({ kind: 'ok', title: 'REPRINTED', detail: `${rec.productName} · ${rec.serial}` });
    } catch (err) { setStamp({ kind: 'bad', title: 'PRINT FAILED', detail: err.message }); }
  };

  const voidCase = async (rec) => {
    if (!confirm(`Void ${rec.serial}? Misprints must not be scanned in.`)) return;
    try {
      await api.post(`/api/cases/${rec.caseId}/void`, { reason: 'station misprint' });
      const next = loadPrints().map((p) => p.serial === rec.serial ? { ...p, voided: true } : p);
      localStorage.setItem(printsKey(), JSON.stringify(next));
      setPrints(next);
    } catch (err) { setStamp({ kind: 'bad', title: 'VOID FAILED', detail: err.message }); }
  };

  const scaleUp = bridgeOk && wt.scaleConnected;
  const lb = wt.lb;
  const dot = (on) => <span className={`dot ${on ? 'up' : 'down'}`} />;

  return (
    <>
      <div className="eyebrow">Weigh &amp; label station — {stationId}</div>
      <div className="row statusrow">
        <span className="statuschip">{dot(bridgeOk)} Bridge</span>
        <span className="statuschip">{dot(scaleUp)} Scale{wt.sim ? ' (sim)' : ''}</span>
        <span className="statuschip">{dot(health?.printer?.reachable)} Printer{health?.printer?.sim ? ' (sim)' : ''}</span>
        <span className="statuschip">{dot(cloudOk)} Cloud</span>
        {queued > 0 && <span className="chip PENDING">{queued} upload{queued > 1 ? 's' : ''} queued</span>}
      </div>
      {bridgeOk === false && (
        <div className="stamp warn">BRIDGE NOT RUNNING
          <small>Start the station bridge on this PC ({bridgeUrl()}) — see station/bridge/. Manual weight entry still works.</small>
        </div>
      )}

      <div className="panel">
        <div className="row">
          <div className="field">
            <label>Product</label>
            <select value={itemCode} onChange={(e) => { setItemCode(e.target.value); localStorage.setItem('cf_station_item', e.target.value); }}>
              <option value="">Select product…</option>
              {products.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Pack date</label>
            <input type="date" value={packDate} onChange={(e) => setPackDate(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 90 }}>
            <label>Batch</label>
            <input type="number" min="1" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </div>
          <button className="btn secondary" onClick={setLotFromForm} style={{ alignSelf: 'flex-end' }}>Set lot</button>
        </div>
        {lot && <div style={{ marginTop: 10 }}>
          Lot <span className="serial">{lot.lot_code}</span>{lot.local ? ' (local — created on next upload)' : ''}
        </div>}
      </div>

      <div className="panel weighpanel">
        <div className="weight">
          {scaleUp && lb !== null ? lb.toFixed(2) : '——.——'}
          <span className="unit">lb</span>
          {scaleUp && lb !== null && (wt.stable
            ? <span className="chip IN_STOCK">STABLE</span>
            : <span className="chip PENDING">MOTION</span>)}
        </div>
        {!scaleUp && (
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field" style={{ maxWidth: 180 }}>
              <label>Manual weight (lb)</label>
              <input type="number" step="0.01" min="0.01" value={manualLb} onChange={(e) => setManualLb(e.target.value)} />
            </div>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn print" disabled={!product || !lot}
            onClick={() => doPrint(scaleUp ? (wt.stable ? lb : 0) : Number(manualLb))}>
            PRINT LABEL
          </button>
          <label className="autotoggle">
            <input type="checkbox" checked={auto} onChange={(e) => { armedRef.current = true; setAuto(e.target.checked); }} />
            Auto-print on stable weight
          </label>
        </div>
      </div>

      {stamp && <div className={`stamp ${stamp.kind}`}>{stamp.title}<small>{stamp.detail}</small></div>}

      <div className="eyebrow">Printed today at this station ({prints.length})</div>
      <div className="panel">
        {prints.length === 0 ? <div className="empty">Nothing printed yet today.</div> : (
          <table><tbody>
            {prints.map((p) => (
              <tr key={p.serial} style={p.voided ? { opacity: .45 } : undefined}>
                <td>{p.productName}</td>
                <td className="num">{Number(p.weightLb).toFixed(2)} lb</td>
                <td><span className="serial">{p.serial}</span></td>
                <td>{p.voided ? <span className="chip VOID">VOID</span> : !p.printed ? <span className="chip PENDING">NOT PRINTED</span> : null}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {!p.voided && <>
                    <button className="btn secondary mini" onClick={() => reprint(p)}>Reprint</button>{' '}
                    {p.caseId && <button className="btn danger mini" onClick={() => voidCase(p)}>Void</button>}
                  </>}
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
