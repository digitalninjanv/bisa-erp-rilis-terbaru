import { describe, expect, it } from "vitest";
import { periodStatusForDate, type PeriodStatusRow } from "@/lib/period-status";

// FIX-P1 Tahap 5 (AK5-03): formulir jurnal menilai status periode dari
// tanggal yang dipilih mengikuti semantik domain Tahap 3 (AK1-01):
// baris periode menentukan; tanpa baris, hanya tahun berjalan & tahun
// berikutnya yang terbuka (materialisasi otomatis) — tahun lain tertutup.
const PERIODS: PeriodStatusRow[] = [
  { year: 2026, month: 10, status: "open" },
  { year: 2026, month: 9, status: "closed" },
  { year: 2026, month: 8, status: "locked" },
];

describe("periodStatusForDate", () => {
  it("mengikuti status baris periode yang ada", () => {
    expect(periodStatusForDate(PERIODS, "2026-10-15", 2026)).toBe("open");
    expect(periodStatusForDate(PERIODS, "2026-09-15", 2026)).toBe("closed");
    expect(periodStatusForDate(PERIODS, "2026-08-15", 2026)).toBe("locked");
  });

  it("bulan tanpa baris di tahun berjalan → open (materialisasi otomatis)", () => {
    expect(periodStatusForDate(PERIODS, "2026-11-15", 2026)).toBe("open");
    expect(periodStatusForDate(PERIODS, "2027-03-15", 2026)).toBe("open");
  });

  it("tahun di luar jendela otomatis tanpa baris → missing (dianggap tertutup)", () => {
    expect(periodStatusForDate(PERIODS, "2024-05-15", 2026)).toBe("missing");
    expect(periodStatusForDate(PERIODS, "2028-05-15", 2026)).toBe("missing");
  });

  it("tanggal tidak valid → null", () => {
    expect(periodStatusForDate(PERIODS, "", 2026)).toBeNull();
    expect(periodStatusForDate(PERIODS, "15-10-2026", 2026)).toBeNull();
  });
});
