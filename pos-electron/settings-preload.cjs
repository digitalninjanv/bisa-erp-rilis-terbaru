const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("bisaPosSettings", {
    load: () => ipcRenderer.invoke("pos:settings:load"),
    save: (updates) => ipcRenderer.invoke("pos:settings:save", updates),
    testPrint: () => ipcRenderer.invoke("pos:settings:test-print"),
    refreshPrinters: () => ipcRenderer.invoke("pos:settings:printers"),
    close: () => ipcRenderer.invoke("pos:settings:close"),
    retryConnection: () => ipcRenderer.invoke("pos:offline:retry"),
    openSettingsFromOffline: () => ipcRenderer.invoke("pos:offline:open-settings"),
  });
}
