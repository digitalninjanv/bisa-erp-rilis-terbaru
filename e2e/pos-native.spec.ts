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
