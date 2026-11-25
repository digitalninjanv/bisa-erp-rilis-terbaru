import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-ifi-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/linux-unpacked/bisa-pos",
  args: ["--no-sandbox", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData },
  timeout: 30000,
});
const errors = [];
const win = await app.firstWindow({ timeout: 20000 });
win.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
win.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
await win.waitForTimeout(6000);
const body = (await win.locator("body").innerText().catch(() => "")).slice(0, 400);
console.log(JSON.stringify({ url: win.url(), title: await win.title(), body, errors }, null, 2));
await app.close();
