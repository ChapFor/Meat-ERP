// Turning whatever the scale sent into pounds.
// Kept separate from bridge.js so it can be tested directly — this is the part
// most likely to need tuning when a different scale or protocol shows up.
//
// Tried in order of how much the message tells us:
//   1. number + unit       "14.50 LB"        NCI / SICS poll replies
//   2. bare decimal        "   14.50\r"      plenty of scales omit the unit
//   3. Toledo continuous   STX,3 status,6 weight digits,6 tare digits,CR —
//      no decimal point and no unit, so `divisor` supplies the scaling
// Returns null rather than guessing when nothing looks like a weight.
export function parseWeightLb(buf, { divisor = 100 } = {}) {
  const s = String(buf);

  const withUnit = [...s.matchAll(/(-?\d+(?:\.\d+)?)\s*(lb|kg|g)\b/gi)];
  if (withUnit.length) {
    const m = withUnit[withUnit.length - 1];
    let lb = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'kg') lb *= 2.20462;
    else if (u === 'g') lb *= 0.00220462;
    return Number.isFinite(lb) ? Math.round(lb * 100) / 100 : null;
  }

  const decimals = [...s.matchAll(/(-?\d+\.\d+)/g)];
  if (decimals.length) {
    const lb = Number(decimals[decimals.length - 1][1]);
    return Number.isFinite(lb) ? Math.round(lb * 100) / 100 : null;
  }

  // The weight field is exactly 6 wide. A looser run would swallow the first
  // tare digit and report 14.50 lb as 145.00.
  const cont = /\x02[^\d]{0,4}(\d{6})/.exec(s);
  if (cont) {
    const lb = Number(cont[1]) / (Number(divisor) || 100);
    return Number.isFinite(lb) ? Math.round(lb * 100) / 100 : null;
  }
  return null;
}
