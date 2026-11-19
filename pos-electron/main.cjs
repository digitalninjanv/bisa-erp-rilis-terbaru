const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require("electron");
const { join } = require("node:path");
const { loadSettings, saveSettings, parseOrigin } = require("./settings.cjs");

const POS_PATH = "/app/pos";
const PARTITION = "persist:bisa-pos";
const SALE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SERVER_ARG = "--erp-url=";
const preferences = {
  partition: PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
};

let terminal;
let settings;
let printing = false;

function trustedUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === settings?.origin;
  } catch {
    return false;
  }
}

function trustedTerminal(event, paths = [POS_PATH, POS_PATH + "/"]) {
  const frame = event.senderFrame;
  return terminal && !terminal.isDestroyed() && event.sender === terminal.webContents &&
    frame && frame === event.sender.mainFrame && trustedUrl(frame.url) &&
    paths.includes(new URL(frame.url).pathname);
}

function updateSettings(updates) {
  const next = { ...settings, ...updates };
  saveSettings(app.getPath("userData"), next);
  settings = next;
}

function showError(error) {
  void dialog.showMessageBox(terminal, {
    type: "warning",
    title: "Bisa POS",
    message: error instanceof Error ? error.message : String(error),
  });
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function printDocument(receiptPath) {
  if (printing) return { ok: false, message: "Cetakan sebelumnya masih diproses." };
  if (!settings.printer) return { ok: false, message: "Pilih printer melalui Atur printer, lalu coba lagi." };

  printing = true;
  let documentWindow;
  let submitted = false;
  const { printer, width } = settings;
  try {
    const printers = await terminal.webContents.getPrintersAsync();
    if (!printers.some(({ name }) => name === printer)) {
      return { ok: false, message: "Printer yang dipilih tidak tersedia. Periksa driver dan koneksi printer." };
    }
    documentWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 768,
      webPreferences: preferences,
    });
    const contents = documentWindow.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    const receiptUrl = receiptPath && new URL(receiptPath, settings.origin);
    if (receiptUrl) receiptUrl.searchParams.set("thermal", String(width));
    const testHtml = '<!doctype html><meta charset=utf-8><title>Uji printer</title>' +
      '<main class="print-doc" style="font:12px monospace"><h2>Bisa POS</h2>' +
      '<p>Uji printer thermal ' + width + ' mm</p><p>Periksa lebar kertas dan keterbacaan.</p></main>';
    await withTimeout(
      contents.loadURL(receiptUrl?.href ?? "data:text/html;charset=utf-8," + encodeURIComponent(testHtml)),
      15_000,
      "Halaman nota tidak dapat dimuat. Periksa koneksi ke ERP.",
    );
    if (receiptUrl && (contents.getURL() !== receiptUrl.href)) {
      return { ok: false, message: "Nota tidak tersedia. Periksa sesi login dan akses transaksi." };
    }

    const height = await withTimeout(contents.executeJavaScript(`
      (async () => {
        const doc = document.querySelector(".print-doc");
        if (!doc) return 0;
        await document.fonts.ready;
        await Promise.all([...doc.querySelectorAll("img")].map(img => img.decode().catch(() => {})));
        const height = Math.max(60, Math.ceil(doc.getBoundingClientRect().height * 25.4 / 96 + 6));
        const style = doc.querySelector(":scope > style") ?? doc.appendChild(document.createElement("style"));
        style.textContent = "@page { size: ${width}mm " + height + "mm; margin: 2mm; }";
        return height;
      })()`), 10_000, "Tata letak nota belum siap dicetak.");
    if (!Number.isFinite(height) || height <= 0) {
      return { ok: false, message: "Halaman ini tidak memuat dokumen nota." };
    }

    submitted = true;
    return await withTimeout(new Promise((resolve) => {
      contents.print({
        deviceName: printer,
        silent: true,
        printBackground: true,
        pageSize: { width: width * 1000, height: height * 1000 },
      }, (ok) => resolve(ok
        ? { ok: true }
        : { ok: false, uncertain: true, message: "Driver melaporkan kegagalan. Periksa hasil cetak sebelum mengulang." }));
    }), 20_000, "Printer belum memberi hasil. Periksa apakah struk sudah keluar.");
  } catch (error) {
    return { ok: false, uncertain: submitted, message: error.message || "Cetak gagal." };
  } finally {
    if (documentWindow && !documentWindow.isDestroyed()) documentWindow.destroy();
    printing = false;
  }
}

async function printerMenu() {
  const printers = await terminal.webContents.getPrintersAsync();
  const save = (updates) => {
    try { updateSettings(updates); } catch (error) { showError(error); }
  };
  Menu.buildFromTemplate([
    { label: "Printer thermal", enabled: false },
    ...(printers.length ? printers.map(({ name, displayName }) => ({
      label: (displayName || name).replaceAll("&", "&&"),
      type: "radio",
      checked: name === settings.printer,
      click: () => save({ printer: name }),
    })) : [{ label: "Belum ada printer di sistem operasi", enabled: false }]),
    { type: "separator" },
    ...[58, 80].map((width) => ({
      label: width + " mm",
      type: "radio",
      checked: width === settings.width,
      click: () => save({ width }),
    })),
    { type: "separator" },
    { label: "Uji cetak", click: async () => {
      const result = await printDocument();
      if (!result.ok) showError(result.message);
      else void dialog.showMessageBox(terminal, { message: "Data uji dikirim. Periksa kertas printer." });
    } },
  ]).popup({ window: terminal });
}

async function openTerminal() {
  terminal = new BrowserWindow({
    title: "Bisa POS",
    width: 1366,
    height: 850,
    webPreferences: { ...preferences, preload: join(__dirname, "preload.cjs") },
  });
  terminal.on("closed", () => { terminal = undefined; });
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "Bisa POS", submenu: [
    { label: "Buka kasir", click: () => void loadTerminal() },
    { label: "Atur printer", click: () => void printerMenu().catch(showError) },
    { type: "separator" },
    { role: "quit", label: "Keluar" },
  ] }]));
  await loadTerminal();
}

async function loadTerminal() {
  try {
    await terminal.loadURL(new URL(POS_PATH, settings.origin).href);
  } catch (error) {
    if (error.code === "ERR_ABORTED") return;
    showError("ERP tidak dapat dijangkau di " + settings.origin + ". Jalankan layanan ERP, lalu pilih Buka kasir.");
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (terminal?.isMinimized()) terminal.restore();
    terminal?.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      if (!trustedUrl(url)) event.preventDefault();
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
      if (origin !== settings.origin) updateSettings({ origin, printer: "" });
    }
    const profile = session.fromPartition(PARTITION);
    profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    profile.setPermissionCheckHandler(() => false);

    ipcMain.handle("pos:print-receipt", (event, saleId, copy) =>
      typeof copy === "boolean" && typeof saleId === "string" && SALE_ID.test(saleId) &&
      (trustedTerminal(event) || (copy && trustedTerminal(event, [POS_PATH + "/riwayat"])))
        ? printDocument(POS_PATH + "/nota/" + saleId + (copy ? "?salinan=1" : ""))
        : { ok: false, message: "Permintaan cetak tidak valid." },
    );
    ipcMain.handle("pos:printer-settings", async (event) => {
      if (trustedTerminal(event)) await printerMenu().catch(showError);
    });
    await openTerminal();
  }).catch((error) => {
    dialog.showErrorBox("Bisa POS", error.message);
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
}
