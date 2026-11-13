import { expect, test } from "@playwright/test";

for (const tab of ["laba-rugi", "neraca"]) {
  test(`${tab}: kolom pembanding sejajar dengan subtotal di layar`, async ({ page }) => {
    await page.goto(`/app/akuntansi/laporan?tab=${tab}&compare=prev`);
    await expect(page.locator('.financial-report-columns')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Jenis laporan keuangan' }).locator('[aria-current="page"]')).toHaveCount(1);
    await expect(async () => {
      const detail = await page.locator('[data-statement-group] tbody tr td.num').first().boundingBox();
      const total = await page.locator('[data-statement-total] > span:nth-child(2)').first().boundingBox();
      expect(detail).not.toBeNull(); expect(total).not.toBeNull();
      expect(Math.abs(detail!.x + detail!.width - total!.x - total!.width)).toBeLessThan(2);
    }).toPass();
  });
  test(`${tab}: dokumen cetak memakai kolom nominal yang sama`, async ({ page }) => {
    await page.goto(`/app/akuntansi/laporan/cetak?tab=${tab}&compare=prev`);
    await expect(page.locator('.print-doc h1')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(async () => {
      const detail = await page.locator('.report-keep td.num').first().boundingBox();
      const total = await page.locator('[data-print-total] > span:nth-child(2)').first().boundingBox();
      expect(detail).not.toBeNull(); expect(total).not.toBeNull();
      expect(Math.abs(detail!.x + detail!.width - total!.x - total!.width)).toBeLessThan(2);
    }).toPass();
    await expect(page.getByText('Periode sebelumnya', { exact: false }).first()).toBeVisible();
  });
}
test('laporan komparatif mobile dapat digeser tanpa overflow dokumen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/akuntansi/laporan?compare=prev');
  await expect(page.locator('.financial-report-columns')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.financial-report-document').evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
});
