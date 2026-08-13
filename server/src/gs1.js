// GS1-128 element string helpers (internal-use barcodes).
// AIs used: (3202) net wt lb, 2 implied decimals, 6 digits
//           (91) internal item code  (10) lot code  (21) case serial
//
// Compact encoding: a full-form symbol does not fit a 4in label (9.3in at ^BY3),
// so the barcode carries
//   - no (13): the pack date is already the lot's YYMMDD prefix
//   - the lot as digits, 260812-B2 -> 2608122 (the dash and B force Code 128 out
//     of numeric subset C, doubling their cost)
//   - the serial as its suffix only, 260812-B2-0001 -> 0001, since the lot is in
//     the same symbol
// Database values keep their full readable forms; only the wire encoding shrinks.
// The parser accepts both encodings, so labels printed before this change and
// labels from other label software both still scan.
const GS = String.fromCharCode(29);

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

// 260812-B2 <-> 2608122. Date is always exactly 6 digits, so the batch number
// that follows is unambiguous even past B9.
export function compactLot(lotCode) {
  const m = /^(\d{6})-B(\d+)$/.exec(lotCode || '');
  return m ? m[1] + m[2] : lotCode;
}
export function expandLot(raw) {
  if (!raw) return raw;
  if (/^\d{6}-B\d+$/.test(raw)) return raw;           // already full form
  const m = /^(\d{6})(\d+)$/.exec(raw);
  return m ? `${m[1]}-B${m[2]}` : raw;
}

// Serial is stored as {lot}-{suffix} ({lot}-0001 server-side, {lot}-{station}{base36}
// offline). Only the suffix goes in the barcode.
export function serialSuffix(serial, lotCode) {
  const p = lotCode ? `${lotCode}-` : null;
  return p && serial?.startsWith(p) ? serial.slice(p.length) : serial;
}
export function expandSerial(raw, lotCode) {
  if (!raw || !lotCode) return raw;
  return raw.startsWith(`${lotCode}-`) ? raw : `${lotCode}-${raw}`;
}

// Human-readable element string, e.g. (3202)001450(91)176(10)2608122(21)0001
export function humanReadable({ itemCode, weightLb, lotCode, serial }) {
  return `(3202)${encodeWeight(weightLb)}(91)${itemCode}` +
    `(10)${compactLot(lotCode)}(21)${serialSuffix(serial, lotCode)}`;
}

// ZPL ^FD payload for ^BC in GS1-128 mode. >; = start subset C, >8 = FNC1.
// (3202) is predefined-length so it needs no separator before (91); the two
// variable-length AIs that follow each get one.
export function zplFieldData({ itemCode, weightLb, lotCode, serial }) {
  return `>;>83202${encodeWeight(weightLb)}91${itemCode}` +
    `>810${compactLot(lotCode)}>821${serialSuffix(serial, lotCode)}`;
}

// Parse a scan from a keyboard-wedge scanner. Tolerates: AIM prefix ]C1,
// ASCII GS (0x1D) separators, or parenthesized human-readable form.
// Returns database-shaped values (full lot code and full serial) whichever
// encoding was scanned.
export function parseScan(raw) {
  if (!raw) throw new Error('empty scan');
  let s = String(raw).trim();
  if (s.startsWith(']C1')) s = s.slice(3);

  const out = {};
  if (s.includes('(')) {
    // parenthesized form
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m;
    while ((m = re.exec(s))) out[m[1]] = m[2].trim();
  } else {
    // raw element string with GS separators (or fixed-length walking)
    const fixedLen = { '13': 6, '3202': 6, '11': 6, '15': 6, '17': 6 };
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      const ai4 = s.slice(i, i + 4), ai2 = s.slice(i, i + 2);
      let ai;
      if (fixedLen[ai4] !== undefined || ['3202', '3102'].includes(ai4)) ai = ai4;
      else if (['91', '92', '10', '21', '13'].includes(ai2)) ai = ai2;
      else throw new Error(`unrecognized AI at "${s.slice(i, i + 4)}"`);
      i += ai.length;
      if (fixedLen[ai] !== undefined) {
        out[ai] = s.slice(i, i + fixedLen[ai]);
        i += fixedLen[ai];
      } else {
        const end = s.indexOf(GS, i);
        out[ai] = end === -1 ? s.slice(i) : s.slice(i, end);
        i = end === -1 ? s.length : end + 1;
      }
    }
  }

  const lotCode = expandLot(out['10'] || null);
  const result = {
    packDateRaw: out['13'] || null,   // legacy labels only; pack date comes from the lot
    weightLb: out['3202'] ? Number(out['3202']) / 100 : null,
    itemCode: out['91'] || null,
    lotCode,
    serial: expandSerial(out['21'] || null, lotCode),
  };
  if (!result.serial) throw new Error('scan missing serial (AI 21)');
  return result;
}
