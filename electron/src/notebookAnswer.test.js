import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_NOTEBOOK_CODE_LANGUAGE,
  NOTEBOOK_MODE_CODE,
  NOTEBOOK_MODE_MARKDOWN,
  createEmptyNotebookAnswer,
  hydrateNotebookAnswer,
  serializeNotebookAnswer,
} from './notebookAnswer.js';

test('serializes markdown notebook answers as raw markdown text', () => {
  const serialized = serializeNotebookAnswer({
    mode: NOTEBOOK_MODE_MARKDOWN,
    text: 'Hello **world**',
    language: 'python',
  });

  assert.equal(serialized, 'Hello **world**');
});

test('serializes code notebook answers as fenced blocks with the selected language', () => {
  const serialized = serializeNotebookAnswer({
    mode: NOTEBOOK_MODE_CODE,
    text: 'print("hi")',
    language: 'python',
  });

  assert.equal(serialized, '```python\nprint("hi")\n```');
});

test('hydrates a serialized code answer back into notebook state', () => {
  const hydrated = hydrateNotebookAnswer('```javascript\nconsole.log("hello");\n```');

  assert.deepEqual(hydrated, {
    mode: NOTEBOOK_MODE_CODE,
    text: 'console.log("hello");',
    language: 'javascript',
  });
});

test('hydrates legacy plain text answers into markdown mode', () => {
  const hydrated = hydrateNotebookAnswer('Average runtime is linear.');

  assert.deepEqual(hydrated, {
    mode: NOTEBOOK_MODE_MARKDOWN,
    text: 'Average runtime is linear.',
    language: DEFAULT_NOTEBOOK_CODE_LANGUAGE,
  });
});

test('falls back to markdown mode when fenced code is malformed', () => {
  const malformed = '```python\nprint("missing close fence")';
  const hydrated = hydrateNotebookAnswer(malformed);

  assert.deepEqual(hydrated, {
    mode: NOTEBOOK_MODE_MARKDOWN,
    text: malformed,
    language: DEFAULT_NOTEBOOK_CODE_LANGUAGE,
  });
});

test('returns an empty markdown notebook for blank input', () => {
  assert.deepEqual(hydrateNotebookAnswer('   '), createEmptyNotebookAnswer());
});
