import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { canSeeInventoryCost, maskCost } from "@/lib/inventory-cost";

vi.mock("@/server/supplier-returns", () => ({
  SUPPLIER_RETURN_REASON_LABELS: { damaged: "Rusak" },
}));

import { SupplierReturnList } from "@/components/gudang/supplier-return-list";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("SEC-003 — matriks izin inventory.cost", () => {
  it("hanya pemegang inventory.cost yang melihat biaya", () => {
    expect(canSeeInventoryCost({ permissions: ["inventory.view"] })).toBe(false);
    expect(canSeeInventoryCost({ permissions: ["inventory.view", "inventory.cost"] })).toBe(true);
    expect(maskCost("Rp 1.234.567", false)).toBe("—");
    expect(maskCost("Rp 1.234.567", true)).toBe("Rp 1.234.567");
  });

  it("daftar retur menyembunyikan kolom & nilai biaya tanpa inventory.cost", () => {
    const rows = [{
      id: "r1",
      number: "RTB-2026-0001",
      date: "2026-11-15",
      status: "posted",
      reasonCategory: "damaged",
      totalValue: "1234567",
      creditAmount: "0",
      resolvedAmount: "0",
      supplierId: "s1",
      supplierName: "PT Uji",
      warehouseId: "w1",
      warehouseName: "Gudang Utama",
    }];

    const hidden = renderToStaticMarkup(createElement(SupplierReturnList, { rows, canSeeCost: false }));
    expect(hidden).not.toContain("Nilai retur");
    expect(hidden).not.toContain("1.234.567");

    const visible = renderToStaticMarkup(createElement(SupplierReturnList, { rows, canSeeCost: true }));
    expect(visible).toContain("Nilai retur");
    expect(visible).toContain("1.234.567");
  });

  it("permukaan PO/penerimaan/retur/dokumen memakai gerbang biaya", () => {
    const files = [
      "src/app/app/gudang/pembelian/page.tsx",
      "src/app/app/gudang/pembelian/[id]/page.tsx",
      "src/app/app/gudang/pembelian/[id]/cetak/page.tsx",
      "src/app/app/gudang/penerimaan/riwayat/page.tsx",
      "src/app/app/gudang/penerimaan/[id]/page.tsx",
      "src/app/app/gudang/penerimaan/[id]/cetak/page.tsx",
      "src/app/app/gudang/penyesuaian/page.tsx",
      "src/app/app/gudang/retur-pembelian/[id]/page.tsx",
      "src/app/app/gudang/retur-pembelian/[id]/cetak/page.tsx",
      "src/app/app/gudang/dokumen/[id]/page.tsx",
    ];
    for (const rel of files) {
      const source = readFileSync(path.join(ROOT, rel), "utf8");
      expect(source, rel).toContain("canSeeInventoryCost");
      expect(source, rel).toMatch(/canSeeCost\s*\?/);
    }
  });
});
