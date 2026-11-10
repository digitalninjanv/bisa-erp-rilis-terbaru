import { expect, test, type Page } from "@playwright/test";

/**
 * Validasi UI/UX Putaran 3 — PENJAGA TABEL & FORM (T-01, T-02, F-01).
 *
 * Penempatan: pengukuran computed style hanya bermakna pada DOM yang
 * ter-render, dan satu-satunya harness DOM ter-render di repo ini
 * adalah Playwright e2e (test arsitektur di tests/unit menjaga pola
 * sumber secara statis — pola date-input-pattern dsb. — tetapi cacat
 * T-01 adalah hasil kaskade CSS, yang hanya terlihat sesudah render).
 * Spec ini mengukur halaman sampel per modul dan menggagalkan gate
 * bila ketidakrapian audit kembali:
 *
 * - T-01: header kolom numerik wajib sejajar isi selnya
 *   (computed text-align header == sel pada kolom berangka).
 * - T-02: tinggi baris sampel tabel ≤ 80px (baris sehat terukur
 *   40–57px; sel bertumpuk dua tingkat yang disengaja — nomor nota
 *   + sub-teks, tanggal + tempo — sampai ±75px; keadaan runtuh
 *   pra-perbaikan 89–91px).
 * - F-01: satu form sampel hanya boleh memiliki SATU tinggi field
 *   (36px) di antara input/select yang terlihat di <main> —
 *   campuran 32/36px adalah temuan P1 audit.
 *
 * Fungsi ukur diadaptasi dari skrip audit
 * ~/workspace/bukti-a28/validasi3/measure.mjs, dipersempit ke <main>
 * agar kontrol cangkang (pencarian global dsb.) tidak ikut terukur.
 */
function measureInMain() {
  const root = document.querySelector("main") ?? document.body;
  const NUMERIC_RE = /^[-+]?\(?\s*(Rp\s*)?[\d][\d.,\s%]*\)?$/;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el as HTMLElement);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  };
  const round1 = (v: number) => Math.round(v * 10) / 10;

  const misaligned: string[] = [];
  const rowHeights: number[] = [];
  root.querySelectorAll("table").forEach((table, ti) => {
    if (!visible(table)) return;
    const headCells = table.querySelectorAll("thead th");
    if (headCells.length === 0) return;
    // Baris sampel: baris data MURNI pertama (tanpa sel colspan>1).
    // Baris label/grup — mis. "Saldo awal periode" di buku besar yang
    // sel saldonya jatuh di posisi kolom Nomor — bukan baris data dan
    // akan menghasilkan positif palsu bila dipetakan per indeks.
    let sampleRow: Element | null = null;
    for (const tr of table.querySelectorAll("tbody tr")) {
      if (!visible(tr)) continue;
      const tds = tr.querySelectorAll("td");
      if (tds.length === 0) continue;
      const hasSpan = [...tds].some((td) => (td.getAttribute("colspan") ?? "1") !== "1");
      if (!hasSpan) {
        sampleRow = tr;
        break;
      }
      if (!sampleRow) sampleRow = tr;
    }
    if (!sampleRow) return;
    rowHeights.push(round1(sampleRow.getBoundingClientRect().height));
    const sampleCells = sampleRow.querySelectorAll("td");
    headCells.forEach((th, ci) => {
      const td = sampleCells[ci];
      if (!td) return;
      const txt = (td.textContent || "").trim();
      if (!NUMERIC_RE.test(txt) || !/\d/.test(txt)) return;
      const headAlign = getComputedStyle(th).textAlign;
      const cellAlign = getComputedStyle(td).textAlign;
      if (headAlign !== cellAlign) {
        misaligned.push(
          `tabel#${ti} kolom "${(th.textContent || "").trim().slice(0, 28)}": header ${headAlign} vs sel ${cellAlign} (contoh "${txt.slice(0, 20)}")`,
        );
      }
    });
  });

  const fieldHeights = new Set<number>();
  root.querySelectorAll("input, select").forEach((el) => {
    if (!visible(el)) return;
    const type = el.getAttribute("type") || el.tagName.toLowerCase();
    if (["hidden", "checkbox", "radio", "file", "submit", "button"].includes(type)) return;
    fieldHeights.add(round1(el.getBoundingClientRect().height));
  });

  return { misaligned, rowHeights, fieldHeights: [...fieldHeights].sort((a, b) => a - b) };
}

async function measure(page: Page, path: string) {
  await page.goto(path);
  await page.waitForTimeout(700);
  return page.evaluate(measureInMain);
}

test.describe("Penjaga tabel & form (Validasi 3)", () => {
  test("T-01: header kolom numerik sejajar isi selnya", async ({ page }) => {
    for (const path of [
      "/app/gudang/pergerakan",
      "/app/gudang/produk",
      "/app/akuntansi/buku-besar",
      "/app/pos/sesi/riwayat",
    ]) {
      const result = await measure(page, path);
      expect(result.misaligned, `${path}: ${result.misaligned.join(" | ")}`).toEqual([]);
    }
  });

  test("T-02: tinggi baris tabel dalam rentang sehat (≤80px)", async ({ page }) => {
    for (const path of [
      "/app/pos/sesi",
      "/app/pos/sesi/riwayat",
      "/app/akuntansi/piutang-utang",
      "/app/gudang/pergerakan",
    ]) {
      const result = await measure(page, path);
      const tooTall = result.rowHeights.filter((h) => h > 80);
      expect(tooTall, `${path}: tinggi baris ${result.rowHeights.join(", ")}`).toEqual([]);
    }
  });

  test("F-01: satu tinggi field (36px) per form sampel", async ({ page }) => {
    for (const path of [
      "/app/pos/sesi",
      "/app/akuntansi/jurnal/baru",
      "/app/pengaturan/payroll-indonesia",
    ]) {
      const result = await measure(page, path);
      expect(result.fieldHeights, `${path}: tinggi field terukur ${result.fieldHeights.join(", ")}`).toEqual([36]);
    }
  });
});
