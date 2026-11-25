import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-checkout-"));
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
if (win.url().includes("/login")) {
  await win.getByLabel("Email").fill("owner@bisa.id");
  await win.getByLabel("Kata sandi").fill("Bisa12345!");
  await win.getByRole("button", { name: "Masuk" }).click();
}
await win.waitForURL(/\/app\/pos/, { timeout: 30000 });
const search = win.getByLabel("Cari produk atau scan barcode");
await search.waitFor({ state: "visible", timeout: 20000 });
await search.fill("8991000000001");
await search.press("Enter");
await win.waitForFunction(
  () => document.querySelectorAll('button[aria-label^="Hapus "][aria-label$=" dari keranjang"]').length > 0,
  undefined,
  { timeout: 15000 },
);
await win.waitForFunction(
  () => [...document.querySelectorAll("button")].some((b) => /^Bayar Rp/.test(b.textContent ?? "") && !b.disabled),
  undefined,
  { timeout: 20000 },
);
await win.locator("button", { hasText: /^Bayar Rp/ }).first().click();
const tendered = win.getByLabel("Uang diterima");
if (await tendered.isVisible().catch(() => false)) {
  await win.getByRole("button", { name: "Uang Pas" }).click();
  await win.locator("button", { hasText: /^Bayar Rp/ }).first().click();
}
await win.getByRole("heading", { name: "Transaksi berhasil" }).waitFor({ state: "visible", timeout: 30000 });
console.log(JSON.stringify({
  url: win.url(),
  title: await win.title(),
  success: await win.getByRole("heading", { name: "Transaksi berhasil" }).isVisible(),
  printerConfig: await win.evaluate(() => window.bisaPosDesktop?.getPrinterConfig?.()),
  errors,
}, null, 2));
await app.close();
