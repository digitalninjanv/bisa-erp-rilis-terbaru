import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-terminal-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/linux-unpacked/bisa-pos",
  args: ["--no-sandbox", "--erp-url=http://127.0.0.1:3100", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData },
  timeout: 30000,
});
const errors = [];
const win = await app.firstWindow({ timeout: 20000 });
win.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 300)); });
win.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`.slice(0, 300)));
await win.waitForLoadState("domcontentloaded").catch(() => {});

// Login if the ERP redirects to the login page.
if (win.url().includes("/login")) {
  await win.getByLabel("Email").fill("owner@bisa.id");
  await win.getByLabel("Kata sandi").fill("Bisa12345!");
  await win.getByRole("button", { name: "Masuk" }).click();
}
await win.waitForURL(/\/app\/pos/, { timeout: 30000 }).catch(() => {});
await win.waitForTimeout(1500);

const terminalApi = await win.evaluate(async () => ({
  desktop: Boolean(window.bisaPosDesktop),
  printReceipt: typeof window.bisaPosDesktop?.printReceipt,
  openPrinterSettings: typeof window.bisaPosDesktop?.openPrinterSettings,
  config: await window.bisaPosDesktop?.getPrinterConfig?.().catch(() => null),
}));
console.log(JSON.stringify({
  url: win.url(),
  title: await win.title(),
  heading: (await win.locator("h1,h2").first().textContent().catch(() => ""))?.trim(),
  hasSearch: await win.getByLabel("Cari produk atau scan barcode").isVisible().catch(() => false),
  terminalApi,
  errors,
}, null, 2));
await app.close();
