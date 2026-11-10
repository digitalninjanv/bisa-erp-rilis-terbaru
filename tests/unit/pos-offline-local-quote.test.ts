import { describe, expect, it } from "vitest";
import {
  computeLocalOfflineQuote,
  type LocalQuoteCatalogEntry,
} from "@/lib/pos-offline";

/**
 * A-24 T6 (temuan T6-01) — quote lokal offline POS.
 *
 * Quote server (src/server/pos/quote.ts) adalah otoritas; quote lokal
 * ini hanya jembatan agar tombol Bayar hidup saat server tak terjangkau
 * dan saklar offline aktif: harga master katalog + diskon manual baris +
 * pajak inklusif + pembulatan tunai — primitif uang yang sama
 * (lib/money.ts). Harga kelompok per produk TIDAK diketahui klien:
 * groupUnitPrice = harga master, selisihnya diselesaikan kontrak
 * sinkronisasi sebagai konflik harga di peninjauan, bukan senyap.
 * Nilai harap di bawah dihitung dari logika quote.ts server.
 */

const AQUA = "01900000-0000-7000-8000-0000000000a1";
const BENG = "01900000-0000-7000-8000-0000000000b2";

function catalog(): Record<string, LocalQuoteCatalogEntry> {
  return {
    [AQUA]: {
      name: "Aqua Air Mineral 600ml",
      sku: "SKU-00001",
      salePrice: "4000",
      stock: 120,
      trackStock: true,
      trackSerial: false,
    },
    [BENG]: {
      name: "Beng Beng Chocolate",
      sku: "SKU-00002",
      salePrice: "3000",
      stock: 120,
      trackStock: true,
      trackSerial: false,
    },
  };
}

describe("computeLocalOfflineQuote (T6-01)", () => {
  it("keranjang polos: total = jumlah baris pada harga master", () => {
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: AQUA, qty: 2 }],
      catalog: catalog(),
      taxRate: 0,
      companyRoundingMode: "none",
    });
    expect(quote).not.toBeNull();
    expect(quote!.subtotal).toBe(8000);
    expect(quote!.discountTotal).toBe(0);
    expect(quote!.taxTotal).toBe(0);
    expect(quote!.total).toBe(8000);
    expect(quote!.roundingAdjustment).toBe(0);
    expect(quote!.lines[0].groupUnitPrice).toBe(4000);
    expect(quote!.lines[0].lineTotal).toBe(8000);
    expect(quote!.lines[0].stock).toBe(120);
  });

  it("pembulatan tunai perusahaan nearest_500 diterapkan seperti server", () => {
    const quote = computeLocalOfflineQuote({
      lines: [
        { productId: AQUA, qty: 1 },
        { productId: BENG, qty: 1 },
      ],
      catalog: {
        ...catalog(),
        [BENG]: { ...catalog()[BENG], salePrice: "3300" },
      },
      taxRate: 0,
      companyRoundingMode: "nearest_500",
    });
    // 4000 + 3300 = 7300 → terdekat 500 = 7500 (penyesuaian +200)
    expect(quote!.total).toBe(7500);
    expect(quote!.roundingAdjustment).toBe(200);
    expect(quote!.cashRounding).toEqual({ step: 500, direction: "nearest" });
  });

  it("diskon manual persen dihitung dari harga satuan seperti server", () => {
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: AQUA, qty: 2, discountType: "percent", discountValue: 10 }],
      catalog: catalog(),
      taxRate: 0,
      companyRoundingMode: "none",
    });
    expect(quote!.discountTotal).toBe(800);
    expect(quote!.lines[0].manualDiscountAmount).toBe(800);
    expect(quote!.total).toBe(7200);
  });

  it("diskon manual nominal tidak melebihi bruto baris", () => {
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: BENG, qty: 1, discountType: "nominal", discountValue: 5000 }],
      catalog: catalog(),
      taxRate: 0,
      companyRoundingMode: "none",
    });
    expect(quote!.discountTotal).toBe(3000);
    expect(quote!.total).toBe(0);
  });

  it("pajak inklusif: total tidak berubah, komponen pajak terpisah", () => {
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: AQUA, qty: 1, discountType: "nominal", discountValue: 0 }],
      catalog: {
        [AQUA]: { ...catalog()[AQUA], salePrice: "11100" },
      },
      taxRate: 11,
      companyRoundingMode: "none",
    });
    expect(quote!.total).toBe(11100);
    expect(quote!.taxTotal).toBe(1100);
    expect(quote!.netSales).toBe(10000);
    expect(quote!.lines[0].taxRate).toBe(11);
  });

  it("pembulatan kas kelompok (roundCashTotal) mengalahkan mode perusahaan", () => {
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: BENG, qty: 1 }],
      catalog: {
        [BENG]: { ...catalog()[BENG], salePrice: "7250" },
      },
      group: { roundingStep: 100, roundingDirection: "up", roundCashTotal: true },
      taxRate: 0,
      companyRoundingMode: "nearest_500",
    });
    expect(quote!.total).toBe(7300);
    expect(quote!.cashRounding).toEqual({ step: 100, direction: "up" });
  });

  it("produk tak dikenal katalog lokal → null (tidak mengarang quote)", () => {
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: "01900000-0000-7000-8000-0000000000ff", qty: 1 }],
      catalog: catalog(),
      taxRate: 0,
      companyRoundingMode: "none",
    });
    expect(quote).toBeNull();
  });

  it("baris serial diteruskan apa adanya untuk gerbang kelengkapan terminal", () => {
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: AQUA, qty: 1, serialNumbers: ["SN-1"] }],
      catalog: catalog(),
      taxRate: 0,
      companyRoundingMode: "none",
    });
    expect(quote!.lines[0].serialNumbers).toEqual(["SN-1"]);
  });

  it("S4: baris berkemasan dikonversi ke satuan dasar dengan harga kemasan independen", () => {
    const DUS = "01900000-0000-7000-8000-0000000000d1";
    const quote = computeLocalOfflineQuote({
      lines: [{ productId: BENG, qty: 1, packagingId: DUS }],
      catalog: {
        [BENG]: {
          ...catalog()[BENG],
          packagings: [{ id: DUS, name: "Dus", isi: "40", salePrice: "145000" }],
        },
      },
      taxRate: 0,
      companyRoundingMode: "none",
    });
    expect(quote).not.toBeNull();
    // 1 Dus isi 40 @ Rp145.000 (independen, bukan 40 × 3.000):
    // qty dasar 40, harga per satuan dasar 3.625, total tetap 145.000.
    expect(quote!.lines[0].packagingId).toBe(DUS);
    expect(quote!.lines[0].packagingName).toBe("Dus");
    expect(quote!.lines[0].qtyInput).toBe(1);
    expect(quote!.lines[0].isiSnapshot).toBe("40");
    expect(quote!.lines[0].qty).toBe(40);
    expect(quote!.lines[0].groupUnitPrice).toBe(3625);
    expect(quote!.lines[0].lineTotal).toBe(145000);
    expect(quote!.total).toBe(145000);
  });

  it("S4: kemasan tak dikenal katalog lokal → null (terminal tidak mengarang faktor)", () => {
    const quote = computeLocalOfflineQuote({
      lines: [
        {
          productId: BENG,
          qty: 1,
          packagingId: "01900000-0000-7000-8000-0000000000ee",
        },
      ],
      catalog: catalog(),
      taxRate: 0,
      companyRoundingMode: "none",
    });
    expect(quote).toBeNull();
  });
});
