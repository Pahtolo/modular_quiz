const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

let mainWindow = null;
let backendProcess = null;
let backendInfo = {
  baseUrl: '',
  token: '',
  ready: false,
};
const DROPPED_SOURCE_STAGING_ROOT = 'modular-quiz-drops';
const DROPPED_SOURCE_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function projectRoot() {
  return path.resolve(__dirname, '..');
}

function resolveOcrRuntimeEnv() {
  const candidateRoots = [
    path.join(process.resourcesPath, 'backend', 'ocr-runtime'),
    path.join(projectRoot(), 'electron', 'build', 'ocr-runtime'),
  ];
  for (const root of candidateRoots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    const binDir = path.join(root, 'bin');
    const tessdataDir = path.join(root, 'tessdata');
    const env = {};
    if (fs.existsSync(binDir)) {
      env.OCR_BIN_DIR = binDir;
    }
    if (fs.existsSync(tessdataDir)) {
      env.TESSDATA_PREFIX = tessdataDir;
    }
    if (Object.keys(env).length) {
      return env;
    }
  }
  return {};
}

function resolveBackendLaunch() {
  const packagedCandidates = [
    path.join(process.resourcesPath, 'backend', 'modular-quiz-api'),
    path.join(process.resourcesPath, 'backend', 'modular-quiz-api.exe'),
  ];
  const packagedSidecar = app.isPackaged
    ? packagedCandidates.find((candidate) => fs.existsSync(candidate))
    : null;
  if (packagedSidecar) {
    return {
      cmd: packagedSidecar,
      args: [],
      mode: 'packaged-sidecar',
    };
  }

  const sidecarBin = process.env.API_SIDECAR_BIN;
  if (sidecarBin && fs.existsSync(sidecarBin)) {
    return {
      cmd: sidecarBin,
      args: [],
      mode: 'sidecar',
    };
  }

  const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const runApiPath = path.resolve(projectRoot(), 'run_api.py');
  return {
    cmd: pythonBin,
    args: [runApiPath],
    mode: 'python',
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function apiRequest(pathname, method = 'GET', body = undefined) {
  if (!backendInfo.baseUrl || !backendInfo.token) {
    throw new Error('Backend is not initialized');
  }

  const url = `${backendInfo.baseUrl}${pathname}`;
  const headers = {
    Authorization: `Bearer ${backendInfo.token}`,
  };
  const options = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_err) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const errorMessage = payload && payload.error && payload.error.message
      ? payload.error.message
      : `HTTP ${response.status}`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function waitForBackend(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await apiRequest('/v1/health', 'GET');
      backendInfo.ready = true;
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  throw new Error(`Backend did not become ready: ${lastError ? lastError.message : 'timeout'}`);
}

async function maybeImportLegacy() {
  if (app.isPackaged) {
    return;
  }

  const markerPath = path.join(app.getPath('userData'), 'legacy_import_v1.json');
  if (fs.existsSync(markerPath)) {
    return;
  }

  const legacyRoot = projectRoot();
  const legacySettingsPath = path.resolve(legacyRoot, 'settings', 'settings.json');
  const legacyHistoryPath = path.resolve(legacyRoot, 'settings', 'performance_history.json');

  try {
    await apiRequest('/v1/settings/import-legacy', 'POST', {
      legacy_project_root: legacyRoot,
      legacy_settings_path: legacySettingsPath,
      legacy_history_path: legacyHistoryPath,
      overwrite_existing: false,
    });

    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ imported_at: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.warn('[electron] legacy import skipped:', err.message);
  }
}

async function startBackend() {
  if (backendProcess) {
    return;
  }

  const port = await getFreePort();
  const token = crypto.randomBytes(32).toString('hex');
  const settingsPath = path.join(app.getPath('userData'), 'settings', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  const launch = resolveBackendLaunch();
  const args = [
    ...launch.args,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--token',
    token,
    '--settings-path',
    settingsPath,
    '--project-root',
    projectRoot(),
  ];

  backendInfo = {
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    ready: false,
  };

  backendProcess = spawn(launch.cmd, args, {
    cwd: projectRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...resolveOcrRuntimeEnv(),
      PYTHONUNBUFFERED: '1',
    },
  });

  backendProcess.stdout.on('data', (data) => {
    process.stdout.write(`[api] ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    process.stderr.write(`[api] ${data}`);
  });

  backendProcess.on('exit', (code, signal) => {
    console.warn(`[electron] backend exited code=${code} signal=${signal}`);
    backendInfo.ready = false;
    backendProcess = null;
  });

  await waitForBackend(30000);
  await maybeImportLegacy();
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }

  try {
    backendProcess.kill('SIGTERM');
  } catch (_err) {
    // no-op
  }
  backendProcess = null;
  backendInfo.ready = false;
}

function managedQuizzesRoot() {
  return path.resolve(app.getPath('userData'), 'Quizzes');
}

function droppedSourceStagingRoot() {
  return path.join(app.getPath('temp'), DROPPED_SOURCE_STAGING_ROOT);
}

function sanitizePathSegment(value, fallback = 'item') {
  const sanitized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '')
    .replace(/\.+$/, '');
  return sanitized || fallback;
}

function pruneDroppedSourceStaging() {
  const root = droppedSourceStagingRoot();
  if (!fs.existsSync(root)) {
    return;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryPath = path.join(root, entry.name);
    try {
      const stats = fs.statSync(entryPath);
      if ((Date.now() - stats.mtimeMs) > DROPPED_SOURCE_STAGING_MAX_AGE_MS) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    } catch (_err) {
      // Best-effort cleanup only.
    }
  }
}

function uniqueTargetPath(rootPath, relativePath) {
  const parsed = path.parse(path.join(rootPath, relativePath));
  let attempt = path.join(parsed.dir, `${parsed.name}${parsed.ext}`);
  let counter = 1;
  while (fs.existsSync(attempt)) {
    attempt = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
    counter += 1;
  }
  return attempt;
}

function normalizeDroppedRelativePath(entry, index) {
  const rawRelativePath = String(entry?.relativePath || '').replace(/\\/g, '/');
  const rawName = String(entry?.name || '').trim();
  const segments = rawRelativePath
    .split('/')
    .map((segment, segmentIndex, allSegments) => sanitizePathSegment(
      segment,
      segmentIndex === allSegments.length - 1 ? sanitizePathSegment(rawName, `source-${index + 1}`) : 'folder',
    ))
    .filter((segment) => segment);

  if (segments.length) {
    return path.join(...segments);
  }

  return sanitizePathSegment(rawName, `source-${index + 1}`);
}

function stageDroppedFiles(files) {
  pruneDroppedSourceStaging();

  const root = droppedSourceStagingRoot();
  fs.mkdirSync(root, { recursive: true });

  const sessionDir = path.join(
    root,
    `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
  );
  fs.mkdirSync(sessionDir, { recursive: true });

  const returnedPaths = [];
  const seenReturnedPaths = new Set();

  for (let index = 0; index < files.length; index += 1) {
    const entry = files[index];
    const base64 = String(entry?.data_base64 || '').trim();
    if (!base64) {
      continue;
    }

    const relativePath = normalizeDroppedRelativePath(entry, index);
    const targetPath = uniqueTargetPath(sessionDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, Buffer.from(base64, 'base64'));

    const topLevelName = relativePath.split(path.sep)[0];
    const returnedPath = relativePath.includes(path.sep)
      ? path.join(sessionDir, topLevelName)
      : targetPath;
    if (!seenReturnedPaths.has(returnedPath)) {
      seenReturnedPaths.add(returnedPath);
      returnedPaths.push(returnedPath);
    }
  }

  return returnedPaths;
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedQuizFile(targetPath) {
  if (path.extname(targetPath).toLowerCase() !== '.json') {
    return false;
  }
  return !(path.basename(targetPath) === 'settings.json' && path.basename(path.dirname(targetPath)) === 'settings');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 520,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'Modular Quiz',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIpcHandlers() {
  ipcMain.handle('backend:get-info', async () => {
    return {
      baseUrl: backendInfo.baseUrl,
      ready: backendInfo.ready,
    };
  });

  ipcMain.handle('backend:request', async (_event, args) => {
    const pathname = typeof args?.path === 'string' ? args.path : '';
    const method = typeof args?.method === 'string' ? args.method.toUpperCase() : 'GET';
    const body = args?.body;

    if (!pathname.startsWith('/v1/')) {
      throw new Error('Only /v1/* backend paths are allowed.');
    }

    return apiRequest(pathname, method, body);
  });

  ipcMain.handle('quizzes:delete-item', async (_event, args) => {
    const rawPath = String(args?.path || '').trim();
    if (!rawPath) {
      throw new Error('Quiz library path is required.');
    }
    const targetPath = path.resolve(rawPath);

    const quizzesRoot = managedQuizzesRoot();
    if (!isPathWithin(quizzesRoot, targetPath)) {
      throw new Error('Quiz folder operations must stay inside the managed Quizzes directory.');
    }
    if (targetPath === quizzesRoot) {
      throw new Error('The managed Quizzes directory itself cannot be modified by this action.');
    }
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Quiz library item not found: ${targetPath}`);
    }

    const stat = fs.lstatSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: false });
      return { deletedPath: targetPath, deletedKind: 'folder' };
    }
    if (stat.isFile()) {
      if (!isAllowedQuizFile(targetPath)) {
        throw new Error(`Unsupported quiz file: ${targetPath}`);
      }
      fs.rmSync(targetPath, { force: false });
      return { deletedPath: targetPath, deletedKind: 'quiz' };
    }

    throw new Error('Unsupported quiz library item.');
  });

  ipcMain.handle('dialog:pick-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Materials',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Supported Files',
          extensions: ['txt', 'md', 'pdf', 'pptx', 'docx'],
        },
      ],
    });
    if (result.canceled) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:pick-source-inputs', async () => {
    if (process.platform === 'win32') {
      const modeChoice = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Files', 'Folder', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Import Source Materials',
        message: 'Choose what to import',
        detail: 'Use Files for individual documents or Folder to recursively include all supported files.',
      });
      if (modeChoice.response === 2) {
        return [];
      }

      if (modeChoice.response === 1) {
        const folderResult = await dialog.showOpenDialog({
          title: 'Import Source Folders',
          properties: ['openDirectory', 'multiSelections'],
        });
        if (folderResult.canceled) {
          return [];
        }
        return folderResult.filePaths;
      }

      const filesResult = await dialog.showOpenDialog({
        title: 'Import Source Files',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Supported Files',
            extensions: ['txt', 'md', 'pdf', 'pptx', 'docx'],
          },
        ],
      });
      if (filesResult.canceled) {
        return [];
      }
      return filesResult.filePaths;
    }

    const result = await dialog.showOpenDialog({
      title: 'Import Source Materials',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        {
          name: 'Supported Files',
          extensions: ['txt', 'md', 'pdf', 'pptx', 'docx'],
        },
      ],
    });
    if (result.canceled) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.handle('shell:open-path', async (_event, payload) => {
    const target = String(payload?.path || '').trim();
    if (!target) {
      return { ok: false, error: 'Path is required.' };
    }
    const error = await shell.openPath(target);
    return { ok: !error, error: error || null };
  });

  ipcMain.handle('shell:open-external', async (_event, payload) => {
    const url = String(payload?.url || '').trim();
    if (!url) {
      return { ok: false, error: 'URL is required.' };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('sources:stage-dropped-files', async (_event, payload) => {
    const files = Array.isArray(payload?.files) ? payload.files : [];
    if (!files.length) {
      throw new Error('Dropped files payload is required.');
    }

    const paths = stageDroppedFiles(files);
    return { paths };
  });
}

app.whenReady().then(async () => {
  setupIpcHandlers();

  try {
    await startBackend();
    createMainWindow();
  } catch (err) {
    dialog.showErrorBox('Backend Startup Failed', String(err?.message || err));
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
