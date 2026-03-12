import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { csharp } from '@replit/codemirror-lang-csharp';

import MarkdownMathText from './MarkdownMathText';
import {
  DEFAULT_NOTEBOOK_CODE_LANGUAGE,
  NOTEBOOK_CODE_LANGUAGE_OPTIONS,
  NOTEBOOK_MODE_CODE,
  NOTEBOOK_MODE_MARKDOWN,
  normalizeNotebookAnswer,
} from './notebookAnswer';
import { vscodeCodeThemeExtension } from './vscodeCodeTheme';

const NOTEBOOK_EDITOR_BASIC_SETUP = {
  foldGutter: false,
  lineNumbers: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: true,
};

function codeLanguageExtension(language) {
  switch (language) {
    case 'python':
      return [python()];
    case 'javascript':
      return [javascript({ jsx: true })];
    case 'typescript':
      return [javascript({ jsx: true, typescript: true })];
    case 'java':
      return [java()];
    case 'cpp':
      return [cpp()];
    case 'csharp':
      return [csharp()];
    case 'html':
      return [html()];
    case 'css':
      return [css()];
    case 'sql':
      return [sql()];
    case 'bash':
      return [StreamLanguage.define(shell)];
    case 'json':
      return [json()];
    default:
      return [];
  }
}

export default function ShortAnswerNotebook({
  value,
  onChange,
  disabled = false,
  previewEnabled = false,
  onPreviewToggle,
  themeMode = 'light',
}) {
  const notebook = normalizeNotebookAnswer(value);
  const codeExtensions = useMemo(
    () => [
      ...codeLanguageExtension(notebook.language),
      ...vscodeCodeThemeExtension(themeMode),
    ],
    [notebook.language, themeMode],
  );

  function updateNotebook(nextPatch) {
    onChange({
      ...notebook,
      ...nextPatch,
    });
  }

  return (
    <div className="short-answer-notebook">
      <div className="short-answer-notebook-toolbar">
        <div className="short-answer-notebook-mode-group" role="tablist" aria-label="Short answer mode">
          <button
            type="button"
            className={notebook.mode === NOTEBOOK_MODE_MARKDOWN ? 'active' : ''}
            onClick={() => updateNotebook({ mode: NOTEBOOK_MODE_MARKDOWN })}
            disabled={disabled}
            aria-pressed={notebook.mode === NOTEBOOK_MODE_MARKDOWN}
          >
            Markdown
          </button>
          <button
            type="button"
            className={notebook.mode === NOTEBOOK_MODE_CODE ? 'active' : ''}
            onClick={() => updateNotebook({ mode: NOTEBOOK_MODE_CODE })}
            disabled={disabled}
            aria-pressed={notebook.mode === NOTEBOOK_MODE_CODE}
          >
            Code
          </button>
        </div>

        {notebook.mode === NOTEBOOK_MODE_CODE ? (
          <label className="short-answer-notebook-language">
            <span>Language</span>
            <select
              value={notebook.language}
              onChange={(event) => updateNotebook({ language: event.target.value || DEFAULT_NOTEBOOK_CODE_LANGUAGE })}
              disabled={disabled}
            >
              {NOTEBOOK_CODE_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <button
            type="button"
            className={`secondary short-answer-notebook-preview-toggle ${previewEnabled ? 'active' : ''}`}
            onClick={() => onPreviewToggle?.(!previewEnabled)}
            aria-pressed={previewEnabled}
          >
            {previewEnabled ? 'Show Editor' : 'Show Preview'}
          </button>
        )}
      </div>

      <div className="short-answer-notebook-surface">
        {notebook.mode === NOTEBOOK_MODE_CODE ? (
          <CodeMirror
            value={notebook.text}
            height="220px"
            editable={!disabled}
            basicSetup={NOTEBOOK_EDITOR_BASIC_SETUP}
            extensions={codeExtensions}
            onChange={(nextValue) => updateNotebook({ text: nextValue })}
            placeholder="Write your answer as code"
          />
        ) : previewEnabled ? (
          notebook.text.trim() ? (
            <div className="short-answer-notebook-preview">
              <MarkdownMathText className="math-text markdown-math-content" text={notebook.text} />
            </div>
          ) : (
            <div className="short-answer-notebook-preview short-answer-notebook-preview-empty">
              Nothing to preview yet.
            </div>
          )
        ) : (
          <textarea
            className="short-answer-notebook-textarea"
            value={notebook.text}
            onChange={(event) => updateNotebook({ text: event.target.value })}
            disabled={disabled}
            placeholder="Write your answer"
          />
        )}
      </div>
    </div>
  );
}
