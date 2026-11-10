import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADJUSTMENT_REASONS,
  composeAdjustmentReason,
  resolveAdjustmentReasons,
  sanitizeAdjustmentReasons,
} from "@/lib/adjustment-reasons";
import {
  opnameDueStatus,
  sanitizeOpnameCycleConfig,
} from "@/lib/opname-cycle";
import {
  resolveOperationScan,
  type OperationRef,
} from "@/lib/operation-scan";

// A-24 T3: kontrak lib murni tahap gudang — alasan penyesuaian
// terkonfigurasi (G4), pengingat siklus opname (G3), resolusi
// pindaian Mode Operasi (G1).

describe("adjustment-reasons", () => {
  it("tanpa konfigurasi → daftar bawaan rencana (Rusak…Lainnya)", () => {
    expect(resolveAdjustmentReasons(null)).toEqual([...DEFAULT_ADJUSTMENT_REASONS]);
    expect(resolveAdjustmentReasons(undefined)).toEqual([...DEFAULT_ADJUSTMENT_REASONS]);
    expect(resolveAdjustmentReasons("rusak")).toEqual([...DEFAULT_ADJUSTMENT_REASONS]);
  });

  it("konfigurasi sah dipakai apa adanya (terpotong rapi)", () => {
    expect(resolveAdjustmentReasons(["  Rusak di perjalanan ", "Selisih kasir"])).toEqual([
      "Rusak di perjalanan",
      "Selisih kasir",
    ]);
  });

  it("duplikat (beda kapital) & entri kosong dibuang; daftar kosong → bawaan", () => {
    expect(sanitizeAdjustmentReasons(["Rusak", "rusak", " ", 42, null])).toEqual(["Rusak"]);
    expect(sanitizeAdjustmentReasons([])).toBeNull();
    expect(resolveAdjustmentReasons([])).toEqual([...DEFAULT_ADJUSTMENT_REASONS]);
  });

  it("komposisi alasan: kategori terlacak, rincian menyertai", () => {
    expect(composeAdjustmentReason("Rusak", "kemasan penyok")).toBe("Rusak — kemasan penyok");
    expect(composeAdjustmentReason("Hilang", "")).toBe("Hilang");
    expect(composeAdjustmentReason("Lainnya", "ditemukan basi di rak pajang")).toBe(
      "ditemukan basi di rak pajang",
    );
    expect(composeAdjustmentReason("Lainnya", "  ")).toBe("");
    expect(composeAdjustmentReason("", "apa pun")).toBe("");
  });
});

describe("opname-cycle", () => {
  it("sanitasi membuang frekuensi tidak sah", () => {
    expect(
      sanitizeOpnameCycleConfig({
        warehouseDays: { "w-1": 30, "w-2": 0, "w-3": -5, "w-4": "30", "w-5": 99999 },
        categoryDays: { "c-1": 90.7 },
      }),
    ).toEqual({ warehouseDays: { "w-1": 30 }, categoryDays: { "c-1": 90 } });
    expect(sanitizeOpnameCycleConfig(null)).toEqual({ warehouseDays: {}, categoryDays: {} });
    expect(sanitizeOpnameCycleConfig([1, 2])).toEqual({ warehouseDays: {}, categoryDays: {} });
  });

  it("jatuh tempo = hitung terakhir + frekuensi", () => {
    expect(
      opnameDueStatus({ lastCountDate: "2026-10-01", frequencyDays: 30, today: "2026-10-30" }),
    ).toEqual({ dueDate: "2026-10-31", due: false, daysOverdue: 0 });
    expect(
      opnameDueStatus({ lastCountDate: "2026-10-01", frequencyDays: 30, today: "2026-11-05" }),
    ).toEqual({ dueDate: "2026-10-31", due: true, daysOverdue: 5 });
  });

  it("belum pernah dihitung = jatuh tempo segera tanpa tanggal", () => {
    expect(opnameDueStatus({ lastCountDate: null, frequencyDays: 30, today: "2026-11-05" })).toEqual({
      dueDate: null,
      due: true,
      daysOverdue: 0,
    });
  });
});

describe("operation-scan", () => {
  const ops: OperationRef[] = [
    { kind: "purchase_order", id: "po1", number: "PO-2026-00003", href: "/x/po1", productIds: ["p1", "p2"] },
    { kind: "transfer", id: "tr1", number: "TRF-2026-00001", href: "/x/tr1", productIds: ["p1"] },
    { kind: "opname_task", id: "tk1", number: "Tugas Gudang Utama", href: "/x/tk1", productIds: [] },
  ];

  it("nomor dokumen persis (abaikan kapital/spasi) membuka operasi", () => {
    const result = resolveOperationScan(" po-2026-00003 ", ops, null);
    expect(result).toEqual({ type: "open", operation: ops[0], via: "number" });
  });

  it("pindaian produk: satu operasi memuat → terbuka; banyak → daftar pasangan", () => {
    expect(resolveOperationScan("8991000000001", ops, { id: "p2" })).toEqual({
      type: "open",
      operation: ops[0],
      via: "product",
    });
    const multi = resolveOperationScan("8991000000000", ops, { id: "p1" });
    expect(multi.type).toBe("matches");
    if (multi.type === "matches") {
      expect(multi.operations.map((o) => o.id)).toEqual(["po1", "tr1"]);
    }
  });

  it("kode tak dikenal / produk tak termuat → none", () => {
    expect(resolveOperationScan("XXX-9", ops, null)).toEqual({ type: "none" });
    expect(resolveOperationScan("899999", ops, { id: "p9" })).toEqual({ type: "none" });
    expect(resolveOperationScan("  ", ops, null)).toEqual({ type: "none" });
  });

  it("nomor menang atas pasangan produk", () => {
    const result = resolveOperationScan("TRF-2026-00001", ops, { id: "p2" });
    expect(result).toEqual({ type: "open", operation: ops[1], via: "number" });
  });
});
