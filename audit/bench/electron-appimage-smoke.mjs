import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-appimage-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/Bisa POS-0.1.2.AppImage",
  args: ["--no-sandbox", "--erp-url=http://localhost:3000", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData, APPIMAGE_EXTRACT_AND_RUN: "1" },
  timeout: 60000,
});
const win = await app.firstWindow({ timeout: 30000 });
const errors = [];
win.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
win.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`.slice(0, 200)));
await win.waitForLoadState("domcontentloaded").catch(() => {});
if (win.url().includes("/login")) {
  await win.getByLabel("Email").fill("owner@bisa.id");
  await win.getByLabel("Kata sandi").fill("Bisa12345!");
  await win.getByRole("button", { name: "Masuk" }).click();
}
await win.waitForURL(/\/app\/pos/, { timeout: 30000 }).catch(() => {});
await win.waitForTimeout(1500);
const info = await app.evaluate(({ BrowserWindow }) => {
  const target = BrowserWindow.getAllWindows().find((item) => !item.webContents.getURL().startsWith("file:"));
  return { url: target?.webContents.getURL(), bounds: target?.getBounds(), maximized: target?.isMaximized(), visible: target?.isVisible() };
});
const terminalApi = await win.evaluate(() => ({
  desktop: Boolean(window.bisaPosDesktop),
  printReceipt: typeof window.bisaPosDesktop?.printReceipt,
}));
console.log(JSON.stringify({
  ...info,
  title: await win.title(),
  hasSearch: await win.getByLabel("Cari produk atau scan barcode").isVisible().catch(() => false),
  terminalApi,
  errors,
}, null, 2));
await app.close();
