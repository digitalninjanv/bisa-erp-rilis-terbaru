import { expect, test } from "@playwright/test";

/**
 * Pola SAP Fiori tree/object page: COA ribuan akun tidak tampil semua
 * terbuka; pencarian membuka kelompok yang relevan. Odoo: dari daftar
 * rekening bank langsung masuk ke rekonsiliasi akun itu.
 */
test("bagan akun memakai kelompok lipat dan pencarian membuka hasil", async ({ page }) => {
  await page.goto("/app/akuntansi/akun");
  await expect(page.getByRole("heading", { name: "Bagan akun" })).toBeVisible();
  const asetGroup = page.getByRole("link", { name: /Buka Aset:/ });
  await expect(asetGroup).toBeVisible();
  await asetGroup.click();
  await expect(page).toHaveURL(/type=asset/);
  await expect(page.getByRole("link", { name: "Kas Kecil" })).toBeVisible();

  await page.goto("/app/akuntansi/akun?q=110101");
  const filteredAset = page.locator("details").filter({ hasText: "Aset" }).first();
  await expect(filteredAset).toHaveAttribute("open", "");
  await expect(page.getByRole("link", { name: "Kas Kecil" })).toBeVisible();
});

test("kas & bank menautkan rekening bank langsung ke rekonsiliasi", async ({ page }) => {
  await page.goto("/app/akuntansi/bank");
  await expect(page.getByRole("heading", { name: "Kas & bank" })).toBeVisible();
  const reconcile = page.getByRole("link", { name: "Rekonsiliasi" }).first();
  await expect(reconcile).toBeVisible();
  await expect(reconcile).toHaveAttribute("href", /\/app\/akuntansi\/rekonsiliasi\?accountId=/);
  await reconcile.click();
  await expect(page).toHaveURL(/rekonsiliasi\?accountId=/);
});
