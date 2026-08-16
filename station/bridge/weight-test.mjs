// tests the REAL parser the bridge uses, so the two cannot drift
import { parseWeightLb } from './parse-weight.js';

const STX = String.fromCharCode(2);
const cases = [
  ['NCI with unit',       '\n  14.50LB\r\n', 14.5],
  ['NCI spaced unit',     '14.50 LB\r\n', 14.5],
  ['lowercase unit',      '14.50lb', 14.5],
  ['SICS kg',             'S S      6.578 kg\r\n', 14.5],
  ['bare decimal',        '   14.50  \r', 14.5],
  ['Toledo continuous',   STX + '   001450000000\r', 14.5],
  ['Toledo cont, 0 tare', STX + 'abc001450\r', 14.5],
  ['Toledo heavy',        STX + '   012500000000\r', 125.0],
  ['grams',               '6578.0 g\r\n', 14.5],
  ['negative (tare)',     '-1.25 LB\r\n', -1.25],
  ['zero',                '0.00 LB\r\n', 0],
  ['multiple, take last', '1.00 LB\r\n2.50 LB\r\n', 2.5],
  ['garbage must fail',   '\xfe\xfe\x7f ???', null],
  ['empty must fail',     '', null],
  ['status only',         'S S ---- ', null],
];
let bad = 0;
for (const [name, raw, want] of cases) {
  const got = parseWeightLb(raw);
  const ok = want === null ? got === null : got !== null && Math.abs(got - want) < 0.02;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} -> ${got}${ok ? '' : `   (want ${want})`}`);
}
console.log(bad ? `\n${bad} FAILURE(S)` : '\nall green');
process.exit(bad ? 1 : 0);
