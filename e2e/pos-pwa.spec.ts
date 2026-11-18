import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const BUKTI_DIR = path.join(__dirname, "..", "..", "..", "bukti-a24", "t6b");

// A-24 T6B — pengerasan PWA terbatas (service worker shell terminal).
// Kriteria ditulis SEBELUM dijalankan (RENCANA T6B):
//
// 1. Service worker terdaftar dari halaman terminal dengan scope
//    tepat /app/pos dan mengendalikan halaman terminal sesudah reload;
//    halaman di luar scope (mis. /app/gudang) TIDAK dikendalikan.
// 2. Reload saat jaringan mati membuka terminal DARI CACHE —
//    menutup temuan T6 skenario B butir 5 (sebelum T6B reload yang
//    sama menghasilkan ERR_CONNECTION_REFUSED peramban).
// 3. Penjualan yang dibangun dari halaman hasil cache itu mengantre
//    di IndexedDB (mekanisme T6) dan tersinkron tuntas saat jaringan
//    kembali, dengan total penjualan & stok cocok di DB.
//
// Catatan kejujuran harness: webServer dikelola Playwright sehingga
// server tidak bisa dibunuh di tengah spec; "jaringan mati" di sini
// adalah emulasi context.setOffline — dari sudut service worker,
// fetch navigasi yang gagal jaringan diperlakukan identik. Bukti
// bunuh-server sungguhan (SIGKILL) berjalan sebagai skrip terpandu
// profil persisten terpisah; log & tangkapannya di BUKTI_DIR dan
// hasilnya tercatat di docs/OFFLINE_POS_ARCHITECTURE.md.
//
// Saklar pos_offline_enabled dinyalakan spec ini lewat SQL dan
// dimatikan lagi di afterAll, sama seperti pos-offline.spec.ts.

function directUrl(): string {
  // E2E harus memakai DB uji yang diberikan harness, bukan DB pengguna.
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  const env = fs.readFileSync(".env.local", "utf8");
  const line = env.split("\n").find((row) => row.startsWith("DIRECT_URL="));
  if (!line) throw new Error("DIRECT_URL tidak ditemukan di .env.local");
  return line.slice("DIRECT_URL=".length).trim();
}

const sql = postgres(directUrl(), { max: 1 });

const DEMO = "01900000-0000-7000-8000-000000000001";
let warehouseId = "";
let aquaId = "";

async function one<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T> {
  const rows = await sql.unsafe(query, params as never[]);
  return rows[0] as T;
}

async function stockOfAqua(): Promise<number> {
  const row = await one<{ qty: string }>(
    `select qty from stock_on_hand where product_id = $1 and warehouse_id = $2`,
    [aquaId, warehouseId],
  );
  return Number(row.qty);
}

type QueuedItem = { clientKey: string; expectedTotal?: number; [key: string]: unknown };

async function readQueue(page: Page): Promise<QueuedItem[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bisa-pos-offline", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<QueuedItem[]>((resolve, reject) => {
      const request = db.transaction("sales", "readonly").objectStore("sales").getAll();
      request.onsuccess = () => resolve(request.result as QueuedItem[]);
      request.onerror = () => reject(request.error);
    });
  });
}

async function addProduct(page: Page, name: string, times = 1) {
  await page.getByLabel("Cari produk atau scan barcode").fill(name);
  const button = page.getByRole("button", { name: new RegExp(name) }).first();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  for (let i = 0; i < times; i++) await button.click();
}

async function expectPayTotal(page: Page, label: string) {
  const pay = page.getByRole("button", { name: /^Bayar Rp/ });
  await expect(pay).toBeEnabled({ timeout: 20_000 });
  await expect(pay).toHaveText(new RegExp(`Bayar Rp\\s?${label}`));
  return pay;
}

/** Terminal harus berakhir pada sesi kas terbuka; buka lewat UI bila belum ada. */
async function ensureOpenSession(page: Page) {
  await page.goto("/app/pos");
  // Cek keadaan sebenarnya di DB: teks status bisa belum ter-hidrasi
  // saat halaman baru dimuat, dan locator teks bisa menunjuk elemen
  // tersembunyi. Sesi yang sudah terbuka tidak perlu dibuka lagi.
  const open = await sql.unsafe(
    `select id from cash_sessions where company_id = $1 and status = 'open' limit 1`,
    [DEMO],
  );
  if (open.length > 0) return;
  await page.getByLabel("Modal awal").fill("100000");
  await page.getByRole("button", { name: "Buka sesi" }).click();
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
}

test.beforeAll(async () => {
  const wh = await one<{ id: string }>(
    `select id from warehouses where company_id = $1 and name = 'Gudang Utama'`,
    [DEMO],
  );
  warehouseId = wh.id;
  const aqua = await one<{ id: string }>(
    `select id from products where company_id = $1 and name = 'Aqua Air Mineral 600ml'`,
    [DEMO],
  );
  aquaId = aqua.id;
  await sql.unsafe(`update company_settings set pos_offline_enabled = true where company_id = $1`, [DEMO]);
});

test.afterAll(async () => {
  await sql.unsafe(`update company_settings set pos_offline_enabled = false where company_id = $1`, [DEMO]);
  await sql.end();
});

test("T6B: reload saat jaringan mati membuka terminal dari cache; penjualan mengantre & tersinkron", async ({ page }) => {
  test.setTimeout(300_000);

  // --- 1. SW terdaftar (scope tepat /app/pos) & mengendalikan terminal ---
  await ensureOpenSession(page);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration("/app/pos");
          return reg?.scope ?? "";
        }),
      { timeout: 20_000 },
    )
    .toMatch(/\/app\/pos$/);
  // Kunjungan pertama belum dikendalikan worker. Di suite penuh, registrasi
  // kadang baru aktif satu putaran setelah reload (bergantung cache SW dari
  // spec sebelumnya); ulangi reload terbatas sampai controller terpasang.
  let controlled = false;
  for (let attempt = 0; attempt < 3 && !controlled; attempt += 1) {
    await page.reload();
    await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
    try {
      await expect
        .poll(
          () => page.evaluate(() => navigator.serviceWorker.controller !== null),
          { timeout: 5_000 },
        )
        .toBe(true);
      controlled = true;
    } catch {
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/app/pos");
        await reg?.update();
      });
    }
  }
  expect(controlled, "service worker terminal mengendalikan halaman").toBe(true);

  // Halaman di luar scope tidak dikendalikan worker terminal.
  await page.goto("/app/gudang");
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();

  // --- Pemanasan jalur bayar selagi online (chunk pembayaran termuat
  // & ikut ter-cache, meniru kasir yang sudah berjualan hari itu) ---
  await page.goto("/app/pos");
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
  await addProduct(page, "Aqua Air Mineral 600ml", 1);
  await (await expectPayTotal(page, "4\\.000")).click();
  await expect(page.getByText("Transaksi berhasil")).toBeVisible();
  await page.goto("/app/pos");
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
  const stockBefore = await stockOfAqua();

  // --- 2. Jaringan mati → reload → terminal TERBUKA dari cache ---
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Aqua Air Mineral 600ml/ }).first()).toBeVisible();
  await page.screenshot({ path: path.join(BUKTI_DIR, "e2e-reload-dari-cache.png") });

  // --- 3. Jualan dari halaman cache → antre → jaringan pulih →
  // sinkron tuntas dengan angka DB cocok ---
  await addProduct(page, "Aqua Air Mineral 600ml", 2);
  await (await expectPayTotal(page, "8\\.000")).click();
  await expect(page.getByText(/tersimpan di antrean/).first()).toBeVisible();
  const queue = await readQueue(page);
  expect(queue.length).toBe(1);
  expect(queue[0].expectedTotal).toBe(8000);

  await page.context().setOffline(false);
  await expect.poll(async () => (await readQueue(page)).length, { timeout: 30_000 }).toBe(0);

  const sale = await one<{ id: string; number: string; total: number }>(
    `select id, number, total::float8 as total from sales where company_id = $1 and idempotency_key = $2`,
    [DEMO, queue[0].clientKey],
  );
  expect(sale).toBeTruthy();
  expect(sale.total).toBe(8000);
  expect(await stockOfAqua()).toBe(stockBefore - 2);
  const sums = await one<{ d: string; c: string }>(
    `select coalesce(sum(jl.debit),0) as d, coalesce(sum(jl.credit),0) as c
       from journal_lines jl join journal_entries je on je.id = jl.entry_id
      where je.company_id = $1 and je.source_type = 'sale' and je.source_id = $2`,
    [DEMO, sale.id],
  );
  expect(Number(sums.d)).toBeGreaterThan(0);
  expect(Number(sums.d)).toBe(Number(sums.c));
  await page.screenshot({ path: path.join(BUKTI_DIR, "e2e-sesudah-sinkron.png") });
});
