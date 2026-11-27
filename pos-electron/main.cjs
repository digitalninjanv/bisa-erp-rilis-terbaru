const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require("electron");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadSettings, saveSettings, parseOrigin } = require("./settings.cjs");
const { printWithCallbackTimeout } = require("./print-callback.cjs");
const { createPrintScheduler } = require("./print-scheduler.cjs");

const POS_PATH = "/app/pos";
const POS_SUB_PATHS = [
  POS_PATH,
  POS_PATH + "/",
  POS_PATH + "/riwayat",
  POS_PATH + "/riwayat/",
  POS_PATH + "/ditahan",
  POS_PATH + "/ditahan/",
  POS_PATH + "/sesi",
  POS_PATH + "/sesi/",
  POS_PATH + "/retur",
  POS_PATH + "/retur/",
  POS_PATH + "/piutang",
  POS_PATH + "/piutang/",
];
const POS_NOTA_PATH = /^\/app\/pos\/nota\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SETTINGS_FILE_URL = pathToFileURL(join(__dirname, "settings.html")).href;
const OFFLINE_FILE_URL = pathToFileURL(join(__dirname, "offline.html")).href;
const PARTITION = "persist:bisa-pos";
const SERVER_ARG = "--erp-url=";
const PRINTER_CACHE_TTL_MS = 30_000;
const PRINT_WINDOW_IDLE_MS = 5 * 60 * 1000;

const preferences = {
  partition: PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
  enableWebSQL: false,
};

let terminal;
let settingsWindow;
let printWindow;
let printWindowIdleTimer;
let settings;
let cachedPrinters = null;
let cachedPrintersAt = 0;
const printScheduler = createPrintScheduler();

function trustedUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === settings?.origin;
  } catch {
    return false;
  }
}

function isBundledPage(url, expected) {
  try {
    return new URL(url).href === expected;
  } catch {
    return false;
  }
}

function isAllowedPosPath(pathname, paths = POS_SUB_PATHS) {
  if (paths.includes(pathname)) return true;
  if (paths === POS_SUB_PATHS && POS_NOTA_PATH.test(pathname)) return true;
  return false;
}

function trustedTerminal(event, paths = POS_SUB_PATHS) {
  const frame = event.senderFrame;
  return terminal && !terminal.isDestroyed() && event.sender === terminal.webContents &&
    frame && frame === event.sender.mainFrame && trustedUrl(frame.url) &&
    isAllowedPosPath(new URL(frame.url).pathname, paths);
}

function trustedSettingsPage(event) {
  const frame = event.senderFrame;
  return settingsWindow && !settingsWindow.isDestroyed() &&
    event.sender === settingsWindow.webContents &&
    frame && frame === event.sender.mainFrame &&
    isBundledPage(frame.url, SETTINGS_FILE_URL);
}

function trustedOfflinePage(event) {
  const frame = event.senderFrame;
  return terminal && !terminal.isDestroyed() &&
    event.sender === terminal.webContents &&
    frame && frame === event.sender.mainFrame &&
    isBundledPage(frame.url, OFFLINE_FILE_URL);
}

function publicPrinterConfig() {
  return {
    printer: settings.printer,
    width: settings.width,
    autoPrint: settings.autoPrint !== false,
  };
}

function updateSettings(updates) {
  const next = { ...settings, ...updates };
  saveSettings(app.getPath("userData"), next);
  settings = next;
  if (terminal && !terminal.isDestroyed()) {
    terminal.webContents.send("pos:printer-config-changed", publicPrinterConfig());
  }
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function listPrintersSafe(forceRefresh = false) {
  if (!terminal || terminal.isDestroyed()) return [];
  if (!forceRefresh && cachedPrinters && Date.now() - cachedPrintersAt < PRINTER_CACHE_TTL_MS) {
    return cachedPrinters;
  }
  const printers = await terminal.webContents.getPrintersAsync();
  cachedPrinters = printers.map(({ name, displayName }) => ({ name, displayName }));
  cachedPrintersAt = Date.now();
  return cachedPrinters;
}

function clearPrintIdleTimer() {
  if (printWindowIdleTimer) {
    clearTimeout(printWindowIdleTimer);
    printWindowIdleTimer = undefined;
  }
}

function schedulePrintWindowIdleCleanup() {
  clearPrintIdleTimer();
  printWindowIdleTimer = setTimeout(() => {
    if (printScheduler.inFlightCount() === 0 && printWindow && !printWindow.isDestroyed()) {
      printWindow.destroy();
      printWindow = undefined;
    }
  }, PRINT_WINDOW_IDLE_MS);
}

function destroyPrintWindow() {
  clearPrintIdleTimer();
  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.destroy();
  }
  printWindow = undefined;
}

function getOrCreatePrintWindow() {
  clearPrintIdleTimer();
  if (printWindow && !printWindow.isDestroyed()) return printWindow;
  printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 800,
    webPreferences: {
      ...preferences,
      devTools: !app.isPackaged ? true : false,
    },
  });
  printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  printWindow.webContents.on("render-process-gone", () => {
    destroyPrintWindow();
  });
  printWindow.on("closed", () => {
    printWindow = undefined;
  });
  return printWindow;
}

async function executePrintJob(receiptPath, rawHtml, onNativeComplete) {
  if (!terminal || terminal.isDestroyed()) {
    onNativeComplete();
    return { ok: false, message: "Jendela kasir sudah ditutup." };
  }
  if (!settings.printer) {
    onNativeComplete();
    return { ok: false, message: "Pilih printer melalui Atur printer, lalu coba lagi." };
  }

  let submitted = false;
  const { printer, width } = settings;
  try {
    const printers = await listPrintersSafe(false);
    if (!printers.some(({ name }) => name === printer)) {
      const freshPrinters = await listPrintersSafe(true);
      if (!freshPrinters.some(({ name }) => name === printer)) {
        return { ok: false, message: "Printer yang dipilih tidak tersedia. Periksa driver dan koneksi printer." };
      }
    }

    const worker = getOrCreatePrintWindow();
    const contents = worker.webContents;
    const receiptUrl = receiptPath && new URL(receiptPath, settings.origin);
    if (receiptUrl) receiptUrl.searchParams.set("thermal", String(width));
    const testHtml = '<!doctype html><meta charset=utf-8><title>Uji printer</title>' +
      '<main class="print-doc" style="font:12px monospace"><h2>Bisa POS</h2>' +
      '<p>Uji printer thermal ' + width + ' mm</p><p>Periksa lebar kertas dan keterbacaan.</p></main>';
    const contentUrl = rawHtml
      ? "data:text/html;charset=utf-8," + encodeURIComponent(rawHtml)
      : receiptUrl?.href ?? "data:text/html;charset=utf-8," + encodeURIComponent(testHtml);

    await withTimeout(
      contents.loadURL(contentUrl),
      15_000,
      "Halaman nota tidak dapat dimuat. Periksa koneksi ke ERP.",
    );
    if (receiptUrl) {
      const loaded = new URL(contents.getURL());
      if (loaded.origin !== receiptUrl.origin || loaded.pathname !== receiptUrl.pathname) {
        return {
          ok: false,
          message: loaded.pathname === "/login"
            ? "Sesi login habis. Masuk kembali ke ERP lalu coba cetak ulang."
            : "Nota tidak tersedia. Periksa sesi login dan akses transaksi.",
        };
      }
    }

    const height = await withTimeout(contents.executeJavaScript(`
      (async () => {
        const doc = document.querySelector(".print-doc");
        if (!doc) return 0;
        doc.style.width = "${width === 58 ? 54 : 76}mm";
        doc.style.maxWidth = "100%";
        const cap = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
        await cap(document.fonts.ready, 1500);
        await cap(Promise.all([...doc.querySelectorAll("img")].map((img) => img.decode().catch(() => {}))), 1500);
        const height = Math.max(60, Math.ceil(doc.getBoundingClientRect().height * 25.4 / 96 + 6));
        const style = doc.querySelector(":scope > style") ?? doc.appendChild(document.createElement("style"));
        style.textContent = "@page { size: ${width}mm " + height + "mm; margin: 2mm; }";
        return height;
      })()`), 10_000, "Tata letak nota belum siap dicetak.");
    if (!Number.isFinite(height) || height <= 0) {
      return { ok: false, message: "Halaman ini tidak memuat dokumen nota." };
    }

    submitted = true;
    const result = await printWithCallbackTimeout(
      (callback) => contents.print({
        deviceName: printer,
        silent: true,
        printBackground: true,
        pageSize: { width: width * 1000, height: height * 1000 },
      }, callback),
      20_000,
      "Printer belum memberi hasil. Periksa apakah struk sudah keluar.",
      () => {
        onNativeComplete();
        schedulePrintWindowIdleCleanup();
      },
    );
    if (!result.ok) cachedPrintersAt = 0;
    return result;
  } catch (error) {
    if (!submitted) destroyPrintWindow();
    cachedPrintersAt = 0;
    return { ok: false, uncertain: submitted, message: error.message || "Cetak gagal." };
  } finally {
    if (!submitted) {
      onNativeComplete();
      schedulePrintWindowIdleCleanup();
    }
  }
}

function printDocument(receiptPath, rawHtml, retryConfirmed = false, dedupeKey = "__test__") {
  return printScheduler.enqueue(dedupeKey, retryConfirmed, (release) =>
    executePrintJob(receiptPath, rawHtml, release),
  );
}

function openSettingsModal() {
  cachedPrintersAt = 0;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    parent: terminal && !terminal.isDestroyed() ? terminal : undefined,
    modal: Boolean(terminal && !terminal.isDestroyed()),
    title: "Pengaturan Printer & Server — Bisa POS",
    width: 560,
    height: 660,
    minWidth: 440,
    minHeight: 540,
    resizable: true,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#e7ddcc",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      enableWebSQL: false,
      preload: join(__dirname, "settings-preload.cjs"),
    },
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
  });
  void settingsWindow.loadURL(SETTINGS_FILE_URL);
}

async function clearAppCacheAndReload() {
  const profile = session.fromPartition(PARTITION);
  await profile.clearCache();
  cachedPrintersAt = 0;
  await loadTerminal();
}

async function openTerminal() {
  terminal = new BrowserWindow({
    title: "Bisa POS",
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: "#e7ddcc",
    webPreferences: { ...preferences, preload: join(__dirname, "preload.cjs") },
  });
  terminal.on("closed", () => {
    terminal = undefined;
    destroyPrintWindow();
  });
  let returningFromLogin = false;
  const returnToPos = (_event, url) => {
    if (!trustedUrl(url)) return;
    const { pathname } = new URL(url);
    if (pathname === "/login") returningFromLogin = true;
    if (pathname === POS_PATH) returningFromLogin = false;
    if (returningFromLogin && (pathname === "/app" || pathname === "/app/")) {
      returningFromLogin = false;
      void loadTerminal();
    }
  };
  terminal.webContents.on("did-navigate", returnToPos);
  terminal.webContents.on("did-navigate-in-page", returnToPos);
  terminal.webContents.on("did-fail-load", (_event, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || isBundledPage(validatedURL, OFFLINE_FILE_URL)) return;
    void terminal.loadURL(OFFLINE_FILE_URL);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "Bisa POS", submenu: [
    { label: "Buka kasir", click: () => void loadTerminal() },
    { label: "Atur printer & server...", click: () => openSettingsModal() },
    { type: "separator" },
    { role: "togglefullscreen", label: "Layar penuh (F11)" },
    { role: "reload", label: "Muat ulang" },
    { label: "Bersihkan cache & muat ulang", click: () => void clearAppCacheAndReload() },
    { type: "separator" },
    { role: "quit", label: "Keluar" },
  ] }]));
  terminal.maximize();
  await loadTerminal();
}

async function loadTerminal() {
  if (!terminal || terminal.isDestroyed()) return;
  try {
    await terminal.loadURL(new URL(POS_PATH, settings.origin).href);
  } catch (error) {
    if (error.code === "ERR_ABORTED") return;
    void terminal.loadURL(OFFLINE_FILE_URL);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (terminal?.isMinimized()) terminal.restore();
    terminal?.focus();
  });
  app.on("before-quit", () => {
    destroyPrintWindow();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      if (contents === settingsWindow?.webContents) {
        if (!isBundledPage(url, SETTINGS_FILE_URL)) event.preventDefault();
        return;
      }
      if (!trustedUrl(url) && !isBundledPage(url, OFFLINE_FILE_URL)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!trustedUrl(url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => trustedUrl(url)
      ? { action: "allow", overrideBrowserWindowOptions: { webPreferences: preferences } }
      : { action: "deny" });
  });
  app.whenReady().then(async () => {
    settings = loadSettings(app.getPath("userData"));
    const override = process.argv.find((arg) => arg.startsWith(SERVER_ARG));
    if (override) {
      const origin = parseOrigin(override.slice(SERVER_ARG.length));
      if (origin !== settings.origin) updateSettings({ origin });
    }
    const profile = session.fromPartition(PARTITION);
    profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    profile.setPermissionCheckHandler(() => false);

    ipcMain.handle("pos:print-receipt", (event, saleId, copy, rawHtml, retryConfirmed, printToken) => {
      const allowConfirmedRetry = retryConfirmed === true;
      const validSaleId = typeof saleId === "string" && UUID_RE.test(saleId);
      const dedupeKey = validSaleId ? `${saleId}:${copy ? "copy" : "orig"}` : "__raw__";
      if (typeof rawHtml === "string" && rawHtml.includes("print-doc") && trustedTerminal(event)) {
        return printDocument(undefined, rawHtml, allowConfirmedRetry, dedupeKey);
      }
      const canLoadByUrl =
        typeof copy === "boolean" &&
        validSaleId &&
        (trustedTerminal(event, [POS_PATH, POS_PATH + "/"]) ||
          (copy && (trustedTerminal(event, [POS_PATH + "/riwayat", POS_PATH + "/riwayat/"]) ||
            trustedTerminal(event) && POS_NOTA_PATH.test(new URL(event.senderFrame.url).pathname))));
      if (!canLoadByUrl) {
        return { ok: false, message: "Permintaan cetak tidak valid." };
      }
      const query = new URLSearchParams();
      if (copy) query.set("salinan", "1");
      if (typeof printToken === "string" && UUID_RE.test(printToken)) {
        query.set("printToken", printToken);
      }
      const qs = query.toString();
      return printDocument(POS_PATH + "/nota/" + saleId + (qs ? "?" + qs : ""), undefined, allowConfirmedRetry, dedupeKey);
    });

    ipcMain.handle("pos:printer-settings", (event) => {
      if (trustedTerminal(event)) openSettingsModal();
    });
    ipcMain.handle("pos:printer-config", (event) => {
      if (!trustedTerminal(event)) return null;
      return publicPrinterConfig();
    });

    ipcMain.handle("pos:settings:load", async (event) => {
      if (!trustedSettingsPage(event)) return { printers: [], settings: {} };
      return { printers: await listPrintersSafe(true), settings };
    });
    ipcMain.handle("pos:settings:printers", async (event) => {
      if (!trustedSettingsPage(event)) return [];
      return listPrintersSafe(true);
    });
    ipcMain.handle("pos:settings:save", (event, updates) => {
      if (!trustedSettingsPage(event) || !updates || typeof updates !== "object") {
        return { ok: false, message: "Akses ditolak." };
      }
      try {
        const nextOrigin = typeof updates.origin === "string" ? parseOrigin(updates.origin) : settings.origin;
        const originChanged = nextOrigin !== settings.origin;
        updateSettings({
          origin: nextOrigin,
          printer: typeof updates.printer === "string" ? updates.printer : settings.printer,
          width: updates.width === 58 ? 58 : 80,
          autoPrint: updates.autoPrint !== false,
        });
        if (originChanged) void loadTerminal();
        return { ok: true, originChanged };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    });
    ipcMain.handle("pos:settings:test-print", async (event) => {
      if (!trustedSettingsPage(event)) return { ok: false, message: "Akses ditolak." };
      return printDocument(undefined, undefined, true, "__test__");
    });
    ipcMain.handle("pos:settings:close", (event) => {
      if (trustedSettingsPage(event) && settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
      }
    });

    ipcMain.handle("pos:offline:status", (event) => {
      if (!trustedOfflinePage(event)) return null;
      return { origin: settings.origin };
    });
    ipcMain.handle("pos:offline:retry", (event) => {
      if (trustedOfflinePage(event)) void loadTerminal();
    });
    ipcMain.handle("pos:offline:open-settings", (event) => {
      if (trustedOfflinePage(event)) openSettingsModal();
    });

    await openTerminal();
  }).catch((error) => {
    dialog.showErrorBox("Bisa POS", error.message);
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
}
