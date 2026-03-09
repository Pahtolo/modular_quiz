const bridge = window.modularQuiz;

if (!bridge) {
  throw new Error('Electron preload bridge is not available.');
}

export async function backendInfo() {
  return bridge.backend.getInfo();
}

export async function apiRequest(path, method = 'GET', body = undefined) {
  try {
    return await bridge.backend.request(path, method, body);
  } catch (err) {
    const payload = err && err.payload ? err.payload : null;
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : (err && err.message ? err.message : 'Request failed.');
    const error = new Error(message);
    error.payload = payload;
    error.status = err && err.status ? err.status : null;
    throw error;
  }
}

export async function pickFiles() {
  return bridge.dialog.pickFiles();
}

export async function pickFolder() {
  return bridge.dialog.pickFolder();
}

export async function pickSourceInputs() {
  return bridge.dialog.pickSourceInputs();
}

export async function openPath(path) {
  return bridge.shell.openPath(path);
}

export async function openExternal(url) {
  return bridge.shell.openExternal(url);
}

export async function getUpdaterStatus() {
  if (!bridge.updater || typeof bridge.updater.getStatus !== 'function') {
    return null;
  }
  return bridge.updater.getStatus();
}

export async function checkForAppUpdates() {
  if (!bridge.updater || typeof bridge.updater.check !== 'function') {
    throw new Error('Updater support is not available until the app restarts.');
  }
  return bridge.updater.check();
}

export async function downloadAppUpdate() {
  if (!bridge.updater || typeof bridge.updater.download !== 'function') {
    throw new Error('Updater support is not available until the app restarts.');
  }
  return bridge.updater.download();
}

export async function installAppUpdate() {
  if (!bridge.updater || typeof bridge.updater.install !== 'function') {
    throw new Error('Updater support is not available until the app restarts.');
  }
  return bridge.updater.install();
}

export function subscribeToUpdaterStatus(callback) {
  if (!bridge.updater || typeof bridge.updater.subscribeStatus !== 'function') {
    return () => {};
  }
  return bridge.updater.subscribeStatus(callback);
}

export async function stageDroppedFiles(files) {
  if (!bridge.sources || typeof bridge.sources.stageDroppedFiles !== 'function') {
    throw new Error('Dropped file staging support is not available until the app restarts.');
  }
  return bridge.sources.stageDroppedFiles(files);
}

export async function deleteManagedQuizItem(path) {
  if (!bridge.quizzes || typeof bridge.quizzes.deleteItem !== 'function') {
    throw new Error('Quiz deletion support is not available until the app restarts.');
  }
  return bridge.quizzes.deleteItem(path);
}
