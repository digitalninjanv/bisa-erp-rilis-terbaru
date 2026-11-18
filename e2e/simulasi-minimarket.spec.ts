import { expect, test } from "@playwright/test";
import { readProductStock } from "./helpers";

// Sesi demo berasal dari storageState (lihat auth.setup.ts).

// Skenario penerimaan pengguna (SPEK-FITUR-INTI §5) lewat UI penuh:
// terima barang TUNAI → jual di POS → stok bergerak persis.
// Angka asersi bersifat relatif terhadap stok awal yang diukur dari UI,
// jadi test tahan terhadap isi seed. Produk demo yang dipakai:
// "Aqua Air Mineral 600ml" (harga jual dari data produk, Rp4.000).
const PRODUCT = "Aqua Air Mineral 600ml";
const RECEIVE_QTY = 100;
const RECEIVE_COST = "2500";

test("simulasi minimarket: terima tunai 100, jual 1 di POS, stok berkurang tepat", async ({ page }) => {
  test.setTimeout(180_000);

  // 1) Ukur stok awal dari halaman produk.
  const stockBefore = await readProductStock(page, "Aqua", PRODUCT);

  // 2) Terima 100 unit @Rp2.500 secara TUNAI dari halaman penerimaan.
  await page.goto("/app/gudang/penerimaan");
  await page.waitForLoadState("networkidle");
  const openReceipt = page.getByRole("button", { name: "Penerimaan baru", exact: true });
  if (await openReceipt.isVisible()) await openReceipt.click();
  await page.getByLabel("Sumber penerimaan").selectOption("purchase_cash");
  await expect(page.getByLabel("Dibayar dari akun")).toBeVisible();

  const picker = page.getByPlaceholder("Tambah produk ke dokumen…");
  await picker.fill(PRODUCT);
  const pickButton = page.getByRole("button", { name: new RegExp(PRODUCT) });
  await expect(pickButton).toBeVisible();
  await pickButton.click();

  const lineTable = page.locator("table").first();
  await expect(lineTable.getByText(PRODUCT)).toBeVisible();
  const lineInputs = lineTable.locator("tbody input");
  await lineInputs.nth(0).fill(String(RECEIVE_QTY));
  await lineInputs.nth(1).fill(RECEIVE_COST);
  await expect(lineTable.locator("tfoot")).toContainText(/250\.000/);

  await page.getByRole("button", { name: "Posting penerimaan" }).click();
  await expect(page.getByText("Penerimaan barang tersimpan dan stok diperbarui.")).toBeVisible();
  // Dokumen lahir lunas tanpa utang di riwayat.
  await page.goto("/app/gudang/penerimaan/riwayat");
  await expect(page.getByRole("table").first().locator("tbody tr").first()).toContainText("Lunas");

  // 3) Stok bertambah tepat 100.
  const stockAfterReceipt = await readProductStock(page, "Aqua", PRODUCT);
  expect(stockAfterReceipt).toBe(stockBefore + RECEIVE_QTY);

  // 4) POS: pastikan sesi kas terbuka (seed menyediakan sesi owner;
  //    bila tidak ada, buka sesi baru lewat halaman sesi).
  await page.goto("/app/pos");
  if (await page.getByText("Sesi kas belum dibuka").first().isVisible().catch(() => false)) {
    await page.goto("/app/pos/sesi");
    await page.getByLabel("Modal awal").fill("100000");
    await page.getByRole("button", { name: "Buka sesi" }).click();
    await page.goto("/app/pos");
  }
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();

  // 5) Jual 1 unit produk yang sama, bayar tunai pas.
  await page.getByLabel("Cari produk atau scan barcode").fill(PRODUCT);
  const productButton = page.getByRole("button", { name: new RegExp(PRODUCT) });
  await expect(productButton).toBeVisible();
  await productButton.click();

  await expect(page.getByRole("heading", { name: "Keranjang" })).toBeVisible();
  await expect(page.locator("aside").getByText(PRODUCT)).toBeVisible();
  const payButton = page.getByRole("button", { name: /^Bayar Rp/ });
  await expect(payButton).toBeEnabled();
  // Total sesuai harga jual produk dari data seed (Rp4.000).
  await expect(payButton).toHaveText(/Bayar Rp\s?4\.000/);
  await payButton.click();

  // 6) Modal sukses menandai transaksi selesai; nota dibuka dari tautannya.
  await expect(page.getByText("Transaksi berhasil")).toBeVisible();
  const notaHref = await page
    .getByRole("link", { name: /Buka detail nota/ })
    .getAttribute("href");
  expect(notaHref).toMatch(/\/app\/pos\/nota\//);
  await page.goto(notaHref!);
  await expect(page.getByText(PRODUCT)).toBeVisible();
  await expect(page.getByText(/Rp\s?4\.000/).first()).toBeVisible();

  // 6b) POS-NOTA-01: pada media cetak, toast sukses checkout TIDAK
  //     boleh tampil (ia menimpa kop nota pada hasil cetak thermal)
  //     dan kop nota sendiri tetap terlihat. locator toast yang
  //     tidak ada di DOM juga lulus toBeHidden — yang dilarang di
  //     sini adalah toast yang TERLIHAT di media cetak.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-sonner-toast]").first()).toBeHidden();
  await expect(page.locator(".print-area")).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // 7) Stok akhir = stok sesudah penerimaan − 1.
  const stockAfterSale = await readProductStock(page, "Aqua", PRODUCT);
  expect(stockAfterSale).toBe(stockAfterReceipt - 1);
});
