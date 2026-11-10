/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — hook checkout terminal
 * (antrean offline + pengiriman penjualan, kunci idempotensi
 * dibagi dengan komponen induk). Badan fungsi identik asal.
 */
"use client";

import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { checkoutAction } from "@/server/actions/pos";
import { formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  countQueued,
  enqueueOfflineSale,
  getBrowserOfflineStorage,
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
  sessionOpen: boolean;
  mode: "single" | "mixed";
  singleMethod: string;
  single: Method | undefined;
  cashTendered: number;
  entries: Record<string, PaymentEntry>;
  methodById: Map<string, Method>;
  outstanding: number;
  debtActive: boolean;
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
  receivableDefaultTermDays: number;
  appliedCredit: PaymentEntry | undefined;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setEntries: Dispatch<SetStateAction<Record<string, PaymentEntry>>>;
  setCustomer: Dispatch<SetStateAction<CustomerOption | null>>;
  setCustomerQuery: Dispatch<SetStateAction<string>>;
  setCustomerResults: Dispatch<SetStateAction<CustomerOption[]>>;
  setDueDate: Dispatch<SetStateAction<string>>;
  resetCredit: ReturnCreditApi["resetCredit"];
  setQuoteResult: ReturnType<typeof useQuote>["setQuoteResult"];
  heldSaleId: string | null;
  setHeldSaleId: Dispatch<SetStateAction<string | null>>;
  setHeldTotal: Dispatch<SetStateAction<number | null>>;
  setLastSale: Dispatch<SetStateAction<{ id: string; number: string } | null>>;
  setReservationId: Dispatch<SetStateAction<string | null>>;
  setQueuedCount: Dispatch<SetStateAction<number>>;
  idempotencyKeyRef: RefObject<string>;
  checkoutAttemptedRef: RefObject<boolean>;
  /** A-28 UI-1 (UX-B01): dipanggil sesudah penjualan terantre offline
   *  (terminal tidak berpindah halaman) agar induk mengembalikan
   *  fokus ke kotak cari. */
  onSaleQueued?: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { cart, sessionOpen, mode, singleMethod, single, cashTendered, entries, methodById, outstanding, debtActive, customer, dueDate, total, quote, cache, posOfflineEnabled, reservationId, selectedWarehouse, groupId, storageKey, sessionId, userId, receivableDefaultTermDays, appliedCredit, setCart, setEntries, setCustomer, setCustomerQuery, setCustomerResults, setDueDate, resetCredit, setQuoteResult, heldSaleId, setHeldSaleId, setHeldTotal, setLastSale, setReservationId, setQueuedCount, idempotencyKeyRef, checkoutAttemptedRef, onSaleQueued } = params;

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
      warehouseId: selectedWarehouse,
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
    try {
      const storage = getBrowserOfflineStorage();
      await enqueueOfflineSale(storage, payload);
      setQueuedCount(await countQueued(storage));
    } catch {
      toast.error("Antrean offline tidak dapat disimpan di browser ini. Transaksi dibatalkan.");
      return;
    }
    toast.success("Offline: transaksi tersimpan di antrean dan akan disinkronkan saat koneksi kembali.");
    clearStoredCart(storageKey);
    setCart([]);
    setEntries({});
    setCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setDueDate(defaultDueDate(receivableDefaultTermDays));
    resetCredit();
    setQuoteResult(null);
    setHeldSaleId(null);
    setHeldTotal(null);
    idempotencyKeyRef.current = crypto.randomUUID();
    onSaleQueued?.();
  }

  async function checkout() {
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

    const payments =
      mode === "single"
        ? [
            {
              methodId: singleMethod,
              amount: total,
              tendered: single?.type === "cash" ? cashTendered || total : total,
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

    // SIM-2 S7B-2 Batch 6: browser offline + saklar aktif → penjualan
    // diantrekan lokal (IndexedDB) dengan kunci idempotensi yang sama
    // yang akan dipakai server saat sinkronisasi; keranjang dibersihkan
    // persis seperti checkout sukses, TANPA nomor nota (belum tercatat).
    if (posOfflineEnabled && !navigator.onLine) {
      await queueSaleOffline(payments, idempotencyKeyRef.current);
      return;
    }

    // POS-ERR-01: tombol Bayar tidak boleh macet nonaktif saat server
    // action melempar — state sibuk dipulihkan di finally.
    // A-24 T6: kunci percobaan ini dibekukan agar jalur tangkap
    // (antrean offline) selalu memakai kunci yang sama dengan yang
    // dikirim ke server, walau jalur sukses sempat merotasinya.
    const attemptKey = idempotencyKeyRef.current;
    setSubmitting(true);
    checkoutAttemptedRef.current = true;
    try {
      const result = await checkoutAction({
        warehouseId: selectedWarehouse,
        groupId: groupId || null,
        reservationId: reservationId ?? undefined,
        heldSaleId,
        // POS-1 (D-19): pelanggan & jatuh tempo hanya dikirim bila
        // penjualan mengandung utang; penjualan tunai tetap anonim.
        customerId: debtActive ? (customer?.id ?? undefined) : undefined,
        dueDate: debtActive ? dueDate : undefined,
        idempotencyKey: idempotencyKeyRef.current,
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
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      setLastSale({ id: result.data.id, number: result.data.number });
      toast.success(`Transaksi ${result.data.number} tersimpan.`);
      // D-10: checkout sukses — snapshot keranjang lokal dibersihkan
      // agar transaksi yang sudah terbayar tidak bangkit lagi.
      clearStoredCart(storageKey);
      setCart([]);
      setEntries({});
      // POS-1 (D-19): panel utang direset untuk pelanggan berikutnya.
      setCustomer(null);
      setCustomerQuery("");
      setCustomerResults([]);
      setDueDate(defaultDueDate(receivableDefaultTermDays));
      resetCredit();
      setQuoteResult(null);
      setHeldSaleId(null);
      setHeldTotal(null);
      // FIX-GDG Tahap 4 (butir b): reservasi terpakai dilepas untuk
      // penjualan berikutnya (domain menandainya fulfilled).
      setReservationId(null);
      idempotencyKeyRef.current = crypto.randomUUID();
      checkoutAttemptedRef.current = false;
      router.push(`/app/pos/nota/${result.data.id}?autoprint=1`);
    } catch {
      // A-24 T6 (temuan T6-02): panggilan checkout melempar berarti
      // server tidak terjangkau (transportasi gagal total) — BUKAN
      // putusan domain, yang selalu kembali sebagai { ok: false }.
      // Bila mode offline perusahaan aktif, penjualan diantrekan
      // persis seperti jalur browser-offline; kunci idempotensi yang
      // sama menjaga pengiriman ulang tetap terdedup di server.
      // Terbukti di skenario B: server lokal mati membuat peramban
      // tetap merasa "online", jadi tanpa jalur ini terminal yang
      // sudah termuat tidak dapat menjual sama sekali.
      if (posOfflineEnabled) {
        await queueSaleOffline(payments, attemptKey);
        return;
      }
      toast.error("Checkout gagal. Periksa koneksi lalu coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return { checkout, submitting };
}
