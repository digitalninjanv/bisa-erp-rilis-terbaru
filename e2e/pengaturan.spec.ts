import { expect, test } from "@playwright/test";

// Sesi demo berasal dari storageState (lihat auth.setup.ts).
// A-24 T1 (SIS-11): cangkang Pengaturan punya nav sidebar.
// Validasi 2 (V-02): daftar seksi duplikat di dalam konten dibuang —
// tautan tab ("Modul", "Penomoran", "Cetak") kini HANYA ada di
// sidebar cangkang, jadi pemilih dibatasi ke <aside> itu; perilaku
// yang diuji tidak berubah (href tujuan sama persis).

test.describe("Pengaturan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/app/pengaturan");
    await expect(page.getByRole("heading", { name: "Pengaturan", exact: true })).toBeVisible();
  });

  test("tab Modul menampilkan saklar modul perusahaan", async ({ page }) => {
    await page.locator("aside.module-sidebar").getByRole("link", { name: "Modul", exact: true }).click();
    await expect(page).toHaveURL(/tab=modul/);
    await expect(page.getByRole("heading", { name: "Modul aktif" })).toBeVisible();
    await expect(page.getByText("Beranda dan Pengaturan selalu aktif.")).toBeVisible();
    await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Simpan/ })).toBeVisible();
  });

  test("tab Penomoran menampilkan tabel penomoran dokumen", async ({ page }) => {
    await page.locator("aside.module-sidebar").getByRole("link", { name: "Penomoran", exact: true }).click();
    await expect(page).toHaveURL(/tab=nomor/);
    await expect(page.getByRole("heading", { name: "Penomoran dokumen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan penomoran" })).toBeVisible();
  });

  test("tab Cetak menampilkan kontrol template cetak", async ({ page }) => {
    await page.locator("aside.module-sidebar").getByRole("link", { name: "Cetak", exact: true }).click();
    await expect(page).toHaveURL(/tab=cetak/);
    await expect(page.getByText(/Satu-satunya tempat mengatur cetak/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Simpan/ })).toBeVisible();
  });
});
