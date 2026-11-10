import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A-28 UI-3 (POLA-03) — penjaga format tanggal satu. Input tanggal
 * native (`<input type="date">`) merender menurut lokal peramban
 * (mm/dd/yyyy di Chromium AS) tanpa memandang bahasa aplikasi,
 * sehingga satu halaman bisa menampilkan dua format tanggal sekaligus
 * (terbukti di audit UI/UX: filter Laporan AS vs Jurnal ID, form
 * transfer Kas & bank vs filter riwayatnya). Semua input tanggal
 * wajib memakai DateField bersama (`src/components/date-field.tsx`) —
 * nilai yang dipertukarkan tetap ISO, teks yang dilihat selalu
 * dd/mm/yyyy. Test ini menggagalkan suite bila input native kembali.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(full));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("pola tanggal: tidak ada input tanggal native di src/", () => {
  it("nol kemunculan type=\"date\" / type='date' di luar komponen DateField", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_DIR)) {
      const rel = path.relative(SRC_DIR, file).split(path.sep).join("/");
      // Komponen DateField sendiri merender input teks, bukan tanggal
      // native — tetap dikecualikan agar penjaga tidak berisik palsu.
      if (rel === "components/date-field.tsx") continue;
      const text = readFileSync(file, "utf8");
      if (/type\s*=\s*["']date["']/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
