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
  assert.equal(
    normalizeMathExpression('sin(x) + max(y, z)'),
    '\\sin(x) + \\max(y, z)',
  );
});

test('auto-formats standalone and inline plain-text math in markdown preview content', () => {
  const formatted = autoFormatMathMarkdown([
    'Solve x^2 + y^2 = z^2 before continuing.',
    'Then compare sqrt(x) with 1/2.',
    'The terms 5x and 5x^2 both matter.',
  ].join('\n'));

  assert.equal(
    formatted,
    [
      'Solve \\(x^2 + y^2 = z^2\\) before continuing.',
      'Then compare \\(\\sqrt{x}\\) with \\(\\frac{1}{2}\\).',
      'The terms \\(5x\\) and \\(5x^2\\) both matter.',
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
    'Then compare \\(\\sqrt{x}\\) with \\(\\frac{1}{2}\\).',
  );
});

test('leaves relative paths untouched even on lines that also contain real math', () => {
  const source = 'Refer to src/utils before solving x+1=2 and 1/2.';

  assert.equal(
    autoFormatMathMarkdown(source),
    'Refer to src/utils before solving \\(x+1=2\\) and \\(\\frac{1}{2}\\).',
  );
});

test('renders implicit-multiplication expressions inside larger equations', () => {
  assert.equal(
    autoFormatMathMarkdown('Solve 5x + 3 = 8.'),
    'Solve \\(5x + 3 = 8\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Solve 3a + 1 = 4.'),
    'Solve \\(3a + 1 = 4\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Solve 2n + 1 = 5.'),
    'Solve \\(2n + 1 = 5\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Solve 2ab + 1 = 0.'),
    'Solve \\(2ab + 1 = 0\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Solve 12xy - 4 = 0.'),
    'Solve \\(12xy - 4 = 0\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Solve 2a_1 + 3b^2 = 0.'),
    'Solve \\(2a_1 + 3b^2 = 0\\).',
  );
});

test('does not treat unit-like tokens as implicit multiplication math', () => {
  assert.equal(
    autoFormatMathMarkdown('Use 5g service on campus.'),
    'Use 5g service on campus.',
  );
  assert.equal(
    autoFormatMathMarkdown('Use 10x magnification.'),
    'Use 10x magnification.',
  );
  assert.equal(
    autoFormatMathMarkdown('Model o4-mini is preferred over gpt-5x.'),
    'Model o4-mini is preferred over gpt-5x.',
  );
  assert.equal(
    autoFormatMathMarkdown('Speed increased by 2x and 3x.'),
    'Speed increased by 2x and 3x.',
  );
  assert.equal(
    autoFormatMathMarkdown('The app supports 2x playback and 3x zoom.'),
    'The app supports 2x playback and 3x zoom.',
  );
  assert.equal(
    autoFormatMathMarkdown('Variable 2a_1 is stored.'),
    'Variable 2a_1 is stored.',
  );
  assert.equal(
    autoFormatMathMarkdown('Use 2x_speed mode.'),
    'Use 2x_speed mode.',
  );
});

test('renders symbolic fractions while still protecting code-style relative paths', () => {
  assert.equal(
    autoFormatMathMarkdown('Solve ab/cd = 2.'),
    'Solve \\(\\frac{ab}{cd} = 2\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Solve theta/phi = 1.'),
    'Solve \\(\\frac{theta}{phi} = 1\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Refer to src/utils before solving x+1=2 and 1/2.'),
    'Refer to src/utils before solving \\(x+1=2\\) and \\(\\frac{1}{2}\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Solve 2ab/3cd = 1.'),
    'Solve \\(\\frac{2ab}{3cd} = 1\\).',
  );
});

test('lone dollar text does not corrupt later auto-generated math spans', () => {
  assert.equal(
    autoFormatMathMarkdown('Price is $5 and equation x+1=2.'),
    'Price is $5 and equation \\(x+1=2\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('The shell var $PATH and equation x+1=2.'),
    'The shell var $PATH and equation \\(x+1=2\\).',
  );
  assert.equal(
    autoFormatMathMarkdown('Cost $5, solve 2a_1 + 3b^2 = 0.'),
    'Cost $5, solve \\(2a_1 + 3b^2 = 0\\).',
  );
});
