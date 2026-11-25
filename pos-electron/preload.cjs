const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  if (window.location.protocol === "file:") {
    contextBridge.exposeInMainWorld("bisaPosOffline", {
      getStatus: () => ipcRenderer.invoke("pos:offline:status"),
      retryConnection: () => ipcRenderer.invoke("pos:offline:retry"),
      openSettings: () => ipcRenderer.invoke("pos:offline:open-settings"),
    });
  } else {
    contextBridge.exposeInMainWorld("bisaPosDesktop", {
      printReceipt: (saleId, copy, rawHtml, retryConfirmed, printToken) =>
        ipcRenderer.invoke("pos:print-receipt", saleId, copy, rawHtml, retryConfirmed, printToken),
      openPrinterSettings: () => ipcRenderer.invoke("pos:printer-settings"),
      getPrinterConfig: () => ipcRenderer.invoke("pos:printer-config"),
      onPrinterConfigChanged: (listener) => {
        if (typeof listener !== "function") return () => {};
        const handler = (_event, config) => listener(config);
        ipcRenderer.on("pos:printer-config-changed", handler);
        return () => ipcRenderer.removeListener("pos:printer-config-changed", handler);
      },
    });
  }
}
