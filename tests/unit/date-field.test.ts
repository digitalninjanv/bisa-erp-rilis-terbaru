import { describe, expect, it } from "vitest";
import {
  groupDateDigits,
  isCompleteDateText,
  isoToDisplay,
  parseDateText,
} from "@/lib/date-field";

// A-25 U2: DateField bersama — tampilan selalu dd/mm/yyyy (id-ID),
// nilai yang dipertukarkan selalu ISO. Parser menerima bentuk yang
// wajar diketik/ditempel pengguna Indonesia dan menolak tanggal
// kalender yang tidak ada.
describe("date-field: isoToDisplay", () => {
  it("memformat ISO menjadi dd/mm/yyyy", () => {
    expect(isoToDisplay("2026-11-06")).toBe("06/11/2026");
    expect(isoToDisplay("2026-01-31")).toBe("31/01/2026");
  });
  it("input kosong/tak dikenal menjadi string kosong", () => {
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay(null)).toBe("");
    expect(isoToDisplay(undefined)).toBe("");
    expect(isoToDisplay("bukan-tanggal")).toBe("");
  });
});

describe("date-field: parseDateText", () => {
  it("menerima dd/mm/yyyy (juga satu digit)", () => {
    expect(parseDateText("06/11/2026")).toEqual({ ok: true, value: "2026-11-06" });
    expect(parseDateText("6/1/2026")).toEqual({ ok: true, value: "2026-01-06" });
  });
  it("menerima pemisah - dan .", () => {
    expect(parseDateText("06-11-2026")).toEqual({ ok: true, value: "2026-11-06" });
    expect(parseDateText("06.11.2026")).toEqual({ ok: true, value: "2026-11-06" });
  });
  it("menerima ISO yyyy-mm-dd hasil tempel", () => {
    expect(parseDateText("2026-11-06")).toEqual({ ok: true, value: "2026-11-06" });
  });
  it("menerima nama bulan Indonesia singkat & penuh", () => {
    expect(parseDateText("6 Nov 2026")).toEqual({ ok: true, value: "2026-11-06" });
    expect(parseDateText("6 November 2026")).toEqual({ ok: true, value: "2026-11-06" });
    expect(parseDateText("17 agu 2026")).toEqual({ ok: true, value: "2026-08-17" });
    expect(parseDateText("1 MEI 2026")).toEqual({ ok: true, value: "2026-05-01" });
  });
  it("teks kosong adalah nilai kosong yang sah", () => {
    expect(parseDateText("")).toEqual({ ok: true, value: "" });
    expect(parseDateText("   ")).toEqual({ ok: true, value: "" });
  });
  it("menolak tanggal kalender yang tidak ada", () => {
    expect(parseDateText("31/02/2026").ok).toBe(false);
    expect(parseDateText("29/02/2026").ok).toBe(false); // 2026 bukan kabisat
    expect(parseDateText("29/02/2028")).toEqual({ ok: true, value: "2028-02-29" });
    expect(parseDateText("00/11/2026").ok).toBe(false);
    expect(parseDateText("06/13/2026").ok).toBe(false);
  });
  it("menolak format Amerika mm/dd/yyyy yang ambigu sebagai tanggal lain", () => {
    // 11/06 dibaca 11 Juni (dd/mm) — bukan 6 November.
    expect(parseDateText("11/06/2026")).toEqual({ ok: true, value: "2026-06-11" });
  });
  it("menolak sampah dengan pesan Indonesia", () => {
    const result = parseDateText("besok pagi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("dd/mm/yyyy");
  });
});

describe("date-field: groupDateDigits", () => {
  it("mengelompokkan digit secara progresif", () => {
    expect(groupDateDigits("0")).toBe("0");
    expect(groupDateDigits("06")).toBe("06");
    expect(groupDateDigits("061")).toBe("06/1");
    expect(groupDateDigits("0611")).toBe("06/11");
    expect(groupDateDigits("06112026")).toBe("06/11/2026");
    expect(groupDateDigits("06/11/2026")).toBe("06/11/2026");
  });
  it("membiarkan teks bernama bulan apa adanya", () => {
    expect(groupDateDigits("6 Nov 2026")).toBe("6 Nov 2026");
  });
  it("isCompleteDateText hanya benar untuk tanggal lengkap terbaca", () => {
    expect(isCompleteDateText("06/11/2026")).toBe(true);
    expect(isCompleteDateText("06/11")).toBe(false);
    expect(isCompleteDateText("")).toBe(false);
  });
});
