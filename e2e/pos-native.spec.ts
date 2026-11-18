import { expect, test } from "@playwright/test";

/**
 * Pola POS native: di layar kecil keranjang dibuka sebagai sheet dari
 * bar bawah (bukan tenggelam di bawah katalog), dan daftar admin POS
 * memakai kartu—bukan tabel lebar yang dipaksa scroll horizontal.
 */
test("terminal mobile membuka keranjang sebagai sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/pos");
  await expect(page.getByLabel("Cari produk atau scan barcode")).toBeVisible();
  await page.getByRole("button", { name: /Buka keranjang/ }).click();
  await expect(page.getByText("Keranjang & pembayaran")).toBeVisible();
  await page.getByRole("button", { name: "Tutup keranjang" }).click();
  await expect(page.getByText("Keranjang & pembayaran")).toBeHidden();
});

test("daftar POS memakai kartu di mobile tanpa overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/app/pos/riwayat", "/app/pos/ditahan", "/app/pos/sesi/riwayat"]) {
    await page.goto(path);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      path,
    ).toBe(true);
    await expect(page.locator("table.data-table").first()).toBeHidden();
  }
});

test("kategori produk menyaring katalog dan bisa dikembalikan ke semua", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/pos");
  const semua = page.getByRole("button", { name: "Semua", exact: true });
  const minuman = page.getByRole("button", { name: "Minuman", exact: true });
  const baterai = page.getByRole("button", { name: /Baterai ABC AA 4pcs/ });
  // Ultra Milk ada di kategori Minuman tetapi di luar 24 produk pertama
  // "Semua" — hanya muncul setelah filter benar-benar diterapkan.
  const ultraMilk = page.getByRole("button", { name: /Ultra Milk Coklat 250ml/ });
  await expect(semua).toHaveAttribute("aria-pressed", "true");
  await expect(baterai).toBeVisible();
  await expect(ultraMilk).toHaveCount(0);
  await expect(minuman).toBeVisible();
  await minuman.click();
  await expect(minuman).toHaveAttribute("aria-pressed", "true");
  await expect(semua).toHaveAttribute("aria-pressed", "false");
  // Filter benar-benar memuat ulang katalog: Baterai keluar, Ultra Milk masuk.
  await expect(ultraMilk).toBeVisible();
  await expect(baterai).toHaveCount(0);
  await semua.click();
  await expect(semua).toHaveAttribute("aria-pressed", "true");
  await expect(baterai).toBeVisible();
  await expect(ultraMilk).toHaveCount(0);
});
