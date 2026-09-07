// Customer priority strip — the pure ordering logic, kept out of the component
// so it can be reasoned about (and tested) without a pointer or a DOM.
//
// The floor drags customer chips left and right to say which orders get cut
// first. `priority` is the whole ordering and is replaced wholesale on the
// server, so every function here returns a new complete array.

/** Names on active orders that nobody has ranked yet, A→Z, ranked ones removed. */
export function splitChips(priority, customers) {
  const ranked = Array.isArray(priority) ? priority.filter((c) => typeof c === 'string') : [];
  const all = Array.isArray(customers) ? customers.filter((c) => typeof c === 'string') : [];
  const seen = new Set(ranked);
  const unranked = all.filter((c) => !seen.has(c));
  return { ranked, unranked };
}

/**
 * Which slot the pointer is over, given the ranked chips' rects captured when
 * the drag started. Chips wrap, so a rect only counts once the pointer is on
 * or above its row — otherwise dropping on row two would land in row one.
 */
export function insertionIndex(rects, x, y) {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (y < r.bottom && x < r.left + r.width / 2) return i;
  }
  return rects.length;
}

/** Move the ranked chip at `from` into slot `to` (an insertion slot, 0..len). */
export function moveWithin(list, from, to) {
  if (from < 0 || from >= list.length) return list.slice();
  const out = list.slice();
  const [item] = out.splice(from, 1);
  const idx = to > from ? to - 1 : to;
  out.splice(Math.max(0, Math.min(idx, out.length)), 0, item);
  return out;
}

/** Drop an unranked name into slot `to` (also de-dupes if it was already there). */
export function insertAt(list, name, to) {
  const out = list.filter((n) => n !== name);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, name);
  return out;
}

/** The × on a ranked chip: back to unranked, which is just "not in the list". */
export function removeAt(list, idx) {
  return list.filter((_, i) => i !== idx);
}
