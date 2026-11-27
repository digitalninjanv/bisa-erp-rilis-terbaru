import { _electron as electron } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const userData = mkdtempSync(join(tmpdir(), "bisa-pos-sizes-"));
const app = await electron.launch({
  executablePath: "dist-release/pos-electron/linux-unpacked/bisa-pos",
  args: ["--no-sandbox", "--erp-url=http://127.0.0.1:9", `--user-data-dir=${userData}`],
  env: { ...process.env, XDG_CONFIG_HOME: userData },
  timeout: 30000,
});
const win = await app.firstWindow({ timeout: 20000 });
await win.waitForLoadState("domcontentloaded").catch(() => {});
await win.waitForTimeout(1200);
await win.getByRole("button", { name: /Ubah Alamat Server/i }).click();
await win.waitForTimeout(800);
const settings = app.windows().find((w) => w !== win) ?? win;
await settings.waitForLoadState("domcontentloaded").catch(() => {});
const results = [];
for (const [w, h] of [[560, 660], [540, 540], [420, 540]]) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const target = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes("settings.html"));
    if (target) target.setSize(size[0], size[1]);
  }, [w, h]);
  await settings.waitForTimeout(400);
  const box = await settings.locator(".actions").boundingBox();
  const viewport = await settings.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const save = await settings.getByRole("button", { name: "Simpan Pengaturan" }).boundingBox();
  results.push({ requested: [w, h], viewport, actions: box, save, visible: !!save && save.y + save.height <= viewport.height });
  await settings.screenshot({ path: `audit/checks/electron-settings-${w}x${h}.png` });
}
console.log(JSON.stringify(results, null, 2));
await app.close();
