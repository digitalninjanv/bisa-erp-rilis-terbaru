import { describe, expect, it } from "vitest";
import {
  PackagingSyncError,
  costPerBaseUnit,
  formatCountBreakdown,
  normalizePackagingInput,
  packagingBreakdownLabel,
  planPackagingSync,
  pricePerBaseUnit,
  sumCountComponents,
  toBaseQty,
  validatePackagingInput,
  type CountBreakdownComponent,
  type PackagingInput,
  type PackagingSnapshot,
} from "@/lib/packaging";
import { d } from "@/lib/money";

/**
 * Program Satuan Kemasan S1 — matematika konversi, validasi baris, dan
 * rencana sinkronisasi kemasan (lib/packaging, murni). Rantai kanonik
 * riset §7 wajib tidak pernah patah: beli 10 Dus (isi 40) → stok 400;
 * jual 1 Dus → 360; jual 15 Pcs → 345; opname 8 Dus + 25 Pcs → 345,
 * selisih 0.
 */

function row(overrides: Partial<PackagingInput> = {}): PackagingInput {
  return {
    name: "Dus",
    isi: "40",
    buyPrice: "124000",
    salePrice: "145000",
    barcode: null,
    isDefaultPurchase: false,
    isDefaultSale: false,
    isActive: true,
    ...overrides,
  };
}

function saved(overrides: Partial<PackagingSnapshot> = {}): PackagingSnapshot {
  return { ...row(), id: "pkg-1", sortOrder: 0, ...overrides };
}

describe("toBaseQty — konversi sekali ke satuan dasar", () => {
  it("10 dus isi 40 = 400 satuan dasar", () => {
    expect(toBaseQty(10, 40)).toBe("400.0000");
    expect(toBaseQty("2", "6")).toBe("12.0000");
  });

  it("rantai kanonik riset §7: 400 → 360 → 345 → opname 345 selisih 0", () => {
    let stock = d(0);
    stock = stock.plus(toBaseQty(10, 40)); // beli 10 Dus
    expect(stock.toString()).toBe("400");
    stock = stock.minus(toBaseQty(1, 40)); // jual 1 Dus
    expect(stock.toString()).toBe("360");
    stock = stock.minus(toBaseQty(15, 1)); // jual 15 Pcs (satuan dasar, isi 1)
    expect(stock.toString()).toBe("345");
    const counted = d(toBaseQty(8, 40)).plus(toBaseQty(25, 1)); // opname campuran
    expect(counted.toString()).toBe("345");
    expect(counted.minus(stock).toString()).toBe("0");
  });

  it("membulatkan sekali ke 4 desimal, bukan berantai", () => {
    // 0,3333 × 3 = 0,9999 persis pada skala repo — tidak dibulatkan dua kali.
    expect(toBaseQty("0.3333", "3")).toBe("0.9999");
    expect(toBaseQty("2.5", "3")).toBe("7.5000");
  });
});

describe("pricePerBaseUnit / costPerBaseUnit — harga kemasan ÷ isi", () => {
  it("harga dus 110.000 isi 40 → HPP per pcs 2.750", () => {
    expect(costPerBaseUnit("110000", "40")).toBe("2750.0000");
    expect(pricePerBaseUnit("145000", "40")).toBe("3625.0000");
  });

  it("pembagian tak bulat dibulatkan sekali ke 4 desimal (half-up)", () => {
    expect(costPerBaseUnit("100000", "3")).toBe("33333.3333");
    expect(costPerBaseUnit("100000", "6")).toBe("16666.6667");
  });

  it("isi nol ditolak", () => {
    expect(() => costPerBaseUnit("1000", "0")).toThrow();
  });
});

describe("validatePackagingInput", () => {
  it("baris sah lolos", () => {
    expect(validatePackagingInput(row())).toEqual([]);
    expect(validatePackagingInput(row({ buyPrice: null, salePrice: null, barcode: null }))).toEqual([]);
  });

  it("isi 1, 0, dan pecahan ditolak", () => {
    expect(validatePackagingInput(row({ isi: "1" })).join(" ")).toContain("bilangan bulat");
    expect(validatePackagingInput(row({ isi: "0" })).length).toBeGreaterThan(0);
    expect(validatePackagingInput(row({ isi: "2.5" })).length).toBeGreaterThan(0);
    expect(validatePackagingInput(row({ isi: "24" }))).toEqual([]);
  });

  it("nama kosong & harga negatif ditolak", () => {
    expect(validatePackagingInput(row({ name: "  " })).length).toBeGreaterThan(0);
    expect(validatePackagingInput(row({ salePrice: "-5" })).length).toBeGreaterThan(0);
  });
});

describe("normalizePackagingInput", () => {
  it("memangkas nama/barcode dan menormalkan string kosong menjadi null", () => {
    const normalized = normalizePackagingInput(
      row({ name: "  Dus  ", barcode: "   ", buyPrice: "", salePrice: "145000" }),
    );
    expect(normalized.name).toBe("Dus");
    expect(normalized.barcode).toBeNull();
    expect(normalized.buyPrice).toBeNull();
    expect(normalized.salePrice).toBe("145000.0000");
    expect(normalized.isi).toBe("40.0000");
  });
});

describe("planPackagingSync — penjaga edit", () => {
  it("baris baru menjadi creates dengan sortOrder urutan kiriman", () => {
    const plan = planPackagingSync([], [row(), row({ name: "Pak", isi: "10" })], new Set());
    expect(plan.creates.map((r) => r.name)).toEqual(["Dus", "Pak"]);
    expect(plan.creates.map((r) => r.sortOrder)).toEqual([0, 1]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.priceChanged).toBe(false);
  });

  it("baris tak berubah tidak menghasilkan update; format angka setara bukan perubahan harga", () => {
    const plan = planPackagingSync(
      [saved()],
      [{ ...row({ buyPrice: "124000", salePrice: "145000.0" }), id: "pkg-1" }],
      new Set(),
    );
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.priceChanged).toBe(false);
  });

  it("perubahan harga tersimpan terdeteksi untuk gerbang izin", () => {
    const plan = planPackagingSync([saved()], [{ ...row({ salePrice: "146000" }), id: "pkg-1" }], new Set());
    expect(plan.priceChanged).toBe(true);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].salePrice).toBe("146000.0000");
  });

  it("ubah isi diizinkan (berlaku dokumen berikutnya; histori memegang cuplikannya)", () => {
    const plan = planPackagingSync([saved()], [{ ...row({ isi: "38" }), id: "pkg-1" }], new Set());
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].isi).toBe("38.0000");
    expect(plan.priceChanged).toBe(false);
  });

  it("bendera bawaan bersifat radio: yang pertama menandai yang bertahan", () => {
    const plan = planPackagingSync(
      [],
      [
        row({ name: "Dus", isDefaultPurchase: true }),
        row({ name: "Pak", isi: "10", isDefaultPurchase: true, isDefaultSale: true }),
        row({ name: "Slop", isi: "5", isDefaultSale: true }),
      ],
      new Set(),
    );
    const byName = new Map(plan.creates.map((r) => [r.name, r]));
    expect(byName.get("Dus")?.isDefaultPurchase).toBe(true);
    expect(byName.get("Pak")?.isDefaultPurchase).toBe(false);
    expect(byName.get("Pak")?.isDefaultSale).toBe(true);
    expect(byName.get("Slop")?.isDefaultSale).toBe(false);
  });

  it("nama duplikat (case-insensitive) dan barcode duplikat dalam kiriman ditolak", () => {
    expect(() => planPackagingSync([], [row(), row({ name: "dus" })], new Set())).toThrowError(
      PackagingSyncError,
    );
    expect(() =>
      planPackagingSync(
        [],
        [row({ barcode: "8992" }), row({ name: "Pak", isi: "10", barcode: "8992" })],
        new Set(),
      ),
    ).toThrowError(/dipakai oleh kemasan/);
  });

  it("kemasan belum terpakai yang hilang dari kiriman dihapus fisik", () => {
    const plan = planPackagingSync([saved()], [], new Set());
    expect(plan.deletes).toEqual(["pkg-1"]);
  });

  it("kemasan TERPAKAI yang hilang dari kiriman ditolak — harus dinonaktifkan", () => {
    let caught: unknown;
    try {
      planPackagingSync([saved()], [], new Set(["pkg-1"]));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PackagingSyncError);
    expect((caught as PackagingSyncError).code).toBe("CONFLICT");
    expect((caught as Error).message).toContain("tidak dapat dihapus");
    // Menonaktifkan baris yang sama adalah jalur yang sah:
    const plan = planPackagingSync([saved()], [{ ...row({ isActive: false }), id: "pkg-1" }], new Set(["pkg-1"]));
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].isActive).toBe(false);
    expect(plan.deletes).toEqual([]);
  });

  it("id asing dalam kiriman ditolak sebagai data basi", () => {
    expect(() => planPackagingSync([], [{ ...row(), id: "pkg-asing" }], new Set())).toThrowError(
      /tidak ditemukan pada produk ini/,
    );
  });

  it("baris tidak sah ditolak sebelum rencana dibuat", () => {
    expect(() => planPackagingSync([], [row({ isi: "1" })], new Set())).toThrowError(
      PackagingSyncError,
    );
  });
});

describe("S3 — sumCountComponents & formatCountBreakdown (hitungan campuran opname)", () => {
  const components: CountBreakdownComponent[] = [
    { packagingId: "dus", packagingName: "Dus", isiSnapshot: "100", qtyInput: "3", baseQty: "300" },
    { packagingId: "slop", packagingName: "Slop", isiSnapshot: "10", qtyInput: "4", baseQty: "40" },
    { packagingId: null, packagingName: "Pcs", isiSnapshot: "1", qtyInput: "5", baseQty: "5" },
  ];

  it("3 Dus (100) + 4 Slop (10) + 5 Pcs = 345 tepat", () => {
    expect(sumCountComponents(components)).toBe("345.0000");
  });

  it("rantai kanonik riset: 8 Dus isi 40 + 25 Pcs = 345", () => {
    expect(
      sumCountComponents([
        { qtyInput: "8", isiSnapshot: "40" },
        { qtyInput: "25", isiSnapshot: "1" },
      ]),
    ).toBe("345.0000");
  });

  it("teks rincian menyebut tiap bentuk sekali, urutan komponen", () => {
    expect(formatCountBreakdown(components)).toBe("3 Dus + 4 Slop + 5 Pcs");
  });
});

describe("S3 — packagingBreakdownLabel (pecahan tampilan, display-only)", () => {
  const packs = [
    { name: "Slop", isi: "10" },
    { name: "Dus", isi: "100" },
  ];

  it("memakai kemasan TERBESAR aktif: 345 → ≈ 3 Dus 45 Pcs", () => {
    expect(packagingBreakdownLabel("345", packs, "Pcs")).toBe("≈ 3 Dus 45 Pcs");
  });

  it("kelipatan persis tanpa sisa: 200 → ≈ 2 Dus", () => {
    expect(packagingBreakdownLabel("200", packs, "Pcs")).toBe("≈ 2 Dus");
  });

  it("di bawah satu kemasan terbesar → null (angka dasar berdiri sendiri)", () => {
    expect(packagingBreakdownLabel("99", packs, "Pcs")).toBeNull();
    expect(packagingBreakdownLabel("0", packs, "Pcs")).toBeNull();
    expect(packagingBreakdownLabel("-40", packs, "Pcs")).toBeNull();
    expect(packagingBreakdownLabel("345", [], "Pcs")).toBeNull();
  });
});
