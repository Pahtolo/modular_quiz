const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('modularQuiz', {
  backend: {
    getInfo: () => ipcRenderer.invoke('backend:get-info'),
    request: (path, method = 'GET', body = undefined) =>
      ipcRenderer.invoke('backend:request', { path, method, body }),
  },
  dialog: {
    pickFiles: () => ipcRenderer.invoke('dialog:pick-files'),
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
    pickSourceInputs: () => ipcRenderer.invoke('dialog:pick-source-inputs'),
  },
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:open-path', { path }),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', { url }),
  },
  sources: {
    stageDroppedFiles: (files) => ipcRenderer.invoke('sources:stage-dropped-files', { files }),
  },
  quizzes: {
    deleteItem: (path) => ipcRenderer.invoke('quizzes:delete-item', { path }),
  },
});
