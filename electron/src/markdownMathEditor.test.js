import test from 'node:test';
import assert from 'node:assert/strict';

import { selectionTouchesMathRange } from './markdownMathEditor.js';

test('treats a caret at the end of a math range as outside the range', () => {
  const selection = {
    ranges: [
      { empty: true, head: 8 },
    ],
  };

  assert.equal(selectionTouchesMathRange(selection, 3, 8), false);
});

test('treats a caret at the start or inside a math range as touching the range', () => {
  const atStart = {
    ranges: [
      { empty: true, head: 3 },
    ],
  };
  const inside = {
    ranges: [
      { empty: true, head: 6 },
    ],
  };

  assert.equal(selectionTouchesMathRange(atStart, 3, 8), true);
  assert.equal(selectionTouchesMathRange(inside, 3, 8), true);
});

test('does not treat adjacent non-empty selections as touching a math range', () => {
  const leftAdjacent = {
    ranges: [
      { empty: false, from: 0, to: 3 },
    ],
  };
  const rightAdjacent = {
    ranges: [
      { empty: false, from: 8, to: 10 },
    ],
  };

  assert.equal(selectionTouchesMathRange(leftAdjacent, 3, 8), false);
  assert.equal(selectionTouchesMathRange(rightAdjacent, 3, 8), false);
});

test('still treats overlapping non-empty selections as touching a math range', () => {
  const overlapsLeftEdge = {
    ranges: [
      { empty: false, from: 1, to: 4 },
    ],
  };
  const overlapsRightEdge = {
    ranges: [
      { empty: false, from: 7, to: 10 },
    ],
  };

  assert.equal(selectionTouchesMathRange(overlapsLeftEdge, 3, 8), true);
  assert.equal(selectionTouchesMathRange(overlapsRightEdge, 3, 8), true);
});
