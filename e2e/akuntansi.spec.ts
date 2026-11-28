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
    await expect(page.getByText(/Tidak ada mutasi pada periode ini/)).toBeVisible();
    // Menampilkan akun bersaldo nol mengembalikan struktur kelompok
    // penuh dengan baris angkanya (kontrak V-06 yang sama).
    await page.getByRole("link", { name: "Tampilkan akun nol" }).click();
    await expect(page.getByText("Pendapatan", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Laba kotor", { exact: true })).toBeVisible();
    await expect(page.getByText("Laba bersih", { exact: true })).toBeVisible();
    // Setidaknya ada angka rupiah yang dirender pada tabel laporan.
    await expect(page.getByText(/Rp\s?-?[\d.]+/).first()).toBeVisible();
  });

  test("jurnal umum memuat daftar entri", async ({ page }) => {
    // Halaman jurnal bawaan hanya menampilkan bulan berjalan; jurnal seed
    // tersebar di tahun fiskal demo — buka rentang lebar secara eksplisit.
    await page.goto("/app/akuntansi/jurnal/riwayat?from=2020-01-01&to=2030-12-31");
    await expect(page.getByRole("heading", { name: "Riwayat jurnal" })).toBeVisible();
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
    await page.goto("/app/akuntansi/jurnal/riwayat?from=2020-01-01&to=2030-12-31");
    await expect(page.getByRole("heading", { name: "Riwayat jurnal" })).toBeVisible();
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

  test("duplikat jurnal membuka form baru dengan baris dan memo tersalin", async ({ page }) => {
    await page.goto("/app/akuntansi/jurnal/riwayat?from=2020-01-01&to=2030-12-31");
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toBeVisible();
    await firstRow.locator("a").first().click();
    await expect(page.getByRole("link", { name: "Duplikat" })).toBeVisible();
    await expect(page.getByText("Lampiran bukti")).toBeVisible();
    await page.getByRole("link", { name: "Duplikat" }).click();

    await expect(page).toHaveURL(/\/app\/akuntansi\/jurnal\/baru\?from=/);
    await expect(page.getByText(/Menyalin baris dari jurnal/)).toBeVisible();
    const memo = page.locator("table").getByLabel("Memo baris 1");
    await expect(memo).toBeVisible();
    await expect(memo).toHaveValue(/.+/);
  });

  test("lampiran bukti jurnal dapat diunggah dan dihapus", async ({ page }) => {
    await page.goto("/app/akuntansi/jurnal/riwayat?from=2020-01-01&to=2030-12-31");
    await page.locator("tbody tr").first().locator("a").first().click();
    await expect(page.getByText("Lampiran bukti")).toBeVisible();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: "bukti-uji.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Unggah", exact: true }).click();
    await expect(page.getByText("bukti-uji.png")).toBeVisible();

    await page.getByRole("button", { name: "Hapus", exact: true }).first().click();
    await page.getByRole("button", { name: "Hapus lampiran" }).click();
    await expect(page.getByText("bukti-uji.png")).toHaveCount(0);
  });

  test("halaman rekonsiliasi bank tampil", async ({ page }) => {
    await page.goto("/app/akuntansi/rekonsiliasi");
    await expect(page.getByRole("heading", { name: "Rekonsiliasi bank" })).toBeVisible();
    await page.getByRole("button", { name: "Impor mutasi" }).click();
    await expect(page.getByRole("heading", { name: "Impor mutasi bank (CSV)" })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Saldo akhir rekening koran", exact: true }),
    ).toBeVisible();
  });
});
