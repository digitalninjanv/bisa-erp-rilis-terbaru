import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalPaymentMethod } from "../../pos-desktop/lib/pos-bridge";
import {
  canSubmitCheckout,
  createDebounced,
  isCashLikeMethod,
  isQrisMethod,
  requiresReceiptConfirmation,
} from "../../pos-desktop/lib/pos-native-checkout";

afterEach(() => { vi.useRealTimers(); });

function method(overrides: Partial<LocalPaymentMethod> = {}): LocalPaymentMethod {
  return {
    methodId: "pm-1",
    code: "QRIS",
    name: "QRIS",
    type: "qr",
    feeEnabled: false,
    feeType: "none",
    feeValue: "0",
    ...overrides,
  };
}

describe("gate pembayaran native", () => {
  it("mengenali metode QRIS untuk menampilkan gambar pembayaran", () => {
    expect(isQrisMethod(method({ code: "QRIS", type: "qr", name: "QRIS All Payment" }))).toBe(true);
    expect(isQrisMethod(method({ code: "QR", type: "qris", name: "QRIS" }))).toBe(true);
    expect(isQrisMethod(method({ code: "CASH", type: "cash", name: "Tunai" }))).toBe(false);
    expect(isQrisMethod(method({ code: "TF", type: "transfer", name: "Transfer" }))).toBe(false);
    expect(isQrisMethod(undefined)).toBe(false);
  });

  it("mengenali metode tunai dari kode, tipe, atau nama", () => {
    expect(isCashLikeMethod(method({ code: "CASH", type: "cash", name: "Tunai" }))).toBe(true);
    expect(isCashLikeMethod(method({ code: "TUNAI", type: "cash", name: "Kas" }))).toBe(true);
    expect(isCashLikeMethod(method({ code: "QRIS", type: "qr", name: "QRIS" }))).toBe(false);
    expect(isCashLikeMethod(undefined)).toBe(false);
  });

  it("mewajibkan konfirmasi dana diterima hanya untuk non-tunai non-kredit", () => {
    expect(requiresReceiptConfirmation(method({ code: "QRIS", type: "qr" }))).toBe(true);
    expect(requiresReceiptConfirmation(method({ code: "TF", type: "transfer" }))).toBe(true);
    expect(requiresReceiptConfirmation(method({ code: "CASH", type: "cash" }))).toBe(false);
    expect(requiresReceiptConfirmation(method({ code: "UTANG", type: "credit" }))).toBe(false);
    expect(requiresReceiptConfirmation(method({ code: "KRETUR", type: "customer_credit" }))).toBe(false);
    expect(requiresReceiptConfirmation(undefined)).toBe(false);
  });

  it("tombol bayar tetap aktif untuk tunai tanpa konfirmasi", () => {
    expect(canSubmitCheckout({
      cartCount: 2, sessionOpen: true, methodSelected: true, busy: false,
      needsConfirmation: false, confirmed: false,
    })).toBe(true);
  });

  it("tombol bayar terblokir untuk non-tunai sampai dikonfirmasi", () => {
    expect(canSubmitCheckout({
      cartCount: 2, sessionOpen: true, methodSelected: true, busy: false,
      needsConfirmation: true, confirmed: false,
    })).toBe(false);
    expect(canSubmitCheckout({
      cartCount: 2, sessionOpen: true, methodSelected: true, busy: false,
      needsConfirmation: true, confirmed: true,
    })).toBe(true);
  });

  it("tetap memblokir saat keranjang kosong, sesi tutup, atau sedang memproses", () => {
    const base = { cartCount: 2, sessionOpen: true, methodSelected: true, busy: false, needsConfirmation: false, confirmed: false };
    expect(canSubmitCheckout({ ...base, cartCount: 0 })).toBe(false);
    expect(canSubmitCheckout({ ...base, sessionOpen: false })).toBe(false);
    expect(canSubmitCheckout({ ...base, busy: true })).toBe(false);
    expect(canSubmitCheckout({ ...base, methodSelected: false })).toBe(false);
  });
});

describe("throttle event mesin", () => {
  it("menggabungkan beberapa event menjadi satu eksekusi dengan argumen terakhir", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebounced(fn, 150);
    debounced("a");
    debounced("b");
    debounced("c");
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("cancel mencegah eksekusi yang tertunda", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebounced(fn, 150);
    debounced("x");
    debounced.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
