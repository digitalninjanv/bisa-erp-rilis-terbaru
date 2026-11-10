import { describe, expect, it } from "vitest";
import { paperSpec, type PrintPaper } from "@/components/print/types";

/**
 * Regresi cetak POS: lebar dokumen yang dipakai PrintShell harus sama
 * dengan area cetak efektif (lebar kertas − 2×margin `@page`). Kalau
 * tidak, nota 58mm di preview menjadi 54mm di kertas dan baris teks
 * membungkus berbeda — persis keluhan "cetakan beda dengan preview".
 */
const PAPER_WIDTH_MM: Record<PrintPaper, number> = {
  thermal58: 58,
  thermal80: 80,
  a4: 210,
  a5: 148,
};

describe("paperSpec — lebar konten sama dengan area cetak", () => {
  for (const paper of Object.keys(PAPER_WIDTH_MM) as PrintPaper[]) {
    it(`${paper}: widthMm + 2×pageMargin = lebar kertas`, () => {
      const spec = paperSpec(paper);
      const marginMm = Number.parseFloat(spec.pageMargin);
      expect(Number.isFinite(marginMm)).toBe(true);
      expect(spec.widthMm + marginMm * 2).toBe(PAPER_WIDTH_MM[paper]);
      expect(spec.widthMm).toBeGreaterThan(0);
    });
  }
});
