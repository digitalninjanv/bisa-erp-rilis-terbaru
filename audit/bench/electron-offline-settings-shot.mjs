import { _electron as electron } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const axeSource = readFileSync("node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js", "utf8");
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
async function runAxe(page) {
  await page.evaluate(axeSource);
  const result = await page.evaluate(async (runTags) => await window.axe.run(document, { runOnly: { type: "tag", values: runTags } }), tags);
  return result.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }));
}

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-shot-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/linux-unpacked/bisa-pos",
  args: ["--no-sandbox", "--erp-url=http://127.0.0.1:9", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData },
  timeout: 30000,
});
const errors = [];
const win = await app.firstWindow({ timeout: 20000 });
win.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
await win.waitForLoadState("domcontentloaded").catch(() => {});
await win.waitForTimeout(1200);
await win.screenshot({ path: "audit/checks/electron-offline-0.1.2.png" });
let offlineAxe = [];
try { offlineAxe = await runAxe(win); } catch (e) { offlineAxe = [{ error: String(e).slice(0,160) }]; }
await win.getByRole("button", { name: /Ubah Alamat Server/i }).click();
await win.waitForTimeout(1000);
const settings = app.windows().find((w) => w !== win) ?? win;
await settings.waitForLoadState("domcontentloaded").catch(() => {});
await settings.waitForTimeout(500);
await settings.screenshot({ path: "audit/checks/electron-settings-0.1.2.png" });
let settingsAxe = [];
try { settingsAxe = await runAxe(settings); } catch (e) { settingsAxe = [{ error: String(e).slice(0,160) }]; }
console.log(JSON.stringify({ offlineAxe, settingsAxe, errors }, null, 2));
await app.close();
