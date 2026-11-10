import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CartItem } from "@/components/pos/terminal-types";

// D-10 butir 3 — persistensi keranjang ke localStorage.
//
// Ini HANYA pemulihan keranjang dari reload/crash browser, BUKAN mode
// offline: tidak ada penjualan yang bisa diselesaikan dari salinan lokal
// ini. Harga, stok, jurnal, dan kunci idempotensi tetap selalu dihitung
// dan ditegakkan server saat checkout; tanpa koneksi ke server checkout
// tetap tidak dapat dilakukan. Snapshot diabaikan dengan aman bila JSON
// rusak, bentuk baris tidak sah, atau gudang tersimpan sudah tidak ada.
// T3R-5: snapshot dibedakan per perusahaan + pengguna. Satu browser
// sering dipakai bergantian oleh beberapa kasir; kunci global membuat
// kasir kedua memulihkan keranjang (dan heldSaleId) kasir pertama.
// Snapshot lama berkunci global TIDAK dimigrasi — isinya bisa milik
// kasir/perusahaan lain — melainkan dihapus saat kunci baru pertama
// kali dipakai (lihat efek pulih di komponen).
const LEGACY_CART_STORAGE_KEY = "bisa.pos.cart";

export function cartStorageKey(companyId: string, userId: string): string {
  return `bisa.pos.cart.${companyId}.${userId}`;
}

export type StoredCart = {
  cart: CartItem[];
  groupId: string;
  warehouseId: string;
  heldSaleId: string | null;
  heldTotal: number | null;
};

function readStoredCart(storageKey: string): StoredCart | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCart>;
    if (!Array.isArray(parsed.cart)) return null;
    const cart: CartItem[] = [];
    for (const line of parsed.cart) {
      if (!line || typeof line.productId !== "string") continue;
      if (typeof line.qty !== "number" || !Number.isFinite(line.qty) || line.qty <= 0) continue;
      cart.push({
        productId: line.productId,
        // S4: kemasan baris ikut dipulihkan; snapshot lama tanpa
        // kolom ini terbaca sebagai baris satuan dasar.
        packagingId: typeof line.packagingId === "string" ? line.packagingId : null,
        qty: line.qty,
        discountType:
          line.discountType === "percent" || line.discountType === "nominal"
            ? line.discountType
            : null,
        discountValue: typeof line.discountValue === "number" ? line.discountValue : undefined,
        serialNumbers: Array.isArray(line.serialNumbers)
          ? line.serialNumbers.filter((value): value is string => typeof value === "string")
          : undefined,
      });
    }
    if (cart.length === 0) return null;
    return {
      cart,
      groupId: typeof parsed.groupId === "string" ? parsed.groupId : "",
      warehouseId: typeof parsed.warehouseId === "string" ? parsed.warehouseId : "",
      heldSaleId: typeof parsed.heldSaleId === "string" ? parsed.heldSaleId : null,
      heldTotal: typeof parsed.heldTotal === "number" ? parsed.heldTotal : null,
    };
  } catch {
    // JSON rusak atau localStorage tidak tersedia — mulai dari kosong.
    return null;
  }
}

export function clearStoredCart(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // localStorage tidak tersedia; tidak ada yang perlu dibersihkan.
  }
}

// FIX-ARS Tahap 5 (ARS2-01): hook persistensi keranjang — efek pulih &
// simpan snapshot localStorage beserta gerbang dan ref jaga resume,
// diekstrak apa adanya dari PosTerminal (urutan efek dipertahankan:
// pulih selalu terdaftar sebelum simpan).
export function useCartPersistence(params: {
  storageKey: string;
  resumeId: string | null;
  warehouses: readonly { id: string }[];
  groups: readonly { id: string }[];
  cart: CartItem[];
  groupId: string;
  selectedWarehouse: string;
  heldSaleId: string | null;
  heldTotal: number | null;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setGroupId: Dispatch<SetStateAction<string>>;
  setSelectedWarehouse: Dispatch<SetStateAction<string>>;
  setHeldSaleId: Dispatch<SetStateAction<string | null>>;
  setHeldTotal: Dispatch<SetStateAction<number | null>>;
}) {
  const {
    storageKey,
    resumeId,
    warehouses,
    groups,
    cart,
    groupId,
    selectedWarehouse,
    heldSaleId,
    heldTotal,
    setCart,
    setGroupId,
    setSelectedWarehouse,
    setHeldSaleId,
    setHeldTotal,
  } = params;
  const resumeGuardRef = useRef(Boolean(resumeId));
  const storedActiveRef = useRef<StoredCart | null>(null);
  // D-10: gerbang persistensi keranjang — efek simpan tidak berjalan
  // sebelum efek pulih selesai membaca snapshot (agar keadaan awal yang
  // kosong tidak menimpa snapshot yang belum sempat dipulihkan).
  const [cartLoaded, setCartLoaded] = useState(false);

  // D-10: pulihkan keranjang tersimpan sekali saat terminal dimuat.
  // Snapshot hanya dipakai bila gudang tersimpan masih ada di daftar
  // gudang perusahaan; bila tidak, snapshot dibuang dengan aman.
  // Kelompok yang sudah tidak ada turun kembali ke harga normal.
  // Berbentuk IIFE async seperti efek resume di bawah: localStorage
  // adalah sistem eksternal dan penerapannya memang asynchronous.
  // POS2-02: pada jalur resume, snapshot TIDAK langsung diterapkan —
  // ia disimpan sebagai bukti keranjang aktif (storedActiveRef) agar
  // efek resume dapat meminta keputusan kasir sebelum menimpanya.
  useEffect(() => {
    if (cartLoaded) return;
    void (async () => {
      // T3R-5: snapshot lama berkunci global dihapus saat kunci
      // per-pengguna pertama kali dipakai — diabaikan, bukan dimigrasi,
      // karena pemiliknya tidak dapat dipastikan.
      try {
        window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
      } catch {
        // localStorage tidak tersedia; tidak ada yang perlu dibersihkan.
      }
      const stored = readStoredCart(storageKey);
      if (stored) {
        if (warehouses.some((warehouse) => warehouse.id === stored.warehouseId)) {
          if (resumeId) {
            storedActiveRef.current = stored;
          } else {
            setSelectedWarehouse(stored.warehouseId);
            setCart(stored.cart);
            setGroupId(
              groups.some((group) => group.id === stored.groupId) ? stored.groupId : "",
            );
            setHeldSaleId(stored.heldSaleId);
            setHeldTotal(stored.heldTotal);
          }
        } else {
          clearStoredCart(storageKey);
        }
      }
      setCartLoaded(true);
    })();
  }, [cartLoaded, resumeId, warehouses, groups, storageKey]);

  // D-10: simpan keranjang pada setiap perubahan. Keranjang kosong
  // tanpa tahanan yang dilanjutkan berarti tidak ada yang perlu
  // dipulihkan — snapshot dihapus (inilah yang membersihkan storage
  // sesudah checkout/hold berhasil, karena keduanya mengosongkan
  // keranjang dan heldSaleId).
  useEffect(() => {
    if (!cartLoaded) return;
    // POS2-02: selama resume belum diputuskan, snapshot adalah
    // satu-satunya salinan keranjang aktif — jangan hapus/timpa.
    if (resumeGuardRef.current) return;
    try {
      if (cart.length === 0 && !heldSaleId) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      const snapshot: StoredCart = {
        cart,
        groupId,
        warehouseId: selectedWarehouse,
        heldSaleId,
        heldTotal,
      };
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // localStorage tidak tersedia (mode privat); keranjang tetap
      // berfungsi dari memori selama halaman terbuka.
    }
  }, [cartLoaded, cart, groupId, selectedWarehouse, heldSaleId, heldTotal, storageKey]);

  return { cartLoaded, resumeGuardRef, storedActiveRef };
}
