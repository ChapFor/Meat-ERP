// ZT411 case label — 4x3" @ 203dpi. Same layout as station/gs1128_label.zpl
// (kept there as reference); this is the live template the Station screen fills.
const TEMPLATE = `^XA
^PW812
^LL609
^CI28

^FO30,30^A0N,34,34^FDCHAPEL FORD FARM^FS
^FO30,72^A0N,26,26^FD{PRODUCT_NAME}^FS

^FO30,120^A0N,24,24^FDNet Wt: {WEIGHT_LB} lb^FS
^FO420,120^A0N,24,24^FDPacked: {PACK_DATE_HUMAN}^FS
^FO30,155^A0N,24,24^FDLot: {LOT_CODE}^FS
^FO420,155^A0N,24,24^FDSerial: {SERIAL}^FS

^FO30,220^BY2
^BCN,140,N,N,N
^FD{ZPL_FIELD_DATA}^FS

^FO30,380^A0N,22,22^FD{HUMAN_READABLE}^FS

^FO30,430^A0N,20,20^FDKEEP REFRIGERATED OR FROZEN^FS
^XZ
`;

// ^ ~ are ZPL control chars — strip from free text (not from the barcode data,
// which uses > escapes deliberately).
const clean = (s) => String(s).replace(/[\^~]/g, ' ');

export function fillLabel({ productName, weightLb, packDate, lotCode, serial, zplFieldData, humanReadable }) {
  // pack_date is a bare YYYY-MM-DD from the lot form but a full ISO timestamp
  // when the lot came back from the API — take the date part either way.
  const d = packDate instanceof Date
    ? packDate
    : new Date(String(packDate).slice(0, 10) + 'T00:00:00');
  const human = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return TEMPLATE
    .replace('{PRODUCT_NAME}', clean(productName))
    .replace('{WEIGHT_LB}', Number(weightLb).toFixed(2))
    .replace('{PACK_DATE_HUMAN}', human)
    .replace('{LOT_CODE}', clean(lotCode))
    .replace('{SERIAL}', clean(serial))
    .replace('{ZPL_FIELD_DATA}', zplFieldData)
    .replace('{HUMAN_READABLE}', humanReadable);
}
