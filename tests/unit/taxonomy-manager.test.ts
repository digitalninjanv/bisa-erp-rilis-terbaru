import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaxonomyManager, type CategoryRow, type UnitRow } from "@/components/gudang/taxonomy-manager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/server/actions/inventory/taksonomi", () => ({
  createTaxonomyAction: vi.fn(),
  updateTaxonomyAction: vi.fn(),
  toggleTaxonomyAction: vi.fn(),
  deleteTaxonomyAction: vi.fn(),
}));

const mockCategories: CategoryRow[] = [
  { id: "cat-1", name: "Makanan Ringan", parentId: null, isActive: true },
  { id: "cat-2", name: "Biskuit & Cookies", parentId: "cat-1", isActive: true },
  { id: "cat-3", name: "Minuman", parentId: null, isActive: false },
];

const mockUnits: UnitRow[] = [
  { id: "unit-1", code: "PCS", name: "Pieces", isActive: true },
  { id: "unit-2", code: "BOX", name: "Box / Kotak", isActive: true },
  { id: "unit-3", code: "KG", name: "Kilogram", isActive: false },
];

describe("TaxonomyManager Enterprise UI/UX", () => {
  it("merender tab Kategori dan Satuan dengan badge jumlah data", () => {
    const html = renderToStaticMarkup(
      createElement(TaxonomyManager, {
        categories: mockCategories,
        units: mockUnits,
      }),
    );

    // Tab navigasi
    expect(html).toContain("Kategori");
    expect(html).toContain("Satuan");
    expect(html).toContain("3"); // Mock length = 3
  });

  it("merender form tambah kategori yang responsif (lebar penuh w-full dan tombol Tambah Kategori)", () => {
    const html = renderToStaticMarkup(
      createElement(TaxonomyManager, {
        categories: mockCategories,
        units: mockUnits,
      }),
    );

    expect(html).toContain("Nama kategori baru (contoh: Minuman Kemasan)...");
    expect(html).toContain("Tanpa induk (Kategori Utama)");
    expect(html).toContain("Tambah Kategori");
    // Memastikan input nama membentang selebar kartu (w-full)
    expect(html).toContain("w-full");
  });

  it("merender hierarki kategori dengan simbol kurva pohon ↳ untuk subkategori", () => {
    const html = renderToStaticMarkup(
      createElement(TaxonomyManager, {
        categories: mockCategories,
        units: mockUnits,
      }),
    );

    expect(html).toContain("Makanan Ringan");
    expect(html).toContain("Biskuit &amp; Cookies");
    // Sub-kategori memiliki penanda kurva siku ↳
    expect(html).toContain("↳");
  });

  it("merender badge status aktif dan nonaktif dengan benar", () => {
    const html = renderToStaticMarkup(
      createElement(TaxonomyManager, {
        categories: mockCategories,
        units: mockUnits,
      }),
    );

    expect(html).toContain("Aktif");
    expect(html).toContain("Nonaktif");
  });
});
