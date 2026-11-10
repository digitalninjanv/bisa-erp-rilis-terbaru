import { expect, test } from "@playwright/test";

// Sesi demo berasal dari storageState (lihat auth.setup.ts).

test.describe("Akuntansi", () => {

  test("laporan laba rugi tampil dengan baris angka", async ({ page }) => {
    await page.goto("/app/akuntansi/laporan");
    await expect(page.getByRole("heading", { name: "Laporan keuangan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Laba rugi" })).toBeVisible();
    // Validasi 2 (V-06): periode berjalan data demo memang tanpa
    // mutasi laba rugi dan akun nol bawaan tersembunyi — yang tampil
    // adalah SATU keadaan kosong ringkas, bukan lima kelompok kosong.
    await expect(page.getByText("Tidak ada mutasi pada periode ini.")).toBeVisible();
    // Menampilkan akun bersaldo nol mengembalikan struktur kelompok
    // penuh dengan baris angkanya (kontrak V-06 yang sama).
    await page.getByRole("link", { name: "Tampilkan akun bersaldo nol" }).click();
    await expect(page.getByText("Pendapatan", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Laba kotor", { exact: true })).toBeVisible();
    await expect(page.getByText("Laba bersih", { exact: true })).toBeVisible();
    // Setidaknya ada angka rupiah yang dirender pada tabel laporan.
    await expect(page.getByText(/Rp\s?-?[\d.]+/).first()).toBeVisible();
  });

  test("jurnal umum memuat daftar entri", async ({ page }) => {
    // Halaman jurnal bawaan hanya menampilkan bulan berjalan; jurnal seed
    // tersebar di tahun fiskal demo — buka rentang lebar secara eksplisit.
    await page.goto("/app/akuntansi/jurnal?from=2020-01-01&to=2030-12-31");
    await expect(page.getByRole("heading", { name: "Jurnal umum" })).toBeVisible();
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.locator("tbody").getByText(/JE-\d{4}-/).first()).toBeVisible();
    // Ringkasan periode menyatakan jurnal seimbang.
    await expect(page.getByText("Seimbang", { exact: true })).toBeVisible();
  });

  test("pencarian jurnal dari UI menampilkan hasil tanpa error", async ({ page }) => {
    // A-22 K1 (UX-01): form filter jurnal dulu meneruskan from/to/source
    // sebagai hidden SEKALIGUS input anak bernama sama — parameter terkirim
    // dua kali, searchParams menjadi array, dan halaman melempar error.
    // Test ini mengirim pencarian lewat UI sungguhan dan menegaskan URL
    // hasil kirim memuat tiap parameter tepat satu kali.
    await page.goto("/app/akuntansi/jurnal?from=2020-01-01&to=2030-12-31");
    await expect(page.getByRole("heading", { name: "Jurnal umum" })).toBeVisible();
    const nomor = (await page.locator("tbody tr td:first-child").first().innerText()).trim();
    expect(nomor).toMatch(/^[A-Z]+-\d{4}-/);
    await page.getByLabel("Kata kunci pencarian").fill(nomor);
    await page.getByRole("button", { name: "Cari", exact: true }).click();
    await expect(page.locator("tbody").getByText(nomor).first()).toBeVisible();
    const url = new URL(page.url());
    expect(url.searchParams.getAll("from")).toHaveLength(1);
    expect(url.searchParams.getAll("to")).toHaveLength(1);
    expect(url.searchParams.getAll("q")).toHaveLength(1);
    // Tidak ada error boundary, dan nilai filter tetap tampil.
    await expect(page.getByText("Terjadi kesalahan")).toHaveCount(0);
    await expect(page.getByLabel("Kata kunci pencarian")).toHaveValue(nomor);
    // A-25 U2: filter tanggal kini DateField bersama — tampilan selalu
    // dd/mm/yyyy, nilai yang terkirim tetap ISO (dibuktikan assertion
    // URL from/to tepat satu kali di atas).
    await expect(page.getByLabel("Dari", { exact: true })).toHaveValue("01/01/2020");
    await expect(page.getByLabel("Sampai", { exact: true })).toHaveValue("31/12/2030");
  });

  test("halaman rekonsiliasi bank tampil", async ({ page }) => {
    await page.goto("/app/akuntansi/rekonsiliasi");
    await expect(page.getByRole("heading", { name: "Rekonsiliasi bank" })).toBeVisible();
  });
});
