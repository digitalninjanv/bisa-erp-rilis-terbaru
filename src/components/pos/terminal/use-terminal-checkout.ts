/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — hook checkout terminal
 * (antrean offline + pengiriman penjualan, kunci idempotensi
 * dibagi dengan komponen induk). Badan fungsi identik asal.
 */
"use client";

import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { newUuid } from "@/lib/uuid";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { checkoutAction } from "@/server/actions/pos";
import { formatIDR } from "@/lib/money";
import { clearCheckoutAttempt, readCheckoutAttempt, storeCheckoutAttempt, type CheckoutAttempt } from "@/lib/pos/checkout-attempt";
import { isDefinitiveCheckoutError, isHeldSaleUnavailableMessage } from "@/lib/pos/checkout-recovery";
import { todayISO } from "@/lib/format";
import { receiptHref } from "@/lib/pos/receipt-links";
import { cashTenderError } from "@/lib/pos/payment-plan";
import { buildTerminalReceiptData } from "@/lib/pos/build-receipt-data";
import type { CompletedSaleInfo } from "./checkout-success-modal";
import type { ReceiptData } from "@/lib/escpos/types";
import {
  enqueueOfflineSale,
  getBrowserOfflineStorage,
  getOfflineQueueSummary,
  getOrCreateDeviceId,
  type OfflineSalePayload,
  type OfflineSalePayment,
} from "@/lib/pos-offline";
import type { QuoteResultPublic } from "@/server/pos";
import { clearStoredCart } from "@/components/pos/use-cart-persistence";
import type { useQuote } from "@/components/pos/use-quote";
import type { ReturnCreditApi } from "@/components/pos/use-return-credit";
import type {
  CartItem,
  CustomerOption,
  Method,
  PaymentEntry,
  ProductOption,
  ReceiptProfile,
} from "@/components/pos/terminal-types";

function toLocalISODate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Bawaan jatuh tempo penjualan utang: hari ini + termin bawaan piutang
 * perusahaan (FIX-P1 Tahap 5/AK3-07 — sebelumnya +7 hari hardcoded;
 * bawaan pengaturannya tetap 7 agar perilaku lama tidak berubah).
 */
export function defaultDueDate(termDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + termDays);
  return toLocalISODate(date);
}

export function useTerminalCheckout(params: {
  cart: CartItem[];
  cartSignature: string;
  cartLoaded: boolean;
  sessionOpen: boolean;
  mode: "single" | "mixed";
  singleMethod: string;
  single: Method | undefined;
  cashTendered: number;
  entries: Record<string, PaymentEntry>;
  methodById: Map<string, Method>;
  outstanding: number;
  debtActive: boolean;
  debtAmount: number;
  customer: CustomerOption | null;
  dueDate: string;
  total: number;
  quote: QuoteResultPublic | null;
  cache: Record<string, ProductOption>;
  posOfflineEnabled: boolean;
  reservationId: string | null;
  selectedWarehouse: string;
  groupId: string | null;
  storageKey: string;
  sessionId: string | null;
  userId: string;
  companyId: string;
  receiptProfile: ReceiptProfile;
  receivableDefaultTermDays: number;
  appliedCredit: PaymentEntry | undefined;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setCustomer: Dispatch<SetStateAction<CustomerOption | null>>;
  setCustomerQuery: Dispatch<SetStateAction<string>>;
  setCustomerResults: Dispatch<SetStateAction<CustomerOption[]>>;
  setDueDate: Dispatch<SetStateAction<string>>;
  resetCredit: ReturnCreditApi["resetCredit"];
  /** Reset input pembayaran + konfirmasi non-tunai setelah transaksi selesai. */
  resetPaymentInputs: () => void;
  setGroupId: Dispatch<SetStateAction<string>>;
  setQuoteResult: ReturnType<typeof useQuote>["setQuoteResult"];
  heldSaleId: string | null;
  setHeldSaleId: Dispatch<SetStateAction<string | null>>;
  setHeldTotal: Dispatch<SetStateAction<number | null>>;
  setLastSale: Dispatch<SetStateAction<CompletedSaleInfo | null>>;
  setReservationId: Dispatch<SetStateAction<string | null>>;
  setQueuedCount: Dispatch<SetStateAction<number>>;
  setOldestQueuedAt: Dispatch<SetStateAction<string | null>>;
  idempotencyKeyRef: RefObject<string>;
  checkoutAttemptedRef: RefObject<boolean>;
  inFlightRef: RefObject<boolean>;
  /** A-28 UI-1 (UX-B01): dipanggil sesudah penjualan terantre offline
   *  (terminal tidak berpindah halaman) agar induk mengembalikan
   *  fokus ke kotak cari. */
  onSaleQueued?: () => void;
  /** Callback setelah penjualan tersimpan di server atau di antrean lokal agar kasir tetap berada di terminal (tanpa redirect halaman). */
  onCheckoutSuccess?: (sale: CompletedSaleInfo) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<CheckoutAttempt | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const { cart, sessionOpen, mode, singleMethod, single, cashTendered, entries, methodById, outstanding, debtActive, customer, dueDate, total, quote, cache, posOfflineEnabled, reservationId, selectedWarehouse, groupId, storageKey, sessionId, userId, companyId, receiptProfile, receivableDefaultTermDays, appliedCredit, setCart, setCustomer, setCustomerQuery, setCustomerResults, setDueDate, resetCredit, resetPaymentInputs, setGroupId, setQuoteResult, heldSaleId, setHeldSaleId, setHeldTotal, setLastSale, setReservationId, setQueuedCount, setOldestQueuedAt, idempotencyKeyRef, checkoutAttemptedRef, inFlightRef, onSaleQueued, onCheckoutSuccess } = params;

  useEffect(() => {
    if (!params.cartLoaded) return;
    void (async () => {
      try {
        setPendingCheckout(readCheckoutAttempt(storageKey));
      } catch (error) {
        // Snapshot rusak tidak dapat dipakai untuk retry apa pun. Buang agar
        // terminal tidak terkunci oleh dialog yang tidak punya jalan keluar.
        clearCheckoutAttempt(storageKey);
        toast.error(
          error instanceof Error
            ? `${error.message} Data percobaan rusak telah dibuang; periksa riwayat sebelum menjual ulang.`
            : "Data percobaan pembayaran rusak telah dibuang; periksa riwayat sebelum menjual ulang.",
        );
      }
    })();
  }, [params.cartLoaded, storageKey]);

  function completeCheckout(
    sale: {
      id: string;
      number: string;
      total: number;
      change: number;
      receiptToken?: string;
    },
    attempt: CheckoutAttempt,
    instantReceipt?: ReceiptData,
  ) {
    clearCheckoutAttempt(storageKey);
    setPendingCheckout(null);
    setRecoveryError(null);
    const completed: CompletedSaleInfo = { ...sale, instantReceipt };
    setLastSale(completed);
    // Another tab may have saved a different cart while this payment was unresolved.
    if (attempt.cartSignature === params.cartSignature) {
      clearStoredCart(storageKey);
      setCart([]);
      resetPaymentInputs();
      setCustomer(null);
      setCustomerQuery("");
      setCustomerResults([]);
      setDueDate(defaultDueDate(receivableDefaultTermDays));
      setGroupId("");
      resetCredit();
      setQuoteResult(null);
      setHeldSaleId(null);
      setHeldTotal(null);
      setReservationId(null);
    }
    idempotencyKeyRef.current = newUuid();
    checkoutAttemptedRef.current = false;
    if (onCheckoutSuccess) onCheckoutSuccess(completed);
    else router.push(receiptHref(sale.id, { printToken: sale.receiptToken }));
  }

  async function retryPendingCheckout() {
    if (!pendingCheckout || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const result = await checkoutAction(pendingCheckout.request);
      if (result.ok) completeCheckout(result.data, pendingCheckout);
      else {
        if (isDefinitiveCheckoutError(result.code)) {
          clearCheckoutAttempt(storageKey);
          setPendingCheckout(null);
          setRecoveryError(null);
          if (isHeldSaleUnavailableMessage(result.message)) {
            setHeldSaleId(null);
            setHeldTotal(null);
          }
          toast.error(result.message);
        } else {
          setRecoveryError(result.message);
        }
      }
    } catch {
      setRecoveryError("Status pembayaran belum pasti. Sambungkan jaringan lalu periksa lagi.");
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  function discardPendingCheckout() {
    clearCheckoutAttempt(storageKey);
    setPendingCheckout(null);
    setRecoveryError(null);
    idempotencyKeyRef.current = newUuid();
    checkoutAttemptedRef.current = false;
    toast.info("Percobaan pembayaran dibatalkan. Periksa riwayat bila dana mungkin sudah masuk.");
  }

  // A-24 T6 (T6-01/T6-02): antrekan penjualan ini ke antrean offline
  // lokal. Dipakai oleh DUA pemicu dengan semantik yang sama persis:
  // (1) browser melaporkan offline sebelum checkout dikirim; (2)
  // panggilan checkout MELEMPAR (server tak terjangkau — mis. server
  // lokal toko mati walau peramban merasa "online"). Kunci
  // idempotensi yang sama dengan checkout online membuat pengiriman
  // ulang sesudah server pulih terdedup sebagai `duplicate`, tidak
  // pernah menggandakan penjualan. Badan fungsi ini adalah blok
  // antrean SIM-2 S7B-2 yang dipindah apa adanya dari checkout.
  async function queueSaleOffline(payments: OfflineSalePayment[], clientKey: string) {
    // FIX-GDG Tahap 4 (butir b): payload antrean offline TIDAK
    // membawa reservationId (kontrak sinkronisasi S7B-2) — penjualan
    // bereservasi tidak boleh diantrekan diam-diam tanpa tautannya;
    // kasir diminta menyelesaikan saat tersambung.
    if (reservationId) {
      toast.error(
        "Penjualan dengan reservasi memerlukan koneksi — reservasi tidak dapat diantrekan offline. Selesaikan saat tersambung, atau lepaskan reservasi dari penjualan ini.",
      );
      return;
    }
    const payload: OfflineSalePayload = {
      clientKey,
      companyId,
      warehouseId: selectedWarehouse,
      heldSaleId,
      groupId: groupId || null,
      customerId: debtActive ? (customer?.id ?? null) : null,
      dueDate: debtActive ? dueDate : null,
      date: todayISO(),
      // FIX-POS Tahap 2 (POS3-02): identitas asal — kasir yang
      // sedang melayani, sesi kasnya, dan perangkat ini. Server
      // memposting atas nama asal, bukan atas nama penyinkron.
      cashierId: userId,
      originSessionId: sessionId,
      deviceId: getOrCreateDeviceId(),
      // FIX-POS Tahap 2 (POS3-04): snapshot struk — total yang
      // ditagihkan ke pelanggan & harga satuan per baris saat
      // transaksi terjadi (harga kelompok dari kutipan terakhir,
      // atau harga master dari katalog lokal bila belum terkutip).
      expectedTotal: total,
      lines: cart.map((line) => {
        const quoted = quote?.lines.find(
          (row) =>
            row.productId === line.productId &&
            (row.packagingId ?? null) === (line.packagingId ?? null),
        );
        const pack = line.packagingId
          ? cache[line.productId]?.packagings?.find((row) => row.id === line.packagingId)
          : undefined;
        return {
          productId: line.productId,
          qty: line.qty,
          discountType: line.discountType ?? null,
          discountValue: line.discountValue ?? 0,
          serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
          // S4: snapshot baris berkemasan adalah harga PER KEMASAN
          // yang dibebankan (groupUnitPrice quote adalah per satuan
          // dasar → kalikan faktor cuplikannya), dan muatan membawa
          // packagingId + isiSnapshot agar server mengonversi dengan
          // faktor saat transaksi, bukan master saat sinkron.
          packagingId: line.packagingId ?? null,
          isiSnapshot: pack ? Number(pack.isi) : undefined,
          unitPrice: pack
            ? quoted
              ? quoted.groupUnitPrice * Number(quoted.isiSnapshot)
              : pack.salePrice != null
                ? Number(pack.salePrice)
                : Number(cache[line.productId]?.salePrice ?? 0) * Number(pack.isi)
            : (quoted?.groupUnitPrice ?? Number(cache[line.productId]?.salePrice ?? 0)),
        };
      }),
      payments,
      queuedAt: new Date().toISOString(),
    };
    const offlineSaleNumber = `OFF-${clientKey.slice(0, 8).toUpperCase()}`;
    const receiptData = buildTerminalReceiptData({
      saleNumber: offlineSaleNumber,
      cart,
      quote,
      cache,
      payments,
      methodById,
      receiptProfile,
      customerName: debtActive ? (customer?.name ?? null) : null,
      dueDate: debtActive ? dueDate : null,
      total,
      outstanding: params.debtAmount,
      sessionId,
    });
    try {
      const storage = getBrowserOfflineStorage({
        companyId,
        userId,
        terminalId: payload.deviceId,
      });
      await enqueueOfflineSale(storage, payload);
      void getOfflineQueueSummary(storage)
        .then((summary) => {
          setQueuedCount(summary.count);
          setOldestQueuedAt(summary.oldestQueuedAt);
        })
        .catch(() => toast.error("Transaksi tersimpan, tetapi ringkasan antrean belum bisa dimuat."));
    } catch {
      toast.error("Antrean offline tidak dapat disimpan di browser ini. Transaksi dibatalkan.");
      return;
    }
    toast.success("Offline: transaksi tersimpan di antrean dan akan disinkronkan saat koneksi kembali.");
    clearCheckoutAttempt(storageKey);
    setPendingCheckout(null);
    clearStoredCart(storageKey);
    setCart([]);
    resetPaymentInputs();
    setCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setDueDate(defaultDueDate(receivableDefaultTermDays));
    setGroupId("");
    resetCredit();
    setQuoteResult(null);
    setHeldSaleId(null);
    setHeldTotal(null);
    idempotencyKeyRef.current = newUuid();
    checkoutAttemptedRef.current = false;
    const completed: CompletedSaleInfo = {
      id: clientKey,
      number: offlineSaleNumber,
      total: receiptData.total,
      change: receiptData.change,
      offlineReceipt: receiptData,
    };
    setLastSale(completed);
    if (onCheckoutSuccess) {
      onCheckoutSuccess(completed);
    } else {
      onSaleQueued?.();
    }
  }

  async function checkout() {
    if (inFlightRef.current) return;
    if (pendingCheckout) { await retryPendingCheckout(); return; }
    if (recoveryError || !params.cartLoaded) return;
    try {
      const saved = readCheckoutAttempt(storageKey);
      if (saved) { setPendingCheckout(saved); return; }
    } catch {
      setRecoveryError("Penyimpanan pembayaran tidak dapat dibaca. Periksa riwayat bersama supervisor.");
      return;
    }
    if (cart.length === 0) {
      toast.error("Keranjang masih kosong.");
      return;
    }
    if (!sessionOpen) {
      toast.error("Buka sesi kas terlebih dahulu.");
      return;
    }
    if (mode === "single" && !singleMethod) {
      toast.error("Pilih metode pembayaran.");
      return;
    }
    if (mode === "single" && appliedCredit) {
      toast.error("Kredit retur hanya bisa dipakai pada mode Campuran.");
      return;
    }
    if (mode === "mixed") {
      const hasCredit = Object.entries(entries).some(
        ([id, entry]) => Number(entry.amount) > 0 && methodById.get(id)?.type === "credit",
      );
      if (outstanding > 0 && !hasCredit) {
        toast.error(`Pembayaran kurang ${formatIDR(outstanding)}.`);
        return;
      }
      if (outstanding > 0 && hasCredit) {
        // Server allocates the remainder to the credit method.
      }
    }
    // POS-1 (D-19): gerbang klien penjualan utang — server menegakkan
    // hal yang sama, tetapi kasir harus tahu sebelum transaksi terkirim.
    if (debtActive) {
      if (!customer) {
        toast.error(
          "Penjualan utang wajib memilih pelanggan — pilih dari daftar atau tambah pelanggan baru.",
        );
        return;
      }
      if (!dueDate) {
        toast.error("Tanggal jatuh tempo wajib diisi untuk penjualan utang.");
        return;
      }
    }

    const tenderError =
      mode === "single"
        ? cashTenderError({
            total,
            tendered: cashTendered,
            isCash: single?.type === "cash",
          })
        : null;
    if (tenderError) {
      toast.error(tenderError);
      return;
    }

    const payments =
      mode === "single"
        ? [
            {
              methodId: singleMethod,
              amount: total,
              tendered: single?.type === "cash" ? cashTendered : total,
              reference: entries[singleMethod]?.reference || undefined,
              // A-21 Tahap R3-A (R3-01): fee final dari panel; kosong
              // berarti kasir menerima bawaan konfigurasi metode.
              fee: entries[singleMethod]?.fee ? Number(entries[singleMethod].fee) : undefined,
            },
          ]
        : Object.entries(entries)
            .filter(([, entry]) => Number(entry.amount) > 0)
            .map(([methodId, entry]) => ({
              methodId,
              amount: Number(entry.amount),
              tendered: Number(entry.tendered || entry.amount),
              reference: entry.reference || undefined,
              fee: entry.fee ? Number(entry.fee) : undefined,
            }));

    const attemptKey = idempotencyKeyRef.current;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      if (posOfflineEnabled && !navigator.onLine) {
        await queueSaleOffline(payments, attemptKey);
        return;
      }
      checkoutAttemptedRef.current = true;
      const request = {
        warehouseId: selectedWarehouse,
        groupId: groupId || null,
        reservationId: reservationId ?? undefined,
        heldSaleId,
        // POS-1 (D-19): pelanggan & jatuh tempo hanya dikirim bila
        // penjualan mengandung utang; penjualan tunai tetap anonim.
        customerId: debtActive ? (customer?.id ?? undefined) : undefined,
        dueDate: debtActive ? dueDate : undefined,
        idempotencyKey: attemptKey,
        lines: cart.map((line) => ({
          productId: line.productId,
          // S4: satuan baris (qty = qty input kemasan terpilih).
          packagingId: line.packagingId ?? null,
          qty: line.qty,
          discountType: line.discountType ?? null,
          discountValue: line.discountValue ?? 0,
          serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
        })),
        payments,
      };
      const attempt = { request, cartSignature: params.cartSignature };
      try {
        storeCheckoutAttempt(storageKey, attempt);
      } catch {
        toast.error("Pembayaran belum dikirim. Aktifkan penyimpanan browser agar transaksi dapat dipulihkan.");
        return;
      }
      const result = await checkoutAction(request).catch(() => null);

      if (!result) {
        setPendingCheckout(attempt);
        if (posOfflineEnabled) await queueSaleOffline(payments, attemptKey);
        else toast.error("Checkout gagal. Periksa koneksi lalu coba lagi.");
        return;
      }

      if (!result.ok) {
        // Semua AppError yang dikembalikan server adalah hasil transaksi
        // yang sudah rollback dan bersifat definitif. Jangan menyimpannya
        // sebagai pending (keranjang basi bisa di-retry setelah stok/harga
        // berubah); hanya kegagalan transport/unknown yang pending.
        if (isDefinitiveCheckoutError(result.code)) {
          clearCheckoutAttempt(storageKey);
          if (isHeldSaleUnavailableMessage(result.message)) {
            setHeldSaleId(null);
            setHeldTotal(null);
          }
        } else {
          setPendingCheckout(attempt);
        }
        toast.error(result.message);
        return;
      }

      // Server mengirim snapshot nota dari sale yang sudah commit.
      // Fallback lama tetap ada untuk replay/idempotensi/offline.
      const instantReceipt =
        result.data.receipt ??
        buildTerminalReceiptData({
          saleNumber: result.data.number,
          cart,
          quote,
          cache,
          payments,
          methodById,
          receiptProfile,
          customerName: debtActive ? (customer?.name ?? null) : null,
          dueDate: debtActive ? dueDate : null,
          total: result.data.total,
          change: result.data.change,
          outstanding: debtActive ? params.debtAmount : 0,
          sessionId,
        });
      completeCheckout(result.data, attempt, instantReceipt);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return {
    checkout,
    submitting,
    pendingCheckout,
    recoveryError,
    retryPendingCheckout,
    discardPendingCheckout,
  };
}
