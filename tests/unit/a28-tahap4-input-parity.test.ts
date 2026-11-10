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

import {
  applyMoneyEdit,
  formatMoneyText,
  parseMoneyText,
} from "@/lib/money-input";
import { applyPercentEdit, formatPercentText, parsePercentText } from "@/lib/percent-input";
import { d } from "@/lib/money";
import { SessionManager } from "@/components/pos/session-manager";

/**
 * A-28 Tahap 4 (H-PGT-01/02) — paritas nilai migrasi input mentah →
 * MoneyInput/PercentInput bersama.
 *
 * Kontrak yang dibuktikan: untuk setiap formulir kunci yang
 * dimigrasi (harga produk, komponen gaji, fee metode pembayaran,
 * saldo awal, limit kredit, kas sesi POS, potongan rekonsiliasi),
 * string kanonis yang dihasilkan komponen bersama adalah Decimal
 * yang IDENTIK dengan string yang dikirim field mentah sebelumnya
 * untuk angka yang sama — yang berubah hanya tampilan & ketikan,
 * bukan nilai yang sampai ke server (skema server menerima string
 * desimal; lihat amountField/moneyString).
 */

/** Ketik teks digit demi digit lewat jalur ketik MoneyInput. */
function typeMoney(text: string): string {
  let display = "";
  let value = "";
  for (const ch of text) {
    const outcome = applyMoneyEdit(display, display + ch);
    if (outcome.kind === "value") {
      display = outcome.text;
      value = outcome.value;
    } else if (outcome.kind === "pending") {
      display = outcome.text;
    } else {
      throw new Error(`Ketikan "${text}" ditolak di "${display + ch}": ${outcome.error}`);
    }
  }
  return value;
}

/** Ketik teks digit demi digit lewat jalur ketik PercentInput. */
function typePercent(text: string): string {
  let display = "";
  let value = "";
  for (const ch of text) {
    const outcome = applyPercentEdit(display, display + ch);
    if (outcome.kind === "value") {
      display = outcome.text;
      value = outcome.value;
    } else if (outcome.kind === "pending") {
      display = outcome.text;
    } else {
      throw new Error(`Ketikan "${text}" ditolak di "${display + ch}": ${outcome.error}`);
    }
  }
  return value;
}

describe("paritas MoneyInput — nilai kanonis == nilai field mentah lama", () => {
  it.each([
    // [konteks formulir, teks yang diketik pengguna, string yang dikirim field mentah lama]
    ["harga jual produk", "1500000", "1500000"],
    ["harga pokok produk", "1250750", "1250750"],
    ["gaji pokok karyawan", "5000000", "5000000"],
    ["tunjangan karyawan", "750000", "750000"],
    ["potongan karyawan", "125000", "125000"],
    ["saldo awal utang/piutang", "25000000", "25000000"],
    ["limit kredit pelanggan", "10000000", "10000000"],
    ["modal awal sesi POS", "500000", "500000"],
    ["fee metode mode nominal", "1500", "1500"],
    ["nominal potongan rekonsiliasi", "25000", "25000"],
  ])("%s: ketik %s → Decimal identik dengan mentah %s", (_ctx, typed, rawBefore) => {
    const canonical = typeMoney(typed);
    expect(d(canonical).eq(d(rawBefore))).toBe(true);
    expect(canonical).toBe(`${rawBefore}.0000`);
  });

  it("tempel berformat id-ID menghasilkan Decimal yang sama dengan angka polosnya", () => {
    // Field mentah lama mengirim teks tempel apa adanya; server
    // mem-parse-nya ke Decimal yang sama seperti keluaran tempel
    // MoneyInput di bawah ini.
    expect(parseMoneyText("1.500.000")).toEqual({ ok: true, value: "1500000.0000" });
    expect(parseMoneyText("2.500,75")).toEqual({ ok: true, value: "2500.7500" });
    expect(d("2500.7500").eq(d("2500.75"))).toBe(true);
  });

  it("nilai tersimpan lama tampil terformat, bukan string kanonis mentah", () => {
    // Keluhan inti H-PGT-01: feeValue tersimpan "0.0000" dulu tampil
    // apa adanya di input number; kini tampil "0".
    expect(formatMoneyText("0.0000")).toBe("0");
    expect(formatMoneyText("1500000.0000")).toBe("1.500.000");
    expect(formatMoneyText("1250750.5000")).toBe("1.250.750,5");
  });
});

describe("paritas PercentInput — fee metode mode persen & residu aset", () => {
  it.each([
    ["fee QRIS lazim", "0,75", "0.75"],
    ["fee kartu", "2,9", "2.9"],
    ["residu bawaan kategori aset", "10", "10"],
    ["residu pecahan", "12,5", "12.5"],
  ])("%s: ketik %s → Decimal identik dengan mentah %s", (_ctx, typed, rawBefore) => {
    const canonical = typePercent(typed);
    expect(d(canonical).eq(d(rawBefore))).toBe(true);
    // Server membaca feeValue/residu lewat Number()/amountField —
    // keduanya menafsir string kanonis ke angka yang sama.
    expect(Number(canonical)).toBe(Number(rawBefore));
  });

  it("tempel nilai kanonis lama tetap terbaca utuh", () => {
    expect(parsePercentText("0.7500")).toEqual({ ok: true, value: "0.7500" });
    expect(formatPercentText("0.7500")).toBe("0,75");
  });
});

describe("SessionManager — modal awal sesi kini MoneyInput terformat", () => {
  it("render awal menampilkan 500.000 terformat (bukan 500000 mentah)", () => {
    const markup = renderToStaticMarkup(createElement(SessionManager, { session: null }));
    expect(markup).toContain("Buka sesi kas");
    expect(markup).toContain('value="500.000"');
    expect(markup).not.toContain('value="500000"');
    // Satu-satunya input nominal di panel buka sesi adalah
    // MoneyInput (inputMode desimal), bukan input numeric mentah.
    expect(markup).not.toContain('inputMode="numeric"');
    expect(markup).toContain('inputMode="decimal"');
  });
});
