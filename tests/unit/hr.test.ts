import { describe, expect, it } from "vitest";
import {
  countWorkdays,
  enumerateDates,
  fullMonthsBetween,
  isWorkday,
  lateMinutes,
  periodRange,
  weekdayOf,
} from "@/lib/hr";

const MON_FRI = [1, 2, 3, 4, 5];

describe("lib/hr — kalender kerja", () => {
  it("weekday mengikuti UTC (2026-11-02 = Senin)", () => {
    expect(weekdayOf("2026-11-02")).toBe(1);
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(isWorkday("2026-11-02", MON_FRI)).toBe(true);
    expect(isWorkday("2026-11-01", MON_FRI)).toBe(false);
  });

  it("countWorkdays menghitung hanya hari kerja pada rentang inklusif", () => {
    // Jumat 2026-10-30 s.d. Selasa 2026-11-03: Jum, Sen, Sel = 3 hari kerja.
    expect(countWorkdays("2026-10-30", "2026-11-03", MON_FRI)).toBe(3);
    expect(countWorkdays("2026-11-01", "2026-11-01", MON_FRI)).toBe(0);
    expect(enumerateDates("2026-11-01", "2026-11-03")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  it("lateMinutes tidak pernah negatif", () => {
    expect(lateMinutes("08:00", "08:20")).toBe(20);
    expect(lateMinutes("08:00:00", "07:55:00")).toBe(0);
    expect(lateMinutes("08:00", "08:00")).toBe(0);
  });

  it("fullMonthsBetween menghitung bulan penuh masa kerja", () => {
    expect(fullMonthsBetween("2026-01-15", "2026-07-14")).toBe(5);
    expect(fullMonthsBetween("2026-01-15", "2026-07-15")).toBe(6);
    expect(fullMonthsBetween("2026-01-15", "2027-01-15")).toBe(12);
    expect(fullMonthsBetween("2026-07-01", "2026-07-01")).toBe(0);
  });

  it("periodRange memberi awal & akhir bulan yang benar", () => {
    expect(periodRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodRange("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});
