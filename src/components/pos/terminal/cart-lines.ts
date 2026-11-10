import {
  cartLineKey,
  type CartItem,
} from "@/components/pos/terminal-types";

/**
 * Operasi murni atas baris keranjang terminal (S4 memecah ini dari
 * pos-terminal.tsx demi ratchet ukuran berkas A-26 — perilaku sama,
 * hanya pindah rumah). Identitas baris adalah (produk, kemasan):
 * sejak S4 satu produk dapat hidup sebagai dua baris sekaligus
 * (mis. 1 Dus + 3 Pcs), jadi semua penyunting berkunci cartLineKey,
 * bukan productId.
 */

export function addCartLine(
  current: CartItem[],
  productId: string,
  packagingId: string | null,
): CartItem[] {
  const existing = current.find(
    (line) => line.productId === productId && (line.packagingId ?? null) === packagingId,
  );
  if (existing) {
    return current.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line));
  }
  return [...current, { productId, qty: 1, packagingId }];
}

export function setCartLineQty(current: CartItem[], key: string, qty: number): CartItem[] {
  if (qty <= 0) return current.filter((line) => cartLineKey(line) !== key);
  return current.map((line) => (cartLineKey(line) === key ? { ...line, qty } : line));
}

export function setCartLineSerial(
  current: CartItem[],
  key: string,
  index: number,
  value: string,
): CartItem[] {
  return current.map((line) => {
    if (cartLineKey(line) !== key) return line;
    const next = [...(line.serialNumbers ?? [])];
    next[index] = value;
    return { ...line, serialNumbers: next };
  });
}

export function setCartLineDiscount(
  current: CartItem[],
  key: string,
  type: "percent" | "nominal" | null,
  value: number,
): CartItem[] {
  return current.map((line) =>
    cartLineKey(line) === key
      ? { ...line, discountType: type, discountValue: type ? value : 0 }
      : line,
  );
}

/**
 * Ganti satuan baris (Pcs ↔ kemasan aktif produk). Qty direset ke 1
 * satuan baru — mempertahankan angka lama akan mengubah makna baris
 * secara senyap (40 Pcs menjadi 40 Dus). Bila baris tujuan sudah
 * ada, qty digabung ke sana dan baris asal hilang.
 */
export function changeCartLinePackaging(
  current: CartItem[],
  key: string,
  packagingId: string | null,
): CartItem[] {
  const source = current.find((line) => cartLineKey(line) === key);
  if (!source || (source.packagingId ?? null) === packagingId) return current;
  const targetKey = cartLineKey({ productId: source.productId, packagingId });
  const target = current.find((line) => cartLineKey(line) === targetKey);
  if (target) {
    return current
      .filter((line) => line !== source)
      .map((line) => (line === target ? { ...line, qty: line.qty + 1 } : line));
  }
  return current.map((line) =>
    line === source ? { ...line, packagingId, qty: 1, serialNumbers: undefined } : line,
  );
}
