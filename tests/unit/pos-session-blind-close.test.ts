import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("sonner", () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock("@/server/actions/pos", () => ({
  openSessionAction: async () => ({ ok: true, data: null }),
  closeSessionAction: async () => ({ ok: true, data: null }),
  cashMovementAction: async () => ({ ok: true, data: null }),
}));

import { SessionManager } from "@/components/pos/session-manager";
import { IDR_CASH_DENOMINATIONS, denominationTotal } from "@/lib/pos/denominations";
import { formatIDR } from "@/lib/money";

// A-28 Tahap 1 (H-POS-01/03): tutup sesi BUTA. Bukti render awal
// formulir: angka kas seharusnya & selisih TIDAK muncul sebelum
// kasir mengunci hitungan fisiknya; masukan hitungan adalah grid
// denominasi. Fungsi total denominasi diuji sebagai fungsi murni.

describe("denominationTotal — total hitungan per pecahan", () => {
  it("menjumlahkan pecahan × jumlah lembar (string & angka)", () => {
    expect(denominationTotal({ "100000": 2, "50000": "1", "1000": 3 })).toBe(253_000);
    expect(denominationTotal({})).toBe(0);
  });

  it("mengabaikan pecahan tak dikenal, negatif, dan pecahan lembar", () => {
    expect(denominationTotal({ "999": 5 })).toBe(0);
    expect(denominationTotal({ "5000": -2 })).toBe(0);
    expect(denominationTotal({ "5000": 2.9 })).toBe(10_000);
    expect(denominationTotal({ "5000": "abc" })).toBe(0);
  });

  it("daftar pecahan menurun dan memuat pecahan beredar utama", () => {
    expect(IDR_CASH_DENOMINATIONS[0]).toBe(100_000);
    expect(IDR_CASH_DENOMINATIONS).toContain(75_000);
    expect(IDR_CASH_DENOMINATIONS.at(-1)).toBe(100);
    const sorted = [...IDR_CASH_DENOMINATIONS].sort((a, b) => b - a);
    expect([...IDR_CASH_DENOMINATIONS]).toEqual(sorted);
  });
});

describe("SessionManager — langkah hitung tutup sesi itu buta", () => {
  const session = {
    id: "sesi-uji-buta",
    openedAt: new Date().toISOString(),
    openingCash: 500_000,
    expected: 765_432,
    sales: 265_432,
    refunds: 0,
    deposits: 0,
    withdrawals: 0,
    transactionCount: 3,
    movements: [
      {
        id: "mutasi-1",
        type: "opening",
        amount: 500_000,
        notes: null,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(SessionManager, { session, differenceTolerance: 0 }),
  );

  it("tidak membocorkan label maupun angka kas seharusnya", () => {
    expect(html).not.toContain("Kas seharusnya");
    expect(html).not.toContain(formatIDR(765_432));
    expect(html).not.toContain("765.432");
  });

  it("tidak menampilkan selisih live maupun kolom alasan pada langkah hitung", () => {
    expect(html).not.toContain("Alasan selisih");
    expect(html).toContain("Kunci hitungan");
  });

  it("menampilkan grid denominasi sebagai cara masukan hitungan", () => {
    expect(html).toContain(formatIDR(75_000));
    expect(html).toContain(formatIDR(100_000));
    expect(html).toContain("Total dihitung");
  });
});
