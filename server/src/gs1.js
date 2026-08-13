// GS1-128 element string helpers (internal-use barcodes).
// AIs used: (13) pack date YYMMDD  (3202) net wt lb, 2 implied decimals, 6 digits
//           (91) internal item code  (10) lot code  (21) serial
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

// Human-readable element string, e.g. (13)260812(3202)001450(91)176(10)260812-B2(21)C000123
export function humanReadable({ itemCode, weightLb, packDate, lotCode, serial }) {
  return `(13)${yymmdd(packDate)}(3202)${encodeWeight(weightLb)}(91)${itemCode}(10)${lotCode}(21)${serial}`;
}

// ZPL ^FD payload for ^BC in GS1-128 mode. >; = subset C-ish start handled by ZPL auto,
// >8 = FNC1. Fixed-length AIs (13, 3202) first; variable-length AIs separated by FNC1.
export function zplFieldData({ itemCode, weightLb, packDate, lotCode, serial }) {
  return `>;>813${yymmdd(packDate)}3202${encodeWeight(weightLb)}>891${itemCode}>810${lotCode}>821${serial}`;
}

// Parse a scan from a keyboard-wedge scanner. Tolerates: AIM prefix ]C1,
// ASCII GS (0x1D) separators, or parenthesized human-readable form.
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
      else if (['91', '10', '21'].includes(s.slice(i, i + 2))) ai = ai2;
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

  const result = {
    packDateRaw: out['13'] || null,
    weightLb: out['3202'] ? Number(out['3202']) / 100 : null,
    itemCode: out['91'] || null,
    lotCode: out['10'] || null,
    serial: out['21'] || null,
  };
  if (!result.serial) throw new Error('scan missing serial (AI 21)');
  return result;
}
