/**
 * Audit-only POS browser benchmark: production standalone server,
 * seeded 10.2k-product disposable DB. Measures client-perceived hot path.
 * Run: node audit/bench/pos-ui-bench.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.POS_BASE_URL ?? "http://127.0.0.1:3100";
const BARCODES = ["8991000000001", "8991000000000", "8991000000062", "8991000000050", "8991000000022"];

const result = {
  navigation: {},
  operations: {},
  actions: [],
  consoleErrors: [],
};

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    n: values.length,
    p50: Number(p(0.5).toFixed(1)),
    p95: Number(p(0.95).toFixed(1)),
    max: Number(Math.max(...values).toFixed(1)),
  };
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const login = await context.request.post("/api/auth/sign-in/email", {
    data: { email: "owner@bisa.id", password: "Bisa12345!" },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()} ${await login.text()}`);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask unsupported
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") result.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => result.consoleErrors.push(`pageerror: ${err.message}`.slice(0, 300)));

  let currentOp = "boot";
  const starts = new Map();
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    starts.set(req, { op: currentOp, at: performance.now(), action: req.headers()["next-action"] ?? "" });
  });
  page.on("requestfinished", (req) => {
    const start = starts.get(req);
    if (!start) return;
    starts.delete(req);
    result.actions.push({
      op: start.op,
      ms: Number((performance.now() - start.at).toFixed(1)),
      action: start.action.slice(0, 8),
      url: new URL(req.url()).pathname,
    });
  });

  try {
  currentOp = "load_pos";
  const t0 = performance.now();
  const response = await page.goto("/app/pos", { waitUntil: "networkidle" });
  const loadMs = performance.now() - t0;
  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry
      ? {
          ttfb: Math.round(entry.responseStart),
          domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
          load: Math.round(entry.loadEventEnd),
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
        }
      : {};
  });
  result.navigation = { status: response?.status(), gotoMs: Math.round(loadMs), ...nav };

  const search = page.getByLabel("Cari produk atau scan barcode");
  await search.waitFor({ state: "visible", timeout: 20000 });

  // Warm text search: type into the debounced search box and wait for the
  // action response AND refreshed cards that actually match the term.
  currentOp = "search_text";
  const tSearch = performance.now();
  const searchResponse = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      Boolean(res.request().headers()["next-action"]),
    { timeout: 15000 },
  );
  await search.fill("Aqua");
  await searchResponse;
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll("[data-catalog-index]")];
      return cards.length > 0 && cards.every((card) => /aqua/i.test(card.textContent ?? ""));
    },
    undefined,
    { timeout: 15000 },
  );
  result.operations.search_text_ms = Math.round(performance.now() - tSearch);
  result.operations.search_text_cards = await page.locator("[data-catalog-index]").count();
  await search.fill("");
  await page.waitForTimeout(600);

  // Barcode scan path: exact query + add to cart.
  const scanTimes = [];
  for (let i = 0; i < BARCODES.length; i += 1) {
    currentOp = `scan_${i + 1}`;
    const tScan = performance.now();
    await search.fill(BARCODES[i]);
    await search.press("Enter");
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('button[aria-label^="Hapus "][aria-label$=" dari keranjang"]').length === count,
      i + 1,
      { timeout: 15000 },
    );
    scanTimes.push(Number((performance.now() - tScan).toFixed(1)));
  }
  result.operations.scan_add_cart = stats(scanTimes);

  // Let quote settle (debounced) before paying.
  currentOp = "quote_settle";
  const tQuote = performance.now();
  await page.waitForFunction(
    () => {
      const buttons = [...document.querySelectorAll("button")];
      return buttons.some((b) => /^Bayar Rp/.test(b.textContent ?? "") && !b.disabled);
    },
    undefined,
    { timeout: 20000 },
  );
  result.operations.quote_until_payable_ms = Math.round(performance.now() - tQuote);

  // Checkout: click Bayar, fill exact cash if needed, click again, wait for success.
  currentOp = "checkout";
  const tCheckout = performance.now();
  const payButton = page.locator("button", { hasText: /^Bayar Rp/ }).first();
  await payButton.click();
  const tendered = page.getByLabel("Uang diterima");
  if (await tendered.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Uang Pas" }).click();
    await page.locator("button", { hasText: /^Bayar Rp/ }).first().click();
  }
  await page.getByRole("heading", { name: "Transaksi berhasil" }).waitFor({ state: "visible", timeout: 30000 });
  result.operations.checkout_until_success_ms = Math.round(performance.now() - tCheckout);
  result.longTasks = await page.evaluate(() => window.__longTasks ?? []);
  } finally {
    result.actionStats = {};
    for (const op of [...new Set(result.actions.map((a) => a.op))]) {
      result.actionStats[op] = stats(result.actions.filter((a) => a.op === op).map((a) => a.ms));
    }
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
