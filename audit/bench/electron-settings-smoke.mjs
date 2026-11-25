import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-settings-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/linux-unpacked/bisa-pos",
  args: ["--no-sandbox", "--erp-url=http://127.0.0.1:9", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData },
  timeout: 30000,
});
const errors = [];
const win = await app.firstWindow({ timeout: 20000 });
win.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
await win.waitForLoadState("domcontentloaded").catch(() => {});
await win.getByRole("button", { name: /Ubah Alamat Server/i }).click();
await new Promise((r) => setTimeout(r, 1200));
const windows = app.windows();
const settings = windows.find((w) => w !== win) ?? windows[0];
await settings.waitForLoadState("domcontentloaded").catch(() => {});
await settings.waitForTimeout(500);
const result = {
  windows: windows.length,
  title: await settings.title(),
  url: settings.url(),
  printerOptions: await settings.locator("#printerSelect option").count(),
  origin: await settings.locator("#originInput").inputValue(),
  width58: await settings.locator('input[name="width"][value="58"]').isVisible(),
  saveVisible: await settings.getByRole("button", { name: /Simpan Pengaturan/i }).isVisible(),
  errors,
};
console.log(JSON.stringify(result, null, 2));
await app.close();
