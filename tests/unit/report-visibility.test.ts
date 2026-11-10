import { describe, expect, it } from "vitest";
import {
  isEmptyStatementLine,
  visibleEquityRows,
  visibleStatementLines,
  visibleTrialRows,
} from "@/lib/report-visibility";

// A-28 UI-3 (AKT-09): definisi "akun hampa" bersama layar/cetak/ekspor.
// Hampa = nol pada periode berjalan DAN nol pada periode pembanding —
// akun yang hanya bergerak di satu periode tidak boleh hilang, karena
// kolom pembanding akan berbohong bila barisnya disembunyikan.

describe("report-visibility: baris laporan berkala", () => {
  const lines = [
    { accountId: "a", amount: 0 },
    { accountId: "b", amount: 0 },
    { accountId: "c", amount: 5000 },
    { accountId: "d", amount: 0 },
  ];
  const prior = [
    { accountId: "a", amount: 0 },
    { accountId: "b", amount: 7000 },
    { accountId: "c", amount: 0 },
    // "d" tidak ada di periode pembanding → dianggap 0.
  ];

  it("menyembunyikan hanya baris nol di kedua periode", () => {
    const visible = visibleStatementLines(lines, prior, true);
    expect(visible.map((row) => row.accountId)).toEqual(["b", "c"]);
  });

  it("hideZero=false menampilkan semua baris apa adanya", () => {
    expect(visibleStatementLines(lines, prior, false)).toEqual(lines);
  });

  it("isEmptyStatementLine mengikuti definisi yang sama", () => {
    const priorMap = new Map(prior.map((row) => [row.accountId, row.amount]));
    expect(isEmptyStatementLine(lines[0], priorMap)).toBe(true);
    expect(isEmptyStatementLine(lines[1], priorMap)).toBe(false);
    expect(isEmptyStatementLine(lines[2], priorMap)).toBe(false);
    expect(isEmptyStatementLine(lines[3], priorMap)).toBe(true);
  });
});

describe("report-visibility: neraca saldo & ekuitas", () => {
  it("baris neraca saldo hampa hanya bila semua kolom & pembanding nol", () => {
    const rows = [
      { accountId: "a", opening: 0, debit: 0, credit: 0, closing: 0 },
      { accountId: "b", opening: 0, debit: 0, credit: 0, closing: 0 },
      { accountId: "c", opening: 100, debit: 0, credit: 0, closing: 100 },
      { accountId: "d", opening: 0, debit: 50, credit: 50, closing: 0 },
    ];
    const prior = [
      { accountId: "a", closing: 0 },
      { accountId: "b", closing: 250 },
    ];
    // b tampil (pembanding bukan nol), d tampil (ada gerak walau saldo akhir nol).
    expect(visibleTrialRows(rows, prior, true).map((row) => row.accountId)).toEqual(["b", "c", "d"]);
    expect(visibleTrialRows(rows, prior, false)).toEqual(rows);
  });

  it("baris ekuitas hampa hanya bila saldo & gerak nol di kedua periode", () => {
    const rows = [
      { accountId: "a", opening: 0, addition: 0, reduction: 0, closing: 0 },
      { accountId: "b", opening: 0, addition: 0, reduction: 0, closing: 0 },
      { accountId: "c", opening: 0, addition: 900, reduction: 0, closing: 900 },
    ];
    const prior = [
      { accountId: "a", closing: 0 },
      { accountId: "b", closing: 100 },
    ];
    expect(visibleEquityRows(rows, prior, true).map((row) => row.accountId)).toEqual(["b", "c"]);
    expect(visibleEquityRows(rows, prior, false)).toEqual(rows);
  });
});
