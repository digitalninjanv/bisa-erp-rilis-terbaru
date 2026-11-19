import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// These fault-injection cases must only run against an explicitly selected local test database.
const databaseUrl = process.env.BISA_TEST_DIRECT_URL;
const safeDatabase = databaseUrl && /(?:^|[_-])test(?:$|[_-])/i.test(new URL(databaseUrl).pathname.slice(1)) &&
  ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname);
test.skip(!safeDatabase, "Set BISA_TEST_DIRECT_URL to a local disposable test database.");
const sql = safeDatabase ? postgres(databaseUrl!, { max: 2 }) : null;
const companyId = "01900000-0000-7000-8000-000000000001";
test.afterAll(async () => { await sql?.end(); });
test.use({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block" });

async function terminal(page: Page) {
  await page.goto("/app/pos/sesi");
  const open = page.getByRole("button", { name: "Buka sesi", exact: true });
  if (await open.isVisible()) {
    await page.getByLabel("Modal awal").fill("0");
    await open.click();
  }
  await expect(page.getByText("Sesi kas berjalan", { exact: true })).toBeVisible();
  await page.goto("/app/pos");
  await expect(page.getByLabel("Cari produk atau scan barcode")).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}
function payButton(page: Page) {
  return page.getByRole("complementary").filter({ hasText: "Pembayaran" }).getByRole("button", { name: /^Bayar/ });
}
async function add(page: Page) {
  await page.getByLabel("Cari produk atau scan barcode").fill("Aqua Air Mineral 600ml");
  await expect(page.locator("[data-catalog-index]")).toHaveCount(1);
  await page.getByRole("button", { name: /Aqua Air Mineral 600ml/ }).click();
  await expect(payButton(page)).toBeEnabled();
}

test("lost checkout response survives reload and replays the exact payment only once", async ({ page }) => {
  await terminal(page);
  await add(page);
  const requests: Array<{ idempotencyKey: string }> = [];
  let lost = false;
  await page.route("**/app/pos", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (request.method() === "POST" && body.includes("idempotencyKey") && body.includes("payments")) {
      requests.push(JSON.parse(body, (_key, value) => value === "$undefined" ? undefined : value)[0]);
      if (!lost) {
        lost = true;
        await route.fetch(); // Commit the sale, then lose the response in transit.
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await payButton(page).click();
  await expect(page.getByRole("dialog", { name: "Pembayaran belum terkonfirmasi" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Pembayaran belum terkonfirmasi" })).toBeVisible();
  await page.getByRole("button", { name: "Periksa pembayaran", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transaksi berhasil", exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const [{ count }] = await sql!`select count(*)::int as count from sales where company_id=${companyId} and idempotency_key=${requests[0].idempotencyKey}`;
  expect(count).toBe(1);
  await page.getByRole("button", { name: "Tutup dialog transaksi berhasil" }).click();
  await expect(page.getByRole("button", { name: /Tambah jumlah Aqua/ })).toHaveCount(0);
});

test("paste then immediate Enter cannot add the previous catalog result", async ({ page }) => {
  await terminal(page);
  const search = page.getByLabel("Cari produk atau scan barcode");
  await search.fill("Ultra Milk Coklat 250ml");
  await search.press("Enter");
  await expect(page.getByRole("button", { name: /Tambah jumlah/ })).toHaveCount(0);
  await expect(page.locator("[data-catalog-index]")).toHaveCount(1);
  await search.press("Enter");
  await expect(page.getByRole("button", { name: "Tambah jumlah Ultra Milk Coklat 250ml" })).toBeVisible();
});

test("holding clears the cart and resumes without a false replacement prompt", async ({ page }) => {
  await terminal(page);
  await add(page);
  await page.keyboard.press("F8");
  await expect(page.getByRole("dialog", { name: "Tahan pesanan" })).toBeVisible();
  await page.getByRole("button", { name: "Simpan pesanan", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tahan pesanan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Tambah jumlah/ })).toHaveCount(0);
  const [held] = await sql!`select id from sales where company_id=${companyId} and status='held' order by created_at desc limit 1`;
  await page.goto(`/app/pos?resume=${held.id}`);
  await expect(payButton(page)).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Keranjang aktif belum kosong" })).toHaveCount(0);
  await payButton(page).click();
  await expect(page.getByRole("heading", { name: "Transaksi berhasil", exact: true })).toBeVisible();
  expect(await sql!`select id from sales where id=${held.id}`).toHaveLength(0);
});

test("serial inputs appear after search, barcode scan and restored cart outside initial catalog", async ({ page }) => {
  const [product] = await sql!`select id,barcode,track_serial from products where company_id=${companyId} and name='Ultra Milk Coklat 250ml'`;
  await sql!`update products set track_serial=true where id=${product.id}`;
  try {
    await terminal(page);
    const search = page.getByLabel("Cari produk atau scan barcode");
    await search.fill("Ultra Milk Coklat 250ml");
    await expect(page.locator("[data-catalog-index]")).toHaveCount(1);
    await search.press("Enter");
    await expect(page.getByRole("textbox", { name: /Nomor seri unit/ })).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("textbox", { name: /Nomor seri unit/ })).toHaveCount(1);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await search.fill(product.barcode);
    await search.press("Enter");
    await expect(page.getByRole("textbox", { name: /Nomor seri unit/ })).toHaveCount(1);
  } finally {
    await sql!`update products set track_serial=${product.track_serial} where id=${product.id}`;
  }
});

test("offline mode generates no quote requests while the cart is idle for five seconds", async ({ page }) => {
  const [settings] = await sql!`select pos_offline_enabled from company_settings where company_id=${companyId}`;
  await sql!`update company_settings set pos_offline_enabled=true where company_id=${companyId}`;
  try {
    await terminal(page);
    await add(page);
    let quotes = 0;
    page.on("request", (request) => {
      const body = request.postData() ?? "";
      if (request.method() === "POST" && body.includes('"lines"') && !body.includes("idempotencyKey")) quotes++;
    });
    await page.waitForTimeout(5000);
    expect(quotes).toBe(0);
    await expect(payButton(page)).toBeEnabled();
  } finally {
    await sql!`update company_settings set pos_offline_enabled=${settings.pos_offline_enabled} where company_id=${companyId}`;
  }
});

test("void traps Tab, focuses Cancel and remains open during a failed network submission", async ({ page }) => {
  await terminal(page);
  await add(page);
  let key = "";
  page.on("request", (request) => {
    const body = request.postData() ?? "";
    if (request.method() === "POST" && body.includes("idempotencyKey") && body.includes("payments")) key = JSON.parse(body)[0].idempotencyKey;
  });
  await payButton(page).click();
  await expect(page.getByRole("heading", { name: "Transaksi berhasil", exact: true })).toBeVisible();
  const [sale] = await sql!`select id,number from sales where company_id=${companyId} and idempotency_key=${key}`;
  await page.goto(`/app/pos/riwayat?q=${sale.number}`);
  await page.getByRole("button", { name: `Aksi lain untuk transaksi ${sale.number}` }).click();
  await page.getByRole("menuitem", { name: "Void transaksi", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Void transaksi ${sale.number}` });
  await expect(dialog.getByRole("button", { name: "Batal", exact: true })).toBeFocused();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.getByPlaceholder("Alasan void (wajib)").fill("Regresi gangguan jaringan");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/app/pos/riwayat**", async (route) => {
    if (route.request().method() === "POST") { await gate; await route.abort("failed"); }
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "Void transaksi", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Memproses…" })).toBeVisible();
  try {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
  } finally { release(); }
  await expect(dialog.getByRole("button", { name: "Void transaksi", exact: true })).toBeEnabled();
  await expect(dialog).toBeVisible();
  await page.unroute("**/app/pos/riwayat**");
  await dialog.getByRole("button", { name: "Void transaksi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const [voided] = await sql!`select status from sales where id=${sale.id}`;
  expect(voided.status).toBe("void");
});

test("checkout sends no payment when its recovery record cannot be stored", async ({ page }) => {
  await terminal(page);
  await add(page);
  let payments = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.postData()?.includes("idempotencyKey") && request.postData()?.includes("payments")) payments++;
  });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.endsWith(".checkout")) throw new DOMException("Quota exceeded", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await payButton(page).click();
  await expect(page.getByText("Pembayaran belum dikirim. Aktifkan penyimpanan browser agar transaksi dapat dipulihkan.")).toBeVisible();
  expect(payments).toBe(0);
  await expect(page.getByRole("button", { name: "Tambah jumlah Aqua Air Mineral 600ml" })).toBeVisible();
  await expect(payButton(page)).toBeEnabled();
});

test.describe("PWA hydration", () => {
  test.use({ serviceWorkers: "allow" });

  test("online and cached offline reload hydrate without errors and sync one sale", async ({ page, context }) => {
    const [settings] = await sql!`select pos_offline_enabled from company_settings where company_id=${companyId}`;
    await sql!`update company_settings set pos_offline_enabled=true where company_id=${companyId}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await terminal(page);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByLabel("Cari produk atau scan barcode")).toBeVisible();
      await expect(page.getByRole("link", { name: "POS offline", exact: true })).toContainText("Offline");
      await page.getByRole("button", { name: /Aqua Air Mineral 600ml/ }).click();
      await expect(payButton(page)).toBeEnabled();
      await payButton(page).click();
      await expect(page.getByRole("heading", { name: "Tersimpan di perangkat", exact: true })).toBeVisible();
      const queue = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("bisa-pos-offline", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<Array<{ clientKey: string }>>((resolve, reject) => {
            const request = db.transaction("sales", "readonly").objectStore("sales").getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally { db.close(); }
      });
      expect(queue).toHaveLength(1);
      await page.getByRole("button", { name: "Tutup dialog transaksi berhasil" }).click();
      await context.setOffline(false);
      await expect.poll(async () => {
        const [{ count }] = await sql!`select count(*)::int as count from sales where company_id=${companyId} and idempotency_key=${queue[0].clientKey}`;
        return count;
      }, { timeout: 30000 }).toBe(1);
      await expect(page.getByRole("link", { name: "POS offline", exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.setOffline(false);
      await sql!`update company_settings set pos_offline_enabled=${settings.pos_offline_enabled} where company_id=${companyId}`;
    }
  });
});
