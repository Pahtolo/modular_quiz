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

export async function openPath(path) {
  return bridge.shell.openPath(path);
}

export async function openExternal(url) {
  return bridge.shell.openExternal(url);
}
