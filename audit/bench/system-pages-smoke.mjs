import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: "http://127.0.0.1:3100", viewport: { width: 1440, height: 900 } });
const login = await ctx.request.post("/api/auth/sign-in/email", { data: { email: "owner@bisa.id", password: "Bisa12345!" } });
if (!login.ok()) throw new Error(`login ${login.status()}`);
const page = await ctx.newPage();
const pages = [
  "/app",
  "/app/pos",
  "/app/pos/riwayat",
  "/app/pos/sesi",
  "/app/pos/ditahan",
  "/app/gudang",
  "/app/gudang/produk",
  "/app/gudang/penerimaan",
  "/app/gudang/nilai",
  "/app/gudang/impor?jenis=opening_stock",
  "/app/akuntansi",
  "/app/akuntansi/laporan",
  "/app/analisa",
];
const out = [];
for (const path of pages) {
  const errors = [];
  const onConsole = (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); };
  const onPageError = (e) => errors.push("pageerror: " + e.message.slice(0, 200));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  let status = 0;
  try {
    const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20000 });
    status = response?.status() ?? 0;
    await page.waitForTimeout(700);
    const body = await page.locator("body").innerText();
    out.push({
      path,
      status,
      url: page.url(),
      errorScreen: /Terjadi kesalahan|Halaman gagal dimuat/i.test(body),
      title: await page.title(),
      errors: errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e)).slice(0, 3),
    });
  } catch (error) {
    out.push({ path, status, error: String(error.message).slice(0, 300), errors });
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
