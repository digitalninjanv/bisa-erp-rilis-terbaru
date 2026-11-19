import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.POS_BASE_URL ?? "http://localhost:3100";
const email = process.env.POS_EMAIL ?? "owner@bisa.id";
const password = process.env.POS_PASSWORD ?? "Bisa12345!";
const routes = [
  ["Riwayat transaksi", "/app/pos/riwayat", "Riwayat transaksi"],
  ["Sesi kas", "/app/pos/sesi", "Sesi kas"],
  ["Pesanan ditahan", "/app/pos/ditahan", "Pesanan ditahan"],
  ["Piutang pelanggan", "/app/pos/piutang", "Piutang pelanggan"],
  ["Peninjauan offline", "/app/pos/offline", "Peninjauan Sinkronisasi Offline"],
  ["Riwayat sesi", "/app/pos/sesi/riwayat", "Riwayat sesi kasir"],
];

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const localChrome = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(localChrome) ? localChrome : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
await page.goto(`${base}/login`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Kata sandi").fill(password);
await page.getByRole("button", { name: "Masuk" }).click();
await page.waitForURL(/\/app$/);
await page.goto(`${base}/app/pos`);
await page.locator('input[aria-label="Cari produk atau scan barcode"]').waitFor();
await page.waitForTimeout(2_500);

const samples = [];
for (const [label, path, heading] of routes) {
  for (let round = 0; round < 3; round += 1) {
    await page.getByRole("button", { name: "Menu POS lainnya" }).click();
    await page.waitForTimeout(100);
    const start = Date.now();
    await page.locator(`a[href="${path}"]`).last().click();
    await page.getByRole("heading", { name: heading, exact: true }).first().waitFor();
    samples.push({ label, ms: Date.now() - start });
    await page.waitForTimeout(400);
    await page.goBack();
    await page.locator('input[aria-label="Cari produk atau scan barcode"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
  }
}

const byRoute = Object.fromEntries(
  routes.map(([label]) => {
    const values = samples.filter((row) => row.label === label).map((row) => row.ms);
    return [label, { n: values.length, p50: percentile(values, 50), p95: percentile(values, 95), max: Math.max(...values) }];
  }),
);
const all = samples.map((row) => row.ms);
console.log(JSON.stringify({ base, routes: byRoute, all: { n: all.length, p50: percentile(all, 50), p95: percentile(all, 95) } }, null, 2));
await browser.close();
