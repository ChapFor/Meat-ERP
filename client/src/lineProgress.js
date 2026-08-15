// An order line is counted in packs, in whole cases, or in pounds. This is the
// one place that decides which number to compare against, so Orders and Packing
// can never disagree about whether a line is finished.
export function lineProgress(l) {
  if (l.qty_lb) {
    const done = Number(l.packed_lb || 0), goal = Number(l.qty_lb);
    return { done, goal, unit: 'lb', text: `${done.toFixed(1)}/${goal.toFixed(1)} lb`,
      complete: done >= goal, lb: done };
  }
  const byCase = l.qty_unit === 'case';
  const done = Number((byCase ? l.packed_cases : l.packed_packs) || 0);
  const goal = Number(l.qty_cases || 0);
  const unit = byCase ? 'cases' : 'packs';
  return { done, goal, unit, text: `${done}/${goal} ${unit}`,
    complete: goal > 0 && done >= goal, lb: Number(l.packed_lb || 0) };
}
