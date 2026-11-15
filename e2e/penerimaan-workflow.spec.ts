import { expect, test } from "@playwright/test";

/**
 * Workflow penerimaan mengikuti pola SAP Fiori Post Goods Receipt:
 * dokumen/tujuan → pemasok/PO/faktur → barang. Tautan PO harus terlihat
 * tanpa membuka panel "advanced".
 */
test("penerimaan menampilkan langkah kerja dan tautan PO di permukaan", async ({ page }) => {
  await page.goto("/app/gudang/penerimaan");
  await expect(page.getByRole("heading", { name: "Penerimaan barang" })).toBeVisible();
  await expect(page.getByText("1 · Dokumen & tujuan")).toBeVisible();
  await expect(page.getByText("2 · Pemasok & faktur")).toBeVisible();
  await expect(page.getByText("3 · Barang diterima")).toBeVisible();
  await expect(page.getByLabel("Sumber penerimaan")).toBeVisible();
  await expect(page.getByLabel("Tautkan pesanan pembelian")).toBeVisible();
  await expect(page.getByRole("button", { name: "Posting penerimaan" })).toBeVisible();
});
