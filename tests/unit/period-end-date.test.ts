import { describe, expect, it } from "vitest";
import { periodEndDate } from "@/lib/format";

/**
 * SIM-2 S7 REM-04 (sumber: H-1 di S2): tanggal jurnal payroll dulunya
 * kaku `‹periode›-28` — salah untuk bulan 30/31 hari dan tidak pernah
 * merupakan akhir bulan yang sebenarnya. Helper ini mengunci tanggal
 * kalender terakhir periode, termasuk Februari kabisat.
 */
describe("periodEndDate", () => {
  it("returns the 31st for long months", () => {
    expect(periodEndDate("2026-01")).toBe("2026-01-31");
    expect(periodEndDate("2026-12")).toBe("2026-12-31");
  });

  it("returns the 30th for short months", () => {
    expect(periodEndDate("2026-04")).toBe("2026-04-30");
    expect(periodEndDate("2026-11")).toBe("2026-11-30");
  });

  it("handles February in leap and non-leap years", () => {
    expect(periodEndDate("2024-02")).toBe("2024-02-29");
    expect(periodEndDate("2025-02")).toBe("2025-02-28");
  });
});
