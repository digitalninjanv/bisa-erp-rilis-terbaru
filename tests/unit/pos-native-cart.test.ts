import { describe, expect, it } from "vitest";
import type { LocalPackaging, LocalProduct } from "../../pos-desktop/lib/pos-bridge";
import {
  filterReservationsForCart,
  lineBaseQty,
  lineKey,
  lineTotal,
  lineUnitPrice,
  restoreHeldCart,
  type CartLine,
} from "../../pos-desktop/lib/pos-native-cart";

const product: LocalProduct = {
  productId: "prod-1",
  sku: "SK-1",
  barcode: null,
  name: "Indomie",
  categoryId: null,
  categoryName: null,
  salePrice: "3500",
  stock: 100,
  trackStock: true,
  trackSerial: false,
  unitCode: "Pcs",
  packagings: [],
};

const dus: LocalPackaging = {
  packagingId: "pack-1",
  name: "Dus",
  isi: "40",
  salePrice: "130000",
  barcode: null,
  isActive: true,
  isDefaultSale: false,
};

function line(overrides: Partial<CartLine> = {}): CartLine {
  return { product, packaging: null, qty: 2, ...overrides };
}

describe("reservasi stok di keranjang", () => {
  it("hanya menampilkan reservasi untuk produk yang ada di keranjang", () => {
    const reservations = [
      { id: "r1", number: "RES-1", productId: "prod-1", qty: "2", expiresAt: null, reason: null },
      { id: "r2", number: "RES-2", productId: "prod-lain", qty: "1", expiresAt: null, reason: null },
    ];
    expect(filterReservationsForCart(reservations, [line()]).map((r) => r.id)).toEqual(["r1"]);
    expect(filterReservationsForCart(reservations, [])).toEqual([]);
  });
});

describe("keranjang terminal native", () => {
  it("identitas baris membedakan satuan dasar dan kemasan", () => {
    expect(lineKey(line())).toBe("prod-1::base");
    expect(lineKey(line({ packaging: dus }))).toBe("prod-1::pack-1");
  });

  it("harga kemasan independen dan konversi ke satuan dasar", () => {
    expect(lineUnitPrice(line())).toBe(3500);
    expect(lineUnitPrice(line({ packaging: dus }))).toBe(130000);
    expect(lineBaseQty(line({ packaging: dus, qty: 3 }))).toBe(120);
    expect(lineBaseQty(line())).toBe(2);
  });

  it("menghitung total dengan diskon persen dan nominal", () => {
    expect(lineTotal(line())).toBe(7000);
    expect(lineTotal(line({ discountType: "percent", discountValue: 10 }))).toBe(6300);
    expect(lineTotal(line({ discountType: "nominal", discountValue: 1000 }))).toBe(5000);
  });

  it("total tidak pernah negatif", () => {
    expect(lineTotal(line({ discountType: "nominal", discountValue: 99999 }))).toBe(0);
  });

  it("restore only accepts valid held carts", () => {
    expect(restoreHeldCart({ cart: [line()] })).toHaveLength(1);
    expect(restoreHeldCart({ cart: [] })).toBeNull();
    expect(restoreHeldCart({ cart: [{ ...line(), qty: -1 }] })).toBeNull();
    expect(restoreHeldCart({ cart: [{ ...line(), product: { ...product, salePrice: "abc" } }] })).toBeNull();
    expect(restoreHeldCart({ cart: [{ ...line(), discountType: "weird" }] })).toBeNull();
  });
});
