import { useCallback, useEffect, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { holdAction, resumeHeldSaleAction } from "@/server/actions/pos";
import type { CartItem } from "@/components/pos/terminal-types";
import { requireFilled } from "@/components/use-action-runner";
import type { StoredCart } from "@/components/pos/use-cart-persistence";

// FIX-POS Tahap 4 (POS2-02): bentuk data resumeHeldSaleAction yang
// relevan untuk terminal (aksi juga mengembalikan customerId yang
// tidak dipakai ulang di sini).
export type ResumeData = {
  lines: {
    productId: string;
    qty: string;
    /** S4: kemasan baris asal tahanan (qty sudah bentuk masukannya). */
    packagingId?: string | null;
    discountType: string | null;
    discountValue: string;
  }[];
  warehouseId: string | null;
  customerGroupId: string | null;
  heldTotal: number;
};

// FIX-ARS Tahap 5 (ARS2-01): hook pesanan ditahan & resume — tahan,
// muat tahanan, keputusan resume berdialog, dan pemulihan keranjang
// aktif; diekstrak apa adanya dari PosTerminal. Ref jaga resume &
// snapshot aktif dimiliki useCartPersistence dan diteruskan ke sini.
export function useHeldSales(params: {
  resumeId: string | null;
  cart: CartItem[];
  groupId: string;
  selectedWarehouse: string;
  warehouses: readonly { id: string }[];
  groups: readonly { id: string }[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setGroupId: Dispatch<SetStateAction<string>>;
  setSelectedWarehouse: Dispatch<SetStateAction<string>>;
  setHeldSaleId: Dispatch<SetStateAction<string | null>>;
  setHeldTotal: Dispatch<SetStateAction<number | null>>;
  resumeGuardRef: RefObject<boolean>;
  storedActiveRef: RefObject<StoredCart | null>;
  clearQuote: () => void;
}) {
  const {
    resumeId,
    cart,
    groupId,
    selectedWarehouse,
    warehouses,
    groups,
    setCart,
    setGroupId,
    setSelectedWarehouse,
    setHeldSaleId,
    setHeldTotal,
    resumeGuardRef,
    storedActiveRef,
    clearQuote,
  } = params;
  const router = useRouter();
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState("");
  // FIX-POS Tahap 4 (POS2-02): tawaran resume yang menunggu keputusan
  // kasir karena snapshot lokal membuktikan ada keranjang aktif yang
  // akan tertimpa. Selama keputusan belum diambil, efek simpan
  // DILARANG menyentuh snapshot (resumeGuardRef) — di situlah satu-
  // satunya salinan keranjang aktif berada.
  const [resumeOffer, setResumeOffer] = useState<{
    data: ResumeData;
    stored: StoredCart;
  } | null>(null);
  const [resumeHolding, setResumeHolding] = useState(false);

  // FIX-POS Tahap 4 (POS2-02): terapkan data tahanan ke terminal dan
  // akhiri mode jaga resume — snapshot lokal kembali boleh ditulis
  // (isinya kini keranjang hasil resume).
  const applyResume = useCallback(
    (data: ResumeData) => {
      setCart(
        data.lines.map((line) => ({
          productId: line.productId,
          // S4: satuan baris tahanan dipulihkan bersama bentuk
          // masukannya (qty dari aksi resume sudah qty_input).
          packagingId: line.packagingId ?? null,
          qty: Number(line.qty),
          discountType: (line.discountType as "percent" | "nominal" | null) ?? null,
          discountValue: Number(line.discountValue),
        })),
      );
      if (data.warehouseId) setSelectedWarehouse(data.warehouseId);
      // Kelompok harga pesanan dipulihkan agar checkout memakai harga
      // yang sama dengan saat pesanan ditahan (POS-HOLD-01).
      setGroupId(data.customerGroupId ?? "");
      setHeldSaleId(resumeId);
      setHeldTotal(data.heldTotal);
      resumeGuardRef.current = false;
      storedActiveRef.current = null;
      setResumeOffer(null);
      toast.success("Pesanan ditahan dilanjutkan.");
    },
    [
      resumeId,
      resumeGuardRef,
      setCart,
      setGroupId,
      setHeldSaleId,
      setHeldTotal,
      setSelectedWarehouse,
      storedActiveRef,
    ],
  );

  // POS2-02: batal/gagal resume — keranjang aktif dari snapshot
  // dipulihkan persis seperti pemuatan biasa; tidak ada yang hilang.
  const restoreStoredActive = useCallback(() => {
    const stored = storedActiveRef.current;
    resumeGuardRef.current = false;
    storedActiveRef.current = null;
    setResumeOffer(null);
    if (stored && warehouses.some((warehouse) => warehouse.id === stored.warehouseId)) {
      setSelectedWarehouse(stored.warehouseId);
      setCart(stored.cart);
      setGroupId(groups.some((group) => group.id === stored.groupId) ? stored.groupId : "");
      setHeldSaleId(stored.heldSaleId);
      setHeldTotal(stored.heldTotal);
    }
  }, [
    warehouses,
    groups,
    resumeGuardRef,
    setCart,
    setGroupId,
    setHeldSaleId,
    setHeldTotal,
    setSelectedWarehouse,
    storedActiveRef,
  ]);

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    void (async () => {
      // POS-ERR-01: kegagalan memuat tahanan tampil sebagai pesan, bukan
      // penolakan promise yang hilang.
      let result: Awaited<ReturnType<typeof resumeHeldSaleAction>>;
      try {
        result = await resumeHeldSaleAction(resumeId);
      } catch {
        if (cancelled) return;
        toast.error("Gagal memuat pesanan ditahan. Periksa koneksi lalu coba lagi.");
        // POS2-02: kegagalan resume tidak boleh mengorbankan
        // keranjang aktif — pulihkan snapshot dan tinggalkan resume.
        restoreStoredActive();
        router.replace("/app/pos");
        return;
      }
      if (cancelled) return;
      if (!result.ok) {
        toast.error(result.message);
        restoreStoredActive();
        router.replace("/app/pos");
        return;
      }
      // POS2-02: keranjang aktif (snapshot) yang tidak kosong dan
      // bukan tahanan yang sama → kasir memutuskan lebih dulu; tanpa
      // keranjang aktif, resume berjalan langsung seperti sebelumnya.
      const stored = storedActiveRef.current;
      if (stored && stored.cart.length > 0 && stored.heldSaleId !== resumeId) {
        setResumeOffer({ data: result.data, stored });
        return;
      }
      applyResume(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeId, applyResume, restoreStoredActive, router, storedActiveRef]);

  async function hold() {
    if (cart.length === 0) {
      toast.error("Keranjang masih kosong.");
      return;
    }
    // G2 (FRM-05): validasi wajib-isi kini helper bersama.
    if (!requireFilled(holdLabel, "Nama pesanan wajib diisi.")) {
      return;
    }
    // POS-ERR-01: kegagalan jaringan saat menahan pesanan tampil sebagai
    // pesan, bukan penolakan promise yang hilang.
    let result: Awaited<ReturnType<typeof holdAction>>;
    try {
      result = await holdAction({
        warehouseId: selectedWarehouse,
        groupId: groupId || null,
        idempotencyKey: crypto.randomUUID(),
        label: holdLabel,
        lines: cart.map((line) => ({
          productId: line.productId,
          packagingId: line.packagingId ?? null,
          qty: line.qty,
          discountType: line.discountType ?? null,
          discountValue: line.discountValue ?? 0,
          serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
        })),
      });
    } catch {
      toast.error("Gagal menahan pesanan. Periksa koneksi lalu coba lagi.");
      return;
    }
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pesanan "${holdLabel}" ditahan.`);
    setHoldOpen(false);
    setHoldLabel("");
    setCart([]);
    clearQuote();
    setHeldSaleId(null);
    setHeldTotal(null);
    router.refresh();
  }

  // FIX-POS Tahap 4 (POS2-02): pilihan pertama dialog resume —
  // keranjang aktif ditahan sebagai pesanan BARU (label otomatis
  // bertanda waktu), barulah tahanan yang dipilih diterapkan. Bila
  // penahanan gagal, resume tidak jadi diterapkan dan dialog tetap
  // terbuka agar kasir dapat memilih jalan lain.
  async function resumeHoldActiveFirst() {
    if (!resumeOffer) return;
    setResumeHolding(true);
    try {
      const result = await holdAction({
        warehouseId: resumeOffer.stored.warehouseId,
        groupId: resumeOffer.stored.groupId || null,
        idempotencyKey: crypto.randomUUID(),
        label: `Otomatis ${new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        lines: resumeOffer.stored.cart.map((line) => ({
          productId: line.productId,
          packagingId: line.packagingId ?? null,
          qty: line.qty,
          discountType: line.discountType ?? null,
          discountValue: line.discountValue ?? 0,
          serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
        })),
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Keranjang aktif ditahan sebagai pesanan baru.");
      applyResume(resumeOffer.data);
      router.refresh();
    } catch {
      toast.error("Gagal menahan keranjang aktif. Periksa koneksi lalu coba lagi.");
    } finally {
      setResumeHolding(false);
    }
  }

  function resumeCancel() {
    restoreStoredActive();
    router.replace("/app/pos");
  }

  return {
    holdOpen,
    setHoldOpen,
    holdLabel,
    setHoldLabel,
    resumeOffer,
    resumeHolding,
    hold,
    applyResume,
    resumeHoldActiveFirst,
    resumeCancel,
  };
}
