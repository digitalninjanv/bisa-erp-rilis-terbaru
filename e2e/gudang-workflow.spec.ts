import { expect, test } from "@playwright/test";

/**
 * Pola SAP Fiori list report: filter status tampil sebagai chip kerja
 * dengan antrean aksi yang jelas, bukan dropdown tersembunyi.
 */
test("transfer & penyesuaian menampilkan filter status kerja", async ({ page }) => {
  await page.goto("/app/gudang/transfer");
  await expect(page.getByRole("heading", { name: "Transfer stok" })).toBeVisible();
  const transferChips = page.locator('a[href*="/app/gudang/transfer?status="]');
  await expect(transferChips.filter({ hasText: "Dalam perjalanan" })).toBeVisible();
  await expect(transferChips.filter({ hasText: "Selesai" })).toBeVisible();

  await transferChips.filter({ hasText: "Dalam perjalanan" }).click();
  await expect(page).toHaveURL(/status=in_transit/);
  await expect(page.getByText(/Antrean penerimaan gudang tujuan/)).toBeVisible();

  await page.goto("/app/gudang/penyesuaian");
  await expect(page.getByRole("heading", { name: /Penyesuaian/ })).toBeVisible();
  const adjustmentChips = page.locator('a[href*="/app/gudang/penyesuaian?status="]');
  await expect(adjustmentChips.filter({ hasText: "Menunggu persetujuan" })).toBeVisible();
  await expect(adjustmentChips.filter({ hasText: "Ditolak" })).toBeVisible();

  await adjustmentChips.filter({ hasText: "Menunggu persetujuan" }).click();
  await expect(page).toHaveURL(/status=pending/);
  await expect(page.getByText(/Menunggu pemeriksa kedua/)).toBeVisible();

  // Mobile: chip bar tidak boleh membuat dokumen melebar horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/gudang/penyesuaian");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("aset tetap memiliki filter status dan pencarian", async ({ page }) => {
  await page.goto("/app/akuntansi/aset");
  await expect(page.getByRole("heading", { name: /Aset Tetap/ })).toBeVisible();
  const chips = page.locator('a[href*="/app/akuntansi/aset?status="]');
  await expect(chips.filter({ hasText: "Aktif" })).toBeVisible();
  await expect(chips.filter({ hasText: "Dilepas" })).toBeVisible();
  await chips.filter({ hasText: "Aktif" }).click();
  await expect(page).toHaveURL(/status=active/);
  await expect(page.getByPlaceholder(/Cari nomor, nama, atau kategori aset/)).toBeVisible();
});

test("riwayat opname memiliki filter status dokumen", async ({ page }) => {
  await page.goto("/app/gudang/opname?tab=riwayat");
  const chips = page.locator('a[href*="/app/gudang/opname?"][href*="status="]');
  await expect(chips.filter({ hasText: "Menunggu" })).toBeVisible();
  await chips.filter({ hasText: "Terposting" }).click();
  await expect(page).toHaveURL(/status=posted/);
  await expect(page).toHaveURL(/tab=riwayat/);
});
