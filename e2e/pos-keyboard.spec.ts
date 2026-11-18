import { expect, test, type Page } from "@playwright/test";

// A-28 UI-1 (UX-B01/B02/B03/B04/B07): keyboard & workflow POS dibuktikan
// di browser nyata — autofocus terminal & F2, navigasi panah hasil
// pencarian, tender campuran terformat, gerbang Bayar campuran, dan
// pintasan F9. Sesi demo berasal dari storageState (auth.setup.ts);
// bila sesi belum terbuka, test membukanya seperti kasir.

async function openTerminal(page: Page) {
  await page.goto("/app/pos");
  if (await page.getByText("Sesi kas belum dibuka").first().isVisible().catch(() => false)) {
    await page.goto("/app/pos/sesi");
    await page.getByLabel("Modal awal").fill("100000");
    await page.getByRole("button", { name: "Buka sesi" }).click();
    await page.goto("/app/pos");
  }
  await expect(page.getByText("Sesi kas terbuka")).toBeVisible();
}

test("terminal: autofocus saat dimuat, F2 memulihkan fokus, fokus kembali sesudah tambah produk", async ({ page }) => {
  await openTerminal(page);
  const search = page.getByLabel("Cari produk atau scan barcode");

  // UX-B01: tanpa klik awal, fokus sudah di kotak cari.
  await expect(search).toBeFocused();

  // F2 nyata: fokus dipindah ke badan halaman, F2 mengembalikannya.
  await page.getByText(/Halaman \d+/).click();
  await expect(search).not.toBeFocused();
  await page.keyboard.press("F2");
  await expect(search).toBeFocused();

  // Tambah produk lewat Enter (jalur lama: hasil pertama) — sesudahnya
  // fokus kembali ke kotak cari untuk pindaian berikutnya.
  await search.fill("Aqua");
  await expect(page.locator("[data-catalog-index]")).toHaveCount(2);
  await page.keyboard.press("Enter");
  const cart = page.getByRole("complementary").filter({ hasText: "Keranjang" });
  await expect(cart.getByText(/Aqua Air Mineral/)).toBeVisible();
  await expect(search).toBeFocused();
});

test("pencarian: panah + Enter memilih produk tersorot, bukan selalu hasil pertama", async ({ page }) => {
  await openTerminal(page);
  const search = page.getByLabel("Cari produk atau scan barcode");
  await search.fill("Indomie");
  const cards = page.locator("[data-catalog-index]");
  await expect(cards).toHaveCount(2);

  const firstName = (await cards.nth(0).innerText()).split("\n")[0].trim();

  await page.keyboard.press("ArrowDown");
  await expect(cards.nth(0)).toHaveAttribute("data-highlighted", "true");
  await page.keyboard.press("ArrowDown");
  await expect(cards.nth(1)).toHaveAttribute("data-highlighted", "true");
  await expect(cards.nth(0)).not.toHaveAttribute("data-highlighted", "true");

  const highlightedName = (await cards.nth(1).innerText()).split("\n")[0].trim();
  expect(highlightedName).not.toBe(firstName);

  await page.keyboard.press("Enter");
  const cart = page.getByRole("complementary").filter({ hasText: "Keranjang" });
  await expect(cart.getByText(highlightedName)).toBeVisible();
  await expect(cart.getByText(firstName)).toHaveCount(0);
});

test("campuran: Bayar nonaktif selama sisa > 0, tender tampil terformat, F9 menyelesaikan", async ({ page }) => {
  await openTerminal(page);
  const search = page.getByLabel("Cari produk atau scan barcode");
  await search.fill("Aqua Air Mineral 600ml");
  const card = page.getByRole("button", { name: /Aqua Air Mineral 600ml/ });
  await expect(card).toBeVisible();
  await card.click();

  const panel = page.getByRole("complementary").filter({ hasText: "Pembayaran" });
  await panel.getByRole("button", { name: "Campuran" }).click();

  // UX-B07: sisa masih penuh → Bayar nonaktif & label menyatakan sisa.
  const payButton = panel.getByRole("button", { name: /Bayar/ });
  await expect(payButton).toBeDisabled();
  await expect(payButton).toContainText("sisa Rp 4.000");

  // UX-B04: nominal diketik mentah, tampil terformat id-ID.
  const tunai = page.getByLabel("Nominal pembayaran Tunai");
  await tunai.click();
  await page.keyboard.type("4000");
  await expect(tunai).toHaveValue("4.000");

  // Sisa = 0 → Bayar aktif tepat saat tender tertutup, lalu F9 membayar.
  await expect(payButton).toBeEnabled();
  await expect(payButton).toHaveText(/Bayar Rp\s?4\.000/);
  await page.keyboard.press("F9");
  // Pola native 2026: terminal tidak ditinggalkan — modal sukses tampil
  // dan kasir memilih Transaksi Baru atau membuka detail nota.
  await expect(page.getByText("Transaksi berhasil")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cetak nota" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tutup dialog transaksi berhasil" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Transaksi baru/ })).toBeVisible();
});
