export const NOTEBOOK_MODE_MARKDOWN = 'markdown';
export const NOTEBOOK_MODE_CODE = 'code';
export const DEFAULT_NOTEBOOK_CODE_LANGUAGE = 'plaintext';

export const NOTEBOOK_CODE_LANGUAGE_OPTIONS = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
];

const NOTEBOOK_CODE_LANGUAGE_SET = new Set(
  NOTEBOOK_CODE_LANGUAGE_OPTIONS.map((option) => option.value),
);

const SERIALIZED_CODE_BLOCK_PATTERN = /^(`{3,}|~{3,})([A-Za-z0-9#+._-]*)[ \t]*\n([\s\S]*?)\n\1$/;

function notebookFenceForText(text) {
  const matches = String(text || '').match(/`+/g) || [];
  const longestRun = matches.reduce((maxRun, entry) => Math.max(maxRun, entry.length), 0);
  return '`'.repeat(Math.max(3, longestRun + 1));
}

export function normalizeNotebookCodeLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (NOTEBOOK_CODE_LANGUAGE_SET.has(normalized)) {
    return normalized;
  }
  return DEFAULT_NOTEBOOK_CODE_LANGUAGE;
}

export function createEmptyNotebookAnswer() {
  return {
    mode: NOTEBOOK_MODE_MARKDOWN,
    text: '',
    language: DEFAULT_NOTEBOOK_CODE_LANGUAGE,
  };
}

export function normalizeNotebookAnswer(value) {
  if (!value || typeof value !== 'object') {
    return createEmptyNotebookAnswer();
  }
  const mode = String(value.mode || '').trim().toLowerCase() === NOTEBOOK_MODE_CODE
    ? NOTEBOOK_MODE_CODE
    : NOTEBOOK_MODE_MARKDOWN;
  return {
    mode,
    text: String(value.text || ''),
    language: normalizeNotebookCodeLanguage(value.language),
  };
}

export function serializeNotebookAnswer(value) {
  const notebook = normalizeNotebookAnswer(value);
  const text = String(notebook.text || '').replace(/\r\n/g, '\n');
  if (!text) {
    return '';
  }
  if (notebook.mode !== NOTEBOOK_MODE_CODE) {
    return text;
  }
  const language = normalizeNotebookCodeLanguage(notebook.language);
  const fenceLanguage = language === DEFAULT_NOTEBOOK_CODE_LANGUAGE ? '' : language;
  const fence = notebookFenceForText(text);
  return `${fence}${fenceLanguage}\n${text}\n${fence}`;
}

export function hydrateNotebookAnswer(value) {
  const raw = String(value ?? '');
  const normalized = raw.replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) {
    return createEmptyNotebookAnswer();
  }
  const codeMatch = trimmed.match(SERIALIZED_CODE_BLOCK_PATTERN);
  if (codeMatch) {
    return {
      mode: NOTEBOOK_MODE_CODE,
      text: codeMatch[3],
      language: normalizeNotebookCodeLanguage(codeMatch[2]),
    };
  }
  return {
    mode: NOTEBOOK_MODE_MARKDOWN,
    text: raw,
    language: DEFAULT_NOTEBOOK_CODE_LANGUAGE,
  };
}
