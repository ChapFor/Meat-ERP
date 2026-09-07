// node client/src/priorityOrder.test.mjs   (no database, no bundler)
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  splitChips, insertionIndex, moveWithin, insertAt, removeAt,
} from './priorityOrder.js';

const rect = (left, width, bottom = 40) => ({ left, width, bottom });

test('splitChips separates ranked from the rest, and tolerates junk', () => {
  const r = splitChips(['B'], ['A', 'B', 'C']);
  assert.deepEqual(r.ranked, ['B']);
  assert.deepEqual(r.unranked, ['A', 'C']);
  assert.deepEqual(splitChips(undefined, undefined), { ranked: [], unranked: [] });
  // a ranked customer with no open orders keeps its rank rather than vanishing
  assert.deepEqual(splitChips(['Z'], ['A']), { ranked: ['Z'], unranked: ['A'] });
});

test('insertionIndex picks the slot before the first chip past the pointer', () => {
  const rects = [rect(0, 100), rect(110, 100), rect(220, 100)];
  assert.equal(insertionIndex(rects, 10, 20), 0);    // left of chip 0's centre
  assert.equal(insertionIndex(rects, 60, 20), 1);    // past chip 0's centre
  assert.equal(insertionIndex(rects, 175, 20), 2);
  assert.equal(insertionIndex(rects, 900, 20), 3);   // past everything
  assert.equal(insertionIndex([], 5, 5), 0);
});

test('insertionIndex respects wrapped rows', () => {
  const rects = [rect(0, 100, 40), rect(110, 100, 40), rect(0, 100, 80)];
  // pointer on the second row, far left: not slot 0 — row one is above it
  assert.equal(insertionIndex(rects, 10, 60), 2);
});

test('moveWithin shifts a chip and keeps everyone else in order', () => {
  const l = ['A', 'B', 'C', 'D'];
  assert.deepEqual(moveWithin(l, 2, 0), ['C', 'A', 'B', 'D']);   // drag left
  assert.deepEqual(moveWithin(l, 0, 3), ['B', 'C', 'A', 'D']);   // drag right
  assert.deepEqual(moveWithin(l, 0, 4), ['B', 'C', 'D', 'A']);   // to the end
  assert.deepEqual(moveWithin(l, 1, 1), ['A', 'B', 'C', 'D']);   // no-op slot
  assert.deepEqual(moveWithin(l, 1, 2), ['A', 'B', 'C', 'D']);   // slot after self
  assert.deepEqual(moveWithin(l, 9, 0), l);                      // bogus index
  assert.deepEqual(l, ['A', 'B', 'C', 'D']);                     // never mutates
});

test('insertAt drops an unranked name in, without duplicating it', () => {
  assert.deepEqual(insertAt(['A', 'B'], 'C', 1), ['A', 'C', 'B']);
  assert.deepEqual(insertAt(['A', 'B'], 'C', 99), ['A', 'B', 'C']);
  assert.deepEqual(insertAt(['A', 'B'], 'A', 2), ['B', 'A']);
});

test('removeAt unranks one chip', () => {
  assert.deepEqual(removeAt(['A', 'B', 'C'], 1), ['A', 'C']);
  assert.deepEqual(removeAt(['A'], 5), ['A']);
});
