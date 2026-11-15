import { expect, test } from "@playwright/test";

/**
 * Tahap 8 — memastikan master baru benar-benar dapat dijangkau dari UI
 * impor dan template CSV-nya tersedia, bukan hanya ada di lapisan server.
 */
const TABS = [
  ["Cabang", "branches"],
  ["Gudang", "warehouses"],
  ["Metode Pembayaran", "payment_methods"],
  ["Kelompok Harga", "customer_groups"],
  ["Karyawan", "employees"],
  ["Aset Tetap", "fixed_assets"],
] as const;

test("tab impor master baru tampil dan template CSV dapat diunduh", async ({ page }) => {
  await page.goto("/app/gudang/impor");
  await expect(page.getByRole("heading", { name: "Impor data" })).toBeVisible();

  for (const [label, entity] of TABS) {
    const tab = page.locator(`a[href="/app/gudang/impor?jenis=${entity}"]`);
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText(label);
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`jenis=${entity}`));

    const response = await page.request.get(`/api/import/template/${entity}?format=csv`);
    expect(response.status(), `${entity} template`).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(await response.text()).toContain("Nama");

    await page.goto("/app/gudang/impor");
  }
});
