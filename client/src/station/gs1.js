// Client-side GS1-128 encoders — mirrors server/src/gs1.js (encode half only).
// Needed so the Station screen can build labels offline; keep in sync with the
// server if AIs ever change.
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

export function humanReadable({ itemCode, weightLb, packDate, lotCode, serial }) {
  return `(13)${yymmdd(packDate)}(3202)${encodeWeight(weightLb)}(91)${itemCode}(10)${lotCode}(21)${serial}`;
}

export function zplFieldData({ itemCode, weightLb, packDate, lotCode, serial }) {
  return `>;>813${yymmdd(packDate)}3202${encodeWeight(weightLb)}>891${itemCode}>810${lotCode}>821${serial}`;
}

// Offline serial per station/INTEGRATION.md: {lot}-{stationId}{epochSecondsBase36}
export function offlineSerial(lotCode, stationId) {
  return `${lotCode}-${stationId}${Math.floor(Date.now() / 1000).toString(36).toUpperCase()}`;
}
