import { describe, expect, it } from "vitest";
import type { CashSession, SnapshotName } from "../../pos-desktop/lib/pos-bridge";
import {
  buildCashierNameIndex,
  displayCashierName,
  selectDefaultWarehouseId,
  sessionMatchesSearch,
} from "../../pos-desktop/lib/pos-native-display";
import type { SnapshotWarehouse } from "../../pos-desktop/lib/pos-bridge";

const names: SnapshotName[] = [
  { id: "usr-sari", name: "Sari Wahyuni", groupId: null },
  { id: "usr-budi", name: "Budi Santoso", groupId: null },
];

function session(overrides: Partial<CashSession> = {}): CashSession {
  return {
    id: "sess-0001",
    warehouseId: "gudang-1",
    openedAt: "2026-11-17T02:15:00.000Z",
    openedBy: "usr-sari",
    openingCash: "200000",
    closedAt: "2026-11-17T10:15:00.000Z",
    status: "closed",
    counted: [],
    countedTotal: "1250000",
    expectedTotal: "1245000",
    differenceTotal: "5000",
    ...overrides,
  };
}

describe("pemilih gudang register", () => {
  const warehouses: SnapshotWarehouse[] = [
    { id: "wh-1", code: "CABANG", name: "Cabang", isDefault: false },
    { id: "wh-2", code: "PUSAT", name: "Pusat", isDefault: true },
  ];

  it("memilih gudang berflag default, bukan yang pertama", () => {
    expect(selectDefaultWarehouseId(warehouses)).toBe("wh-2");
  });

  it("jatuh ke gudang pertama bila tidak ada default", () => {
    expect(selectDefaultWarehouseId(warehouses.map((w) => ({ ...w, isDefault: false })))).toBe("wh-1");
  });

  it("tidak memilih apa pun bila daftar kosong", () => {
    expect(selectDefaultWarehouseId([])).toBe("");
  });
});

describe("riwayat sesi kasir native", () => {
  it("memetakan id kasir ke nama asli dari direktori snapshot", () => {
    const index = buildCashierNameIndex(names);
    expect(displayCashierName("usr-sari", index)).toBe("Sari Wahyuni");
    expect(displayCashierName("usr-budi", index)).toBe("Budi Santoso");
  });

  it("tidak pernah menampilkan potongan UUID sebagai nama kasir", () => {
    const index = buildCashierNameIndex(names);
    const fallback = displayCashierName("usr-tanpa-nama", index);
    expect(fallback).not.toMatch(/^[0-9a-f]{4,8}$/i);
    expect(fallback).toBe("Kasir terminal");
    expect(displayCashierName(null, index)).toBe("Kasir terminal");
  });

  it("mencari riwayat berdasarkan nama kasir", () => {
    const index = buildCashierNameIndex(names);
    const entry = session();
    expect(sessionMatchesSearch(entry, displayCashierName(entry.openedBy, index), "sari")).toBe(true);
    expect(sessionMatchesSearch(entry, displayCashierName(entry.openedBy, index), "WAHYUNI")).toBe(true);
    expect(sessionMatchesSearch(entry, displayCashierName(entry.openedBy, index), "budi")).toBe(false);
  });

  it("tetap mendukung pencarian berdasarkan id shift dan tanggal", () => {
    const index = buildCashierNameIndex(names);
    const label = displayCashierName(session().openedBy, index);
    expect(sessionMatchesSearch(session(), label, "sess-0001")).toBe(true);
    expect(sessionMatchesSearch(session(), label, "17 Nov")).toBe(true);
    expect(sessionMatchesSearch(session(), label, "  ")).toBe(true);
  });
});
