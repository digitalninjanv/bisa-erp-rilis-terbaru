import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: process.env.BISA_BASE_URL ?? "http://127.0.0.1:3000", viewport: { width: 1880, height: 900 } });
const login = await ctx.request.post("/api/auth/sign-in/email", { data: { email: "owner@bisa.id", password: "Bisa12345!" } });
if (!login.ok()) throw new Error(`login ${login.status()}`);
const page = await ctx.newPage();
await page.goto("/app/pos", { waitUntil: "networkidle" });
const search = page.getByLabel("Cari produk atau scan barcode");
await search.waitFor({ state: "visible", timeout: 20000 });
for (const code of ["8991000000001", "8991000000062"]) {
  await search.fill(code);
  await search.press("Enter");
  await page.waitForTimeout(300);
}
await page.waitForTimeout(500);
const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
  .analyze();
console.log(JSON.stringify(results.violations.map((v) => ({
  id: v.id,
  impact: v.impact,
  nodes: v.nodes.length,
  help: v.help,
  targets: v.nodes.slice(0, 8).map((n) => n.target.join(" ")),
})), null, 2));
await browser.close();
