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
