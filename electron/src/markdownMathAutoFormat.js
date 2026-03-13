const STANDALONE_IMPLICIT_PRODUCT_TERM_SOURCE = String.raw`\d+(?:\.\d+)?(?:[xyzXYZ]|[A-Za-z](?:_[A-Za-z0-9]+|\^[A-Za-z0-9]+))`;
const EQUATION_IMPLICIT_PRODUCT_TERM_SOURCE = String.raw`\d+(?:\.\d+)?(?:[A-Za-z]+(?:_[A-Za-z0-9]+|\^[A-Za-z0-9]+)?)`;
const ATOMIC_MATH_TERM_SOURCE = [
  String.raw`[A-Za-z][A-Za-z0-9_]*\([^)\n]+\)`,
  String.raw`[A-Za-z][A-Za-z0-9_]*`,
  String.raw`\d+(?:\.\d+)?`,
  String.raw`\([^()\n]+\)`,
].join('|');
const FRACTION_MATH_TERM_SOURCE = String.raw`(?:${ATOMIC_MATH_TERM_SOURCE})\s*\/\s*(?:${ATOMIC_MATH_TERM_SOURCE})`;
const MATH_TERM_SOURCE = [
  FRACTION_MATH_TERM_SOURCE,
  EQUATION_IMPLICIT_PRODUCT_TERM_SOURCE,
  ATOMIC_MATH_TERM_SOURCE,
].join('|');
const MATH_OPERATOR_SOURCE = String.raw`<=|>=|!=|=|<|>|\+|-|\*|\/|\^`;
const MATH_RUN_PATTERN = new RegExp(
  String.raw`(?:sqrt\([^()\n]+\)|\b(?:${MATH_TERM_SOURCE})(?:(?:\s*(?:${MATH_OPERATOR_SOURCE})\s*(?:${MATH_TERM_SOURCE}))+))`,
  'g',
);
const AUTO_INLINE_MATH_OPEN = String.raw`\(`;
const AUTO_INLINE_MATH_CLOSE = String.raw`\)`;
const IMPLICIT_PRODUCT_PATTERN = new RegExp(String.raw`^${STANDALONE_IMPLICIT_PRODUCT_TERM_SOURCE}$`);
const IMPLICIT_PRODUCT_RUN_PATTERN = new RegExp(String.raw`\b${STANDALONE_IMPLICIT_PRODUCT_TERM_SOURCE}\b`, 'g');
const EXPONENT_IMPLICIT_PRODUCT_CUE_PATTERN = /\b\d+(?:\.\d+)?[A-Za-z]+\^[A-Za-z0-9]+\b/;
const FENCE_START_PATTERN = /^(\s*)(`{3,}|~{3,})/;
const SIMPLE_FRACTION_PATTERN = /^(?:\([^()\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*\/\s*(?:\([^()\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?)$/;
const SIMPLE_FRACTION_RUN_PATTERN = /\b(?:\([^()\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*\/\s*(?:\([^()\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?)\b/g;
const FRACTION_NORMALIZATION_TERM_SOURCE = [
  String.raw`\([^()\n]+\)`,
  EQUATION_IMPLICIT_PRODUCT_TERM_SOURCE,
  String.raw`[A-Za-z][A-Za-z0-9_]*`,
  String.raw`\d+(?:\.\d+)?`,
].join('|');
const MARKDOWN_LINK_PATTERN = /!?\[[^\]\n]+\]\([^) \n]+(?:\s+["'][^"\n]+["'])?\)/g;
const URL_PATTERN = /https?:\/\/[^\s)]+/g;
const ROOT_PATH_PATTERN = /(?:^|[\s(])(?:\/[A-Za-z0-9._-]+){2,}(?=$|[\s),.;:!?])/g;
const RELATIVE_PATH_CANDIDATE_PATTERN = /(?:^|[\s(])(?:[A-Za-z][A-Za-z0-9._-]{0,}\/)+[A-Za-z][A-Za-z0-9._-]{0,}(?=$|[\s),.;:!?])/g;
const STRICT_RELATIVE_PATH_TOKEN_PATTERN = /^(?:[A-Za-z][A-Za-z0-9._-]*\/)+[A-Za-z][A-Za-z0-9._-]*$/;
const COMMON_TEX_FUNCTIONS = ['sin', 'cos', 'tan', 'log', 'ln', 'max', 'min'];
const COMMON_RELATIVE_PATH_HEADS = new Set([
  'app',
  'assets',
  'components',
  'dist',
  'docs',
  'hooks',
  'lib',
  'node_modules',
  'pages',
  'public',
  'scripts',
  'src',
  'styles',
  'test',
  'tests',
  'utils',
]);

function isBoundaryCharacter(character) {
  return !character || /[\s()[\]{}.,;:!?'"`~-]/.test(character);
}

function hasStrongMathCue(text) {
  return /(?:sqrt\(|\\sqrt\{|<=|>=|!=|=|<|>|\+|\*|\^)/.test(String(text || ''));
}

function hasExponentImplicitProductCue(text) {
  return EXPONENT_IMPLICIT_PRODUCT_CUE_PATTERN.test(String(text || ''));
}

function stripProtectedSegmentPrefix(text) {
  const raw = String(text || '');
  if (raw[0] === ' ' || raw[0] === '(') {
    return raw.slice(1);
  }
  return raw;
}

function looksLikeRelativePathToken(text) {
  const trimmed = stripProtectedSegmentPrefix(text).trim();
  if (!STRICT_RELATIVE_PATH_TOKEN_PATTERN.test(trimmed)) {
    return false;
  }
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length < 2) {
    return false;
  }
  if (segments.every((segment) => /^\d+$/.test(segment))) {
    return false;
  }
  if (segments.length >= 3) {
    return true;
  }
  if (segments.some((segment) => /[._-]|\d/.test(segment))) {
    return true;
  }
  return COMMON_RELATIVE_PATH_HEADS.has(segments[0].toLowerCase());
}

function nextMathFence(text, startIndex) {
  let nextIndex = -1;
  let nextFence = '';

  for (let index = startIndex; index < text.length; index += 1) {
    const current = text[index];
    const previous = text[index - 1];

    if (current === '$' && previous !== '\\') {
      nextIndex = index;
      nextFence = text[index + 1] === '$' ? '$$' : '$';
      break;
    }

    if (current === '\\' && (text[index + 1] === '(' || text[index + 1] === '[')) {
      nextIndex = index;
      nextFence = text.slice(index, index + 2);
      break;
    }
  }

  return { nextIndex, nextFence };
}

function matchingMathFence(fence) {
  if (fence === '\\(') {
    return '\\)';
  }
  if (fence === '\\[') {
    return '\\]';
  }
  return fence;
}

function splitExistingMathSegments(text) {
  const segments = [];
  const raw = String(text || '');
  let cursor = 0;

  while (cursor < raw.length) {
    const { nextIndex: start, nextFence: fence } = nextMathFence(raw, cursor);

    if (start === -1) {
      segments.push({ type: 'text', value: raw.slice(cursor), start: cursor });
      break;
    }

    if (start > cursor) {
      segments.push({ type: 'text', value: raw.slice(cursor, start), start: cursor });
    }

    const closingFence = matchingMathFence(fence);
    let end = start + fence.length;
    let foundEnd = -1;

    while (end < raw.length) {
      const nextIndex = raw.indexOf(closingFence, end);
      if (nextIndex === -1) {
        break;
      }
      if (closingFence.startsWith('\\') || raw[nextIndex - 1] !== '\\') {
        foundEnd = nextIndex;
        break;
      }
      end = nextIndex + closingFence.length;
    }

    if (foundEnd === -1) {
      segments.push({
        type: 'text',
        value: raw.slice(start, start + fence.length),
        start,
      });
      cursor = start + fence.length;
      continue;
    }

    segments.push({
      type: 'math',
      value: raw.slice(start, foundEnd + closingFence.length),
      start,
    });
    cursor = foundEnd + closingFence.length;
  }

  return segments;
}

function replaceBalancedFunctionCalls(expression, functionName, replacementBuilder) {
  const needle = `${functionName}(`;
  let cursor = 0;
  let result = '';

  while (cursor < expression.length) {
    const index = expression.indexOf(needle, cursor);
    if (index === -1) {
      result += expression.slice(cursor);
      break;
    }

    const before = index > 0 ? expression[index - 1] : '';
    if (before && /[A-Za-z0-9_\\]/.test(before)) {
      result += expression.slice(cursor, index + needle.length);
      cursor = index + needle.length;
      continue;
    }

    let depth = 1;
    let scanIndex = index + needle.length;
    while (scanIndex < expression.length && depth > 0) {
      const character = expression[scanIndex];
      if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
      scanIndex += 1;
    }

    if (depth !== 0) {
      result += expression.slice(cursor);
      break;
    }

    const inner = expression.slice(index + needle.length, scanIndex - 1);
    result += expression.slice(cursor, index);
    result += replacementBuilder(inner);
    cursor = scanIndex;
  }

  return result;
}

function normalizeMathExpression(expression) {
  let normalized = String(expression || '').trim();
  if (!normalized) {
    return normalized;
  }

  normalized = normalized
    .replace(/<=/g, ' \\le ')
    .replace(/>=/g, ' \\ge ')
    .replace(/!=/g, ' \\ne ')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = replaceBalancedFunctionCalls(normalized, 'sqrt', (inner) => `\\sqrt{${normalizeMathExpression(inner)}}`);

  for (const functionName of COMMON_TEX_FUNCTIONS) {
    const pattern = new RegExp(`\\b${functionName}\\s*\\(`, 'g');
    normalized = normalized.replace(pattern, () => `\\${functionName}(`);
  }

  normalized = normalized.replace(
    new RegExp(
      String.raw`(^|[^\\])(${FRACTION_NORMALIZATION_TERM_SOURCE})\s*\/\s*(${FRACTION_NORMALIZATION_TERM_SOURCE})`,
      'g',
    ),
    (match, prefix, numerator, denominator) => `${prefix}\\frac{${numerator}}{${denominator}}`,
  );

  return normalized.replace(/\s+/g, ' ').trim();
}

function shouldWrapMathRun(run, source, offset) {
  const previous = offset > 0 ? source[offset - 1] : '';
  const next = offset + run.length < source.length ? source[offset + run.length] : '';
  const beforePrevious = offset > 1 ? source[offset - 2] : '';
  const afterNext = offset + run.length + 1 < source.length ? source[offset + run.length + 1] : '';
  const trimmed = String(run || '').trim();

  if (!trimmed) {
    return false;
  }
  if (!isBoundaryCharacter(previous) || !isBoundaryCharacter(next)) {
    return false;
  }
  if (/^\d+(?:\s*\/\s*\d+){2,}$/.test(trimmed)) {
    return false;
  }
  if (
    (previous === '-' && /[A-Za-z0-9]/.test(beforePrevious))
    || (next === '-' && /[A-Za-z0-9]/.test(afterNext))
  ) {
    return false;
  }
  if (looksLikeRelativePathToken(trimmed)) {
    return false;
  }
  if (IMPLICIT_PRODUCT_PATTERN.test(trimmed)) {
    const surroundingText = `${source.slice(0, offset)} ${source.slice(offset + run.length)}`;
    const hasSubscript = trimmed.includes('_');
    const hasExponent = trimmed.includes('^');
    if (String(source || '').trim() === trimmed) {
      return true;
    }
    if (hasSubscript) {
      return hasStrongMathCue(surroundingText);
    }
    if (hasExponent) {
      return true;
    }
    if (hasStrongMathCue(surroundingText)) {
      return true;
    }
    if (hasExponentImplicitProductCue(surroundingText)) {
      return true;
    }
    return false;
  }
  if (SIMPLE_FRACTION_PATTERN.test(trimmed)) {
    const surroundingText = `${source.slice(0, offset)} ${source.slice(offset + run.length)}`;
    return hasStrongMathCue(surroundingText);
  }
  return hasStrongMathCue(trimmed);
}

function wrapMatchedRuns(text, pattern) {
  return splitExistingMathSegments(text)
    .map((segment) => {
      if (segment.type !== 'text') {
        return segment.value;
      }
      return segment.value.replace(pattern, (run, offset) => {
        const globalOffset = segment.start + offset;
        if (!shouldWrapMathRun(run, text, globalOffset)) {
          return run;
        }
        return `${AUTO_INLINE_MATH_OPEN}${normalizeMathExpression(run)}${AUTO_INLINE_MATH_CLOSE}`;
      });
    })
    .join('');
}

function wrapMathRuns(text) {
  if (!text) {
    return text;
  }

  const withMathRuns = wrapMatchedRuns(text, MATH_RUN_PATTERN);
  const withFractions = wrapMatchedRuns(withMathRuns, SIMPLE_FRACTION_RUN_PATTERN);
  return wrapMatchedRuns(withFractions, IMPLICIT_PRODUCT_RUN_PATTERN);
}

function splitInlineCodeSegments(line) {
  const segments = [];
  let cursor = 0;

  while (cursor < line.length) {
    const start = line.indexOf('`', cursor);
    if (start === -1) {
      segments.push({ type: 'text', value: line.slice(cursor) });
      break;
    }

    if (start > cursor) {
      segments.push({ type: 'text', value: line.slice(cursor, start) });
    }

    let tickLength = 1;
    while (line[start + tickLength] === '`') {
      tickLength += 1;
    }

    const fence = '`'.repeat(tickLength);
    const end = line.indexOf(fence, start + tickLength);
    if (end === -1) {
      segments.push({ type: 'text', value: line.slice(start) });
      break;
    }

    segments.push({
      type: 'code',
      value: line.slice(start, end + tickLength),
    });
    cursor = end + tickLength;
  }

  return segments;
}

function findNextProtectedMarkdownSegment(text, startIndex) {
  const patterns = [
    { pattern: MARKDOWN_LINK_PATTERN },
    { pattern: URL_PATTERN },
    { pattern: ROOT_PATH_PATTERN },
    { pattern: RELATIVE_PATH_CANDIDATE_PATTERN, predicate: looksLikeRelativePathToken },
  ];
  let bestMatch = null;

  for (const { pattern, predicate } of patterns) {
    pattern.lastIndex = startIndex;
    let match = pattern.exec(text);
    while (match) {
      if (!predicate || predicate(match[0])) {
        if (!bestMatch || match.index < bestMatch.index) {
          bestMatch = {
            index: match.index,
            value: match[0],
          };
        }
        break;
      }
      match = pattern.exec(text);
    }
  }

  return bestMatch;
}

function splitProtectedMarkdownSegments(text) {
  const segments = [];
  let cursor = 0;

  while (cursor < text.length) {
    const nextMatch = findNextProtectedMarkdownSegment(text, cursor);
    if (!nextMatch) {
      segments.push({ type: 'text', value: text.slice(cursor) });
      break;
    }

    let matchStart = nextMatch.index;
    let matchValue = nextMatch.value;

    if ((matchValue[0] === ' ' || matchValue[0] === '(')) {
      const prefix = matchValue[0];
      if (matchStart >= cursor) {
        segments.push({ type: 'text', value: text.slice(cursor, matchStart + 1) });
      }
      matchStart += 1;
      matchValue = matchValue.slice(1);
    } else if (matchStart > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, matchStart) });
    }

    segments.push({ type: 'protected', value: matchValue });
    cursor = nextMatch.index + nextMatch.value.length;
  }

  return segments;
}

function autoFormatMarkdownLine(line) {
  if (!line) {
    return line;
  }

  return splitInlineCodeSegments(line)
    .map((segment) => {
      if (segment.type !== 'text') {
        return segment.value;
      }
      return splitProtectedMarkdownSegments(segment.value)
        .map((subsegment) => (subsegment.type === 'text' ? wrapMathRuns(subsegment.value) : subsegment.value))
        .join('');
    })
    .join('');
}

export function autoFormatMathMarkdown(text) {
  const lines = String(text || '').split('\n');
  const result = [];
  let activeFence = '';

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_START_PATTERN);

    if (activeFence) {
      result.push(line);
      if (fenceMatch && fenceMatch[2] === activeFence) {
        activeFence = '';
      }
      continue;
    }

    if (fenceMatch) {
      activeFence = fenceMatch[2];
      result.push(line);
      continue;
    }

    result.push(autoFormatMarkdownLine(line));
  }

  return result.join('\n');
}

export { normalizeMathExpression };
