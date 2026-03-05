import React, { useEffect, useMemo, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import { apiRequest, backendInfo, openPath, pickFolder, pickSourceInputs } from './api';

const TABS = ['quiz', 'generate', 'settings'];
const THEME_STORAGE_KEY = 'modular-quiz-theme';
const QUIZ_EXIT_CONFIRM_MESSAGE = 'Are you sure you want to exit the quiz? Your progress will not be saved.';
const MAX_INJECTED_CONTEXT_CHARS = 12000;
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

function normalizeTabKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'generator') {
    return 'generate';
  }
  if (TABS.includes(normalized)) {
    return normalized;
  }
  return 'quiz';
}

function parseNonNegativeInt(value, fallback = 0) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return 0;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return parsed;
}

function toTitleWord(token) {
  const raw = String(token || '').trim();
  if (!raw) {
    return '';
  }
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return raw;
  }
  const upper = raw.toUpperCase();
  if (['GPT', 'O1', 'O3', 'O4', 'API'].includes(upper)) {
    return upper;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatModelName(provider, modelId) {
  const rawId = String(modelId || '').trim();
  if (!rawId) {
    return '';
  }

  const rawTokens = rawId
    .replace(/[_:]/g, '-')
    .split('-')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.toLowerCase() !== 'latest')
    .filter((token) => !/^\d{8}$/.test(token));

  if (!rawTokens.length) {
    return rawId;
  }

  let tokens = [...rawTokens];
  const providerKey = String(provider || '').toLowerCase();
  if (providerKey === 'claude' && tokens[0]?.toLowerCase() !== 'claude') {
    tokens = ['claude', ...tokens];
  } else if (providerKey === 'openai' && !['gpt', 'o1', 'o3', 'o4'].includes(tokens[0]?.toLowerCase() || '')) {
    tokens = ['openai', ...tokens];
  }

  const mergedVersionTokens = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    const next = tokens[i + 1];
    if (/^\d$/.test(current) && /^\d{1,2}$/.test(next || '')) {
      mergedVersionTokens.push(`${current}.${next}`);
      i += 1;
      continue;
    }
    mergedVersionTokens.push(current);
  }
  tokens = mergedVersionTokens;

  return tokens.map((token) => toTitleWord(token)).join(' ');
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

function normalizeQuestionId(value, fallbackIndex = 1) {
  const raw = String(value || '').trim();
  if (raw) {
    return raw;
  }
  return `q${Math.max(1, Number(fallbackIndex) || 1)}`;
}

function isUngradedAttemptQuestion(question) {
  const explicit = Boolean(question?.ungraded);
  if (explicit) {
    return true;
  }
  const feedback = String(question?.feedback || '').toLowerCase();
  return feedback.includes('ungraded');
}

function historyAttemptMatchesSignature(record, signature) {
  if (!record || !signature) {
    return false;
  }
  return (
    String(record.timestamp || '') === String(signature.timestamp || '')
    && String(record.quiz_path || '') === String(signature.quiz_path || '')
    && String(record.model_key || '') === String(signature.model_key || '')
    && Number(record.score || 0) === Number(signature.score || 0)
    && Number(record.max_score || 0) === Number(signature.max_score || 0)
    && Number(record.duration_seconds || 0) === Number(signature.duration_seconds || 0)
  );
}

function buildInjectedContextText(sources, maxChars = MAX_INJECTED_CONTEXT_CHARS) {
  if (!(sources || []).length) {
    return '';
  }
  const cap = Math.max(1000, Number(maxChars) || MAX_INJECTED_CONTEXT_CHARS);
  let remaining = cap;
  const blocks = [];

  for (const source of sources || []) {
    if (remaining <= 0) {
      break;
    }
    const sourcePath = String(source?.path || '').trim();
    const sourceName = shortPathLabel(sourcePath) || sourcePath || 'Source';
    const content = String(source?.content || '').trim();
    if (!content) {
      continue;
    }
    const block = `Source: ${sourceName}\n${content}\n`;
    if (block.length <= remaining) {
      blocks.push(block);
      remaining -= block.length;
      continue;
    }
    if (remaining > 20) {
      blocks.push(`${block.slice(0, Math.max(0, remaining - 3)).trimEnd()}...`);
    }
    remaining = 0;
  }

  return blocks.join('\n').trim();
}

function normalizePathText(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

function normalizeRelativePath(value) {
  const normalized = normalizePathText(value);
  if (!normalized || normalized === '.') {
    return '';
  }
  return normalized;
}

function relativePathFromRoot(pathValue, rootPath) {
  const normalizedPath = normalizePathText(pathValue);
  const normalizedRoot = normalizePathText(rootPath);
  if (!normalizedPath || !normalizedRoot) {
    return '';
  }
  if (normalizedPath === normalizedRoot) {
    return '';
  }
  const rootPrefix = `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(rootPrefix)) {
    return '';
  }
  return normalizedPath.slice(rootPrefix.length);
}

function collectFolderNodePaths(nodes, out = []) {
  for (const node of nodes || []) {
    if (node?.kind === 'folder' && node?.path) {
      out.push(String(node.path));
    }
    collectFolderNodePaths(node?.children || [], out);
  }
  return out;
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

function formatElapsedTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timestampToMs(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function formatHistoryTimestamp(value) {
  const parsedMs = timestampToMs(value);
  if (!parsedMs) {
    return 'Unknown date/time';
  }
  return new Date(parsedMs).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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

function QuizTree({ nodes, selectedPath, onSelect, onOpenContextMenu }) {
  const [collapsedPaths, setCollapsedPaths] = useState({});

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

  const openQuizContextMenu = (event, node) => {
    const isQuiz = node?.kind === 'quiz';
    if (!isQuiz || typeof onOpenContextMenu !== 'function') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onOpenContextMenu({
      path: node.path,
      name: nodeLabel(node),
      x: event.clientX,
      y: event.clientY,
    });
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
              openQuizContextMenu(event, node);
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
  const [autoAdvanceDelayDraft, setAutoAdvanceDelayDraft] = useState('600');
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
  const [quizSelectorPanelTab, setQuizSelectorPanelTab] = useState('quizzes');
  const [feedbackTabNeedsAttention, setFeedbackTabNeedsAttention] = useState(false);
  const [activeQuizPath, setActiveQuizPath] = useState('');
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
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [questionResult, setQuestionResult] = useState(null);
  const [questionLocked, setQuestionLocked] = useState(false);
  const [mcqAnswer, setMcqAnswer] = useState('');
  const [shortAnswer, setShortAnswer] = useState('');
  const [quizNotes, setQuizNotes] = useState([]);
  const [feedbackChatMessages, setFeedbackChatMessages] = useState([]);
  const [feedbackChatDraft, setFeedbackChatDraft] = useState('');
  const [feedbackChatSending, setFeedbackChatSending] = useState(false);
  const [feedbackChatContextKey, setFeedbackChatContextKey] = useState('');
  const [attemptQuestions, setAttemptQuestions] = useState([]);
  const [injectedContextText, setInjectedContextText] = useState('');
  const [injectedContextPaths, setInjectedContextPaths] = useState([]);
  const [showInjectedContextPanel, setShowInjectedContextPanel] = useState(false);
  const [generatedQuizContextsByPath, setGeneratedQuizContextsByPath] = useState({});
  const [questionStates, setQuestionStates] = useState({});
  const [questionTimeLeftMs, setQuestionTimeLeftMs] = useState(0);
  const autoAdvanceTimeoutRef = useRef(null);
  const questionTimerIntervalRef = useRef(null);
  const questionStatesRef = useRef({});
  const mcqAnswerRef = useRef('');
  const shortAnswerRef = useRef('');
  const quizNotesCountRef = useRef(0);
  const feedbackChatEndRef = useRef(null);

  const [sourceInputs, setSourceInputs] = useState([]);
  const [collectedSources, setCollectedSources] = useState([]);
  const [generateWarnings, setGenerateWarnings] = useState([]);
  const [generateErrors, setGenerateErrors] = useState([]);
  const [generateDragOver, setGenerateDragOver] = useState(false);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [generateOutputPath, setGenerateOutputPath] = useState('');
  const [generationOutputSubdir, setGenerationOutputSubdir] = useState('');
  const [generationForm, setGenerationForm] = useState({
    total: 20,
    mcq_count: 15,
    short_count: 5,
    mcq_options: 4,
    title_hint: '',
    instructions_hint: '',
  });

  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyContextPaths, setHistoryContextPaths] = useState([]);
  const [historyContextIndex, setHistoryContextIndex] = useState(-1);
  const [selectedAttemptIndex, setSelectedAttemptIndex] = useState(-1);
  const [historySortMode, setHistorySortMode] = useState('most_recent');
  const [gradingHistoryAttempt, setGradingHistoryAttempt] = useState(false);
  const [quizSidebarMode, setQuizSidebarMode] = useState('question_nav');
  const [quizContextMenu, setQuizContextMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    path: '',
    name: '',
  });
  const [quizClockMode, setQuizClockMode] = useState('stopwatch');
  const [quizTimerDurationSeconds, setQuizTimerDurationSeconds] = useState(15 * 60);
  const [quizClockTickMs, setQuizClockTickMs] = useState(Date.now());
  const [quizClockMenu, setQuizClockMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    draftMinutes: '15',
  });
  const normalizedActiveTab = normalizeTabKey(activeTab);

  const combinedModelOptions = useMemo(() => {
    const options = [{ key: 'self:', label: 'No model', provider: 'self' }];
    for (const model of providerModels.claude || []) {
      options.push({
        key: modelKey('claude', model.id),
        label: formatModelName('claude', model.id),
        provider: 'claude',
      });
    }
    for (const model of providerModels.openai || []) {
      options.push({
        key: modelKey('openai', model.id),
        label: formatModelName('openai', model.id),
        provider: 'openai',
      });
    }
    const preferredKey = String(settingsForm?.preferred_model_key || settings?.preferred_model_key || '').trim();
    if (preferredKey && !options.some((option) => option.key === preferredKey)) {
      const { provider, model } = providerAndModelFromKey(preferredKey);
      if (provider === 'claude' || provider === 'openai') {
        options.push({
          key: preferredKey,
          label: `${formatModelName(provider, model || 'unknown model')} (custom)`,
          provider,
        });
      }
    }
    return options;
  }, [providerModels, settingsForm?.preferred_model_key, settings?.preferred_model_key]);

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
  const autoInjectContextEnabled = Boolean(
    settingsForm?.auto_inject_context ?? settings?.auto_inject_context ?? false,
  );
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
    normalizedActiveTab === 'quiz' && quiz && currentQuestion && !questionLocked && questionTimerSeconds > 0,
  );
  const quizElapsedMs = useMemo(() => {
    if (!quiz || quizStartedAt <= 0) {
      return 0;
    }
    return Math.max(0, quizClockTickMs - quizStartedAt);
  }, [quiz, quizStartedAt, quizClockTickMs]);
  const quizTimerDurationMs = Math.max(0, Number(quizTimerDurationSeconds || 0)) * 1000;
  const quizTimerRemainingMs = Math.max(0, quizTimerDurationMs - quizElapsedMs);
  const quizTimerExpired = quizClockMode === 'timer' && quizTimerDurationMs > 0 && quizElapsedMs >= quizTimerDurationMs;
  const showingPerformanceHistory = quizSidebarMode === 'performance_history';

  const activeHistoryQuizPath = useMemo(() => {
    if (historyContextIndex < 0 || historyContextIndex >= historyContextPaths.length) {
      return '';
    }
    return historyContextPaths[historyContextIndex] || '';
  }, [historyContextIndex, historyContextPaths]);

  const historyFiltered = useMemo(() => {
    if (!activeHistoryQuizPath) {
      return [];
    }
    const oldestFirst = historyRecords
      .filter((record) => record.quiz_path === activeHistoryQuizPath)
      .sort((left, right) => {
        const leftTime = timestampToMs(left?.timestamp);
        const rightTime = timestampToMs(right?.timestamp);
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return String(left?.quiz_path || '').localeCompare(String(right?.quiz_path || ''));
      })
      .map((record, index) => ({
        ...record,
        attempt_number: index + 1,
      }));
    if (historySortMode === 'least_recent') {
      return oldestFirst;
    }
    return [...oldestFirst].reverse();
  }, [activeHistoryQuizPath, historyRecords, historySortMode]);

  const hasOlderHistoryContext = historyContextIndex >= 0 && historyContextIndex < historyContextPaths.length - 1;
  const hasNewerHistoryContext = historyContextIndex > 0;
  const activeHistoryQuizTitle = useMemo(() => {
    if (!activeHistoryQuizPath) {
      return '';
    }
    const historyRecord = historyRecords.find((record) => record.quiz_path === activeHistoryQuizPath && record.quiz_title);
    if (historyRecord?.quiz_title) {
      return String(historyRecord.quiz_title);
    }
    const quizNode = findQuizNodeByPath(quizTreeRoots, activeHistoryQuizPath);
    if (quizNode?.name) {
      return String(quizNode.name);
    }
    return shortPathLabel(activeHistoryQuizPath);
  }, [activeHistoryQuizPath, historyRecords, quizTreeRoots]);
  const hasQuizProgress = useMemo(
    () => (
      Boolean(quizSaved)
      || quizIndex > 0
      || quizScore > 0
      || attemptQuestions.length > 0
      || Object.keys(questionStates || {}).length > 0
    ),
    [attemptQuestions, questionStates, quizIndex, quizSaved, quizScore],
  );

  const selectedAttempt = useMemo(() => {
    if (selectedAttemptIndex < 0 || selectedAttemptIndex >= historyFiltered.length) {
      return null;
    }
    return historyFiltered[selectedAttemptIndex];
  }, [selectedAttemptIndex, historyFiltered]);
  const selectedAttemptUngradedIndexes = useMemo(() => {
    if (!selectedAttempt?.questions?.length) {
      return [];
    }
    const indexes = [];
    for (let index = 0; index < selectedAttempt.questions.length; index += 1) {
      const question = selectedAttempt.questions[index];
      if (String(question?.question_type || '') !== 'short') {
        continue;
      }
      if (!isUngradedAttemptQuestion(question)) {
        continue;
      }
      indexes.push(index);
    }
    return indexes;
  }, [selectedAttempt]);

  const generationOutputFolderOptions = useMemo(() => {
    const root = String(quizzesDir || '').trim();
    if (!root) {
      return [];
    }
    const unique = new Map();
    const includePath = (pathValue) => {
      const relative = normalizeRelativePath(relativePathFromRoot(pathValue, root));
      const key = relative;
      if (unique.has(key)) {
        return;
      }
      const absolutePath = relative ? `${normalizePathText(root)}/${relative}` : normalizePathText(root);
      const label = relative ? `Quizzes/${relative}` : 'Quizzes';
      unique.set(key, {
        value: relative,
        label,
        absolute_path: absolutePath,
      });
    };

    includePath(root);
    includePath(`${normalizePathText(root)}/Generated`);
    for (const pathValue of collectFolderNodePaths(quizzesTree)) {
      includePath(pathValue);
    }

    return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [quizzesDir, quizzesTree]);

  const selectedGenerationOutputFolder = useMemo(() => {
    if (!generationOutputFolderOptions.length) {
      return null;
    }
    return generationOutputFolderOptions.find((option) => option.value === generationOutputSubdir) || generationOutputFolderOptions[0];
  }, [generationOutputFolderOptions, generationOutputSubdir]);

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

  function updateGenerationNumberFieldDraft(fieldName, rawValue) {
    if (!/^\d*$/.test(rawValue)) {
      return;
    }
    setGenerationForm((prev) => ({
      ...prev,
      [fieldName]: rawValue,
    }));
  }

  function commitGenerationNumberField(fieldName) {
    setGenerationForm((prev) => ({
      ...prev,
      [fieldName]: parseNonNegativeInt(prev?.[fieldName], 0),
    }));
  }

  function onGenerationNumberFieldKeyDown(event, fieldName) {
    if (event.key !== 'Enter' && event.key !== 'Return') {
      return;
    }
    event.preventDefault();
    commitGenerationNumberField(fieldName);
    event.currentTarget.blur();
  }

  function commitQuestionTimerSeconds() {
    setSettingsForm((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        question_timer_seconds: parseNonNegativeInt(prev.question_timer_seconds, 0),
      };
    });
  }

  function commitAutoAdvanceDelayDraft() {
    const normalized = String(parseNonNegativeInt(autoAdvanceDelayDraft, 0));
    setAutoAdvanceDelayDraft(normalized);
  }

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    setAutoAdvanceDelayDraft(String(parseNonNegativeInt(settings?.auto_advance_ms, 0)));
  }, [settings?.auto_advance_ms]);

  useEffect(() => {
    if (!generationOutputFolderOptions.length) {
      if (generationOutputSubdir !== '') {
        setGenerationOutputSubdir('');
      }
      return;
    }
    const allowedValues = new Set(generationOutputFolderOptions.map((option) => option.value));
    if (allowedValues.has(generationOutputSubdir)) {
      return;
    }
    const preferred = normalizeRelativePath(settings?.generation_output_subdir || '');
    if (preferred && allowedValues.has(preferred)) {
      setGenerationOutputSubdir(preferred);
      return;
    }
    if (allowedValues.has('Generated')) {
      setGenerationOutputSubdir('Generated');
      return;
    }
    setGenerationOutputSubdir(generationOutputFolderOptions[0].value);
  }, [generationOutputFolderOptions, generationOutputSubdir, settings?.generation_output_subdir]);

  useEffect(() => {
    let cancelled = false;

    const refreshPreflightSummary = async () => {
      setGenerateOutputPath('');
      setGenerateErrors([]);
      setGenerateWarnings([]);
      try {
        const sources = await collectSourcePaths({ silentIfEmpty: true });
        if (cancelled) {
          return;
        }
        if (sourceInputs.length && !sources.length) {
          setGenerateErrors(['No supported source files were collected.']);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setGenerateErrors([err.message]);
      }
    };

    void refreshPreflightSummary();

    return () => {
      cancelled = true;
    };
  }, [sourceInputs]);

  const latestQuizNote = quizNotes.length ? quizNotes[quizNotes.length - 1] : '';
  const feedbackChatSeedText = String(latestQuizNote || '').trim();
  const feedbackChatSeedKey = `${String(currentQuestion?.id || `q${quizIndex + 1}`)}:${feedbackChatSeedText}`;

  useEffect(() => {
    const previousCount = Number(quizNotesCountRef.current || 0);
    const nextCount = Number(quizNotes.length || 0);
    if (nextCount > previousCount && quizSelectorPanelTab !== 'feedback') {
      setFeedbackTabNeedsAttention(true);
    }
    quizNotesCountRef.current = nextCount;
  }, [quizNotes.length, quizSelectorPanelTab]);

  useEffect(() => {
    if (quizSelectorPanelTab !== 'feedback') {
      return;
    }
    if (!feedbackTabNeedsAttention) {
      return;
    }
    setFeedbackTabNeedsAttention(false);
  }, [feedbackTabNeedsAttention, quizSelectorPanelTab]);

  useEffect(() => {
    if (!historyContextPaths.length) {
      if (historyContextIndex !== -1) {
        setHistoryContextIndex(-1);
      }
      return;
    }
    if (historyContextIndex < 0 || historyContextIndex >= historyContextPaths.length) {
      setHistoryContextIndex(0);
    }
  }, [historyContextPaths, historyContextIndex]);

  useEffect(() => {
    setSelectedAttemptIndex(-1);
  }, [historySortMode]);

  useEffect(() => {
    if (!autoInjectContextEnabled) {
      return;
    }
    const activePath = normalizePathText(activeQuizPath || selectedQuizPath);
    if (!activePath) {
      return;
    }
    const cached = generatedQuizContextsByPath[activePath];
    if (!cached?.text) {
      return;
    }
    setInjectedContextText((prev) => (String(prev || '').trim() ? prev : cached.text));
    setInjectedContextPaths((prev) => (Array.isArray(prev) && prev.length ? prev : (cached.paths || [])));
  }, [
    activeQuizPath,
    autoInjectContextEnabled,
    generatedQuizContextsByPath,
    selectedQuizPath,
  ]);

  useEffect(() => {
    if (!feedbackChatSeedText) {
      if (feedbackChatMessages.length || feedbackChatDraft || feedbackChatContextKey) {
        setFeedbackChatMessages([]);
        setFeedbackChatDraft('');
        setFeedbackChatContextKey('');
      }
      return;
    }
    if (feedbackChatContextKey === feedbackChatSeedKey) {
      return;
    }
    setFeedbackChatMessages([{ role: 'assistant', text: feedbackChatSeedText }]);
    setFeedbackChatDraft('');
    setFeedbackChatContextKey(feedbackChatSeedKey);
  }, [
    feedbackChatContextKey,
    feedbackChatDraft,
    feedbackChatMessages.length,
    feedbackChatSeedKey,
    feedbackChatSeedText,
  ]);

  useEffect(() => {
    if (!feedbackChatEndRef.current) {
      return;
    }
    feedbackChatEndRef.current.scrollIntoView({ block: 'end' });
  }, [feedbackChatMessages, feedbackChatSending]);

  useEffect(() => {
    if (injectedContextPaths.length) {
      return;
    }
    if (showInjectedContextPanel) {
      setShowInjectedContextPanel(false);
    }
  }, [injectedContextPaths.length, showInjectedContextPanel]);

  useEffect(() => {
    if (normalizedActiveTab === activeTab) {
      return;
    }
    setActiveTab(normalizedActiveTab);
  }, [activeTab, normalizedActiveTab]);

  useEffect(() => {
    if (normalizedActiveTab !== 'quiz') {
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
  }, [normalizedActiveTab, selectedQuizPath]);

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
      return;
    }
    setQuestionResult(null);
    setQuestionLocked(false);
    setMcqAnswer('');
    setShortAnswer('');
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
    const root = document.documentElement;
    root.setAttribute('data-theme', themeMode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch (_err) {
      // Ignore storage write failures.
    }
  }, [themeMode]);

  useEffect(() => {
    if (!quiz || quizStartedAt <= 0) {
      return undefined;
    }
    setQuizClockTickMs(Date.now());
    const timerId = window.setInterval(() => {
      setQuizClockTickMs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(timerId);
    };
  }, [quiz, quizStartedAt]);

  useEffect(() => {
    if (!quizContextMenu.open) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      closeQuizContextMenu();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [quizContextMenu.open]);

  useEffect(() => {
    if (!quizClockMenu.open) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      closeQuizClockMenu();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [quizClockMenu.open]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (normalizedActiveTab !== 'quiz' || isEditableTarget(event.target)) {
        return;
      }
      if (showingPerformanceHistory) {
        if (event.key === 'ArrowLeft' && hasOlderHistoryContext) {
          event.preventDefault();
          goToOlderHistoryContext();
          return;
        }
        if (event.key === 'ArrowRight' && hasNewerHistoryContext) {
          event.preventDefault();
          goToNewerHistoryContext();
          return;
        }
        return;
      }
      if (!quiz || !currentQuestion) {
        return;
      }
      if (event.key === 'ArrowLeft' && canGoPrevQuestion && !autoAdvanceEnabled) {
        event.preventDefault();
        setQuizIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === 'ArrowRight' && canGoForwardQuestion) {
        event.preventDefault();
        setQuizIndex((prev) => Math.min(prev + 1, furthestReachableIndex));
        return;
      }
      const upperKey = String(event.key || '').toUpperCase();
      if (currentQuestion.type === 'mcq' && !questionLocked && ['A', 'B', 'C', 'D'].includes(upperKey)) {
        const optionIndex = upperKey.charCodeAt(0) - 65;
        if (optionIndex >= 0 && optionIndex < (currentQuestion.options || []).length) {
          event.preventDefault();
          void submitMcqAnswer(upperKey);
        }
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
    normalizedActiveTab,
    showingPerformanceHistory,
    hasOlderHistoryContext,
    hasNewerHistoryContext,
    quiz,
    currentQuestion,
    canGoPrevQuestion,
    canGoForwardQuestion,
    furthestReachableIndex,
    autoAdvanceEnabled,
    questionLocked,
  ]);

  useEffect(() => {
    if (autoAdvanceTimeoutRef.current) {
      window.clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }

    if (normalizedActiveTab !== 'quiz' || !quiz || !currentQuestion || !questionLocked || !questionResult) {
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
    normalizedActiveTab,
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

    if (normalizedActiveTab !== 'quiz' || !quiz || !currentQuestion || questionLocked || questionTimerSeconds <= 0) {
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
  }, [normalizedActiveTab, quiz, currentQuestion, quizIndex, questionLocked, questionTimerSeconds]);

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
    setHistoryRecords(response.records || []);
    setSelectedAttemptIndex(-1);
  }

  function resetQuizSessionState(nextSidebarMode = 'question_nav') {
    if (autoAdvanceTimeoutRef.current) {
      window.clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
    if (questionTimerIntervalRef.current) {
      window.clearInterval(questionTimerIntervalRef.current);
      questionTimerIntervalRef.current = null;
    }
    setQuiz(null);
    setQuizIndex(0);
    setQuizScore(0);
    setQuizStartedAt(0);
    setQuizCompleted(false);
    setQuestionResult(null);
    setQuestionLocked(false);
    setMcqAnswer('');
    setShortAnswer('');
    setQuizNotes([]);
    setFeedbackChatMessages([]);
    setFeedbackChatDraft('');
    setFeedbackChatSending(false);
    setFeedbackChatContextKey('');
    setAttemptQuestions([]);
    setInjectedContextText('');
    setInjectedContextPaths([]);
    setShowInjectedContextPanel(false);
    setQuestionStates({});
    setQuestionTimeLeftMs(0);
    setQuizSaved(false);
    setActiveQuizPath('');
    setQuizSidebarMode(nextSidebarMode);
  }

  function pushHistoryContext(targetPath) {
    const nextPath = String(targetPath || '').trim();
    if (!nextPath) {
      return;
    }
    setHistoryContextPaths((prev) => [nextPath, ...prev.filter((item) => item !== nextPath)]);
    setHistoryContextIndex(0);
    setSelectedAttemptIndex(-1);
  }

  function goToOlderHistoryContext() {
    if (!hasOlderHistoryContext) {
      return;
    }
    setHistoryContextIndex((prev) => prev + 1);
    setSelectedAttemptIndex(-1);
  }

  function goToNewerHistoryContext() {
    if (!hasNewerHistoryContext) {
      return;
    }
    setHistoryContextIndex((prev) => prev - 1);
    setSelectedAttemptIndex(-1);
  }

  function closeQuizContextMenu() {
    setQuizContextMenu((prev) => {
      if (!prev.open) {
        return prev;
      }
      return {
        ...prev,
        open: false,
      };
    });
  }

  function closeQuizClockMenu() {
    setQuizClockMenu((prev) => {
      if (!prev.open) {
        return prev;
      }
      return {
        ...prev,
        open: false,
      };
    });
  }

  function openQuizClockMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const MENU_WIDTH = 280;
    const MENU_HEIGHT = 250;
    const EDGE_PADDING = 10;
    const requestedX = Number(event.clientX || 0);
    const requestedY = Number(event.clientY || 0);
    const maxX = Math.max(EDGE_PADDING, window.innerWidth - MENU_WIDTH - EDGE_PADDING);
    const maxY = Math.max(EDGE_PADDING, window.innerHeight - MENU_HEIGHT - EDGE_PADDING);
    const x = Math.min(Math.max(requestedX, EDGE_PADDING), maxX);
    const y = Math.min(Math.max(requestedY, EDGE_PADDING), maxY);
    setQuizClockMenu({
      open: true,
      x,
      y,
      draftMinutes: String(Math.max(1, Math.floor((quizTimerDurationSeconds || 60) / 60))),
    });
  }

  function applyQuizTimerFromMenu() {
    const rawMinutes = Number.parseInt(String(quizClockMenu.draftMinutes || '').trim(), 10);
    if (Number.isNaN(rawMinutes) || rawMinutes <= 0) {
      setQuizClockMenu((prev) => ({ ...prev, draftMinutes: '15' }));
      return;
    }
    const nextMinutes = Math.min(24 * 60, Math.max(1, rawMinutes));
    setQuizTimerDurationSeconds(nextMinutes * 60);
    setQuizClockMode('timer');
    closeQuizClockMenu();
  }

  function openQuizContextMenuForNode(menuPayload) {
    const targetPath = String(menuPayload?.path || '').trim();
    if (!targetPath) {
      return;
    }

    const MENU_WIDTH = 220;
    const MENU_HEIGHT = 120;
    const EDGE_PADDING = 10;
    const requestedX = Number(menuPayload?.x || 0);
    const requestedY = Number(menuPayload?.y || 0);
    const maxX = Math.max(EDGE_PADDING, window.innerWidth - MENU_WIDTH - EDGE_PADDING);
    const maxY = Math.max(EDGE_PADDING, window.innerHeight - MENU_HEIGHT - EDGE_PADDING);
    const x = Math.min(Math.max(requestedX, EDGE_PADDING), maxX);
    const y = Math.min(Math.max(requestedY, EDGE_PADDING), maxY);

    setSelectedQuizPath(targetPath);
    setQuizContextMenu({
      open: true,
      x,
      y,
      path: targetPath,
      name: String(menuPayload?.name || '').trim() || shortPathLabel(targetPath),
    });
  }

  function confirmExitInProgressQuiz() {
    if (!(quiz && !quizSaved && hasQuizProgress)) {
      return true;
    }
    return window.confirm(QUIZ_EXIT_CONFIRM_MESSAGE);
  }

  async function openPerformanceHistoryForQuiz(pathValue) {
    const targetPath = String(pathValue || '').trim();
    if (!targetPath) {
      return;
    }
    if (!confirmExitInProgressQuiz()) {
      return;
    }
    if (quiz) {
      resetQuizSessionState('performance_history');
    } else {
      setQuizSidebarMode('performance_history');
    }
    pushHistoryContext(targetPath);
    setActiveTab('quiz');
    setQuizLoadError('');
    closeQuizClockMenu();
    try {
      await loadHistory();
    } catch (err) {
      setQuizLoadError(err.message || 'Failed to load performance history.');
    }
  }

  async function handleSaveSettings() {
    if (!settingsForm) {
      return false;
    }
    setSavingSettings(true);
    try {
      const autoAdvanceMs = parseNonNegativeInt(
        autoAdvanceDelayDraft,
        settingsForm.auto_advance_ms ?? settings?.auto_advance_ms ?? 0,
      );
      const payload = {
        ...settingsForm,
        auto_advance_ms: autoAdvanceMs,
        question_timer_seconds: parseNonNegativeInt(
          settingsForm.question_timer_seconds,
          settings?.question_timer_seconds ?? 0,
        ),
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

  async function handleTabChange(nextTab) {
    const normalizedNextTab = normalizeTabKey(nextTab);
    if (normalizedNextTab === normalizedActiveTab) {
      return;
    }

    if (normalizedActiveTab === 'settings' && normalizedNextTab !== 'settings' && settingsDirty) {
      const shouldSave = window.confirm('You have unsaved Settings changes. Save before leaving this tab?');
      if (shouldSave) {
        const saved = await handleSaveSettings();
        if (!saved) {
          return;
        }
      }
    }

    closeQuizContextMenu();
    closeQuizClockMenu();
    setActiveTab(normalizedNextTab);
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
    const filePaths = [...new Set(files
      .map((file) => (typeof file.path === 'string' ? file.path.trim() : ''))
      .filter((pathValue) => pathValue))];

    const inferredFolderRoots = [...new Set(
      files
        .map((file) => {
          const absolutePath = normalizePathText(file?.path || '');
          const relativePath = normalizePathText(file?.webkitRelativePath || '');
          if (!absolutePath || !relativePath || !relativePath.includes('/')) {
            return '';
          }
          const suffix = `/${relativePath}`;
          if (!absolutePath.toLowerCase().endsWith(suffix.toLowerCase())) {
            return '';
          }
          return absolutePath.slice(0, absolutePath.length - suffix.length);
        })
        .filter((pathValue) => pathValue)
    )];

    if (!inferredFolderRoots.length) {
      return filePaths;
    }

    const normalizedRoots = inferredFolderRoots
      .map((pathValue) => normalizePathText(pathValue))
      .filter((pathValue) => pathValue)
      .sort((left, right) => right.length - left.length);

    const collapsed = [...normalizedRoots];
    for (const filePath of filePaths) {
      const normalizedFilePath = normalizePathText(filePath);
      const withinRoot = normalizedRoots.some((rootPath) =>
        normalizedFilePath === rootPath || normalizedFilePath.startsWith(`${rootPath}/`));
      if (!withinRoot) {
        collapsed.push(filePath);
      }
    }

    return [...new Set(collapsed)];
  }

  async function handleGenerateSourcesDrop(event) {
    event.preventDefault();
    setGenerateDragOver(false);
    const paths = droppedSourcePaths(event);
    if (!paths.length) {
      setGenerateErrors(['Dropped content did not include local file paths. Use "Import Sources" instead.']);
      return;
    }
    setSourceInputs((prev) => [...new Set([...prev, ...paths])]);
    setCollectedSources([]);
    setGenerateWarnings([]);
    setGenerateErrors([]);
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
    closeQuizContextMenu();
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

  function handleQuizTreeContextMenu(menuPayload) {
    setQuizLoadError('');
    openQuizContextMenuForNode(menuPayload);
  }

  function openHistoryFromContextMenu() {
    const targetPath = String(quizContextMenu.path || '').trim();
    closeQuizContextMenu();
    if (!targetPath) {
      return;
    }
    void openPerformanceHistoryForQuiz(targetPath);
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

  async function startQuizFromPath(pathValue) {
    const targetPath = String(pathValue || '').trim();
    if (!targetPath) {
      return;
    }

    setQuizLoadError('');
    try {
      const response = await apiRequest('/v1/quizzes/load', 'POST', { path: targetPath });
      const loadedQuiz = response.quiz;
      const normalizedTargetPath = normalizePathText(targetPath);
      const cachedContext = autoInjectContextEnabled ? generatedQuizContextsByPath[normalizedTargetPath] : null;
      setQuiz(loadedQuiz);
      setQuizIndex(0);
      setQuizScore(0);
      setQuizStartedAt(Date.now());
      setQuizCompleted(false);
      setQuestionResult(null);
      setQuestionLocked(false);
      setMcqAnswer('');
      setShortAnswer('');
      setQuizNotes([]);
      setFeedbackChatMessages([]);
      setFeedbackChatDraft('');
      setFeedbackChatSending(false);
      setFeedbackChatContextKey('');
      setAttemptQuestions([]);
      setInjectedContextText(cachedContext?.text || '');
      setInjectedContextPaths(cachedContext?.paths || []);
      setShowInjectedContextPanel(false);
      setQuestionStates({});
      setQuizSaved(false);
      setActiveQuizPath(targetPath);
      setQuizSidebarMode('question_nav');
      setQuizClockTickMs(Date.now());
      closeQuizClockMenu();
      setActiveTab('quiz');
    } catch (err) {
      setQuizLoadError(err.message);
    }
  }

  async function startSelectedQuiz() {
    const targetPath = String(selectedQuizPath || '').trim();
    if (!targetPath) {
      return;
    }
    const switchingToAnotherQuiz = Boolean(quiz && activeQuizPath && activeQuizPath !== targetPath);
    if (switchingToAnotherQuiz && !confirmExitInProgressQuiz()) {
      return;
    }
    await startQuizFromPath(targetPath);
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
      ungraded: Boolean(result.ungraded),
    };
    const isShort = currentQuestion.type === 'short';

    setQuestionStates((prev) => ({
      ...prev,
      [quizIndex]: {
        result,
        locked: true,
        mcq_answer: isShort ? '' : userAnswer,
        short_answer: isShort ? userAnswer : '',
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
    const trimmedContext = String(injectedContextText || '').trim();
    if (trimmedContext) {
      body.extra_context = trimmedContext;
    }

    if (selected.provider === 'self') {
      lockQuestionAfterResult(
        {
          correct: false,
          points_awarded: 0,
          max_points: Number(currentQuestion.points || 0),
          feedback: 'No model selected. Response recorded as ungraded.',
          ungraded: true,
        },
        shortAnswer,
        currentQuestion.expected || '',
      );
      return;
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
        extra_context: String(injectedContextText || '').trim(),
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
    if (quizCompleted) {
      const finalIndex = Math.max(0, quiz.questions.length - 1);
      if (quizIndex !== finalIndex) {
        setQuizIndex(finalIndex);
      }
      setQuestionResult({
        correct: false,
        points_awarded: quizScore,
        max_points: maxScore,
        feedback: showFeedbackOnCompletion ? 'Quiz finished.' : '',
      });
      setQuestionLocked(true);
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
          quiz_path: String(activeQuizPath || selectedQuizPath || '').trim(),
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
    setQuizCompleted(true);
  }

  function goToPreviousQuestion() {
    if (!canGoPrevQuestion || autoAdvanceEnabled) {
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
    if (autoAdvanceEnabled && targetIndex < quizIndex) {
      return;
    }
    setQuizIndex(targetIndex);
  }

  function restartQuiz() {
    const targetPath = String(activeQuizPath || selectedQuizPath || '').trim();
    if (!targetPath) {
      return;
    }
    if (selectedQuizPath !== targetPath) {
      setSelectedQuizPath(targetPath);
    }
    void startQuizFromPath(targetPath);
  }

  function openCurrentQuizPerformanceHistory() {
    const targetPath = String(activeQuizPath || selectedQuizPath || '').trim();
    if (!targetPath) {
      return;
    }
    void openPerformanceHistoryForQuiz(targetPath);
  }

  async function injectQuizContext() {
    const paths = await pickSourceInputs();
    if (!paths || !paths.length) {
      return;
    }
    setQuizLoadError('');
    try {
      const response = await apiRequest('/v1/generate/collect-sources', 'POST', {
        paths,
        include_content: true,
      });
      const sources = response.sources || [];
      if (!sources.length) {
        setQuizLoadError('No supported context text was extracted from the selected files.');
        return;
      }
      const extractedMaterials = response.extracted_materials || [];
      const contextText = buildInjectedContextText(extractedMaterials, MAX_INJECTED_CONTEXT_CHARS);
      if (!contextText) {
        const extractionErrors = extractedMaterials
          .flatMap((material) => material?.errors || [])
          .map((entry) => String(entry || '').trim())
          .filter((entry) => entry);
        if (extractionErrors.length) {
          setQuizLoadError(extractionErrors[0]);
        } else {
          setQuizLoadError('Selected context files did not contain extractable text.');
        }
        return;
      }
      setInjectedContextText(contextText);
      setInjectedContextPaths(
        extractedMaterials
          .map((material) => String(material?.path || '').trim())
          .filter((item) => item),
      );
      setShowInjectedContextPanel(true);
    } catch (err) {
      setQuizLoadError(err.message || 'Failed to inject quiz context.');
    }
  }

  async function sendFeedbackFollowup() {
    const userMessage = String(feedbackChatDraft || '').trim();
    if (!userMessage || feedbackChatSending) {
      return;
    }
    if (!feedbackChatSeedText) {
      setQuizLoadError('Answer a question to start the feedback chat.');
      return;
    }

    const modelKeyValue = (settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:').trim();
    const selectedModelValue = providerAndModelFromKey(modelKeyValue);
    if (selectedModelValue.provider === 'self' || !selectedModelValue.model) {
      setQuizLoadError('Select a non-self Preferred model in Settings to ask follow-up feedback questions.');
      return;
    }

    const questionType = String(currentQuestion?.type || '');
    const questionState = questionStates[quizIndex];
    const userAnswer = questionType === 'short'
      ? String(questionState?.short_answer || shortAnswer || '')
      : String(questionState?.mcq_answer || mcqAnswer || '');
    const expectedAnswer = questionType === 'short'
      ? String(currentQuestion?.expected || '')
      : String(currentQuestion?.answer || '');
    const historySnapshot = (feedbackChatMessages || [])
      .map((entry) => ({
        role: String(entry?.role || '').trim().toLowerCase(),
        text: String(entry?.text || '').trim(),
      }))
      .filter((entry) => (entry.role === 'assistant' || entry.role === 'user') && entry.text);

    setQuizLoadError('');
    setFeedbackChatDraft('');
    setFeedbackChatSending(true);
    setFeedbackChatMessages((prev) => [...prev, { role: 'user', text: userMessage }]);

    try {
      const payload = {
        provider: selectedModelValue.provider,
        model: selectedModelValue.model,
        feedback: feedbackChatSeedText,
        user_message: userMessage,
        chat_history: historySnapshot,
        question: {
          id: String(currentQuestion?.id || `q${quizIndex + 1}`),
          type: questionType,
          prompt: String(currentQuestion?.prompt || ''),
          options: Array.isArray(currentQuestion?.options) ? currentQuestion.options : [],
        },
        user_answer: userAnswer,
        expected_answer: expectedAnswer,
      };
      const trimmedContext = String(injectedContextText || '').trim();
      if (trimmedContext) {
        payload.extra_context = trimmedContext;
      }
      const response = await apiRequest('/v1/feedback/chat', 'POST', payload);
      const assistantText = String(response?.text || '').trim() || 'No response returned.';
      setFeedbackChatMessages((prev) => [...prev, { role: 'assistant', text: assistantText }]);
    } catch (err) {
      setQuizLoadError(err.message || 'Failed to send follow-up feedback question.');
      setFeedbackChatDraft(userMessage);
    } finally {
      setFeedbackChatSending(false);
    }
  }

  async function gradeSelectedAttemptRetrospectively() {
    if (gradingHistoryAttempt || !selectedAttempt) {
      return;
    }
    if (!selectedAttemptUngradedIndexes.length) {
      return;
    }

    const modelKeyValue = (settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:').trim();
    const selectedModelValue = providerAndModelFromKey(modelKeyValue);
    if (selectedModelValue.provider === 'self' || !selectedModelValue.model) {
      setQuizLoadError('Select a non-self Preferred model in Settings to re-grade ungraded attempts.');
      return;
    }

    const matchSignature = {
      timestamp: String(selectedAttempt.timestamp || '').trim(),
      quiz_path: String(selectedAttempt.quiz_path || activeHistoryQuizPath || '').trim(),
      model_key: String(selectedAttempt.model_key || '').trim(),
      score: Number(selectedAttempt.score || 0),
      max_score: Number(selectedAttempt.max_score || 0),
      duration_seconds: Number(selectedAttempt.duration_seconds || 0),
    };
    if (!matchSignature.timestamp || !matchSignature.quiz_path) {
      setQuizLoadError('Selected attempt is missing required metadata and cannot be re-graded.');
      return;
    }

    setGradingHistoryAttempt(true);
    setQuizLoadError('');

    try {
      const quizResponse = await apiRequest('/v1/quizzes/load', 'POST', { path: matchSignature.quiz_path });
      const quizQuestions = Array.isArray(quizResponse?.quiz?.questions) ? quizResponse.quiz.questions : [];
      const quizQuestionsById = new Map();
      for (let index = 0; index < quizQuestions.length; index += 1) {
        const question = quizQuestions[index];
        quizQuestionsById.set(normalizeQuestionId(question?.id, index + 1), question);
      }

      const nextQuestions = [...(selectedAttempt.questions || [])];
      for (const questionIndex of selectedAttemptUngradedIndexes) {
        const questionRecord = nextQuestions[questionIndex];
        if (!questionRecord || String(questionRecord.question_type || '') !== 'short') {
          continue;
        }

        const questionId = normalizeQuestionId(questionRecord.question_id, questionIndex + 1);
        const loadedQuestion = quizQuestionsById.get(questionId);
        const points = Number(loadedQuestion?.points || questionRecord.max_points || 0);
        const expected = String(
          loadedQuestion?.expected
            || questionRecord.correct_answer_or_expected
            || '',
        );
        const prompt = String(loadedQuestion?.prompt || '');
        const gradePayload = {
          provider: selectedModelValue.provider,
          model: selectedModelValue.model,
          question: {
            id: questionId,
            type: 'short',
            prompt,
            expected,
            points,
          },
          user_answer: String(questionRecord.user_answer || ''),
        };
        const trimmedContext = String(injectedContextText || '').trim();
        if (trimmedContext) {
          gradePayload.extra_context = trimmedContext;
        }
        const gradeResponse = await apiRequest('/v1/grade/short', 'POST', gradePayload);
        const result = gradeResponse?.result || {};
        nextQuestions[questionIndex] = {
          ...questionRecord,
          correct_answer_or_expected: expected,
          points_awarded: Number(result.points_awarded || 0),
          max_points: Number(result.max_points || points),
          feedback: String(result.feedback || ''),
          ungraded: Boolean(result.ungraded),
        };
      }

      const nextScore = nextQuestions.reduce((acc, question) => acc + Number(question?.points_awarded || 0), 0);
      const nextMaxScore = Number(
        selectedAttempt.max_score
        || nextQuestions.reduce((acc, question) => acc + Number(question?.max_points || 0), 0),
      );
      const nextPercent = nextMaxScore > 0 ? (nextScore / nextMaxScore) * 100 : 0;
      const updatedRecord = {
        ...selectedAttempt,
        score: nextScore,
        max_score: nextMaxScore,
        percent: nextPercent,
        model_key: modelKey(selectedModelValue.provider, selectedModelValue.model),
        questions: nextQuestions,
      };

      const updateResponse = await apiRequest('/v1/history/update', 'POST', {
        match: matchSignature,
        record: updatedRecord,
      });
      const savedRecord = updateResponse?.record || updatedRecord;
      setHistoryRecords((prev) =>
        prev.map((record) => (historyAttemptMatchesSignature(record, matchSignature) ? savedRecord : record)));
    } catch (err) {
      setQuizLoadError(err.message || 'Failed to re-grade ungraded attempt questions.');
    } finally {
      setGradingHistoryAttempt(false);
    }
  }

  async function importSourcesFromFinder() {
    const paths = await pickSourceInputs();
    if (!paths || !paths.length) {
      return;
    }
    setSourceInputs((prev) => [...new Set([...prev, ...paths])]);
    setCollectedSources([]);
    setGenerateWarnings([]);
    setGenerateErrors([]);
  }

  async function collectSourcePaths({ silentIfEmpty = false } = {}) {
    if (!sourceInputs.length) {
      setCollectedSources([]);
      setGenerateWarnings([]);
      if (silentIfEmpty) {
        setGenerateErrors([]);
      } else {
        setGenerateErrors(['Add source material using drag and drop or Import Sources.']);
      }
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
    if (isGeneratingQuiz) {
      return;
    }
    setGenerateErrors([]);
    setGenerateWarnings([]);
    setGenerateOutputPath('');
    setIsGeneratingQuiz(true);

    try {
      const normalizedGenerationCounts = {
        mcq_count: parseNonNegativeInt(generationForm.mcq_count, 0),
        short_count: parseNonNegativeInt(generationForm.short_count, 0),
      };
      normalizedGenerationCounts.total = normalizedGenerationCounts.mcq_count + normalizedGenerationCounts.short_count;
      normalizedGenerationCounts.mcq_options = 4;
      setGenerationForm((prev) => ({
        ...prev,
        ...normalizedGenerationCounts,
      }));

      let sources = collectedSources;
      if (!sources.length) {
        sources = await collectSourcePaths();
      }

      if (!sources.length) {
        if (!sourceInputs.length) {
          setGenerateErrors(['Add source material using drag and drop or Import Sources.']);
        } else {
          setGenerateErrors(['No supported source files were collected.']);
        }
        return;
      }

      const preferredModelKey = settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:';
      const selectedModel = providerAndModelFromKey(preferredModelKey);
      if (selectedModel.provider === 'self' || !selectedModel.model) {
        setGenerateErrors(['Select a non-self Preferred model in Settings before generating a quiz.']);
        return;
      }

      const payload = {
        quiz_dir: settings?.quiz_dir,
        sources,
        provider: selectedModel.provider,
        model: selectedModel.model,
        total: normalizedGenerationCounts.total,
        mcq_count: normalizedGenerationCounts.mcq_count,
        short_count: normalizedGenerationCounts.short_count,
        mcq_options: normalizedGenerationCounts.mcq_options,
        title_hint: generationForm.title_hint,
        instructions_hint: generationForm.instructions_hint,
        output_subdir: selectedGenerationOutputFolder?.value || '',
      };

      const result = await apiRequest('/v1/generate/run', 'POST', payload);
      setGenerateWarnings(result.warnings || []);
      setGenerateErrors(result.errors || []);
      const generatedPath = normalizePathText(result.output_path || '');
      const extractedMaterials = Array.isArray(result.extracted_materials) ? result.extracted_materials : [];
      const autoContextText = buildInjectedContextText(extractedMaterials, MAX_INJECTED_CONTEXT_CHARS);
      const autoContextPaths = extractedMaterials
        .map((source) => String(source?.path || '').trim())
        .filter((item) => item);
      if (generatedPath && autoContextText) {
        setGeneratedQuizContextsByPath((prev) => ({
          ...prev,
          [generatedPath]: {
            text: autoContextText,
            paths: autoContextPaths,
          },
        }));
      }
      if (result.output_path) {
        setGenerateOutputPath(result.output_path);
      }
    } catch (err) {
      setGenerateErrors([err.message]);
    } finally {
      setIsGeneratingQuiz(false);
    }
  }

  const selectedProviderModel = providerAndModelFromKey(
    settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:',
  );
  const preferredModelLabel = useMemo(() => {
    const currentKey = settingsForm?.preferred_model_key || settings?.preferred_model_key || 'self:';
    const matched = combinedModelOptions.find((option) => option.key === currentKey);
    if (matched?.label) {
      return matched.label;
    }
    if (selectedProviderModel.provider === 'self') {
      return 'No model';
    }
    return formatModelName(selectedProviderModel.provider, selectedProviderModel.model || 'unknown model');
  }, [combinedModelOptions, selectedProviderModel.model, selectedProviderModel.provider, settings?.preferred_model_key, settingsForm?.preferred_model_key]);
  const quizComplete = quizCompleted;
  const shouldShowQuestionFeedback = Boolean(questionResult && (!quizComplete ? showFeedbackOnAnswer : showFeedbackOnCompletion));
  const settingsFilterHasMatches = [
    settingsMatches('appearance', 'theme', 'dark mode', 'light mode'),
    settingsMatches('preferred model', 'model selection', 'grading model'),
    settingsMatches(
      'feedback',
      'show feedback on answer',
      'show feedback on quiz completion',
      'automatically inject context',
      'inject context',
    ),
    settingsMatches('auto advance', 'auto-advance', 'auto advance delay', 'question delay'),
    settingsMatches('question timer', 'timer', 'countdown'),
    settingsMatches('mcq explanations', 'explanations', 'explain'),
    settingsMatches('quizzes', 'quiz folder', 'quiz library', 'import folder', 'open quizzes folder', 'drag and drop'),
    settingsMatches('claude api key', 'claude'),
    settingsMatches('openai api key', 'openai'),
  ].some(Boolean);
  const settingsDirty = useMemo(() => {
    if (!settingsForm || !settings) {
      return false;
    }
    const normalizedAutoAdvanceMs = parseNonNegativeInt(
      autoAdvanceDelayDraft,
      settingsForm.auto_advance_ms ?? settings.auto_advance_ms ?? 0,
    );
    const normalizedQuestionTimerSeconds = parseNonNegativeInt(
      settingsForm.question_timer_seconds,
      settings.question_timer_seconds ?? 0,
    );
    const nextForm = {
      ...settingsForm,
      auto_advance_ms: normalizedAutoAdvanceMs,
      question_timer_seconds: normalizedQuestionTimerSeconds,
    };
    return JSON.stringify(nextForm) !== JSON.stringify(settings);
  }, [autoAdvanceDelayDraft, settingsForm, settings]);
  function renderPerformanceHistoryPanel() {
    return (
      <div className="performance-sidebar">
        {activeHistoryQuizPath ? (
          <div className="row performance-context-nav">
            <button type="button" onClick={() => goToOlderHistoryContext()} disabled={!hasOlderHistoryContext}>
              ←
            </button>
            <div className="performance-context-label">
              <strong>{activeHistoryQuizTitle || activeHistoryQuizPath}</strong>
            </div>
            <button type="button" onClick={() => goToNewerHistoryContext()} disabled={!hasNewerHistoryContext}>
              →
            </button>
            <label className="performance-sort-control">
              <span>Sort by</span>
              <select
                value={historySortMode}
                onChange={(event) => setHistorySortMode(String(event.target.value || 'most_recent'))}
              >
                <option value="most_recent">Most recent</option>
                <option value="least_recent">Least recent</option>
              </select>
            </label>
            <button type="button" disabled={gradingHistoryAttempt} onClick={() => loadHistory()}>
              Refresh
            </button>
          </div>
        ) : null}

        {!activeHistoryQuizPath ? (
          <p className="roots-empty">Right-click a quiz and choose Performance History to view attempts.</p>
        ) : historyFiltered.length ? (
          <div className="performance-session-grid">
            <ul className="attempt-list performance-attempt-list">
              {historyFiltered.map((record, index) => (
                <li key={`${record.timestamp}-${record.attempt_number}-${index}`}>
                  <button
                    type="button"
                    className={selectedAttemptIndex === index ? 'selected' : ''}
                    onClick={() => setSelectedAttemptIndex(index)}
                  >
                    <span className="performance-attempt-cell attempt">{`Attempt #${record.attempt_number}`}</span>
                    <span className="performance-attempt-cell percent">
                      {`${Number(record.percent || 0).toFixed(1)}% correct`}
                    </span>
                    <span className="performance-attempt-cell grader">{record.model_key || 'No model'}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="attempt-detail performance-attempt-detail">
              {selectedAttempt && activeHistoryQuizPath ? (
                <>
                  <div className="performance-attempt-header">
                    <h5>{selectedAttempt.quiz_title || selectedAttempt.quiz_path}</h5>
                    <span className="performance-attempt-timestamp">
                      {formatHistoryTimestamp(selectedAttempt.timestamp)}
                    </span>
                  </div>
                  {selectedAttemptUngradedIndexes.length ? (
                    <div className="row performance-attempt-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={gradingHistoryAttempt}
                        onClick={() => {
                          void gradeSelectedAttemptRetrospectively();
                        }}
                      >
                        {gradingHistoryAttempt
                          ? 'Grading Ungraded...'
                          : `Grade Ungraded (${selectedAttemptUngradedIndexes.length})`}
                      </button>
                    </div>
                  ) : null}
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
                            {isUngradedAttemptQuestion(question)
                              ? 'Ungraded'
                              : `${question.points_awarded}/${question.max_points}`}
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
        ) : (
          <p className="roots-empty">No attempts yet for this quiz.</p>
        )}
      </div>
    );
  }

  function renderFeedbackChatPanel() {
    if (!latestQuizNote) {
      return <p className="roots-empty">Answer a question to start feedback chat.</p>;
    }

    return (
      <div className="feedback-chat">
        <div className="row between">
          <h4>Feedback Chat</h4>
          {feedbackChatSending ? <span className="feedback-chat-status">Thinking...</span> : null}
        </div>
        <div className="feedback-chat-log">
          {(feedbackChatMessages.length
            ? feedbackChatMessages
            : [{ role: 'assistant', text: latestQuizNote }]).map((entry, index) => (
              <div
                key={`feedback-chat-${entry.role}-${index}`}
                className={`feedback-chat-message ${entry.role === 'assistant' ? 'assistant' : 'user'}`}
              >
                <span className="feedback-chat-role">{entry.role === 'assistant' ? 'Assistant' : 'You'}</span>
                <MathText as="div" className="math-text" text={entry.text} />
              </div>
            ))}
          <div ref={feedbackChatEndRef} />
        </div>
        <div className="feedback-chat-compose">
          <textarea
            value={feedbackChatDraft}
            onChange={(event) => setFeedbackChatDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendFeedbackFollowup();
              }
            }}
            placeholder="Ask a follow-up question about this feedback"
            disabled={feedbackChatSending || selectedProviderModel.provider === 'self'}
          />
          <button
            type="button"
            className="primary"
            disabled={!String(feedbackChatDraft || '').trim() || feedbackChatSending || selectedProviderModel.provider === 'self'}
            onClick={() => {
              void sendFeedbackFollowup();
            }}
          >
            Send
          </button>
        </div>
        {selectedProviderModel.provider === 'self' ? (
          <p className="feedback-chat-hint">
            Select a non-self Preferred model in Settings to ask follow-up feedback questions.
          </p>
        ) : null}
      </div>
    );
  }

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

      {quizContextMenu.open ? (
        <div className="quiz-context-menu-overlay" onClick={() => closeQuizContextMenu()}>
          <div
            className="quiz-context-menu"
            style={{ top: `${quizContextMenu.y}px`, left: `${quizContextMenu.x}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                void handleQuizContextRename(quizContextMenu.path, quizContextMenu.name);
              }}
            >
              Rename
            </button>
            <button type="button" onClick={() => openHistoryFromContextMenu()}>
              Performance History
            </button>
          </div>
        </div>
      ) : null}
      {quizClockMenu.open ? (
        <div className="quiz-clock-menu-overlay" onClick={() => closeQuizClockMenu()}>
          <div
            className="quiz-clock-menu"
            style={{ top: `${quizClockMenu.y}px`, left: `${quizClockMenu.x}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="quiz-clock-menu-title">Quiz Clock</div>
            <div className="quiz-clock-menu-actions">
              <button
                type="button"
                onClick={() => {
                  setQuizClockMode('stopwatch');
                  closeQuizClockMenu();
                }}
              >
                Stopwatch
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuizClockMode('timer');
                  closeQuizClockMenu();
                }}
              >
                Timer
              </button>
            </div>
            <label className="field quiz-clock-menu-field">
              <span>Timer duration (minutes)</span>
              <input
                type="number"
                min={1}
                max={24 * 60}
                step={1}
                value={quizClockMenu.draftMinutes}
                onChange={(event) =>
                  setQuizClockMenu((prev) => ({
                    ...prev,
                    draftMinutes: event.target.value,
                  }))
                }
              />
            </label>
            <button type="button" className="primary" onClick={() => applyQuizTimerFromMenu()}>
              Save and use timer
            </button>
          </div>
        </div>
      ) : null}

      <nav className="tabs">
        <div className="tabs-list">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab-link ${normalizedActiveTab === tab ? 'active' : ''}`.trim()}
              onClick={() => {
                void handleTabChange(tab);
              }}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`quiz-clock tabs-quiz-clock ${quizClockMode === 'timer' ? 'timer-mode' : ''}${quizTimerExpired ? ' expired' : ''}`}
          onContextMenu={(event) => openQuizClockMenu(event)}
          title="Right-click to switch between stopwatch and timer."
        >
          {quizClockMode === 'timer'
            ? `Timer: ${formatCountdown(quizTimerRemainingMs)}`
            : `Stopwatch: ${formatElapsedTime(quizElapsedMs)}`}
        </button>
      </nav>

      <main className="tab-panel">
        {normalizedActiveTab === 'quiz' ? (
          <section className="quiz-layout">
            <aside className="quiz-selector-column">
              <div className="card tree-card">
                <div className="row between">
                  <div className="quiz-selector-tabs" role="tablist" aria-label="Quiz sidebar panels">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={quizSelectorPanelTab === 'quizzes'}
                      className={`quiz-selector-tab ${quizSelectorPanelTab === 'quizzes' ? 'active' : ''}`.trim()}
                      onClick={() => setQuizSelectorPanelTab('quizzes')}
                    >
                      Quizzes
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={quizSelectorPanelTab === 'feedback'}
                      className={
                        `quiz-selector-tab ${quizSelectorPanelTab === 'feedback' ? 'active' : ''} ${feedbackTabNeedsAttention ? 'attention' : ''}`.trim()
                      }
                      onClick={() => {
                        setQuizSelectorPanelTab('feedback');
                        setFeedbackTabNeedsAttention(false);
                      }}
                    >
                      Feedback
                    </button>
                  </div>
                  {quizSelectorPanelTab === 'quizzes' ? (
                    <span className="quiz-tree-hint">Click folders to collapse. Right-click quizzes for options.</span>
                  ) : null}
                </div>
                {quizSelectorPanelTab === 'quizzes' ? (
                  <>
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
                      onOpenContextMenu={handleQuizTreeContextMenu}
                    />
                    {!visibleQuizTreeNodes.length ? (
                      <p className="roots-empty">No quizzes match the current filter.</p>
                    ) : null}
                  </>
                ) : (
                  <div className="quiz-selector-feedback">
                    {renderFeedbackChatPanel()}
                  </div>
                )}
              </div>
              {quizSelectorPanelTab === 'quizzes' ? (
                <button
                  type="button"
                  className="primary start-quiz-column-btn"
                  disabled={!selectedQuizPath}
                  onClick={() => startSelectedQuiz()}
                >
                  Start Selected Quiz
                </button>
              ) : null}
            </aside>

            <section className="card quiz-card">
              <div className="row between">
                <h2>{showingPerformanceHistory ? 'Performance History' : (quiz ? quiz.title : 'Quiz')}</h2>
                {quiz ? <div className="score">{`Score: ${quizScore}/${maxScore}`}</div> : null}
              </div>

              {quizLoadError ? <div className="banner error">{quizLoadError}</div> : null}

              {quiz && currentQuestion ? (
                <div className={`question-shell ${showingPerformanceHistory ? 'performance-history-open' : ''}`}>
                  <div className="question-block">
                    <div className="row question-step-controls">
                      <button type="button" disabled={!canGoPrevQuestion || autoAdvanceEnabled} onClick={() => goToPreviousQuestion()}>
                        ← Previous
                      </button>
                      <button type="button" disabled={!canGoForwardQuestion} onClick={() => goToForwardQuestion()}>
                        Forward →
                      </button>
                      {showQuestionTimer ? (
                        <div className="question-step-right">
                          <span className={`question-timer ${questionTimeLeftMs <= 5000 ? 'urgent' : ''}`}>
                            Time left: {formatCountdown(questionTimeLeftMs)}
                          </span>
                        </div>
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
                          <div className="banner warn">No model selected: short answers are saved as ungraded.</div>
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
                      <button
                        type="button"
                        onClick={() => {
                          void injectQuizContext();
                        }}
                      >
                        {injectedContextPaths.length ? `Inject Context (${injectedContextPaths.length})` : 'Inject Context'}
                      </button>
                      {injectedContextPaths.length ? (
                        <button
                          type="button"
                          onClick={() => setShowInjectedContextPanel((prev) => !prev)}
                        >
                          {showInjectedContextPanel ? 'Hide Injected Context' : 'View Injected Context'}
                        </button>
                      ) : null}

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
                        <button type="button" onClick={() => openCurrentQuizPerformanceHistory()}>
                          See Performance History
                        </button>
                      ) : null}

                      {quizComplete ? (
                        <button type="button" onClick={() => restartQuiz()}>
                          Restart Quiz
                        </button>
                      ) : null}
                    </div>
                    {showInjectedContextPanel && injectedContextPaths.length ? (
                      <div className="injected-context-panel">
                        <div className="row between">
                          <strong>Injected Files</strong>
                        </div>
                        <ul className="injected-context-file-list">
                          {injectedContextPaths.map((pathValue) => {
                            const fullPath = String(pathValue || '').trim();
                            if (!fullPath) {
                              return null;
                            }
                            return (
                              <li key={fullPath}>
                                <span className="injected-context-file-name">{shortPathLabel(fullPath) || fullPath}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {injectedContextPaths.length ? (
                      <p className="injected-context-status">
                        Context loaded from {injectedContextPaths.length} source{injectedContextPaths.length === 1 ? '' : 's'}.
                      </p>
                    ) : null}
                  </div>

                  {showingPerformanceHistory ? (
                    <aside className="question-nav-column performance-history-column">
                      {renderPerformanceHistoryPanel()}
                    </aside>
                  ) : (
                    <aside className="question-nav-column">
                      <h4>Question Nav</h4>
                      <div className="question-nav-list">
                        {quiz.questions.map((q, index) => {
                          const questionState = questionStates[index];
                          const answered = Boolean(questionState);
                          const reachable = index <= furthestReachableIndex;
                          const blockedByAutoAdvance = autoAdvanceEnabled && index < quizIndex;
                          const current = index === quizIndex;
                          const result = questionState?.result;
                          const hasGradedOutcome = typeof result?.correct === 'boolean' && !result?.ungraded;

                          let navStatusLabel = reachable ? 'Open' : 'Locked';
                          let navStatusClass = '';
                          if (blockedByAutoAdvance) {
                            navStatusLabel = 'Locked';
                          } else if (answered) {
                            if (showFeedbackOnAnswer && hasGradedOutcome) {
                              navStatusLabel = result.correct ? 'Correct' : 'Incorrect';
                              navStatusClass = result.correct ? ' correct' : ' incorrect';
                            } else if (showFeedbackOnCompletion) {
                              navStatusLabel = 'Done';
                              navStatusClass = ' done';
                              if (quizComplete && hasGradedOutcome) {
                                navStatusLabel = result.correct ? 'Correct' : 'Incorrect';
                                navStatusClass = result.correct ? ' correct' : ' incorrect';
                              }
                            }
                          }

                          return (
                            <button
                              key={`qnav-${q.id || index}`}
                              type="button"
                              disabled={!reachable || blockedByAutoAdvance}
                              className={`question-nav-button${current ? ' current' : ''}${navStatusClass}`}
                              onClick={() => jumpToQuestion(index)}
                            >
                              <span>Q{index + 1}</span>
                              <span>{navStatusLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </aside>
                  )}
                </div>
              ) : showingPerformanceHistory ? (
                <section className="performance-standalone">
                  {renderPerformanceHistoryPanel()}
                </section>
              ) : (
                <p>Select and start a quiz to begin.</p>
              )}

            </section>
          </section>
        ) : null}

        {normalizedActiveTab === 'generate' ? (
          <section className="generate-layout">
            <section className="card">
              <div className="row between">
                <h2>Sources</h2>
                <div className="row">
                  <button type="button" onClick={() => importSourcesFromFinder()}>
                    Import Sources
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceInputs([]);
                      setCollectedSources([]);
                      setGenerateWarnings([]);
                      setGenerateErrors([]);
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div
                className={`generate-source-drop ${generateDragOver ? 'drag-over' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setGenerateDragOver(true);
                }}
                onDragLeave={() => setGenerateDragOver(false)}
                onDrop={(event) => {
                  void handleGenerateSourcesDrop(event);
                }}
              >
                Drag and drop source files/folders here.
              </div>
              <ul className="source-list">
                {sourceInputs.length ? (
                  sourceInputs.map((item) => (
                    <li key={item}>{shortPathLabel(item) || item}</li>
                  ))
                ) : (
                  <li className="source-placeholder">No sources selected yet.</li>
                )}
              </ul>
            </section>

            <section className="card">
              <h2>Generation</h2>
              <div className="form-grid">
                <div className="field">
                  <span>Preferred model</span>
                  <div className="settings-warning-note">
                    Quiz generation and grading use: <strong>{preferredModelLabel}</strong>
                  </div>
                </div>

                <label className="field">
                  <span>MCQ</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={generationForm.mcq_count ?? ''}
                    onChange={(event) => updateGenerationNumberFieldDraft('mcq_count', event.target.value)}
                    onBlur={() => commitGenerationNumberField('mcq_count')}
                    onKeyDown={(event) => onGenerationNumberFieldKeyDown(event, 'mcq_count')}
                  />
                </label>

                <label className="field">
                  <span>Short</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={generationForm.short_count ?? ''}
                    onChange={(event) => updateGenerationNumberFieldDraft('short_count', event.target.value)}
                    onBlur={() => commitGenerationNumberField('short_count')}
                    onKeyDown={(event) => onGenerationNumberFieldKeyDown(event, 'short_count')}
                  />
                </label>

                <div className="field">
                  <span>MCQ options</span>
                  <div className="settings-warning-note">Fixed at 4 options per question.</div>
                </div>

                <label className="field">
                  <span>Output folder (inside Quizzes)</span>
                  <select
                    value={selectedGenerationOutputFolder?.value || ''}
                    onChange={(event) => setGenerationOutputSubdir(event.target.value)}
                  >
                    {generationOutputFolderOptions.length ? (
                      generationOutputFolderOptions.map((option) => (
                        <option key={option.value || '__root__'} value={option.value}>
                          {option.label}
                        </option>
                      ))
                    ) : (
                      <option value="">Quizzes</option>
                    )}
                  </select>
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

              <section className="preflight-summary">
                <h3>Preflight Summary</h3>
                <div className="preflight-item">
                  <strong>Source files</strong>
                  <span>
                    {collectedSources.length
                      ? `${collectedSources.length} supported files ready.`
                      : (sourceInputs.length ? 'No supported source files detected.' : 'Add sources to build this summary automatically.')}
                  </span>
                </div>
                <ul className="source-list preflight-list">
                  {collectedSources.length ? (
                    collectedSources.map((source) => (
                      <li key={`${source.path}:${source.source_kind}`}>
                        {shortPathLabel(source.path) || source.path}
                      </li>
                    ))
                  ) : (
                    <li className="source-placeholder">Supported files appear here automatically after adding sources.</li>
                  )}
                </ul>
                <div className="preflight-item">
                  <strong>Target output folder</strong>
                  <span>{selectedGenerationOutputFolder?.absolute_path || quizzesDir || 'Quizzes'}</span>
                </div>
              </section>

              <div className="row">
                <button
                  type="button"
                  className="primary"
                  disabled={isGeneratingQuiz}
                  onClick={() => runGeneration()}
                >
                  {isGeneratingQuiz ? (
                    <span className="button-loading">
                      <span className="loading-spinner" aria-hidden="true" />
                      Generating...
                    </span>
                  ) : (
                    'Generate Quiz'
                  )}
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

        {normalizedActiveTab === 'settings' && settingsForm ? (
          <section className="card settings-layout">
            <div className="row between">
              <h2>Settings</h2>
              <button type="button" onClick={() => handleImportLegacy()}>
                Import Legacy
              </button>
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

            {settingsMatches(
              'feedback',
              'show feedback on answer',
              'show feedback on quiz completion',
              'automatically inject context',
              'inject context',
            ) ? (
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

                  <label className="field checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(settingsForm.auto_inject_context)}
                      onChange={(event) =>
                        setSettingsForm((prev) => ({ ...prev, auto_inject_context: event.target.checked }))
                      }
                    />
                    <span>Automatically inject context</span>
                  </label>
                </div>
                <div className="settings-warning-note">
                  Reuses source files from quiz generation as extra context for grading and explanations.
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
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={autoAdvanceDelayDraft}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (!/^\d*$/.test(next)) {
                                return;
                              }
                              setAutoAdvanceDelayDraft(next);
                            }}
                            onBlur={() => commitAutoAdvanceDelayDraft()}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== 'Return') {
                                return;
                              }
                              event.preventDefault();
                              commitAutoAdvanceDelayDraft();
                              event.currentTarget.blur();
                            }}
                          />
                        </label>

                        {autoAdvanceEnabled ? (
                          <div className="settings-warning-note">
                            Auto-advance is enabled. Going back to previous questions is disabled during quizzes.
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {settingsMatches('question timer', 'timer', 'countdown') ? (
                      <label className="field">
                        <span>Question timer (seconds, 0 = off)</span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={settingsForm.question_timer_seconds ?? ''}
                          onChange={(event) => {
                            const next = event.target.value;
                            if (!/^\d*$/.test(next)) {
                              return;
                            }
                            setSettingsForm((prev) => ({
                              ...prev,
                              question_timer_seconds: next,
                            }));
                          }}
                          onBlur={() => commitQuestionTimerSeconds()}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== 'Return') {
                              return;
                            }
                            event.preventDefault();
                            commitQuestionTimerSeconds();
                            event.currentTarget.blur();
                          }}
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
                    type="password"
                    value={settingsForm.claude_api_key || ''}
                    onChange={(event) => setSettingsForm((prev) => ({ ...prev, claude_api_key: event.target.value }))}
                  />
                </label>
              ) : null}

              {settingsMatches('openai api key', 'openai') ? (
                <label className="field">
                  <span>OpenAI API key</span>
                  <input
                    type="password"
                    value={settingsForm.openai_api_key || ''}
                    onChange={(event) => setSettingsForm((prev) => ({ ...prev, openai_api_key: event.target.value }))}
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
