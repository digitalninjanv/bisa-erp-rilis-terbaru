import { chromium } from "@playwright/test";
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
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Bayar Rp/.test(b.textContent ?? "") && !b.disabled && b.getClientRects().length > 0), undefined, { timeout: 20000 });
await page.locator("button:visible", { hasText: /^Bayar Rp/ }).first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: "audit/checks/pos-contrast-after.png", fullPage: false });
console.log(JSON.stringify({
  url: page.url(),
  title: await page.title(),
  cards: await page.locator("[data-catalog-index]").count(),
  pay: await page.locator("[role=dialog] button", { hasText: /^Bayar Rp/ }).first().textContent(),
}, null, 2));
await browser.close();
