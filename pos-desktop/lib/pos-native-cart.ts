/** Model keranjang terminal native — murni, tanpa React/Tauri. */

import type { LocalPackaging, LocalProduct, ServerSaleAction } from "./pos-bridge";

export type CartReservation = {
  id: string;
  number: string;
  productId: string;
  qty: string;
  expiresAt: string | null;
  reason: string | null;
};

/** Reservasi yang relevan dengan produk di keranjang saat ini. */
export function filterReservationsForCart(
  reservations: CartReservation[],
  cart: CartLine[],
): CartReservation[] {
  const productIds = new Set(cart.map((line) => line.product.productId));
  return reservations.filter((reservation) => productIds.has(reservation.productId));
}

export type CartLine = {
  product: LocalProduct;
  packaging: LocalPackaging | null;
  qty: number;
  serialNumbers?: string[];
  discountType?: "percent" | "nominal" | null;
  discountValue?: number;
};

export type MixedPaymentEntry = {
  key: string;
  methodId: string;
  amount: string;
  tendered: string;
  reference: string;
  fee?: string;
};

export type HeldCartPayload = {
  cart: CartLine[];
  groupId?: string | null;
  serverHeldSaleId?: string | null;
  pendingServerHold?: Extract<ServerSaleAction, { action: "hold" }>;
  heldTotal?: string;
  selectedCustomerId: string;
  customerQuery: string;
  dueDate: string;
  methodId: string;
  paymentReference: string;
  paymentFee?: string;
  splitPayment: boolean;
  mixedPayments: MixedPaymentEntry[];
  cashTendered: string;
};

export function restoreHeldCart(payload: Record<string, unknown>): CartLine[] | null {
  if (!Array.isArray(payload.cart) || payload.cart.length === 0 || payload.cart.length > 200) return null;
  const valid = payload.cart.every((value) => {
    if (!value || typeof value !== "object") return false;
    const line = value as Record<string, unknown>;
    const product = line.product;
    if (!product || typeof product !== "object") return false;
    const row = product as Record<string, unknown>;
    const qty = line.qty;
    const salePrice = Number(row.salePrice);
    return (
      typeof qty === "number" && Number.isFinite(qty) && qty > 0 &&
      typeof row.productId === "string" && typeof row.name === "string" &&
      Number.isFinite(salePrice) && salePrice >= 0 &&
      (line.packaging == null || typeof line.packaging === "object") &&
      (line.serialNumbers == null || (Array.isArray(line.serialNumbers) && line.serialNumbers.every((value) => typeof value === "string"))) &&
      (line.discountType == null || line.discountType === "percent" || line.discountType === "nominal") &&
      (line.discountValue == null || (typeof line.discountValue === "number" && Number.isFinite(line.discountValue)))
    );
  });
  return valid ? payload.cart as CartLine[] : null;
}

export function lineKey(line: CartLine): string {
  return `${line.product.productId}::${line.packaging?.packagingId ?? "base"}`;
}

/** Harga yang dibebankan PER SATUAN BARIS: per kemasan untuk baris
 *  berkemasan (harga kemasan independen; belum diatur → harga
 *  satuan dasar × isi, cermin quote lokal web), harga satuan
 *  dasar untuk baris biasa. */
export function lineUnitPrice(line: CartLine): number {
  if (!line.packaging) return Number(line.product.salePrice);
  if (line.packaging.salePrice != null) return Number(line.packaging.salePrice);
  return Number(line.product.salePrice) * Number(line.packaging.isi);
}

export function lineTotal(line: CartLine): number {
  const gross = lineUnitPrice(line) * line.qty;
  const discount = !line.discountType
    ? 0
    : line.discountType === "percent"
      ? gross * Number(line.discountValue ?? 0) / 100
      : lineBaseQty(line) * Number(line.discountValue ?? 0);
  return Math.max(0, gross - discount);
}

/** Kuantitas satuan dasar baris (qty input × isi cuplikan). */
export function lineBaseQty(line: CartLine): number {
  return line.qty * (line.packaging ? Number(line.packaging.isi) : 1);
}
