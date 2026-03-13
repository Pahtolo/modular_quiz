import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import { historyField } from '@codemirror/commands';
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
const NOTEBOOK_EDITOR_STATE_FIELDS = {
  history: historyField,
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
  autoFormatMathEnabled = false,
  onAutoFormatMathToggle,
  themeMode = 'light',
}) {
  const notebook = normalizeNotebookAnswer(value);
  const [isCodeFullscreen, setIsCodeFullscreen] = useState(false);
  const codeEditorViewRef = useRef(null);
  const codeEditorStateRef = useRef(null);
  const shouldRestoreCodeEditorStateRef = useRef(false);
  const codeEditorViewportRef = useRef({ left: 0, top: 0, shouldRestore: false });
  const codeEditorFocusRef = useRef(false);
  const codeExtensions = useMemo(
    () => [
      ...codeLanguageExtension(notebook.language),
      ...vscodeCodeThemeExtension(themeMode),
    ],
    [notebook.language, themeMode],
  );

  useEffect(() => {
    if (notebook.mode === NOTEBOOK_MODE_CODE) {
      return;
    }
    setIsCodeFullscreen(false);
  }, [notebook.mode]);

  useEffect(() => {
    if (!isCodeFullscreen) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setCodeFullscreen(false);
      }
    }

    document.body.classList.add('short-answer-notebook-fullscreen-open');
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('short-answer-notebook-fullscreen-open');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCodeFullscreen]);

  function updateNotebook(nextPatch) {
    onChange({
      ...notebook,
      ...nextPatch,
    });
  }

  function captureCodeEditorState(view = codeEditorViewRef.current) {
    if (!view) {
      return;
    }
    codeEditorStateRef.current = view.state.toJSON(NOTEBOOK_EDITOR_STATE_FIELDS);
    codeEditorViewportRef.current = {
      left: view.scrollDOM.scrollLeft,
      top: view.scrollDOM.scrollTop,
      shouldRestore: codeEditorViewportRef.current.shouldRestore,
    };
    codeEditorFocusRef.current = view.hasFocus;
  }

  function restoreCodeEditorViewport(view) {
    if (!codeEditorViewportRef.current.shouldRestore) {
      return;
    }
    const { left, top } = codeEditorViewportRef.current;
    requestAnimationFrame(() => {
      view.scrollDOM.scrollLeft = left;
      view.scrollDOM.scrollTop = top;
      if (codeEditorFocusRef.current && !disabled) {
        view.focus();
      }
      codeEditorViewportRef.current.shouldRestore = false;
      shouldRestoreCodeEditorStateRef.current = false;
    });
  }

  function setCodeFullscreen(nextValue) {
    captureCodeEditorState();
    shouldRestoreCodeEditorStateRef.current = true;
    codeEditorViewportRef.current = {
      ...codeEditorViewportRef.current,
      shouldRestore: true,
    };
    setIsCodeFullscreen(nextValue);
  }

  function renderLanguagePicker() {
    return (
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
    );
  }

  function renderCodeEditor(height) {
    return (
      <CodeMirror
        value={notebook.text}
        height={height}
        editable={!disabled}
        basicSetup={NOTEBOOK_EDITOR_BASIC_SETUP}
        extensions={codeExtensions}
        initialState={shouldRestoreCodeEditorStateRef.current && codeEditorStateRef.current
          ? {
            json: codeEditorStateRef.current,
            fields: NOTEBOOK_EDITOR_STATE_FIELDS,
          }
          : undefined}
        onChange={(nextValue) => updateNotebook({ text: nextValue })}
        onCreateEditor={(view) => {
          codeEditorViewRef.current = view;
          restoreCodeEditorViewport(view);
          if (!codeEditorViewportRef.current.shouldRestore) {
            shouldRestoreCodeEditorStateRef.current = false;
          }
        }}
        onUpdate={(viewUpdate) => captureCodeEditorState(viewUpdate.view)}
        placeholder="Write your answer as code"
      />
    );
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
          <div className="short-answer-notebook-code-actions">
            {renderLanguagePicker()}
            <button
              type="button"
              className={`secondary short-answer-notebook-fullscreen-toggle ${isCodeFullscreen ? 'active' : ''}`}
              onClick={() => setCodeFullscreen(!isCodeFullscreen)}
            >
              {isCodeFullscreen ? 'Exit Full Screen' : 'Full Screen'}
            </button>
          </div>
        ) : (
          <div className="short-answer-notebook-markdown-actions">
            <button
              type="button"
              className={`secondary short-answer-notebook-preview-toggle ${autoFormatMathEnabled ? 'active' : ''}`}
              onClick={() => onAutoFormatMathToggle?.(!autoFormatMathEnabled)}
              aria-pressed={autoFormatMathEnabled}
            >
              KaTeX
            </button>
          </div>
        )}
      </div>

      <div className="short-answer-notebook-surface">
        {notebook.mode === NOTEBOOK_MODE_CODE ? (
          isCodeFullscreen ? (
            <div className="short-answer-notebook-fullscreen-placeholder">
              Code editor is open in full screen mode.
            </div>
          ) : (
            renderCodeEditor('220px')
          )
        ) : (
          <div className="short-answer-notebook-markdown-live">
            <textarea
              className="short-answer-notebook-textarea"
              value={notebook.text}
              onChange={(event) => updateNotebook({ text: event.target.value })}
              disabled={disabled}
              placeholder="Write your answer"
            />
            {autoFormatMathEnabled ? (
              <div className="short-answer-notebook-live-preview">
                <div className="short-answer-notebook-live-preview-label">Live Render</div>
                {notebook.text.trim() ? (
                  <div className="short-answer-notebook-preview">
                    <MarkdownMathText
                      className="math-text markdown-math-content"
                      text={notebook.text}
                      autoFormatMath={autoFormatMathEnabled}
                    />
                  </div>
                ) : (
                  <div className="short-answer-notebook-preview short-answer-notebook-preview-empty">
                    Math will render live as you type.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {notebook.mode === NOTEBOOK_MODE_CODE && isCodeFullscreen && typeof document !== 'undefined'
        ? createPortal(
          <div className="short-answer-notebook-fullscreen" role="dialog" aria-modal="true" aria-label="Full screen code editor">
            <div className="short-answer-notebook-fullscreen-shell">
              <div className="short-answer-notebook-fullscreen-header">
                <span className="short-answer-notebook-fullscreen-title">Code Answer Editor</span>
                <div className="short-answer-notebook-code-actions">
                  {renderLanguagePicker()}
                  <button
                    type="button"
                    className="secondary short-answer-notebook-fullscreen-toggle active"
                    onClick={() => setCodeFullscreen(false)}
                  >
                    Exit Full Screen
                  </button>
                </div>
              </div>
              <div className="short-answer-notebook-fullscreen-body">
                {renderCodeEditor('calc(100vh - 140px)')}
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
