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

function projectRoot() {
  return path.resolve(__dirname, '..');
}

function resolveBackendLaunch() {
  const packagedSidecar = path.join(process.resourcesPath, 'backend', 'modular-quiz-api');
  if (app.isPackaged && fs.existsSync(packagedSidecar)) {
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

  const pythonBin = process.env.PYTHON_BIN || 'python3';
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
