import test from 'node:test';
import assert from 'node:assert/strict';

import {
  autoFormatMathMarkdown,
  normalizeMathExpression,
} from './markdownMathAutoFormat.js';

test('normalizes common plain-text math syntax into TeX-friendly expressions', () => {
  assert.equal(
    normalizeMathExpression('sqrt(x^2 + 1) = 1/2'),
    '\\sqrt{x^2 + 1} = \\frac{1}{2}',
  );
});

test('auto-formats standalone and inline plain-text math in markdown preview content', () => {
  const formatted = autoFormatMathMarkdown([
    'Solve x^2 + y^2 = z^2 before continuing.',
    'Then compare sqrt(x) with 1/2.',
  ].join('\n'));

  assert.equal(
    formatted,
    [
      'Solve $x^2 + y^2 = z^2$ before continuing.',
      'Then compare $\\sqrt{x}$ with $\\frac{1}{2}$.',
    ].join('\n'),
  );
});

test('leaves fenced code, inline code, and explicit TeX delimiters untouched', () => {
  const source = [
    'Already TeX: $x^2 + y^2$',
    'Inline code `x^2 + y^2 = z^2` stays literal.',
    '```python',
    'value = sqrt(x) + 1/2',
    '```',
  ].join('\n');

  assert.equal(autoFormatMathMarkdown(source), source);
});

test('does not mistake slash-separated dates for fractions', () => {
  assert.equal(
    autoFormatMathMarkdown('Class moved to 3/12/2026.'),
    'Class moved to 3/12/2026.',
  );
});

test('leaves markdown links and API-style paths untouched', () => {
  const source = [
    '[a-b guide](https://example.com/a-b)',
    'POST to /v1/history/update before retrying.',
  ].join('\n');

  assert.equal(autoFormatMathMarkdown(source), source);
});

test('does not auto-format hyphenated prose, ranges, or isolated chapter fractions', () => {
  const source = 'Filename a-b.txt and Between pages 3-5, review chapter 1/2.';

  assert.equal(autoFormatMathMarkdown(source), source);
});

test('still formats a standalone fraction when the same line already has stronger math context', () => {
  assert.equal(
    autoFormatMathMarkdown('Then compare sqrt(x) with 1/2.'),
    'Then compare $\\sqrt{x}$ with $\\frac{1}{2}$.',
  );
});
