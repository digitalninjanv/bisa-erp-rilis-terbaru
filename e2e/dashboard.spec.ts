import { expect, test } from "@playwright/test";

/**
 * Dashboard utama: hierarki ringkasan → tindakan → tren → ruang kerja.
 * Angka boleh berubah; yang dikunci adalah struktur kerja dan
 * responsivitasnya, bukan nilai seed.
 */
test("dashboard menampilkan ringkasan, tindakan, dan ruang kerja", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /Selamat bekerja/ })).toBeVisible();
  await expect(page.getByText("Perlu tindakan")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ruang kerja" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Mulai kasir/ })).toBeVisible();
  await expect(page.getByText("Piutang terbuka", { exact: true })).toBeVisible();
  await expect(page.getByText("Utang terbuka", { exact: true })).toBeVisible();
  await expect(page.getByText("Tren penjualan")).toBeVisible();
});

test("dashboard tidak overflow di mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(page.getByText("Perlu tindakan")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ruang kerja" })).toBeVisible();
});
