import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3000", viewport: { width: 1440, height: 900 } });
const login = await ctx.request.post("/api/auth/sign-in/email", { data: { email: "owner@bisa.id", password: "Bisa12345!" } });
console.log("login", login.status());
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
const results = [];
for (const path of ["/app", "/app/pos", "/app/gudang/produk", "/app/gudang/impor?jenis=opening_stock", "/app/akuntansi"]) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);
  const body = await page.locator("body").innerText();
  results.push({ path, status: response?.status(), title: await page.title(), errorScreen: /Terjadi kesalahan|Halaman gagal dimuat/i.test(body), errors: errors.splice(0) });
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
