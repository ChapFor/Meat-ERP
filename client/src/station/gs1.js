// Client-side GS1-128 encoders — mirrors server/src/gs1.js (encode half only).
// Needed so the Station screen can build labels offline; keep in sync with the
// server if AIs or the compact encoding ever change.
export function yymmdd(d) {
  const dt = d instanceof Date ? d : new Date(d + 'T00:00:00');
  const p = (n) => String(n).padStart(2, '0');
  return `${String(dt.getFullYear()).slice(2)}${p(dt.getMonth() + 1)}${p(dt.getDate())}`;
}

export function encodeWeight(lb) {
  const n = Math.round(Number(lb) * 100);
  if (!Number.isFinite(n) || n <= 0 || n > 999999) throw new Error('weight out of range for AI 3202');
  return String(n).padStart(6, '0');
}

// 260812-B2 -> 2608122 (dash and B would force Code 128 out of numeric subset C)
export function compactLot(lotCode) {
  const m = /^(\d{6})-B(\d+)$/.exec(lotCode || '');
  return m ? m[1] + m[2] : lotCode;
}

// only the suffix of {lot}-{suffix} goes in the barcode; the lot is right there
export function serialSuffix(serial, lotCode) {
  const p = lotCode ? `${lotCode}-` : null;
  return p && serial?.startsWith(p) ? serial.slice(p.length) : serial;
}

export function humanReadable({ itemCode, weightLb, lotCode, serial }) {
  return `(3202)${encodeWeight(weightLb)}(91)${itemCode}` +
    `(10)${compactLot(lotCode)}(21)${serialSuffix(serial, lotCode)}`;
}

export function zplFieldData({ itemCode, weightLb, lotCode, serial }) {
  return `>;>83202${encodeWeight(weightLb)}91${itemCode}` +
    `>810${compactLot(lotCode)}>821${serialSuffix(serial, lotCode)}`;
}

// Offline serial. The suffix must stay numeric: an alphanumeric one forces
// subset B and pushes the symbol to 4.55in, past the 4in label. Station digit +
// 5-digit counter keyed on the lot, so it cannot repeat within the lot and
// cannot collide with the server's 4-digit sequence.
export function offlineSerial(lotCode, stationId) {
  const st = (String(stationId || '').match(/\d/) || ['1'])[0];
  const key = `cf_station_seq_${lotCode}`;
  const n = Number(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, String(n));
  return `${lotCode}-${st}${String(n).padStart(5, '0')}`;
}
