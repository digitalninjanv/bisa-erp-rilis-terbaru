import { expect, test } from "@playwright/test";

/**
 * Analisa bisnis: hierarki kesehatan → aksi → tren → produk → risiko.
 * Angka bergantung data seed; struktur kerja dan responsivitas yang
 * dikunci.
 */
test("analisa menampilkan ringkasan, tren, dan risiko", async ({ page }) => {
  await page.goto("/app/analisa");
  await expect(page.getByRole("heading", { name: "Analisa bisnis" })).toBeVisible();
  await expect(page.locator("#kesehatan").getByText("Kesehatan bisnis")).toBeVisible();
  await expect(page.getByText("Tren omzet")).toBeVisible();
  await expect(page.getByText("Kinerja produk")).toBeVisible();
  await expect(page.getByText("Sebaran ABC-FSN")).toBeVisible();
  await expect(page.locator("#kinerja").getByText("Penggerak kinerja")).toBeVisible();
  await expect(page.getByText("Risiko stok & data")).toBeVisible();
  await expect(page.getByRole("link", { name: "30 hari" })).toBeVisible();
});

test("analisa tidak overflow di mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/analisa");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(page.getByText("Tren omzet")).toBeVisible();
});
