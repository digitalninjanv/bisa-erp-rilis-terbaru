const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("bisaPosDesktop", {
    printReceipt: (saleId, copy, rawHtml) => ipcRenderer.invoke("pos:print-receipt", saleId, copy, rawHtml),
    openPrinterSettings: () => ipcRenderer.invoke("pos:printer-settings"),
  });
}
