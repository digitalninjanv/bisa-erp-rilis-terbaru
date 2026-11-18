import type { LocalPaymentMethod } from "./pos-bridge";

/**
 * Aturan gate pembayaran terminal native (murni, tanpa Tauri).
 *
 * Kasir tidak boleh menekan Bayar untuk pembayaran non-tunai sebelum
 * menyatakan dana benar-benar diterima — patroli ini sejajar dengan
 * terminal web dan dengan praktik Odoo/Accurate. Tunai tidak perlu
 * konfirmasi tambahan karena kembalian dihitung langsung di layar.
 */

export function isCashLikeMethod(method: LocalPaymentMethod | undefined): boolean {
  return /cash|tunai/i.test(`${method?.code ?? ""} ${method?.type ?? ""} ${method?.name ?? ""}`);
}

/** Metode QRIS dikenali dari kode/tipe/nama agar gambar QR dapat ditampilkan. */
export function isQrisMethod(method: LocalPaymentMethod | undefined): boolean {
  return /qris|(^|[-_ ])qr($|[-_ ])/i.test(
    `${method?.code ?? ""} ${method?.type ?? ""} ${method?.name ?? ""}`,
  );
}

export function requiresReceiptConfirmation(method: LocalPaymentMethod | undefined): boolean {
  if (!method || isCashLikeMethod(method)) return false;
  if (method.type === "credit" || method.type === "customer_credit") return false;
  return true;
}

export type CheckoutGateInput = {
  cartCount: number;
  sessionOpen: boolean;
  methodSelected: boolean;
  busy: boolean;
  needsConfirmation: boolean;
  confirmed: boolean;
};

export function canSubmitCheckout(input: CheckoutGateInput): boolean {
  if (input.busy || input.cartCount === 0 || !input.sessionOpen || !input.methodSelected) return false;
  if (input.needsConfirmation && !input.confirmed) return false;
  return true;
}

/**
 * Debounce untuk coalesce event mesin Rust yang datang beruntun
 * (mis. beberapa `passFinished` berturut-turut). Pemanggilan baru
 * menjadwalkan ulang eksekusi dengan argumen terakhir.
 */
export function createDebounced<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const debounced = (...args: A) => {
    pending = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const argsToRun = pending;
      pending = null;
      if (argsToRun) fn(...argsToRun);
    }, delayMs);
  };
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return debounced;
}
