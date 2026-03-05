import React, { useEffect, useMemo, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import { apiRequest, backendInfo, openPath, pickFiles, pickFolder } from './api';

const TABS = ['quiz', 'generate', 'performance', 'settings'];
const THEME_STORAGE_KEY = 'modular-quiz-theme';
const KATEX_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true },
];

function MathText({ as = 'span', className, text }) {
  const ref = useRef(null);
  const Element = as;

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    renderMathInElement(ref.current, {
      delimiters: KATEX_DELIMITERS,
      throwOnError: false,
    });
  }, [text]);

  return <Element ref={ref} className={className}>{text || ''}</Element>;
}

function providerAndModelFromKey(modelKey) {
  if (!modelKey || !modelKey.includes(':')) {
    return { provider: 'self', model: '' };
  }
  const [provider, model] = modelKey.split(':', 2);
  if (!['self', 'claude', 'openai'].includes(provider)) {
    return { provider: 'self', model: '' };
  }
  return { provider, model };
}

function modelKey(provider, model) {
  return `${provider}:${model || ''}`;
}

function flattenQuizNodes(nodes, out = []) {
  for (const node of nodes || []) {
    if (node.kind === 'quiz') {
      out.push(node.path);
    }
    flattenQuizNodes(node.children || [], out);
  }
  return out;
}

function countQuizFiles(nodes) {
  let total = 0;
  for (const node of nodes || []) {
    if (node.kind === 'quiz') {
      total += 1;
    }
    total += countQuizFiles(node.children || []);
  }
  return total;
}

function shortPathLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

function omitManagedQuizzesRoot(nodes) {
  const output = [];
  for (const node of nodes || []) {
    const label = shortPathLabel(node?.path || node?.name).toLowerCase();
    if (node?.kind === 'root' && label === 'quizzes') {
      output.push(...(node.children || []));
      continue;
    }
    output.push(node);
  }
  return output;
}

function findQuizNodeByPath(nodes, targetPath) {
  if (!targetPath) {
    return null;
  }
  for (const node of nodes || []) {
    if (node?.kind === 'quiz' && node?.path === targetPath) {
      return node;
    }
    const found = findQuizNodeByPath(node?.children || [], targetPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function filterQuizNodes(nodes, queryText) {
  const query = String(queryText || '').trim().toLowerCase();
  if (!query) {
    return nodes || [];
  }

  const output = [];
  for (const node of nodes || []) {
    const filteredChildren = filterQuizNodes(node.children || [], query);
    const haystack = `${node?.name || ''} ${node?.file_name || ''} ${node?.path || ''}`.toLowerCase();
    if (haystack.includes(query) || filteredChildren.length) {
      output.push({
        ...node,
        children: filteredChildren,
      });
    }
  }
  return output;
}

function sortQuizNodes(nodes, sortMode) {
  const sortedChildren = (nodes || []).map((node) => ({
    ...node,
    children: sortQuizNodes(node.children || [], sortMode),
  }));

  const compare = (left, right) => {
    const leftIsQuiz = left?.kind === 'quiz';
    const rightIsQuiz = right?.kind === 'quiz';
    if (leftIsQuiz !== rightIsQuiz) {
      return leftIsQuiz ? 1 : -1;
    }

    const leftTitle = String(left?.name || shortPathLabel(left?.path || '')).toLowerCase();
    const rightTitle = String(right?.name || shortPathLabel(right?.path || '')).toLowerCase();
    const leftPath = String(left?.path || '').toLowerCase();
    const rightPath = String(right?.path || '').toLowerCase();

    if (sortMode === 'title_desc') {
      const titleCompare = rightTitle.localeCompare(leftTitle);
      if (titleCompare !== 0) {
        return titleCompare;
      }
      return rightPath.localeCompare(leftPath);
    }

    if (sortMode === 'path_asc') {
      const pathCompare = leftPath.localeCompare(rightPath);
      if (pathCompare !== 0) {
        return pathCompare;
      }
      return leftTitle.localeCompare(rightTitle);
    }

    const titleCompare = leftTitle.localeCompare(rightTitle);
    if (titleCompare !== 0) {
      return titleCompare;
    }
    return leftPath.localeCompare(rightPath);
  };

  sortedChildren.sort(compare);
  return sortedChildren;
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ancestorPathsForTarget(nodes, targetPath, trail = []) {
  for (const node of nodes || []) {
    const nextTrail = [...trail, node.path];
    if (node?.path === targetPath) {
      return trail;
    }
    const nested = ancestorPathsForTarget(node?.children || [], targetPath, nextTrail);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function QuizTree({ nodes, selectedPath, onSelect, onRename }) {
  const [collapsedPaths, setCollapsedPaths] = useState({});
  const rightClickRenameHandledRef = useRef(false);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    const ancestors = ancestorPathsForTarget(nodes, selectedPath);
    if (!ancestors || !ancestors.length) {
      return;
    }
    setCollapsedPaths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const path of ancestors) {
        if (next[path]) {
          next[path] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [nodes, selectedPath]);

  const toggleCollapsed = (path) => {
    setCollapsedPaths((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  };

  const nodeLabel = (node) => {
    if (node.kind === 'root') {
      return shortPathLabel(node.path || node.name) || 'Quizzes';
    }
    return node.name || shortPathLabel(node.path) || '';
  };

  const triggerRename = (event, node) => {
    const isQuiz = node?.kind === 'quiz';
    if (!isQuiz || typeof onRename !== 'function') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    rightClickRenameHandledRef.current = true;
    onRename(node.path, nodeLabel(node));
    window.setTimeout(() => {
      rightClickRenameHandledRef.current = false;
    }, 0);
  };

  const renderNode = (node) => {
    const isQuiz = node.kind === 'quiz';
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const isCollapsible = !isQuiz && hasChildren;
    const isCollapsed = Boolean(collapsedPaths[node.path]);
    const nodeKindLabel = isQuiz ? 'FILE' : (node.kind === 'root' ? 'ROOT' : 'FOLDER');
    return (
      <li key={`${node.kind}-${node.path}`}>
        <div className="tree-row">
          {isCollapsible ? (
            <button
              type="button"
              className="tree-toggle"
              onClick={() => toggleCollapsed(node.path)}
              aria-label={isCollapsed ? 'Expand folder' : 'Collapse folder'}
              title={isCollapsed ? 'Expand folder' : 'Collapse folder'}
            >
              {isCollapsed ? '+' : '-'}
            </button>
          ) : (
            <span className="tree-toggle-spacer" />
          )}
          <button
            className={`tree-node ${isQuiz ? 'quiz' : 'group'} ${selectedPath === node.path ? 'selected' : ''}`}
            type="button"
            onClick={() => {
              if (isQuiz) {
                onSelect(node.path);
                return;
              }
              if (isCollapsible) {
                toggleCollapsed(node.path);
              }
            }}
            onContextMenu={(event) => {
              if (rightClickRenameHandledRef.current) {
                rightClickRenameHandledRef.current = false;
                return;
              }
              triggerRename(event, node);
            }}
            onMouseDown={(event) => {
              if (event.button !== 2) {
                return;
              }
              triggerRename(event, node);
            }}
          >
            <span className={`tree-node-kind ${isQuiz ? 'quiz' : 'group'}`}>{nodeKindLabel}</span>
            <span className="tree-node-name">{nodeLabel(node)}</span>
          </button>
        </div>
        {hasChildren && !isCollapsed ? (
          <ul className="tree-list">
            {node.children.map((child) => renderNode(child))}
          </ul>
        ) : null}
      </li>
    );
  };

  return <ul className="tree-list">{(nodes || []).map((node) => renderNode(node))}</ul>;
}

function QuizzesStructureTree({ nodes }) {
  const renderNode = (node) => (
    <li key={`${node.kind}-${node.path}`}>
      <div className={`quizzes-node ${node.kind}`}>
        {node.kind === 'folder' ? '[Folder]' : '[Quiz]'} {node.name}
      </div>
      {node.children && node.children.length > 0 ? (
        <ul className="quizzes-structure-list">
          {node.children.map((child) => renderNode(child))}
        </ul>
      ) : null}
    </li>
  );

  if (!(nodes || []).length) {
    return <p className="roots-empty">No quizzes imported yet.</p>;
  }

  return <ul className="quizzes-structure-list">{(nodes || []).map((node) => renderNode(node))}</ul>;
}

function App() {
  const [themeMode, setThemeMode] = useState(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (_err) {
      // Ignore storage/media failures and fall back to light mode.
    }
    return 'light';
  });
  const [activeTab, setActiveTab] = useState('quiz');
  const [startupError, setStartupError] = useState('');

  const [settings, setSettings] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [quizzesDir, setQuizzesDir] = useState('');
  const [quizzesTree, setQuizzesTree] = useState([]);
  const [quizzesWarnings, setQuizzesWarnings] = useState([]);
  const [showQuizzesBox, setShowQuizzesBox] = useState(true);
  const [quizzesDragOver, setQuizzesDragOver] = useState(false);

  const [providerModels, setProviderModels] = useState({ self: [], claude: [], openai: [] });
  const [modelLoadError, setModelLoadError] = useState('');

  const [quizTreeRoots, setQuizTreeRoots] = useState([]);
  const [selectedQuizPath, setSelectedQuizPath] = useState('');
  const [quizSearchText, setQuizSearchText] = useState('');
  const [quizSortMode, setQuizSortMode] = useState('title_asc');
  const [renamingQuiz, setRenamingQuiz] = useState(false);
  const [renameDialog, setRenameDialog] = useState({
    open: false,
    path: '',
    currentTitle: '',
    nextTitle: '',
  });
  const [quizLoadError, setQuizLoadError] = useState('');
  const [quiz, setQuiz] = useState(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizStartedAt, setQuizStartedAt] = useState(0);
  const [quizSaved, setQuizSaved] = useState(false);
  const [questionResult, setQuestionResult] = useState(null);
  const [questionLocked, setQuestionLocked] = useState(false);
  const [mcqAnswer, setMcqAnswer] = useState('');
  const [shortAnswer, setShortAnswer] = useState('');
  const [selfScore, setSelfScore] = useState('');
  const [quizNotes, setQuizNotes] = useState([]);
  const [attemptQuestions, setAttemptQuestions] = useState([]);
  const [questionStates, setQuestionStates] = useState({});
  const [questionTimeLeftMs, setQuestionTimeLeftMs] = useState(0);
  const autoAdvanceTimeoutRef = useRef(null);
  const questionTimerIntervalRef = useRef(null);
  const questionStatesRef = useRef({});
  const mcqAnswerRef = useRef('');
  const shortAnswerRef = useRef('');
  const selfScoreRef = useRef('');

  const [sourceInputs, setSourceInputs] = useState([]);
  const [collectedSources, setCollectedSources] = useState([]);
  const [generateWarnings, setGenerateWarnings] = useState([]);
  const [generateErrors, setGenerateErrors] = useState([]);
  const [generateOutputPath, setGenerateOutputPath] = useState('');
  const [generationForm, setGenerationForm] = useState({
    provider: 'claude',
    model: '',
    total: 20,
    mcq_count: 15,
    short_count: 5,
    mcq_options: 4,
    title_hint: '',
    instructions_hint: '',
  });

  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyFilterPath, setHistoryFilterPath] = useState('');
  const [selectedAttemptIndex, setSelectedAttemptIndex] = useState(-1);

  const combinedModelOptions = useMemo(() => {
    const options = [{ key: 'self:', label: 'No model', provider: 'self' }];
    for (const model of providerModels.claude || []) {
      options.push({ key: modelKey('claude', model.id), label: `Claude: ${model.label}`, provider: 'claude' });
    }
    for (const model of providerModels.openai || []) {
      options.push({ key: modelKey('openai', model.id), label: `OpenAI: ${model.label}`, provider: 'openai' });
    }
    return options;
  }, [providerModels]);

  const currentQuestion = useMemo(() => {
    if (!quiz || !quiz.questions || quizIndex >= quiz.questions.length) {
      return null;
    }
    return quiz.questions[quizIndex];
  }, [quiz, quizIndex]);

  const selectedQuizNode = useMemo(
    () => findQuizNodeByPath(quizTreeRoots, selectedQuizPath),
    [quizTreeRoots, selectedQuizPath],
  );

  const visibleQuizTreeNodes = useMemo(() => {
    const baseNodes = omitManagedQuizzesRoot(quizTreeRoots);
    const filteredNodes = filterQuizNodes(baseNodes, quizSearchText);
    return sortQuizNodes(filteredNodes, quizSortMode);
  }, [quizTreeRoots, quizSearchText, quizSortMode]);

  const selectedQuizLabel = useMemo(() => {
    if (selectedQuizNode?.name) {
      return selectedQuizNode.name;
    }
    return shortPathLabel(selectedQuizPath) || 'None';
  }, [selectedQuizNode, selectedQuizPath]);

  const maxScore = useMemo(() => {
    if (!quiz || !quiz.questions) {
      return 0;
    }
    return quiz.questions.reduce((acc, q) => acc + Number(q.points || 0), 0);
  }, [quiz]);

  const lastAnsweredIndex = useMemo(() => {
    let maxIndex = -1;
    for (const key of Object.keys(questionStates || {})) {
      const index = Number(key);
      if (!Number.isNaN(index) && index > maxIndex) {
        maxIndex = index;
      }
    }
    return maxIndex;
  }, [questionStates]);

  const furthestReachableIndex = useMemo(() => {
    if (!quiz || !quiz.questions?.length) {
      return 0;
    }
    return Math.min(lastAnsweredIndex + 1, quiz.questions.length - 1);
  }, [quiz, lastAnsweredIndex]);

  const canGoPrevQuestion = useMemo(() => {
    if (!quiz || !quiz.questions?.length || quizIndex <= 0) {
      return false;
    }
    return Boolean(questionStates[quizIndex - 1]);
  }, [quiz, quizIndex, questionStates]);

  const canGoForwardQuestion = useMemo(() => {
    if (!quiz || !quiz.questions?.length) {
      return false;
    }
    return quizIndex < furthestReachableIndex;
  }, [quiz, quizIndex, furthestReachableIndex]);

  const feedbackMode = settingsForm?.feedback_mode || settings?.feedback_mode || 'show_then_next';
  const showFeedbackOnAnswer = settingsForm?.show_feedback_on_answer ?? settings?.show_feedback_on_answer ?? feedbackMode !== 'end_only';
  const showFeedbackOnCompletion = settingsForm?.show_feedback_on_completion ?? settings?.show_feedback_on_completion ?? true;
  const autoAdvanceEnabled = settingsForm?.auto_advance_enabled ?? settings?.auto_advance_enabled ?? feedbackMode === 'auto_advance';
  const autoAdvanceDelayMs = Math.max(
    0,
    Number(settingsForm?.auto_advance_ms ?? settings?.auto_advance_ms ?? 0) || 0,
  );
  const questionTimerSeconds = Math.max(
    0,
    Number(settingsForm?.question_timer_seconds ?? settings?.question_timer_seconds ?? 0) || 0,
  );
  const showQuestionTimer = Boolean(
    activeTab === 'quiz' && quiz && currentQuestion && !questionLocked && questionTimerSeconds > 0,
  );

  const historyFiltered = useMemo(() => {
    if (!historyFilterPath) {
      return historyRecords;
    }
    return historyRecords.filter((record) => record.quiz_path === historyFilterPath);
  }, [historyFilterPath, historyRecords]);

  const selectedAttempt = useMemo(() => {
    if (selectedAttemptIndex < 0 || selectedAttemptIndex >= historyFiltered.length) {
      return null;
    }
    return historyFiltered[selectedAttemptIndex];
  }, [selectedAttemptIndex, historyFiltered]);

  const generationProviderModels = useMemo(() => {
    if (generationForm.provider === 'openai') {
      return providerModels.openai || [];
    }
    return providerModels.claude || [];
  }, [generationForm.provider, providerModels]);

  const settingsSearchQuery = (settingsSearch || '').trim().toLowerCase();

  function settingsMatches(...terms) {
    if (!settingsSearchQuery) {
      return true;
    }
    return terms.some((term) => String(term || '').toLowerCase().includes(settingsSearchQuery));
  }

  function feedbackModeFromFlags(showOnAnswer, autoAdvanceOn) {
    if (!showOnAnswer) {
      return 'end_only';
    }
    if (autoAdvanceOn) {
      return 'auto_advance';
    }
    return 'show_then_next';
  }

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (activeTab !== 'quiz') {
      return undefined;
    }

    const refreshQuizTree = async () => {
      try {
        await loadQuizTree();
      } catch (_err) {
        // Polling should be best-effort and not interrupt quiz flow.
      }
    };

    void refreshQuizTree();

    const timerId = window.setInterval(() => {
      void refreshQuizTree();
    }, 10000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [activeTab, selectedQuizPath]);

  useEffect(() => {
    if (!settingsForm || combinedModelOptions.length === 0) {
      return;
    }
    const exists = combinedModelOptions.some((option) => option.key === settingsForm.preferred_model_key);
    if (!exists) {
      setSettingsForm((prev) => ({
        ...prev,
        preferred_model_key: combinedModelOptions[0].key,
      }));
    }
  }, [combinedModelOptions, settingsForm]);

  useEffect(() => {
    if (!quiz || !quiz.questions?.length) {
      return;
    }
    const state = questionStates[quizIndex];
    if (state) {
      setQuestionResult(state.result || null);
      setQuestionLocked(true);
      setMcqAnswer(state.mcq_answer || '');
      setShortAnswer(state.short_answer || '');
      setSelfScore(state.self_score || '');
      return;
    }
    setQuestionResult(null);
    setQuestionLocked(false);
    setMcqAnswer('');
    setShortAnswer('');
    setSelfScore('');
  }, [quiz, quizIndex, questionStates]);

  useEffect(() => {
    questionStatesRef.current = questionStates || {};
  }, [questionStates]);

  useEffect(() => {
    mcqAnswerRef.current = mcqAnswer;
  }, [mcqAnswer]);

  useEffect(() => {
    shortAnswerRef.current = shortAnswer;
  }, [shortAnswer]);

  useEffect(() => {
    selfScoreRef.current = selfScore;
  }, [selfScore]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', themeMode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch (_err) {
      // Ignore storage write failures.
    }
  }, [themeMode]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (activeTab !== 'quiz' || !quiz || !currentQuestion || isEditableTarget(event.target)) {
        return;
      }
      if (event.key === 'ArrowLeft' && canGoPrevQuestion) {
        event.preventDefault();
        setQuizIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === 'ArrowRight' && canGoForwardQuestion) {
        event.preventDefault();
        setQuizIndex((prev) => Math.min(prev + 1, furthestReachableIndex));
        return;
      }
      if (event.key !== 'Enter') {
        return;
      }
      if (questionLocked) {
        event.preventDefault();
        void goToNextQuestion();
        return;
      }
      if (canGoForwardQuestion) {
        event.preventDefault();
        setQuizIndex((prev) => Math.min(prev + 1, furthestReachableIndex));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTab,
    quiz,
    currentQuestion,
    canGoPrevQuestion,
    canGoForwardQuestion,
    furthestReachableIndex,
    questionLocked,
  ]);

  useEffect(() => {
    if (autoAdvanceTimeoutRef.current) {
      window.clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }

    if (activeTab !== 'quiz' || !quiz || !currentQuestion || !questionLocked || !questionResult) {
      return;
    }
    if (!autoAdvanceEnabled) {
      return;
    }

    const state = questionStates[quizIndex];
    if (!state || state.result !== questionResult) {
      return;
    }

    autoAdvanceTimeoutRef.current = window.setTimeout(() => {
      void goToNextQuestion();
    }, autoAdvanceDelayMs);

    return () => {
      if (autoAdvanceTimeoutRef.current) {
        window.clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = null;
      }
    };
  }, [
    activeTab,
    quiz,
    currentQuestion,
    questionLocked,
    questionResult,
    autoAdvanceEnabled,
    autoAdvanceDelayMs,
    questionStates,
    quizIndex,
  ]);

  useEffect(() => {
    if (questionTimerIntervalRef.current) {
      window.clearInterval(questionTimerIntervalRef.current);
      questionTimerIntervalRef.current = null;
    }

    if (activeTab !== 'quiz' || !quiz || !currentQuestion || questionLocked || questionTimerSeconds <= 0) {
      setQuestionTimeLeftMs(0);
      return;
    }

    const durationMs = questionTimerSeconds * 1000;
    const deadline = Date.now() + durationMs;
    setQuestionTimeLeftMs(durationMs);

    questionTimerIntervalRef.current = window.setInterval(() => {
      const remainingMs = Math.max(0, deadline - Date.now());
      setQuestionTimeLeftMs(remainingMs);
      if (remainingMs > 0) {
        return;
      }
      if (questionTimerIntervalRef.current) {
        window.clearInterval(questionTimerIntervalRef.current);
        questionTimerIntervalRef.current = null;
      }

      const timeoutResult = {
        correct: false,
        points_awarded: 0,
        max_points: Number(currentQuestion.points || 0),
        feedback: 'Time expired.',
      };
      const timedAnswer = currentQuestion.type === 'short' ? shortAnswerRef.current : (mcqAnswerRef.current || '');
      const expectedText = currentQuestion.type === 'short' ? (currentQuestion.expected || '') : (currentQuestion.answer || '');
      lockQuestionAfterResult(timeoutResult, timedAnswer, expectedText);
    }, 200);

    return () => {
      if (questionTimerIntervalRef.current) {
        window.clearInterval(questionTimerIntervalRef.current);
        questionTimerIntervalRef.current = null;
      }
    };
  }, [activeTab, quiz, currentQuestion, quizIndex, questionLocked, questionTimerSeconds]);

  async function boot() {
    setStartupError('');

    try {
      const info = await backendInfo();
      if (!info.ready) {
        throw new Error('Backend is not ready.');
      }

      const settingsResponse = await apiRequest('/v1/settings', 'GET');
      const currentSettings = settingsResponse.settings;
      setSettings(currentSettings);
      setSettingsForm({ ...currentSettings });

      await Promise.all([loadModels(), loadHistory()]);
      await loadQuizzesLibrary();
      await loadQuizTree();

      setGenerationForm((prev) => ({
        ...prev,
        total: currentSettings.generation_defaults?.total || prev.total,
        mcq_count: currentSettings.generation_defaults?.mcq_count || prev.mcq_count,
        short_count: currentSettings.generation_defaults?.short_count || prev.short_count,
        mcq_options: currentSettings.generation_defaults?.mcq_options || prev.mcq_options,
      }));
    } catch (err) {
      setStartupError(err.message || 'Failed to start app.');
    }
  }

  async function loadModels() {
    setModelLoadError('');
    const next = {
      self: [{ id: '', label: 'No model', provider: 'self', capability_tags: [] }],
      claude: [],
      openai: [],
    };

    try {
      const claudeResponse = await apiRequest('/v1/models?provider=claude', 'GET');
      next.claude = claudeResponse.models || [];
    } catch (err) {
      setModelLoadError((prev) => `${prev}\nClaude models: ${err.message}`.trim());
    }

    try {
      const openaiResponse = await apiRequest('/v1/models?provider=openai', 'GET');
      next.openai = openaiResponse.models || [];
    } catch (err) {
      setModelLoadError((prev) => `${prev}\nOpenAI models: ${err.message}`.trim());
    }

    setProviderModels(next);

    setGenerationForm((prev) => {
      const modelOptions = prev.provider === 'openai' ? next.openai : next.claude;
      const fallback = modelOptions.length ? modelOptions[0].id : '';
      if (!prev.model || !modelOptions.some((m) => m.id === prev.model)) {
        return { ...prev, model: fallback };
      }
      return prev;
    });
  }

  async function loadQuizTree() {
    const response = await apiRequest('/v1/quizzes/tree', 'POST', {});
    setQuizTreeRoots(response.roots || []);

    const allQuizPaths = flattenQuizNodes(response.roots || []);
    if (selectedQuizPath && allQuizPaths.includes(selectedQuizPath)) {
      return;
    }
    setSelectedQuizPath(allQuizPaths[0] || '');
  }

  async function loadQuizzesLibrary() {
    const response = await apiRequest('/v1/quizzes/library', 'GET');
    setQuizzesDir(response.quizzes_dir || '');
    setQuizzesTree(response.tree || []);
    setQuizzesWarnings([]);
    if (response.settings) {
      setSettings(response.settings);
      setSettingsForm((prev) => (prev ? { ...prev, ...response.settings } : { ...response.settings }));
    }
    return response;
  }

  async function importQuizzesFromPaths(sourcePaths) {
    const paths = [...new Set((sourcePaths || []).map((item) => String(item || '').trim()).filter((item) => item))];
    if (!paths.length) {
      return;
    }

    const response = await apiRequest('/v1/quizzes/library/import', 'POST', {
      source_paths: paths,
    });
    setQuizzesDir(response.quizzes_dir || '');
    setQuizzesTree(response.tree || []);
    setQuizzesWarnings(response.warnings || []);
    if (response.settings) {
      setSettings(response.settings);
      setSettingsForm((prev) => (prev ? { ...prev, ...response.settings } : { ...response.settings }));
    }
    await loadQuizTree();
  }

  async function loadHistory() {
    const response = await apiRequest('/v1/history', 'GET');
    const records = response.records || [];
    setHistoryRecords(records);
    if (historyFilterPath && !records.some((record) => record.quiz_path === historyFilterPath)) {
      setHistoryFilterPath('');
    }
    setSelectedAttemptIndex(-1);
  }

  async function handleSaveSettings() {
    if (!settingsForm) {
      return false;
    }
    setSavingSettings(true);
    try {
      const payload = {
        ...settingsForm,
        quiz_roots: (settingsForm.quiz_roots || [])
          .map((item) => String(item).trim())
          .filter((item) => item),
        claude_models: (settingsForm.claude_models || [])
          .map((item) => String(item).trim())
          .filter((item) => item),
        openai_oauth_scopes: (settingsForm.openai_oauth_scopes || [])
          .map((item) => String(item).trim())
          .filter((item) => item),
        generation_defaults: {
          total: Number(settingsForm.generation_defaults?.total || 20),
          mcq_count: Number(settingsForm.generation_defaults?.mcq_count || 15),
          short_count: Number(settingsForm.generation_defaults?.short_count || 5),
          mcq_options: Number(settingsForm.generation_defaults?.mcq_options || 4),
        },
      };

      const response = await apiRequest('/v1/settings', 'PUT', payload);
      setSettings(response.settings);
      setSettingsForm({ ...response.settings });
      await Promise.all([loadHistory(), loadModels()]);
      await loadQuizzesLibrary();
      await loadQuizTree();
      return true;
    } catch (err) {
      setStartupError(`Failed to save settings: ${err.message}`);
      return false;
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleImportLegacy() {
    try {
      const response = await apiRequest('/v1/settings/import-legacy', 'POST', {
        overwrite_existing: false,
      });
      const settingsResponse = await apiRequest('/v1/settings', 'GET');
      setSettings(settingsResponse.settings);
      setSettingsForm({ ...settingsResponse.settings });
      await Promise.all([loadHistory(), loadModels()]);
      await loadQuizzesLibrary();
      await loadQuizTree();
    } catch (err) {
      setStartupError(`Legacy import failed: ${err.message}`);
    }
  }

  async function handleOpenAISignIn() {
    try {
      if (!(settingsForm?.openai_oauth_client_id || '').trim()) {
        setStartupError('OpenAI OAuth client ID is required. Add it in Settings, then try signing in again.');
        return;
      }
      if (settingsDirty) {
        const saved = await handleSaveSettings();
        if (!saved) {
          return;
        }
      }
      await apiRequest('/v1/oauth/openai/connect', 'POST', {});
      const settingsResponse = await apiRequest('/v1/settings', 'GET');
      setSettings(settingsResponse.settings);
      setSettingsForm({ ...settingsResponse.settings });
    } catch (err) {
      setStartupError(`OpenAI sign-in failed: ${err.message}`);
    }
  }

  async function handleTabChange(nextTab) {
    if (nextTab === activeTab) {
      return;
    }

    if (activeTab === 'settings' && nextTab !== 'settings' && settingsDirty) {
      const shouldSave = window.confirm('You have unsaved Settings changes. Save before leaving this tab?');
      if (shouldSave) {
        const saved = await handleSaveSettings();
        if (!saved) {
          return;
        }
      }
    }

    setActiveTab(nextTab);
  }

  async function importQuizzesFromFinder() {
    const folder = await pickFolder();
    if (!folder) {
      return;
    }
    try {
      await importQuizzesFromPaths([folder]);
    } catch (err) {
      setQuizzesWarnings([err.message || 'Failed to import selected folder.']);
    }
  }

  function droppedSourcePaths(event) {
    const files = Array.from(event?.dataTransfer?.files || []);
    return [...new Set(files
      .map((file) => (typeof file.path === 'string' ? file.path.trim() : ''))
      .filter((path) => path))];
  }

  async function handleQuizzesDrop(event) {
    event.preventDefault();
    setQuizzesDragOver(false);
    const paths = droppedSourcePaths(event);
    if (!paths.length) {
      setQuizzesWarnings(['Dropped content did not include local file paths. Use "Import Folder" instead.']);
      return;
    }
    try {
      await importQuizzesFromPaths(paths);
    } catch (err) {
      setQuizzesWarnings([err.message || 'Failed to import dropped items.']);
    }
  }

  async function renameQuizAtPath(pathValue, titleValue) {
    const targetPath = String(pathValue || '').trim();
    const nextTitle = String(titleValue || '').trim();
    if (!targetPath || !nextTitle) {
      return;
    }

    setRenamingQuiz(true);
    setQuizLoadError('');
    try {
      const response = await apiRequest('/v1/quizzes/library/rename', 'POST', {
        path: targetPath,
        title: nextTitle,
      });
      await Promise.all([loadQuizzesLibrary(), loadQuizTree()]);
      if (quiz && response.path === targetPath) {
        setQuiz((prev) => (prev ? { ...prev, title: response.title || nextTitle } : prev));
      }
      setRenameDialog((prev) => ({
        ...prev,
        open: false,
        path: '',
        currentTitle: '',
        nextTitle: '',
      }));
    } catch (err) {
      setQuizLoadError(err.message || 'Failed to rename quiz.');
    } finally {
      setRenamingQuiz(false);
    }
  }

  async function handleQuizContextRename(pathValue, currentTitle) {
    if (renamingQuiz) {
      return;
    }
    const targetPath = String(pathValue || '').trim();
    if (!targetPath) {
      return;
    }
    const baseTitle = String(currentTitle || '').trim() || shortPathLabel(targetPath);
    setRenameDialog({
      open: true,
      path: targetPath,
      currentTitle: baseTitle,
      nextTitle: baseTitle,
    });
  }

  function closeRenameDialog() {
    if (renamingQuiz) {
      return;
    }
    setRenameDialog({
      open: false,
      path: '',
      currentTitle: '',
      nextTitle: '',
    });
  }

  async function submitRenameDialog(event) {
    event.preventDefault();
    const targetPath = String(renameDialog.path || '').trim();
    const trimmed = String(renameDialog.nextTitle || '').trim();
    if (!targetPath) {
      return;
    }
    if (!trimmed) {
      setQuizLoadError('Quiz title cannot be empty.');
      return;
    }
    await renameQuizAtPath(targetPath, trimmed);
  }

  async function startSelectedQuiz() {
    if (!selectedQuizPath) {
      return;
    }

    setQuizLoadError('');
    try {
      const response = await apiRequest('/v1/quizzes/load', 'POST', { path: selectedQuizPath });
      const loadedQuiz = response.quiz;
      setQuiz(loadedQuiz);
      setQuizIndex(0);
      setQuizScore(0);
      setQuizStartedAt(Date.now());
      setQuestionResult(null);
      setQuestionLocked(false);
      setMcqAnswer('');
      setShortAnswer('');
      setSelfScore('');
      setQuizNotes([]);
      setAttemptQuestions([]);
      setQuestionStates({});
      setQuizSaved(false);
      setActiveTab('quiz');
    } catch (err) {
      setQuizLoadError(err.message);
    }
  }

  function lockQuestionAfterResult(result, userAnswer, expectedText) {
    if (!currentQuestion) {
      return;
    }
    if (questionStatesRef.current[quizIndex]) {
      return;
    }
    const record = {
      question_id: String(currentQuestion.id || `q${quizIndex + 1}`),
      question_type: currentQuestion.type,
      user_answer: userAnswer,
      correct_answer_or_expected: expectedText,
      points_awarded: Number(result.points_awarded || 0),
      max_points: Number(result.max_points || 0),
      feedback: result.feedback || '',
    };
    const isShort = currentQuestion.type === 'short';

    setQuestionStates((prev) => ({
      ...prev,
      [quizIndex]: {
        result,
        locked: true,
        mcq_answer: isShort ? '' : userAnswer,
        short_answer: isShort ? userAnswer : '',
        self_score: isShort ? String(selfScoreRef.current || '') : '',
      },
    }));

    setQuestionResult(result);
    setQuestionLocked(true);
    setQuizScore((prev) => prev + Number(result.points_awarded || 0));
    if (showFeedbackOnAnswer && result.feedback) {
      setQuizNotes((prev) => [...prev, result.feedback]);
    }
    setAttemptQuestions((prev) => {
      const next = [...prev];
      const index = next.findIndex((item) => item.question_id === record.question_id);
      if (index >= 0) {
        next[index] = record;
        return next;
      }
      return [...next, record];
    });
  }

  async function submitMcqAnswer(letter) {
    if (!currentQuestion || questionLocked) {
      return;
    }

    setMcqAnswer(letter);
    try {
      const response = await apiRequest('/v1/grade/mcq', 'POST', {
        question: currentQuestion,
        user_answer: letter,
      });
      lockQuestionAfterResult(response.result, letter, currentQuestion.answer || '');
    } catch (err) {
      setQuizLoadError(err.message);
    }
  }

  async function submitShortAnswer() {
    if (!currentQuestion || questionLocked) {
      return;
    }

    const modelKeyValue = (settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:').trim();
    const selected = providerAndModelFromKey(modelKeyValue);
    const body = {
      provider: selected.provider,
      model: selected.model,
      question: currentQuestion,
      user_answer: shortAnswer,
    };

    if (selected.provider === 'self') {
      body.self_score = Number(selfScore || 0);
    }

    try {
      const response = await apiRequest('/v1/grade/short', 'POST', body);
      lockQuestionAfterResult(response.result, shortAnswer, currentQuestion.expected || '');
    } catch (err) {
      setQuizLoadError(err.message);
    }
  }

  async function explainCurrentMcq() {
    if (!currentQuestion || currentQuestion.type !== 'mcq' || !questionResult) {
      return;
    }

    const modelKeyValue = (settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:').trim();
    const selected = providerAndModelFromKey(modelKeyValue);
    if (selected.provider === 'self') {
      setQuizLoadError('No model mode does not support MCQ explanation.');
      return;
    }

    try {
      const response = await apiRequest('/v1/explain/mcq', 'POST', {
        provider: selected.provider,
        model: selected.model,
        prompt: currentQuestion.prompt,
        options: currentQuestion.options,
        user_answer: mcqAnswer,
        correct_answer: currentQuestion.answer,
      });
      setQuizNotes((prev) => [...prev, response.text || 'No explanation returned.']);
    } catch (err) {
      setQuizLoadError(err.message);
    }
  }

  async function goToNextQuestion() {
    if (!quiz) {
      return;
    }

    const nextIndex = quizIndex + 1;
    if (nextIndex < quiz.questions.length) {
      setQuizIndex(nextIndex);
      return;
    }

    if (!quizSaved) {
      const durationSeconds = Math.max(0, (Date.now() - quizStartedAt) / 1000);
      const percent = maxScore ? (quizScore / maxScore) * 100 : 0;
      const modelKeyValue = settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:';

      try {
        await apiRequest('/v1/history/append', 'POST', {
          timestamp: new Date().toISOString(),
          quiz_path: selectedQuizPath,
          quiz_title: quiz.title,
          score: quizScore,
          max_score: maxScore,
          percent,
          duration_seconds: durationSeconds,
          model_key: modelKeyValue,
          questions: attemptQuestions,
        });
        setQuizSaved(true);
        await loadHistory();
      } catch (err) {
        setQuizLoadError(`Failed to save history: ${err.message}`);
      }
    }

    setQuestionResult({
      correct: false,
      points_awarded: quizScore,
      max_points: maxScore,
      feedback: showFeedbackOnCompletion ? 'Quiz finished.' : '',
    });
    setQuestionLocked(true);
  }

  function goToPreviousQuestion() {
    if (!canGoPrevQuestion) {
      return;
    }
    setQuizIndex((prev) => Math.max(prev - 1, 0));
  }

  function goToForwardQuestion() {
    if (!canGoForwardQuestion) {
      return;
    }
    setQuizIndex((prev) => Math.min(prev + 1, furthestReachableIndex));
  }

  function jumpToQuestion(targetIndex) {
    if (!quiz || !quiz.questions?.length) {
      return;
    }
    if (targetIndex < 0 || targetIndex > furthestReachableIndex) {
      return;
    }
    setQuizIndex(targetIndex);
  }

  function restartQuiz() {
    if (selectedQuizPath) {
      void startSelectedQuiz();
    }
  }

  async function addFilesToSources() {
    const files = await pickFiles();
    if (!files || !files.length) {
      return;
    }
    setSourceInputs((prev) => [...new Set([...prev, ...files])]);
  }

  async function addFolderToSources() {
    const folder = await pickFolder();
    if (!folder) {
      return;
    }
    setSourceInputs((prev) => [...new Set([...prev, folder])]);
  }

  async function collectSourcePaths() {
    if (!sourceInputs.length) {
      setGenerateErrors(['Add files or folders first.']);
      return [];
    }

    const response = await apiRequest('/v1/generate/collect-sources', 'POST', {
      paths: sourceInputs,
    });

    setCollectedSources(response.sources || []);
    setGenerateWarnings(response.warnings || []);
    setGenerateErrors([]);
    return response.sources || [];
  }

  async function runGeneration() {
    setGenerateErrors([]);
    setGenerateWarnings([]);
    setGenerateOutputPath('');

    try {
      let sources = collectedSources;
      if (!sources.length) {
        sources = await collectSourcePaths();
      }

      if (!sources.length) {
        setGenerateErrors(['No supported source files were collected.']);
        return;
      }

      const payload = {
        quiz_dir: settings?.quiz_dir,
        sources,
        provider: generationForm.provider,
        model: generationForm.model,
        total: Number(generationForm.total),
        mcq_count: Number(generationForm.mcq_count),
        short_count: Number(generationForm.short_count),
        mcq_options: Number(generationForm.mcq_options),
        title_hint: generationForm.title_hint,
        instructions_hint: generationForm.instructions_hint,
        output_subdir: settings?.generation_output_subdir || 'Generated',
      };

      const result = await apiRequest('/v1/generate/run', 'POST', payload);
      setGenerateWarnings(result.warnings || []);
      setGenerateErrors(result.errors || []);
      if (result.output_path) {
        setGenerateOutputPath(result.output_path);
      }
    } catch (err) {
      setGenerateErrors([err.message]);
    }
  }

  const selectedModelKey = settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:';
  const selectedProviderModel = providerAndModelFromKey(selectedModelKey);
  const quizComplete = Boolean(quiz && quizIndex >= quiz.questions.length - 1 && questionLocked && questionResult);
  const shouldShowQuestionFeedback = Boolean(questionResult && (!quizComplete ? showFeedbackOnAnswer : showFeedbackOnCompletion));
  const settingsFilterHasMatches = [
    settingsMatches('appearance', 'theme', 'dark mode', 'light mode'),
    settingsMatches('preferred model', 'model selection', 'grading model'),
    settingsMatches('feedback', 'show feedback on answer', 'show feedback on quiz completion'),
    settingsMatches('auto advance', 'auto-advance', 'auto advance delay', 'question delay'),
    settingsMatches('question timer', 'timer', 'countdown'),
    settingsMatches('mcq explanations', 'explanations', 'explain'),
    settingsMatches('quizzes', 'quiz folder', 'quiz library', 'import folder', 'open quizzes folder', 'drag and drop'),
    settingsMatches('claude api key', 'claude model selected', 'claude'),
    settingsMatches('openai auth mode', 'openai oauth client id', 'openai api key', 'openai model selected', 'openai'),
    settingsMatches('generation output subdir', 'output folder', 'generation'),
  ].some(Boolean);
  const settingsDirty = useMemo(() => {
    if (!settingsForm || !settings) {
      return false;
    }
    return JSON.stringify(settingsForm) !== JSON.stringify(settings);
  }, [settingsForm, settings]);
  const latestQuizNote = quizNotes.length ? quizNotes[quizNotes.length - 1] : '';

  return (
    <div className="app-root">
      {startupError ? <div className="banner error">{startupError}</div> : null}
      {modelLoadError ? <div className="banner warn">{modelLoadError}</div> : null}
      {renameDialog.open ? (
        <div className="rename-dialog-overlay" onClick={() => closeRenameDialog()}>
          <form
            className="card rename-dialog-card"
            onSubmit={(event) => {
              void submitRenameDialog(event);
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Rename Quiz</h3>
            <div className="rename-dialog-path">{shortPathLabel(renameDialog.path)}</div>
            <label className="field">
              <span>Title</span>
              <input
                autoFocus
                type="text"
                value={renameDialog.nextTitle}
                disabled={renamingQuiz}
                onChange={(event) =>
                  setRenameDialog((prev) => ({
                    ...prev,
                    nextTitle: event.target.value,
                  }))
                }
                placeholder="Quiz title"
              />
            </label>
            <div className="row rename-dialog-actions">
              <button type="button" onClick={() => closeRenameDialog()} disabled={renamingQuiz}>
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!String(renameDialog.nextTitle || '').trim() || renamingQuiz}
              >
                {renamingQuiz ? 'Renaming...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'active' : ''}
            onClick={() => {
              void handleTabChange(tab);
            }}
          >
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main className="tab-panel">
        {activeTab === 'quiz' ? (
          <section className="quiz-layout">
            <aside className="quiz-selector-column">
              <div className="card tree-card">
                <div className="row between">
                  <h2>Quizzes</h2>
                  <span className="quiz-tree-hint">Click folders to collapse. Right-click quizzes to rename.</span>
                </div>
                <div className="quiz-selector-controls">
                  <label className="field">
                    <span>Filter</span>
                    <input
                      type="text"
                      value={quizSearchText}
                      onChange={(event) => setQuizSearchText(event.target.value)}
                      placeholder="Search title, file, or path"
                    />
                  </label>
                  <label className="field">
                    <span>Sort</span>
                    <select value={quizSortMode} onChange={(event) => setQuizSortMode(event.target.value)}>
                      <option value="title_asc">Title (A-Z)</option>
                      <option value="title_desc">Title (Z-A)</option>
                      <option value="path_asc">Path (A-Z)</option>
                    </select>
                  </label>
                </div>
                <QuizTree
                  nodes={visibleQuizTreeNodes}
                  selectedPath={selectedQuizPath}
                  onSelect={setSelectedQuizPath}
                  onRename={(path, name) => {
                    void handleQuizContextRename(path, name);
                  }}
                />
                {!visibleQuizTreeNodes.length ? (
                  <p className="roots-empty">No quizzes match the current filter.</p>
                ) : null}
              </div>
              <button
                type="button"
                className="primary start-quiz-column-btn"
                disabled={!selectedQuizPath}
                onClick={() => startSelectedQuiz()}
              >
                Start Selected Quiz
              </button>
            </aside>

            <section className="card quiz-card">
              <div className="row between">
                <h2>{quiz ? quiz.title : 'Quiz'}</h2>
                <div className="score">{quiz ? `Score: ${quizScore}/${maxScore}` : 'No quiz loaded'}</div>
              </div>

              <div className="selected-quiz-label">
                <strong>Selected quiz:</strong> {selectedQuizLabel}
              </div>

              <label className="field">
                <span>Preferred model</span>
                <select
                  value={selectedModelKey}
                  onChange={(event) => {
                    const nextKey = event.target.value;
                    setSettingsForm((prev) => ({ ...prev, preferred_model_key: nextKey }));
                  }}
                >
                  {combinedModelOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {quizLoadError ? <div className="banner error">{quizLoadError}</div> : null}

              {quiz && currentQuestion ? (
                <div className="question-shell">
                  <div className="question-block">
                    <div className="row question-step-controls">
                      <button type="button" disabled={!canGoPrevQuestion} onClick={() => goToPreviousQuestion()}>
                        ← Previous
                      </button>
                      <button type="button" disabled={!canGoForwardQuestion} onClick={() => goToForwardQuestion()}>
                        Forward →
                      </button>
                      {showQuestionTimer ? (
                        <span className={`question-timer ${questionTimeLeftMs <= 5000 ? 'urgent' : ''}`}>
                          Time left: {formatCountdown(questionTimeLeftMs)}
                        </span>
                      ) : null}
                    </div>

                    <h3>
                      <span>Q{quizIndex + 1}. </span>
                      <MathText as="span" className="math-text" text={currentQuestion.prompt} />
                    </h3>

                    {currentQuestion.type === 'mcq' ? (
                      <div className="mcq-grid">
                        {currentQuestion.options.map((option, index) => {
                          const letter = String.fromCharCode(65 + index);
                          return (
                            <button
                              key={letter}
                              type="button"
                              disabled={questionLocked}
                              className={mcqAnswer === letter ? 'selected' : ''}
                              onClick={() => submitMcqAnswer(letter)}
                            >
                              <strong>{letter}.</strong> <MathText as="span" className="math-text" text={option} />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="short-block">
                        <textarea
                          value={shortAnswer}
                          onChange={(event) => setShortAnswer(event.target.value)}
                          disabled={questionLocked}
                          placeholder="Write your answer"
                        />

                        {selectedProviderModel.provider === 'self' ? (
                          <label className="field">
                            <span>Self-score (0 to {currentQuestion.points})</span>
                            <input
                              type="number"
                              min={0}
                              max={currentQuestion.points}
                              value={selfScore}
                              disabled={questionLocked}
                              onChange={(event) => setSelfScore(event.target.value)}
                            />
                          </label>
                        ) : null}

                        <button type="button" className="primary" disabled={questionLocked} onClick={() => submitShortAnswer()}>
                          Submit Answer
                        </button>
                      </div>
                    )}

                    {shouldShowQuestionFeedback ? (
                      <div className={`result ${questionResult.correct ? 'good' : 'bad'}`}>
                        <MathText as="span" className="math-text" text={questionResult.feedback} />
                      </div>
                    ) : null}

                    <div className="row">
                      {currentQuestion.type === 'mcq' && questionResult && selectedProviderModel.provider !== 'self' ? (
                        <button type="button" onClick={() => explainCurrentMcq()}>
                          Explain
                        </button>
                      ) : null}

                      {questionLocked ? (
                        <button type="button" className="primary" onClick={() => goToNextQuestion()}>
                          {quizComplete ? 'Finish Quiz' : 'Next'}
                        </button>
                      ) : null}

                      {quizComplete ? (
                        <button type="button" onClick={() => restartQuiz()}>
                          Restart Quiz
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <aside className="question-nav-column">
                    <h4>Question Nav</h4>
                    <div className="question-nav-list">
                      {quiz.questions.map((q, index) => {
                        const answered = Boolean(questionStates[index]);
                        const reachable = index <= furthestReachableIndex;
                        const current = index === quizIndex;
                        return (
                          <button
                            key={`qnav-${q.id || index}`}
                            type="button"
                            disabled={!reachable}
                            className={`question-nav-button${current ? ' current' : ''}${answered ? ' answered' : ''}`}
                            onClick={() => jumpToQuestion(index)}
                          >
                            <span>Q{index + 1}</span>
                            <span>{answered ? 'Done' : reachable ? 'Open' : 'Locked'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </aside>
                </div>
              ) : (
                <p>Select and start a quiz to begin.</p>
              )}

              {latestQuizNote ? (
                <div className="notes">
                  <h4>Latest Feedback</h4>
                  <MathText as="div" className="math-text" text={latestQuizNote} />
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {activeTab === 'generate' ? (
          <section className="generate-layout">
            <section className="card">
              <div className="row between">
                <h2>Sources</h2>
                <div className="row">
                  <button type="button" onClick={() => addFilesToSources()}>
                    Add Files
                  </button>
                  <button type="button" onClick={() => addFolderToSources()}>
                    Add Folder
                  </button>
                  <button type="button" onClick={() => setSourceInputs([])}>
                    Clear
                  </button>
                </div>
              </div>
              <ul className="source-list">
                {sourceInputs.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="row">
                <button type="button" onClick={() => collectSourcePaths()}>
                  Collect Supported Sources
                </button>
              </div>
            </section>

            <section className="card">
              <h2>Generation</h2>
              <div className="form-grid">
                <label className="field">
                  <span>Provider</span>
                  <select
                    value={generationForm.provider}
                    onChange={(event) => {
                      const provider = event.target.value;
                      const candidates = provider === 'openai' ? providerModels.openai : providerModels.claude;
                      setGenerationForm((prev) => ({
                        ...prev,
                        provider,
                        model: candidates.length ? candidates[0].id : '',
                      }));
                    }}
                  >
                    <option value="claude">Claude</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </label>

                <label className="field">
                  <span>Model</span>
                  <select
                    value={generationForm.model}
                    onChange={(event) => setGenerationForm((prev) => ({ ...prev, model: event.target.value }))}
                  >
                    {generationProviderModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Total</span>
                  <input
                    type="number"
                    value={generationForm.total}
                    onChange={(event) => setGenerationForm((prev) => ({ ...prev, total: Number(event.target.value) }))}
                  />
                </label>

                <label className="field">
                  <span>MCQ</span>
                  <input
                    type="number"
                    value={generationForm.mcq_count}
                    onChange={(event) => setGenerationForm((prev) => ({ ...prev, mcq_count: Number(event.target.value) }))}
                  />
                </label>

                <label className="field">
                  <span>Short</span>
                  <input
                    type="number"
                    value={generationForm.short_count}
                    onChange={(event) => setGenerationForm((prev) => ({ ...prev, short_count: Number(event.target.value) }))}
                  />
                </label>

                <label className="field">
                  <span>MCQ options</span>
                  <input
                    type="number"
                    value={generationForm.mcq_options}
                    onChange={(event) => setGenerationForm((prev) => ({ ...prev, mcq_options: Number(event.target.value) }))}
                  />
                </label>
              </div>

              <label className="field">
                <span>Title hint</span>
                <input
                  value={generationForm.title_hint}
                  onChange={(event) => setGenerationForm((prev) => ({ ...prev, title_hint: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Instructions hint</span>
                <input
                  value={generationForm.instructions_hint}
                  onChange={(event) => setGenerationForm((prev) => ({ ...prev, instructions_hint: event.target.value }))}
                />
              </label>

              <div className="row">
                <button type="button" className="primary" onClick={() => runGeneration()}>
                  Generate Quiz
                </button>
                {generateOutputPath ? (
                  <button type="button" onClick={() => openPath(generateOutputPath)}>
                    Open Output
                  </button>
                ) : null}
              </div>

              {generateWarnings.length ? (
                <div className="banner warn">
                  {generateWarnings.map((line, idx) => (
                    <div key={`gw-${idx}`}>{line}</div>
                  ))}
                </div>
              ) : null}

              {generateErrors.length ? (
                <div className="banner error">
                  {generateErrors.map((line, idx) => (
                    <div key={`ge-${idx}`}>{line}</div>
                  ))}
                </div>
              ) : null}

              {generateOutputPath ? <div className="banner success">Saved: {generateOutputPath}</div> : null}
            </section>
          </section>
        ) : null}

        {activeTab === 'performance' ? (
          <section className="card performance-layout">
            <div className="row between">
              <h2>Performance History</h2>
              <div className="row">
                <select
                  value={historyFilterPath}
                  onChange={(event) => {
                    setHistoryFilterPath(event.target.value);
                    setSelectedAttemptIndex(-1);
                  }}
                >
                  <option value="">(All quizzes)</option>
                  {[...new Set(historyRecords.map((record) => record.quiz_path).filter(Boolean))].map((path) => (
                    <option key={path} value={path}>
                      {path.split('/').slice(-1)[0]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => loadHistory()}>
                  Refresh
                </button>
              </div>
            </div>

            <div className="performance-grid">
              <ul className="attempt-list">
                {historyFiltered.map((record, index) => (
                  <li key={`${record.timestamp}-${index}`}>
                    <button
                      type="button"
                      className={selectedAttemptIndex === index ? 'selected' : ''}
                      onClick={() => setSelectedAttemptIndex(index)}
                    >
                      <strong>{record.quiz_title || record.quiz_path}</strong>
                      <span>{record.timestamp.replace('T', ' ')}</span>
                      <span>
                        {record.score}/{record.max_score} ({Number(record.percent || 0).toFixed(1)}%)
                      </span>
                      <span>{record.model_key}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="attempt-detail">
                {selectedAttempt ? (
                  <>
                    <h3>{selectedAttempt.quiz_title || selectedAttempt.quiz_path}</h3>
                    <p>
                      {selectedAttempt.score}/{selectedAttempt.max_score} - {Number(selectedAttempt.percent || 0).toFixed(1)}%
                    </p>
                    <p>Duration: {Number(selectedAttempt.duration_seconds || 0).toFixed(1)}s</p>
                    <table>
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>User</th>
                          <th>Expected</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedAttempt.questions || []).map((question, idx) => (
                          <tr key={`${question.question_id}-${idx}`}>
                            <td>{question.question_id}</td>
                            <td><MathText as="span" className="math-text" text={question.user_answer} /></td>
                            <td><MathText as="span" className="math-text" text={question.correct_answer_or_expected} /></td>
                            <td>
                              {question.points_awarded}/{question.max_points}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p>Select an attempt to inspect details.</p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'settings' && settingsForm ? (
          <section className="card settings-layout">
            <div className="row between">
              <h2>Settings</h2>
              <div className="row">
                <button type="button" onClick={() => handleImportLegacy()}>
                  Import Legacy
                </button>
                <button type="button" onClick={() => handleOpenAISignIn()}>
                  Sign in with OpenAI
                </button>
              </div>
            </div>

            <label className="field settings-search-field">
              <span>Search settings</span>
              <input
                value={settingsSearch}
                onChange={(event) => setSettingsSearch(event.target.value)}
                placeholder="Try: theme, feedback, auto-advance, OpenAI, quiz library"
              />
            </label>

            {settingsMatches('appearance', 'theme', 'dark mode', 'light mode') ? (
              <section className="settings-group">
                <h3>Appearance</h3>
                <div className="form-grid two-col">
                  <div className="field">
                    <span>Theme mode</span>
                    <button
                      type="button"
                      onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                    >
                      {themeMode === 'dark' ? 'Light mode' : 'Dark mode'}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            <div className="form-grid two-col">
              {settingsMatches('preferred model', 'model selection', 'grading model') ? (
                <label className="field">
                  <span>Preferred model</span>
                  <select
                    value={settingsForm.preferred_model_key || 'self:'}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, preferred_model_key: event.target.value }))
                    }
                  >
                    {combinedModelOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {settingsMatches('mcq explanations', 'explanations', 'explain') ? (
                <label className="field checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(settingsForm.mcq_explanations_enabled)}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, mcq_explanations_enabled: event.target.checked }))
                    }
                  />
                  <span>Enable MCQ explanations</span>
                </label>
              ) : null}
            </div>

            {settingsMatches('feedback', 'show feedback on answer', 'show feedback on quiz completion') ? (
              <section className="settings-group">
                <h3>Feedback</h3>
                <div className="form-grid two-col">
                  <label className="field checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(showFeedbackOnAnswer)}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setSettingsForm((prev) => {
                          if (!prev) {
                            return prev;
                          }
                          const nextAutoAdvance = prev.auto_advance_enabled ?? prev.feedback_mode === 'auto_advance';
                          return {
                            ...prev,
                            show_feedback_on_answer: enabled,
                            feedback_mode: feedbackModeFromFlags(enabled, nextAutoAdvance),
                          };
                        });
                      }}
                    />
                    <span>Show feedback on answer</span>
                  </label>

                  <label className="field checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(showFeedbackOnCompletion)}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({ ...prev, show_feedback_on_completion: event.target.checked }))
                      }
                    />
                    <span>Show feedback on quiz completion</span>
                  </label>
                </div>
              </section>
            ) : null}

            {(settingsMatches('auto advance', 'auto-advance', 'delay', 'next question')
              || settingsMatches('question timer', 'timer', 'countdown')) ? (
                <section className="settings-group">
                  <h3>Pacing</h3>
                  <div className="form-grid two-col">
                    {settingsMatches('auto advance', 'auto-advance', 'delay', 'next question') ? (
                      <>
                        <label className="field checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(autoAdvanceEnabled)}
                            onChange={(event) => {
                              const enabled = event.target.checked;
                              setSettingsForm((prev) => {
                                if (!prev) {
                                  return prev;
                                }
                                const nextShowFeedback = prev.show_feedback_on_answer ?? prev.feedback_mode !== 'end_only';
                                return {
                                  ...prev,
                                  auto_advance_enabled: enabled,
                                  feedback_mode: feedbackModeFromFlags(nextShowFeedback, enabled),
                                };
                              });
                            }}
                          />
                          <span>Enable auto-advance after answer</span>
                        </label>

                        <label className="field">
                          <span>Auto-advance delay (ms)</span>
                          <input
                            type="number"
                            min={0}
                            value={settingsForm.auto_advance_ms || 0}
                            disabled={!autoAdvanceEnabled}
                            onChange={(event) =>
                              setSettingsForm((prev) => ({ ...prev, auto_advance_ms: Number(event.target.value) }))
                            }
                          />
                        </label>
                      </>
                    ) : null}

                    {settingsMatches('question timer', 'timer', 'countdown') ? (
                      <label className="field">
                        <span>Question timer (seconds, 0 = off)</span>
                        <input
                          type="number"
                          min={0}
                          value={settingsForm.question_timer_seconds || 0}
                          onChange={(event) =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              question_timer_seconds: Math.max(0, Number(event.target.value) || 0),
                            }))
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                </section>
              ) : null}

            {!settingsFilterHasMatches ? (
              <div className="banner warn">No settings matched your search.</div>
            ) : null}

            {settingsMatches('quizzes', 'quiz folder', 'quiz library', 'import folder', 'open quizzes folder', 'drag and drop') ? (
              <section className="roots-card">
                <div className="row between roots-header">
                  <div>
                    <strong>Quizzes</strong>
                    <div className="roots-count">{countQuizFiles(quizzesTree)} quiz file(s)</div>
                  </div>
                  <div className="row">
                    <button type="button" onClick={() => importQuizzesFromFinder()}>
                      Import Folder
                    </button>
                    <button type="button" onClick={() => openPath(quizzesDir)} disabled={!quizzesDir}>
                      Open Quizzes Folder
                    </button>
                    <button type="button" onClick={() => loadQuizzesLibrary()}>
                      Refresh
                    </button>
                    <button type="button" onClick={() => setShowQuizzesBox((prev) => !prev)}>
                      {showQuizzesBox ? 'Minimize' : 'Expand'}
                    </button>
                  </div>
                </div>

                <div className="quizzes-dir-path">{quizzesDir || 'No quizzes directory available.'}</div>

                {showQuizzesBox ? (
                  <>
                    <div
                      className={`quizzes-drop-zone ${quizzesDragOver ? 'drag-over' : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setQuizzesDragOver(true);
                      }}
                      onDragLeave={() => setQuizzesDragOver(false)}
                      onDrop={(event) => {
                        void handleQuizzesDrop(event);
                      }}
                    >
                      Drag and drop quiz folders or .json files here to import into Quizzes.
                    </div>
                    <div className="roots-list-wrap">
                      <QuizzesStructureTree nodes={quizzesTree} />
                    </div>
                  </>
                ) : null}

                {quizzesWarnings.length ? (
                  <div className="banner warn">
                    {quizzesWarnings.map((warning, index) => (
                      <div key={`quiz-warning-${index}`}>{warning}</div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="form-grid two-col">
              {settingsMatches('claude api key', 'claude') ? (
                <label className="field">
                  <span>Claude API key</span>
                  <input
                    value={settingsForm.claude_api_key || ''}
                    onChange={(event) => setSettingsForm((prev) => ({ ...prev, claude_api_key: event.target.value }))}
                  />
                </label>
              ) : null}

              {settingsMatches('claude model selected', 'claude model', 'claude') ? (
                <label className="field">
                  <span>Claude model selected</span>
                  <input
                    value={settingsForm.claude_model_selected || ''}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, claude_model_selected: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              {settingsMatches('openai auth mode', 'openai') ? (
                <label className="field">
                  <span>OpenAI auth mode</span>
                  <select
                    value={settingsForm.openai_auth_mode || 'api_key'}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, openai_auth_mode: event.target.value }))
                    }
                  >
                    <option value="api_key">api_key</option>
                    <option value="oauth">oauth</option>
                  </select>
                </label>
              ) : null}

              {settingsMatches('openai oauth client id', 'oauth client id', 'openai') ? (
                <label className="field">
                  <span>OpenAI OAuth client ID</span>
                  <input
                    value={settingsForm.openai_oauth_client_id || ''}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, openai_oauth_client_id: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              {settingsMatches('openai api key', 'openai') ? (
                <label className="field">
                  <span>OpenAI API key</span>
                  <input
                    value={settingsForm.openai_api_key || ''}
                    onChange={(event) => setSettingsForm((prev) => ({ ...prev, openai_api_key: event.target.value }))}
                  />
                </label>
              ) : null}

              {settingsMatches('openai model selected', 'openai model', 'openai') ? (
                <label className="field">
                  <span>OpenAI model selected</span>
                  <input
                    value={settingsForm.openai_model_selected || ''}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, openai_model_selected: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              {settingsMatches('generation output subdir', 'output folder', 'generation') ? (
                <label className="field">
                  <span>Generation output subdir</span>
                  <input
                    value={settingsForm.generation_output_subdir || ''}
                    onChange={(event) =>
                      setSettingsForm((prev) => ({ ...prev, generation_output_subdir: event.target.value }))
                    }
                  />
                </label>
              ) : null}
            </div>

            <div className="row">
              <button type="button" className="primary" disabled={savingSettings} onClick={() => handleSaveSettings()}>
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const response = await apiRequest('/v1/settings', 'GET');
                  setSettings(response.settings);
                  setSettingsForm({ ...response.settings });
                  await loadQuizzesLibrary();
                  await loadQuizTree();
                }}
              >
                Reload Settings
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;
