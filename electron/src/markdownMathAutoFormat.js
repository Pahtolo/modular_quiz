const MATH_RUN_PATTERN = /(?:sqrt\([^()\n]+\)|\b(?:[A-Za-z][A-Za-z0-9_]*\([^)\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?|\([^()\n]+\))\s*(?:<=|>=|!=|=|<|>|\+|-|\*|\/|\^)\s*(?:[A-Za-z][A-Za-z0-9_]*\([^)\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?|\([^()\n]+\))(?:(?:\s*(?:<=|>=|!=|=|<|>|\+|-|\*|\/|\^)\s*(?:[A-Za-z][A-Za-z0-9_]*\([^)\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?|\([^()\n]+\))))*)/g;
const EXPLICIT_TEX_PATTERN = /(?:^|[^\\])(?:\$\$?[^$]+?\$\$?|\\\(|\\\[)/;
const FENCE_START_PATTERN = /^(\s*)(`{3,}|~{3,})/;
const COMMON_TEX_FUNCTIONS = ['sin', 'cos', 'tan', 'log', 'ln', 'max', 'min'];

function isBoundaryCharacter(character) {
  return !character || /[\s()[\]{}.,;:!?'"`~-]/.test(character);
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
    normalized = normalized.replace(pattern, `\\\\${functionName}(`);
  }

  normalized = normalized.replace(
    /(^|[^\\])(\([^()\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*\/\s*(\([^()\n]+\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?)/g,
    (match, prefix, numerator, denominator) => `${prefix}\\frac{${numerator}}{${denominator}}`,
  );

  return normalized.replace(/\s+/g, ' ').trim();
}

function shouldWrapMathRun(run, source, offset) {
  const previous = offset > 0 ? source[offset - 1] : '';
  const next = offset + run.length < source.length ? source[offset + run.length] : '';
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
  return /(?:sqrt\(|<=|>=|!=|=|<|>|\+|-|\*|\/|\^)/.test(trimmed);
}

function wrapMathRuns(text) {
  if (!text || EXPLICIT_TEX_PATTERN.test(text)) {
    return text;
  }

  return text.replace(MATH_RUN_PATTERN, (run, offset, source) => {
    if (!shouldWrapMathRun(run, source, offset)) {
      return run;
    }
    return `$${normalizeMathExpression(run)}$`;
  });
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

function autoFormatMarkdownLine(line) {
  if (!line) {
    return line;
  }

  return splitInlineCodeSegments(line)
    .map((segment) => (segment.type === 'text' ? wrapMathRuns(segment.value) : segment.value))
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
