import { useCallback, useEffect, useRef, useState } from "react";
import { newUuid } from "@/lib/uuid";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { holdAction, resumeHeldSaleAction } from "@/server/actions/pos";
import { useActionRunner } from "@/components/use-action-runner";
import type { CartItem, CustomerOption } from "@/components/pos/terminal-types";
import type { StoredCart } from "@/components/pos/use-cart-persistence";

// Data yang dikembalikan resumeHeldSaleAction untuk memulihkan konteks
// transaksi, termasuk pelanggan dan jatuh tempo penjualan kredit.
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
  customerId: string | null;
  customer: CustomerOption | null;
  dueDate: string | null;
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
  reservationId?: string | null;
  customerId?: string | null;
  dueDate?: string | null;
  warehouses: readonly { id: string }[];
  groups: readonly { id: string }[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setGroupId: Dispatch<SetStateAction<string>>;
  setSelectedWarehouse: Dispatch<SetStateAction<string>>;
  setReservationId?: Dispatch<SetStateAction<string | null>>;
  setHeldSaleId: Dispatch<SetStateAction<string | null>>;
  setHeldTotal: Dispatch<SetStateAction<number | null>>;
  setCustomer?: Dispatch<SetStateAction<CustomerOption | null>>;
  setDueDate?: Dispatch<SetStateAction<string>>;
  onHoldSuccess?: () => void;
  onResumeApplied?: () => void;
  resumeGuardRef: RefObject<boolean>;
  storedActiveRef: RefObject<StoredCart | null>;
  clearQuote: () => void;
}) {
  const {
    resumeId,
    cart,
    groupId,
    selectedWarehouse,
    reservationId,
    customerId,
    dueDate,
    warehouses,
    groups,
    setCart,
    setGroupId,
    setSelectedWarehouse,
    setReservationId,
    setHeldSaleId,
    setHeldTotal,
    setCustomer,
    setDueDate,
    onHoldSuccess,
    onResumeApplied,
    resumeGuardRef,
    storedActiveRef,
    clearQuote,
  } = params;
  const router = useRouter();
  const { run: runAction } = useActionRunner();
  const holdSubmissionRef = useRef(false);
  const holdAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const resumeHoldAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  // Satu resumeId hanya diproses sekali. Efek resume bergantung pada
  // callback yang identitasnya dapat berubah saat state pulih; tanpa
  // penjaga ini, toast "Pesanan ditahan dilanjutkan" bisa tercetak
  // berkali-kali (StrictMode + dependency loop).
  const resumeProcessedRef = useRef<string | null>(null);
  const activeContextRef = useRef({
    cart,
    groupId,
    selectedWarehouse,
    reservationId: reservationId ?? null,
    customerId: customerId ?? null,
    dueDate: dueDate ?? null,
  });
  useEffect(() => {
    activeContextRef.current = {
      cart,
      groupId,
      selectedWarehouse,
      reservationId: reservationId ?? null,
      customerId: customerId ?? null,
      dueDate: dueDate ?? null,
    };
  }, [cart, groupId, selectedWarehouse, reservationId, customerId, dueDate]);
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
      setCustomer?.(data.customer);
      setDueDate?.(data.dueDate ?? "");
      setReservationId?.(null);
      setHeldSaleId(resumeId);
      setHeldTotal(data.heldTotal);
      clearQuote();
      onResumeApplied?.();
      resumeGuardRef.current = false;
      storedActiveRef.current = null;
      setResumeOffer(null);
      toast.success("Pesanan ditahan dilanjutkan.", { id: `pos.resume.${resumeId}` });
      // Buang parameter ?resume agar refresh tidak memproses tahanan
      // yang sama untuk kedua kalinya.
      router.replace("/app/pos");
    },
    [
      resumeId,
      router,
      resumeGuardRef,
      setCart,
      setGroupId,
      setHeldSaleId,
      setHeldTotal,
      setSelectedWarehouse,
      storedActiveRef,
      setCustomer,
      setDueDate,
      setReservationId,
      clearQuote,
      onResumeApplied,
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
      setReservationId?.(stored.reservationId ?? null);
      setCustomer?.(stored.customer ?? null);
      if (stored.dueDate) setDueDate?.(stored.dueDate);
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
    setReservationId,
    storedActiveRef,
    setCustomer,
    setDueDate,
  ]);

  useEffect(() => {
    if (!resumeId) return;
    if (resumeProcessedRef.current === resumeId) return;
    let cancelled = false;
    void (async () => {
      // POS-ERR-01: kegagalan memuat tahanan tampil sebagai pesan, bukan
      // penolakan promise yang hilang.
      let result: Awaited<ReturnType<typeof resumeHeldSaleAction>>;
      try {
        result = await resumeHeldSaleAction(resumeId);
      } catch {
        if (cancelled) return;
        resumeProcessedRef.current = resumeId;
        toast.error("Gagal memuat pesanan ditahan. Periksa koneksi lalu coba lagi.");
        // POS2-02: kegagalan resume tidak boleh mengorbankan
        // keranjang aktif — pulihkan snapshot dan tinggalkan resume.
        restoreStoredActive();
        router.replace("/app/pos");
        return;
      }
      if (cancelled) return;
      if (!result.ok) {
        resumeProcessedRef.current = resumeId;
        toast.error(result.message);
        restoreStoredActive();
        router.replace("/app/pos");
        return;
      }
      // Efek dapat berjalan ulang selama request pertama masih terbang
      // (mis. StrictMode/dependency berubah). Hanya hasil pertama yang
      // boleh diterapkan.
      if (resumeProcessedRef.current === resumeId) return;
      resumeProcessedRef.current = resumeId;
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
    if (holdSubmissionRef.current) return;
    if (cart.length === 0) {
      toast.error("Keranjang masih kosong.");
      return;
    }
    if (reservationId) {
      toast.error("Selesaikan penjualan berreservasi terlebih dahulu. Reservasi tidak bisa dipindahkan ke pesanan tahan.");
      return;
    }
    const submittedContext = JSON.stringify({
      cart,
      groupId,
      selectedWarehouse,
      reservationId: reservationId ?? null,
      customerId: customerId ?? null,
      dueDate: dueDate ?? null,
    });
    const request = {
      warehouseId: selectedWarehouse,
      groupId: groupId || null,
      customerId: customerId ?? null,
      dueDate: dueDate ?? null,
      label: holdLabel.trim() || undefined,
      lines: cart.map((line) => ({
        productId: line.productId,
        packagingId: line.packagingId ?? null,
        qty: line.qty,
        discountType: line.discountType ?? null,
        discountValue: line.discountValue ?? 0,
        serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
      })),
    };
    const signature = JSON.stringify(request);
    const attempt =
      holdAttemptRef.current?.signature === signature
        ? holdAttemptRef.current
        : { signature, idempotencyKey: newUuid() };
    holdAttemptRef.current = attempt;
    holdSubmissionRef.current = true;
    try {
      const result = await runAction(holdAction({ ...request, idempotencyKey: attempt.idempotencyKey }));
      if (!result) {
        // Keep the key: a server action may have committed before a later
        // response/revalidation failure. The same payload must replay safely.
        return;
      }
      holdAttemptRef.current = null;
      const activeContextUnchanged =
        JSON.stringify(activeContextRef.current) === submittedContext;
      setHoldOpen(false);
      setHoldLabel("");
      if (activeContextUnchanged) {
        setCart([]);
        clearQuote();
        setHeldSaleId(null);
        setHeldTotal(null);
        onHoldSuccess?.();
        toast.success(`Pesanan ${result.number} ditahan.`);
      } else {
        // The request saved the submitted snapshot. Preserve edits made
        // while it was in flight instead of clearing a newer active cart.
        toast.success(`Pesanan ${result.number} ditahan; perubahan keranjang terbaru tetap dipertahankan.`);
      }
      router.refresh();
    } catch {
      // Preserve the same key for an ambiguous retry with this same payload.
      toast.error("Gagal menahan pesanan. Periksa koneksi lalu coba lagi.");
    } finally {
      holdSubmissionRef.current = false;
    }
  }

  // FIX-POS Tahap 4 (POS2-02): pilihan pertama dialog resume —
  // keranjang aktif ditahan sebagai pesanan BARU (label otomatis dari
  // nomor dokumen), barulah tahanan yang dipilih diterapkan. Bila
  // penahanan gagal, resume tidak jadi diterapkan dan dialog tetap
  // terbuka agar kasir dapat memilih jalan lain.
  async function resumeHoldActiveFirst() {
    if (!resumeOffer) return;
    if (holdSubmissionRef.current) return;
    if (resumeOffer.stored.reservationId) {
      toast.error("Keranjang aktif berreservasi tidak bisa dipindahkan ke pesanan tahan. Ganti keranjang atau batalkan proses lanjut.");
      return;
    }
    const request = {
      warehouseId: resumeOffer.stored.warehouseId,
      groupId: resumeOffer.stored.groupId || null,
      customerId: resumeOffer.stored.customer?.id ?? null,
      dueDate: resumeOffer.stored.dueDate ?? null,
      lines: resumeOffer.stored.cart.map((line) => ({
        productId: line.productId,
        packagingId: line.packagingId ?? null,
        qty: line.qty,
        discountType: line.discountType ?? null,
        discountValue: line.discountValue ?? 0,
        serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
      })),
    };
    const signature = JSON.stringify(request);
    const attempt =
      resumeHoldAttemptRef.current?.signature === signature
        ? resumeHoldAttemptRef.current
        : { signature, idempotencyKey: newUuid() };
    resumeHoldAttemptRef.current = attempt;
    holdSubmissionRef.current = true;
    setResumeHolding(true);
    try {
      const result = await runAction(holdAction({ ...request, idempotencyKey: attempt.idempotencyKey }));
      if (!result) return;
      resumeHoldAttemptRef.current = null;
      toast.success(`Keranjang aktif ditahan sebagai pesanan ${result.number}.`);
      applyResume(resumeOffer.data);
      router.refresh();
    } catch {
      toast.error("Gagal menahan keranjang aktif. Periksa koneksi lalu coba lagi.");
    } finally {
      setResumeHolding(false);
      holdSubmissionRef.current = false;
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
