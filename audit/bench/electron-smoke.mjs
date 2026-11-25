import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-smoke-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/linux-unpacked/bisa-pos",
  args: ["--no-sandbox", "--erp-url=http://127.0.0.1:9", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData },
  timeout: 30000,
});
const errors = [];
app.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
const win = await app.firstWindow({ timeout: 20000 });
await win.waitForLoadState("domcontentloaded").catch(() => {});
await win.waitForTimeout(1500);
const result = {
  windows: app.windows().length,
  title: await win.title(),
  url: win.url(),
  body: (await win.locator("body").innerText()).slice(0, 500),
  offlineApi: await win.evaluate(() => Boolean(window.bisaPosOffline)),
  desktopApi: await win.evaluate(() => Boolean(window.bisaPosDesktop)),
  errors,
};
console.log(JSON.stringify(result, null, 2));
await app.close();
