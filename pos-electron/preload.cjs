const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("bisaPosDesktop", {
    printReceipt: (saleId, copy) => ipcRenderer.invoke("pos:print-receipt", saleId, copy),
    openPrinterSettings: () => ipcRenderer.invoke("pos:printer-settings"),
  });
}
