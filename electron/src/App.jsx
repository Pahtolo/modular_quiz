import React, { useEffect, useMemo, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import { apiRequest, backendInfo, openPath, pickFiles, pickFolder } from './api';

const TABS = ['quiz', 'generate', 'performance', 'settings'];
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

function QuizTree({ nodes, selectedPath, onSelect }) {
  const renderNode = (node) => {
    const isQuiz = node.kind === 'quiz';
    return (
      <li key={`${node.kind}-${node.path}`}>
        <button
          className={`tree-node ${isQuiz ? 'quiz' : 'group'} ${selectedPath === node.path ? 'selected' : ''}`}
          type="button"
          onClick={() => {
            if (isQuiz) {
              onSelect(node.path);
            }
          }}
        >
          {node.name}
        </button>
        {node.children && node.children.length > 0 ? (
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
  const [activeTab, setActiveTab] = useState('quiz');
  const [startupError, setStartupError] = useState('');
  const [apiStatus, setApiStatus] = useState('');

  const [settings, setSettings] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);
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

  const [globalBusy, setGlobalBusy] = useState(false);

  const combinedModelOptions = useMemo(() => {
    const options = [{ key: 'self:', label: 'Self grading', provider: 'self' }];
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

  const maxScore = useMemo(() => {
    if (!quiz || !quiz.questions) {
      return 0;
    }
    return quiz.questions.reduce((acc, q) => acc + Number(q.points || 0), 0);
  }, [quiz]);

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

  useEffect(() => {
    void boot();
  }, []);

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

  async function boot() {
    setGlobalBusy(true);
    setStartupError('');

    try {
      const info = await backendInfo();
      if (!info.ready) {
        throw new Error('Backend is not ready.');
      }
      setApiStatus(`Connected to ${info.baseUrl}`);

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
    } finally {
      setGlobalBusy(false);
    }
  }

  async function loadModels() {
    setModelLoadError('');
    const next = {
      self: [{ id: '', label: 'Self grading', provider: 'self', capability_tags: [] }],
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
    setApiStatus(`Imported ${Number(response.imported_files || 0)} quiz file(s).`);
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
      return;
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
      setApiStatus('Settings saved.');
    } catch (err) {
      setStartupError(`Failed to save settings: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleImportLegacy() {
    try {
      const response = await apiRequest('/v1/settings/import-legacy', 'POST', {
        overwrite_existing: false,
      });
      setApiStatus(
        `Legacy import: settings=${response.imported_settings ? 'yes' : 'no'}, history=${response.imported_history ? 'yes' : 'no'}`,
      );
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

  async function handleOAuthConnect() {
    try {
      await apiRequest('/v1/oauth/openai/connect', 'POST', {});
      const settingsResponse = await apiRequest('/v1/settings', 'GET');
      setSettings(settingsResponse.settings);
      setSettingsForm({ ...settingsResponse.settings });
      setApiStatus('OpenAI OAuth connected successfully.');
    } catch (err) {
      setStartupError(`OAuth connect failed: ${err.message}`);
    }
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
      setQuizSaved(false);
      setActiveTab('quiz');
    } catch (err) {
      setQuizLoadError(err.message);
    }
  }

  function lockQuestionAfterResult(result, userAnswer, expectedText) {
    setQuestionResult(result);
    setQuestionLocked(true);
    setQuizScore((prev) => prev + Number(result.points_awarded || 0));
    setQuizNotes((prev) => [...prev, result.feedback]);

    if (currentQuestion) {
      setAttemptQuestions((prev) => [
        ...prev,
        {
          question_id: String(currentQuestion.id || `q${quizIndex + 1}`),
          question_type: currentQuestion.type,
          user_answer: userAnswer,
          correct_answer_or_expected: expectedText,
          points_awarded: Number(result.points_awarded || 0),
          max_points: Number(result.max_points || 0),
          feedback: result.feedback || '',
        },
      ]);
    }
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
      setQuizLoadError('Self grading does not support MCQ explanation.');
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
      setQuestionResult(null);
      setQuestionLocked(false);
      setMcqAnswer('');
      setShortAnswer('');
      setSelfScore('');
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
      feedback: 'Quiz finished.',
    });
    setQuestionLocked(true);
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
  const latestQuizNote = quizNotes.length ? quizNotes[quizNotes.length - 1] : '';

  return (
    <div className="app-root">
      <header className="topbar">
        <div>
          <h1>Modular Quiz</h1>
          <p>{apiStatus || 'Initializing...'}</p>
        </div>
        {globalBusy ? <span className="pill">Loading</span> : null}
      </header>

      {startupError ? <div className="banner error">{startupError}</div> : null}
      {modelLoadError ? <div className="banner warn">{modelLoadError}</div> : null}

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
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
                  <button type="button" onClick={() => loadQuizTree()}>
                    Refresh
                  </button>
                </div>
                <QuizTree nodes={quizTreeRoots} selectedPath={selectedQuizPath} onSelect={setSelectedQuizPath} />
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
                <strong>Selected quiz:</strong> {selectedQuizPath ? selectedQuizPath.split('/').slice(-1)[0] : 'None'}
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
                <div className="question-block">
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

                  {questionResult ? (
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
                <button type="button" onClick={() => handleOAuthConnect()}>
                  Connect OpenAI OAuth
                </button>
              </div>
            </div>

            <div className="form-grid two-col">
              <label className="field">
                <span>Quiz directory</span>
                <input
                  value={settingsForm.quiz_dir || ''}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, quiz_dir: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Performance history path</span>
                <input
                  value={settingsForm.performance_history_path || ''}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({ ...prev, performance_history_path: event.target.value }))
                  }
                />
              </label>

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

              <label className="field">
                <span>Feedback mode</span>
                <select
                  value={settingsForm.feedback_mode || 'show_then_next'}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, feedback_mode: event.target.value }))}
                >
                  <option value="show_then_next">show_then_next</option>
                  <option value="auto_advance">auto_advance</option>
                  <option value="end_only">end_only</option>
                </select>
              </label>

              <label className="field">
                <span>Auto advance (ms)</span>
                <input
                  type="number"
                  value={settingsForm.auto_advance_ms || 0}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({ ...prev, auto_advance_ms: Number(event.target.value) }))
                  }
                />
              </label>

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
            </div>

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

            <div className="form-grid two-col">
              <label className="field">
                <span>Claude API key</span>
                <input
                  value={settingsForm.claude_api_key || ''}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, claude_api_key: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Claude model selected</span>
                <input
                  value={settingsForm.claude_model_selected || ''}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({ ...prev, claude_model_selected: event.target.value }))
                  }
                />
              </label>

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

              <label className="field">
                <span>OpenAI API key</span>
                <input
                  value={settingsForm.openai_api_key || ''}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, openai_api_key: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>OpenAI model selected</span>
                <input
                  value={settingsForm.openai_model_selected || ''}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({ ...prev, openai_model_selected: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Generation output subdir</span>
                <input
                  value={settingsForm.generation_output_subdir || ''}
                  onChange={(event) =>
                    setSettingsForm((prev) => ({ ...prev, generation_output_subdir: event.target.value }))
                  }
                />
              </label>
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
