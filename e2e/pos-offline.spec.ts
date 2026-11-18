import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const BUKTI_DIR = path.join(__dirname, "..", "..", "..", "bukti-a24", "t6");

// A-24 T6 — Pembuktian offline POS di peramban sungguhan.
// Kriteria kelulusan ditulis SEBELUM skenario dijalankan
// (docs/rombak/RENCANA.md T6 + docs/OFFLINE_POS_ARCHITECTURE.md):
//
// Skenario A — jaringan peramban putus di tengah sesi; keranjang
// dibangun SESUDAH offline (kasus nyata penurunan koneksi):
// 3 penjualan (tunai/QRIS/campuran) masuk antrean IndexedDB, lalu
// sinkron sesudah online dengan angka stok/jurnal/sesi yang cocok
// dengan penjualan kontrol online berkeranjang identik; pengiriman
// ulang payload yang sama terdedup (status duplicate, tetap 1 nota).
//
// Skenario C — konflik: harga berubah & stok dikosongkan dari
// perangkat lain selagi terminal offline → kedua item TIDAK
// terposting, masuk peninjauan berkind price/stock dengan penjelasan
// yang terlihat kasir — bukan kehilangan penjualan diam-diam.
//
// Saklar pos_offline_enabled perusahaan demo dinyalakan spec ini
// lewat SQL dan DIMATIKAN lagi di afterAll; aplikasi tidak diubah.

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
let sessionId = "";
const productId: Record<string, string> = {};

async function one<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T> {
  const rows = await sql.unsafe(query, params as never[]);
  return rows[0] as T;
}

async function stockOf(name: string): Promise<number> {
  const row = await one<{ qty: string }>(
    `select qty from stock_on_hand where product_id = $1 and warehouse_id = $2`,
    [productId[name], warehouseId],
  );
  return Number(row.qty);
}

async function saleByKey(clientKey: string) {
  const rows = await sql.unsafe(
    `select id, number, total::float8 as total from sales where company_id = $1 and idempotency_key = $2`,
    [DEMO, clientKey],
  );
  return rows[0] as unknown as { id: string; number: string; total: number } | undefined;
}

async function journalMultiset(saleId: string): Promise<string> {
  const rows = await sql.unsafe(
    `select a.code as code, jl.debit::float8 as debit, jl.credit::float8 as credit
       from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
      where je.company_id = $1 and je.source_type = 'sale' and je.source_id = $2
      order by a.code, jl.debit desc, jl.credit desc`,
    [DEMO, saleId],
  );
  return JSON.stringify(rows);
}

async function sessionCashTotal(): Promise<number> {
  const row = await one<{ sum: string }>(
    `select coalesce(sum(sp.amount), 0) as sum
       from sale_payments sp
       join sales s on s.id = sp.sale_id
       join payment_methods pm on pm.id = sp.method_id
      where s.company_id = $1 and s.session_id = $2 and pm.type = 'cash' and s.status = 'completed'`,
    [DEMO, sessionId],
  );
  return Number(row.sum);
}

type QueuedItem = {
  clientKey: string;
  expectedTotal?: number;
  lastStatus?: string;
  [key: string]: unknown;
};

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
  // Tombol produk nonaktif bila stok katalog habis — gagal cepat &
  // jelas di sini daripada klik yang menggantung sampai timeout test.
  await expect(button).toBeEnabled();
  await button.click();
  // Klik kartu berulang cepat bisa kalah balapan render React. Untuk
  // qty > 1, tambah lewat tombol keranjang yang memang mengubah qty.
  if (times > 1) {
    const plus = page.getByRole("button", { name: `Tambah jumlah ${name}` });
    for (let i = 1; i < times; i++) await plus.click();
  }
}

/** Ubah harga jual produk lewat UI Gudang (perangkat lain). */
async function setProductPrice(page: Page, productName: string, price: string) {
  await page.goto(`/app/gudang/produk?q=${encodeURIComponent(productName.split(" ")[0])}`);
  await page.getByRole("link", { name: productName, exact: true }).click();
  await page.getByRole("button", { name: "Ubah produk" }).click();
  await page.getByLabel("Harga jual").fill(price);
  await page.getByRole("button", { name: "Simpan" }).click();
}

/** Terima stok lewat penerimaan pembelian tunai (pola spec simulasi). */
async function receiveStock(page: Page, productName: string, qty: number, cost: string) {
  await page.goto("/app/gudang/penerimaan");
  await page.getByLabel("Sumber penerimaan").selectOption({ label: "Pembelian tunai" });
  const picker = page.getByPlaceholder("Tambah produk ke dokumen…");
  await picker.fill(productName);
  const pickButton = page.getByRole("button", { name: new RegExp(productName) });
  await expect(pickButton).toBeVisible();
  await pickButton.click();
  const lineTable = page.locator("table").first();
  await expect(lineTable.getByText(productName)).toBeVisible();
  const lineInputs = lineTable.locator("tbody input");
  await lineInputs.nth(0).fill(String(qty));
  await lineInputs.nth(1).fill(cost);
  await page.getByRole("button", { name: "Posting penerimaan" }).click();
  await expect(page.getByText("Penerimaan barang tersimpan dan stok diperbarui.")).toBeVisible();
}

async function expectPayTotal(page: Page, label: string) {
  const pay = page.getByRole("button", { name: /^Bayar Rp/ });
  await expect(pay).toBeEnabled({ timeout: 20_000 });
  await expect(pay).toHaveText(new RegExp(`Bayar Rp\\s?${label}`));
  return pay;
}

test.beforeAll(async () => {
  const wh = await one<{ id: string }>(
    `select id from warehouses where company_id = $1 and name = 'Gudang Utama'`,
    [DEMO],
  );
  warehouseId = wh.id;
  const session = await one<{ id: string }>(
    `select id from cash_sessions where company_id = $1 and status = 'open' order by opened_at desc limit 1`,
    [DEMO],
  );
  sessionId = session.id;
  for (const name of ["Aqua Air Mineral 600ml", "Beng Beng Chocolate", "Coca Cola 390ml", "Fanta Strawberry 390ml", "Ember Plastik 10L"]) {
    const row = await one<{ id: string }>(
      `select id from products where company_id = $1 and name = $2`,
      [DEMO, name],
    );
    productId[name] = row.id;
  }
  await sql.unsafe(`update company_settings set pos_offline_enabled = true where company_id = $1`, [DEMO]);
});

test.afterAll(async () => {
  await sql.unsafe(`update company_settings set pos_offline_enabled = false where company_id = $1`, [DEMO]);
  await sql.end();
});

test("skenario A: offline di tengah sesi — 3 penjualan antre, sinkron, angka cocok, duplikat terdedup", async ({ page }) => {
  test.setTimeout(300_000);

  // --- Kontrol online: keranjang identik A1 (Aqua x2 tunai) ---
  const cashBefore = await sessionCashTotal();
  const stockAqua0 = await stockOf("Aqua Air Mineral 600ml");
  await page.goto("/app/pos");
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
  await addProduct(page, "Aqua Air Mineral 600ml", 2);
  await (await expectPayTotal(page, "8\\.000")).click();
  await expect(page.getByText("Transaksi berhasil")).toBeVisible();
  const controlSales = await sql.unsafe(
    `select id from sales where company_id = $1 order by created_at desc limit 1`,
    [DEMO],
  );
  const controlJournal = await journalMultiset(controlSales[0].id as string);

  // --- Offline: bangun 3 keranjang SESUDAH jaringan putus ---
  await page.goto("/app/pos");
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
  const stockBeng0 = await stockOf("Beng Beng Chocolate");
  const stockCoke0 = await stockOf("Coca Cola 390ml");
  await page.context().setOffline(true);

  // A1 tunai: Aqua x2 = 8.000 (Diterima kosong = uang pas)
  await addProduct(page, "Aqua Air Mineral 600ml", 2);
  await (await expectPayTotal(page, "8\\.000")).click();
  await expect(page.getByText(/tersimpan di antrean/).first()).toBeVisible();

  // A2 QRIS: Beng Beng x3 = 9.000 + konfirmasi penerimaan
  await addProduct(page, "Beng Beng Chocolate", 3);
  await page.getByRole("button", { name: /^QRIS/ }).click();
  await page.locator("label", { hasText: "Pembayaran sudah diterima" }).click();
  await (await expectPayTotal(page, "9\\.000")).click();
  await expect(page.getByText(/tersimpan di antrean/).first()).toBeVisible();

  // A3 campuran: Coca Cola x2 = 14.000 → Tunai 10.000 + QRIS 4.000
  await addProduct(page, "Coca Cola 390ml", 2);
  await page.getByRole("button", { name: "Campuran" }).click();
  await page.getByLabel("Nominal pembayaran Tunai").fill("10000");
  await page.getByLabel("Uang diterima untuk Tunai").fill("10000");
  await page.getByLabel("Nominal pembayaran QRIS").fill("4000");
  await (await expectPayTotal(page, "14\\.000")).click();
  await expect(page.getByText(/tersimpan di antrean/).first()).toBeVisible();

  const queue = await readQueue(page);
  expect(queue.map((item) => item.expectedTotal).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8000, 9000, 14000]);
  const payloadA1 = queue.find((item) => item.expectedTotal === 8000);
  expect(payloadA1).toBeTruthy();

  // --- Online lagi: sinkron tuntas ---
  await page.context().setOffline(false);
  await expect
    .poll(async () => (await readQueue(page)).length, { timeout: 30_000 })
    .toBe(0);

  const saleA1 = await saleByKey(payloadA1!.clientKey);
  expect(saleA1).toBeTruthy();
  expect(saleA1!.total).toBe(8000);
  // Jurnal A1 identik dengan penjualan kontrol online (multiset baris)
  expect(await journalMultiset(saleA1!.id)).toBe(controlJournal);
  // Jurnal setiap penjualan sinkron seimbang
  for (const item of queue) {
    const sale = await saleByKey(item.clientKey);
    expect(sale, `penjualan untuk clientKey ${item.clientKey}`).toBeTruthy();
    const sums = await one<{ d: string; c: string }>(
      `select coalesce(sum(jl.debit),0) as d, coalesce(sum(jl.credit),0) as c
         from journal_lines jl join journal_entries je on je.id = jl.entry_id
        where je.company_id = $1 and je.source_type = 'sale' and je.source_id = $2`,
      [DEMO, sale!.id],
    );
    expect(Number(sums.d)).toBeGreaterThan(0);
    expect(Number(sums.d)).toBe(Number(sums.c));
  }
  // Stok turun tepat (kontrol -2 Aqua; A1 -2 Aqua; A2 -3; A3 -2)
  expect(await stockOf("Aqua Air Mineral 600ml")).toBe(stockAqua0 - 4);
  expect(await stockOf("Beng Beng Chocolate")).toBe(stockBeng0 - 3);
  expect(await stockOf("Coca Cola 390ml")).toBe(stockCoke0 - 2);
  // Kas sesi: kontrol 8.000 + A1 8.000 + A3 tunai 10.000
  expect(await sessionCashTotal()).toBe(cashBefore + 26_000);

  // --- Idempotensi: payload A1 dikirim ulang → duplicate, tetap 1 nota ---
  await page.evaluate(async (payload) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bisa-pos-offline", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sales", "readwrite");
      tx.objectStore("sales").add(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    window.dispatchEvent(new Event("online"));
  }, payloadA1 as never);
  await expect
    .poll(async () => (await readQueue(page)).length, { timeout: 30_000 })
    .toBe(0);
  const dupCount = await one<{ n: string }>(
    `select count(*) as n from sales where company_id = $1 and idempotency_key = $2`,
    [DEMO, payloadA1!.clientKey],
  );
  expect(Number(dupCount.n)).toBe(1);

  await page.goto("/app/pos/riwayat");
  await expect(page.getByRole("link", { name: saleA1!.number }).first()).toBeVisible();
  await page.screenshot({ path: path.join(BUKTI_DIR, "skenario-a-riwayat.png") });
});

test("skenario C: konflik harga & stok — item masuk peninjauan, tidak hilang diam-diam", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const storageState = test.info().project.use.storageState as string;
  const otherContext: BrowserContext = await browser.newContext({ storageState });
  const other = await otherContext.newPage();

  // Titik awal harga Fanta Rp7.000 ditulis langsung ke master produk
  // (bukan ledger) agar deterministik; perubahan harga berikutnya tetap
  // lewat UI perangkat lain untuk menguji konflik harga.
  await sql.unsafe(
    `update products set sale_price = 7000 where id = $1`,
    [productId["Fanta Strawberry 390ml"]],
  );
  let emberStock = await stockOf("Ember Plastik 10L");
  if (emberStock < 1) {
    await receiveStock(other, "Ember Plastik 10L", 6, "22000");
    emberStock = await stockOf("Ember Plastik 10L");
  }
  // Higiene antrean peninjauan: baris pending sisa larian uji lain
  // ditandai terproses (bookkeeping outbox saja — bukan ledger) agar
  // halaman peninjauan pada test ini berisi tepat item test ini.
  await sql.unsafe(
    `update outbox set processed_at = now()
      where company_id = $1 and event_type = 'pos_offline_sale' and processed_at is null`,
    [DEMO],
  );

  const salesBefore = await one<{ n: string }>(
    `select count(*) as n from sales where company_id = $1`,
    [DEMO],
  );
  // Terminal memuat snapshot (harga & stok lama), lalu offline
  await page.goto("/app/pos");
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
  await page.context().setOffline(true);

  // C1: Fanta x1 pada harga snapshot 7.000
  await addProduct(page, "Fanta Strawberry 390ml", 1);
  await (await expectPayTotal(page, "7\\.000")).click();
  await expect(page.getByText(/tersimpan di antrean/).first()).toBeVisible();
  // C2: Ember x1 (stok snapshot = stok saat ini)
  await addProduct(page, "Ember Plastik 10L", 1);
  await (await expectPayTotal(page, "30\\.000")).click();
  await expect(page.getByText(/tersimpan di antrean/).first()).toBeVisible();
  const queue = await readQueue(page);
  expect(queue.length).toBe(2);

  // Perangkat lain (online): harga Fanta naik 7.000 → 7.500
  await setProductPrice(other, "Fanta Strawberry 390ml", "7500");
  await expect
    .poll(
      async () => {
        const row = await one<{ sale_price: string }>(
          `select sale_price from products where id = $1`,
          [productId["Fanta Strawberry 390ml"]],
        );
        return Number(row.sale_price);
      },
      { timeout: 20_000 },
    )
    .toBe(7500);

  // Perangkat lain mengosongkan stok Ember: jual seluruh stok yang ada
  // di POS-nya (jumlah dinamis dari stok saat ini — total ikut menyesuaikan)
  await other.goto("/app/pos");
  await expect(other.getByText("Sesi kas terbuka")).toBeVisible();
  await addProduct(other, "Ember Plastik 10L", emberStock);
  const emberTotalLabel = (emberStock * 30000).toLocaleString("id-ID").replace(/\./g, "\\.");
  await (await expectPayTotal(other, emberTotalLabel)).click();
  await expect(other.getByText("Transaksi berhasil")).toBeVisible();
  expect(await stockOf("Ember Plastik 10L")).toBe(0);

  // Terminal online lagi → sinkron → kedua item tertahan sebagai konflik
  await page.context().setOffline(false);
  await expect
    .poll(
      async () => {
        const items = await readQueue(page);
        return items.length === 2 && items.every((item) => item.lastStatus) ? 2 : items.length;
      },
      { timeout: 30_000 },
    )
    .toBe(2);

  // Tidak ada penjualan baru untuk kedua clientKey; hanya +1 penjualan
  // (pembelian Ember oleh perangkat lain) sejak awal test
  for (const item of queue) {
    expect(await saleByKey(item.clientKey)).toBeUndefined();
  }
  const salesAfter = await one<{ n: string }>(
    `select count(*) as n from sales where company_id = $1`,
    [DEMO],
  );
  expect(Number(salesAfter.n)).toBe(Number(salesBefore.n) + 1);

  // Baris peninjauan server: kind price & stock, belum terproses.
  // Dipoll: penulisan outbox adalah efek server asinkron terhadap
  // respons yang diterima klien.
  const keys = new Set(queue.map((item) => item.clientKey));
  await expect
    .poll(
      async () => {
        const pending = await sql.unsafe(
          `select payload->>'kind' as kind, payload->>'clientKey' as key
             from outbox
            where company_id = $1 and event_type = 'pos_offline_sale' and processed_at is null`,
          [DEMO],
        );
        return pending
          .filter((row) => keys.has(row.key as string))
          .map((row) => row.kind)
          .sort();
      },
      { timeout: 20_000 },
    )
    .toEqual(["price", "stock"]);

  // Kasir melihat penjelasan di halaman Peninjauan offline
  await page.goto("/app/pos/offline");
  await expect(page.getByText("Harga berubah sejak transaksi").first()).toBeVisible();
  // A-25 U1: deskripsi PageHeader kini terlipat ("Penjelasan
  // halaman") sehingga kecocokan teks pertama "Konflik stok" adalah
  // paragraf yang tersembunyi itu. Yang dimaksud assertion ini sejak
  // awal adalah kartu statistik konflik stok yang terlihat —
  // arahkan locator ke kartunya; maksud pengujian tidak berubah.
  await expect(page.getByText("Konflik stok", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(BUKTI_DIR, "skenario-c-peninjauan.png"), fullPage: true });

  // Kebersihan: supervisor membuang kedua item dari halaman peninjauan
  // (G1/FRM-02: alasan buang kini ConfirmDialog bersama — klik baris
  // "Buang" lalu konfirmasi "Buang antrean"; dulu window.prompt yang
  // ditangani handler dialog peramban), lalu antrean lokal terminal
  // dibersihkan lewat IndexedDB-nya sendiri.
  const buangButtons = page.getByRole("button", { name: "Buang", exact: true });
  for (let i = 0; i < 5 && (await buangButtons.count()) > 0; i++) {
    await buangButtons.first().click();
    await page.getByRole("button", { name: "Buang antrean" }).click();
    await page.waitForTimeout(1200);
  }
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bisa-pos-offline", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sales", "readwrite");
      tx.objectStore("sales").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
  // Pulihkan titik awal skenario lewat UI perangkat lain: harga Fanta
  // kembali 7.000 dan stok Ember diterima kembali sejumlah yang dibeli
  // (biaya pokok sama dengan biaya produk → AVCO pulih; ledger tetap
  // konsisten karena keduanya pergerakan resmi).
  await setProductPrice(other, "Fanta Strawberry 390ml", "7000");
  await receiveStock(other, "Ember Plastik 10L", emberStock, "22000");
  expect(await stockOf("Ember Plastik 10L")).toBe(emberStock);
  await otherContext.close();
});
