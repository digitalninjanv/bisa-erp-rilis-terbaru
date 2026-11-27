import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-window-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/linux-unpacked/bisa-pos",
  args: ["--no-sandbox", "--erp-url=http://localhost:3000", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData },
  timeout: 30000,
});
const win = await app.firstWindow({ timeout: 20000 });
await win.waitForLoadState("domcontentloaded").catch(() => {});
await win.waitForTimeout(1500);
const info = await app.evaluate(({ BrowserWindow, screen }) => {
  const target = BrowserWindow.getAllWindows().find((item) => !item.webContents.getURL().startsWith("file:"));
  const display = screen.getPrimaryDisplay();
  return {
    bounds: target?.getBounds(),
    maximized: target?.isMaximized(),
    visible: target?.isVisible(),
    workArea: display.workArea,
    inner: target ? target.webContents.getOwnerBrowserWindow()?.webContents.executeJavaScript("({ width: innerWidth, height: innerHeight })") : null,
  };
});
console.log(JSON.stringify(await info, null, 2));
await app.close();
