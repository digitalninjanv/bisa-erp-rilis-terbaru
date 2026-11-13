import { expect, test, type Page } from "@playwright/test";

/**
 * Program Perbaikan Gabungan — PENJAGA KERAPIAN UI (G5, penutup).
 *
 * Melengkapi penjaga tabel & form Putaran 3 (table-form-guard.spec.ts)
 * dengan tiga kerapian yang ditutup program gabungan G1–G4 dan terbukti
 * lewat pengukuran DOM Putaran 4 + pengukuran ulang G5
 * (~/workspace/bukti-validasi4 & ~/workspace/bukti-gabungan):
 *
 * - (a) LANTAI FONT 11px (UX4-02, ARAH-DESAIN-A25 §2.2): nol elemen
 *   berteks langsung berukuran < 11px pada sampel halaman kunci.
 *   Definisi elemen berteks & keterlihatan meniru fungsi ukur audit.
 *   Sampel = halaman yang terukur NOL pada penutupan G5. Sisa lokal
 *   bernama yang TIDAK masuk sampel (keputusan tercatat di
 *   docs/form-crud/STATUS-TUTUP-GABUNGAN.md): subteks SKU/barcode per
 *   baris di Produk/Nilai/Pergerakan, pil status lokal Produk,
 *   petunjuk field Pengaturan, sitasi regulasi Payroll Indonesia,
 *   angka langkah wizard Impor/Opname, dan permukaan cetak (skala
 *   cetak). Penjaga ini mencegah permukaan yang sudah tertutup mundur.
 * - (b) PRIMER TUNGGAL (UX4-03, §4.2): ≤ 1 tombol AKSI berlatar
 *   --primary per halaman pada sampel bekas pelanggar + kontrol.
 *   Dihitung di dalam <main> saja — logo merek sidebar berlatar
 *   setara-primer adalah token cangkang konstan, bukan aksi halaman
 *   (pengukuran Putaran 4/G5 juga tidak menghitungnya).
 * - (c) OVERFLOW SEMPIT (UX4-04): nol overflow horizontal dokumen pada
 *   390px untuk sampel halaman bertabel lebar.
 *
 * Larangan window.prompt/confirm (FRM-02) dijaga di lapisan sumber
 * oleh tests/unit/architecture-dialog-patterns.test.ts — dirujuk di
 * sini, tidak diduplikasi.
 */
function measureNeatness() {
  const root = document.querySelector("main") ?? document.body;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el as HTMLElement);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  };
  const probe = document.createElement("div");
  probe.style.backgroundColor = "var(--primary)";
  document.body.appendChild(probe);
  const primaryRgb = getComputedStyle(probe).backgroundColor;
  probe.remove();

  const belowFloor: string[] = [];
  const primaryLabels: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el as HTMLElement);
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0,
    );
    if (hasText) {
      const fs = parseFloat(cs.fontSize);
      if (fs < 11 && belowFloor.length < 12) {
        belowFloor.push(
          `${cs.fontSize} "${(el.textContent || "").trim().slice(0, 32)}" <${el.tagName.toLowerCase()}>`,
        );
      }
    }
    if (
      el.tagName === "BUTTON" ||
      (el.tagName === "A" && el.getAttribute("role") === "button")
    ) {
      if (primaryRgb !== "rgba(0, 0, 0, 0)" && cs.backgroundColor === primaryRgb) {
        primaryLabels.push((el.textContent || "").trim().slice(0, 30) || "(tanpa teks)");
      }
    }
  });
  return { belowFloor, primaryCount: primaryLabels.length, primaryLabels };
}

function measureOverflow() {
  const de = document.documentElement;
  return {
    scrollW: de.scrollWidth,
    innerW: window.innerWidth,
    overflowX: de.scrollWidth > window.innerWidth + 1,
  };
}

async function measure(page: Page, path: string) {
  await page.goto(path);
  await page.waitForTimeout(700);
  let result: ReturnType<typeof measureNeatness> | undefined;
  await expect(async () => {
    await expect(page.locator("main h1").first()).toBeVisible();
    result = await page.evaluate(measureNeatness);
  }).toPass({ timeout: 15000 });
  return result!;
}

test.describe("Penjaga kerapian UI (Gabungan G5)", () => {
  test("(a) lantai font 11px: nol elemen teks < 11px di halaman kunci", async ({ page }) => {
    for (const path of [
      "/app/akuntansi/jurnal",
      "/app/gudang/pemasok",
      "/app/akuntansi/hr",
      "/app/akuntansi/payroll",
      "/app/akuntansi/jurnal/baru",
      "/app/akuntansi/buku-besar",
    ]) {
      const result = await measure(page, path);
      expect(result.belowFloor, `${path}: ${result.belowFloor.join(" | ")}`).toEqual([]);
    }
  });

  test("(b) primer tunggal: ≤ 1 tombol aksi primer per halaman", async ({ page }) => {
    for (const path of [
      "/app/akuntansi/hr",
      "/app/pengaturan/pengguna",
      "/app/akuntansi/hr/lembur",
      "/app/akuntansi/hr/cuti",
      "/app/akuntansi/aset",
      "/app/akuntansi/payroll",
      "/app/gudang/pemasok",
      "/app/gudang/pembelian",
    ]) {
      const result = await measure(page, path);
      expect(
        result.primaryCount,
        `${path}: ${result.primaryCount} primer (${result.primaryLabels.join(", ")})`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test.describe("lebar sempit", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("(c) nol overflow horizontal dokumen pada 390px (tabel lebar)", async ({ page }) => {
      for (const path of [
        "/app/akuntansi/jurnal",
        "/app/akuntansi/piutang-utang",
        "/app/akuntansi/buku-besar",
        "/app/gudang/nilai",
        "/app/pengaturan/payroll-indonesia",
      ]) {
        await page.goto(path);
        await page.waitForTimeout(700);
        const result = await page.evaluate(measureOverflow);
        expect(result.overflowX, `${path}: scrollW ${result.scrollW} vs viewport ${result.innerW}`).toBe(false);
      }
    });
  });
});
