import { describe, expect, it } from "vitest";
import {
  arApStatusLabel,
  filterArApRows,
  parseArApStatus,
  type ArApStatusFilter,
} from "@/lib/due-date";

// A-22 Tahap K6 (sisa K5): chip filter status daftar piutang & utang.
// Status HARUS diturunkan dari baris listReceivables/listPayables yang
// sama dengan angka antrean dashboard (getReceivablePayableQueues):
// terlambat = tempo < hari ini; jatuh-tempo = terlambat + tempo dalam
// 7 hari ke depan (gabungan overdueCount + dueSoonCount kartu utang).
// Daftar sumber hanya memuat dokumen TERBUKA (unpaid/partial), jadi
// tidak ada status "lunas" di sini — chip disesuaikan status nyata.

const TODAY = "2026-11-05";

type Row = { paymentStatus: string; dueDate: string | null };
const rows: Row[] = [
  { paymentStatus: "unpaid", dueDate: "2026-11-01" }, // terlambat 4 hari
  { paymentStatus: "partial", dueDate: "2026-11-04" }, // terlambat 1 hari
  { paymentStatus: "unpaid", dueDate: "2026-11-05" }, // tempo hari ini
  { paymentStatus: "unpaid", dueDate: "2026-11-12" }, // 7 hari lagi
  { paymentStatus: "partial", dueDate: "2026-11-13" }, // 8 hari lagi
  { paymentStatus: "unpaid", dueDate: null }, // tanpa tempo
  { paymentStatus: "partial", dueDate: "2026-12-01" }, // jauh
];

describe("parseArApStatus", () => {
  it.each(["semua", "belum-lunas", "sebagian", "terlambat", "jatuh-tempo"] as const)(
    "menerima nilai sah %s",
    (value) => {
      expect(parseArApStatus(value)).toBe(value);
    },
  );

  it("nilai kosong/tidak dikenal → semua (parameter URL aman)", () => {
    expect(parseArApStatus(undefined)).toBe("semua");
    expect(parseArApStatus("")).toBe("semua");
    expect(parseArApStatus("lunas")).toBe("semua");
    expect(parseArApStatus("DROP TABLE")).toBe("semua");
  });
});

describe("filterArApRows", () => {
  it("semua → seluruh baris terbuka", () => {
    expect(filterArApRows(rows, "semua", TODAY)).toHaveLength(rows.length);
  });

  it("belum-lunas → hanya paymentStatus unpaid", () => {
    const out = filterArApRows(rows, "belum-lunas", TODAY);
    expect(out).toHaveLength(4);
    expect(out.every((r) => r.paymentStatus === "unpaid")).toBe(true);
  });

  it("sebagian → hanya paymentStatus partial", () => {
    const out = filterArApRows(rows, "sebagian", TODAY);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.paymentStatus === "partial")).toBe(true);
  });

  it("terlambat → hanya tempo sebelum hari ini (sama dgn overdue dashboard)", () => {
    const out = filterArApRows(rows, "terlambat", TODAY);
    expect(out.map((r) => r.dueDate)).toEqual(["2026-11-01", "2026-11-04"]);
  });

  it("jatuh-tempo → terlambat + tempo s.d. 7 hari ke depan (overdue+duseSoon dashboard)", () => {
    const out = filterArApRows(rows, "jatuh-tempo", TODAY);
    expect(out.map((r) => r.dueDate)).toEqual([
      "2026-11-01",
      "2026-11-04",
      "2026-11-05",
      "2026-11-12",
    ]);
  });

  it("baris tanpa tempo tidak pernah terlambat/jatuh-tempo", () => {
    for (const status of ["terlambat", "jatuh-tempo"] as ArApStatusFilter[]) {
      expect(filterArApRows(rows, status, TODAY).some((r) => r.dueDate === null)).toBe(false);
    }
  });
});

describe("arApStatusLabel", () => {
  it.each([
    ["semua", "Semua"],
    ["belum-lunas", "Belum lunas"],
    ["sebagian", "Sebagian"],
    ["terlambat", "Terlambat"],
    ["jatuh-tempo", "Jatuh tempo ≤ 7 hari"],
  ] as const)("label %s → %s", (status, label) => {
    expect(arApStatusLabel(status)).toBe(label);
  });
});
