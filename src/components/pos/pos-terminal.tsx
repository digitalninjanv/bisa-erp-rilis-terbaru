"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newUuid } from "@/lib/uuid";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/money";
import { useHydrated, usePosDisplayPrefs } from "@/components/pos/pos-display";
import { searchProductsAction } from "@/server/actions/pos";
import { useGlobalBarcodeScan } from "@/components/pos/terminal/use-global-barcode-scan";
import {
  cartLineBaseQty, type CartItem, type CustomerOption, type Method, type PaymentEntry,
  type ProductOption, type PosTerminalProps, type TerminalReservation,
} from "@/components/pos/terminal-types";
import { cartStorageKey, useCartPersistence } from "@/components/pos/use-cart-persistence";
import { useQuote } from "@/components/pos/use-quote";
import { useHeldSales } from "@/components/pos/use-held-sales";
import { useOfflineQueue } from "@/components/pos/use-offline-queue";
import { useReturnCredit } from "@/components/pos/use-return-credit";
import { HoldDialog, ResumeDialog } from "@/components/pos/terminal-dialogs";
import { useProductSearch } from "@/components/pos/terminal/use-product-search";
import { usePaymentPlan } from "@/components/pos/terminal/use-payment-plan";
import { useTerminalShortcuts } from "@/components/pos/terminal/use-terminal-shortcuts";
import type { TerminalShortcutAction } from "@/lib/pos/terminal-shortcuts";
import { defaultDueDate, useTerminalCheckout } from "@/components/pos/terminal/use-terminal-checkout";
import { ProductCatalog } from "@/components/pos/terminal/product-catalog";
import { CheckoutSuccessModal, type CompletedSaleInfo } from "@/components/pos/terminal/checkout-success-modal";
import {
  addCartLine, changeCartLinePackaging, setCartLineDiscount, setCartLineQty, setCartLineSerial,
} from "@/components/pos/terminal/cart-lines";
import { MobilePayBar } from "@/components/pos/terminal/mobile-pay-bar";
import { PosCheckoutWorkspace } from "@/components/pos/terminal/pos-checkout-workspace";
import { usePosCustomerActions } from "@/components/pos/terminal/use-pos-customer-actions";
import { focusPosTenderedInput, useCloseMobileCartOnDesktop, useExitFullscreenOnEscape } from "@/components/pos/terminal/use-terminal-layout";
import { useTerminalDialogEscape } from "@/components/pos/terminal/use-terminal-dialog-escape";
import { useTerminalReset } from "@/components/pos/terminal/use-terminal-reset";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export type { TerminalReservation };

export function PosTerminal({
  companyId, userId, companyName, warehouseId, warehouses, categories, methods, creditMethod,
  debtMethod, initialProducts, qrisImage, groups, sessionOpen, sessionId = null,
  heldCount, resumeId, posOfflineEnabled = false, offlineTaxRate = 0,
  offlineRoundingMode = "none", receivableDefaultTermDays = 7, reservations = [],
  allowNegativeStock = false,
}: PosTerminalProps) {
  // T3R-5: kunci snapshot keranjang milik kasir ini di perusahaan ini.
  const storageKey = cartStorageKey(companyId, userId);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cache, setCache] = useState<Record<string, ProductOption>>(
    Object.fromEntries(initialProducts.map((p) => [p.id, p])),
  );
  // SIM-2 S7B-2 Batch 5: baris serial yang belum lengkap serinya tidak
  // di-quote — status ini diturunkan (derived) dari cart+cache saat
  // render, bukan dibersihkan lewat setState di dalam effect: selama
  // ada baris serial yang belum lengkap, quote dianggap tidak ada dan
  // kasir melihat petunjuk inline pada baris keranjang.
  const serialIncomplete = cart.some((line) => {
    if (!cache[line.productId]?.trackSerial) return false;
    const filled = (line.serialNumbers ?? []).filter((value) => value.trim()).length;
    // S4: seri dihitung per unit SATUAN DASAR (baris Dus isi 40
    // membutuhkan 40 seri), bukan per kemasan.
    return filled !== cartLineBaseQty(line, cache[line.productId]);
  });
  const [selectedWarehouse, setSelectedWarehouse] = useState(warehouseId);
  const [selectedCategory, setSelectedCategory] = useState("");
  // FIX-GDG Tahap 4 (butir b): reservasi terpilih untuk penjualan ini.
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [mode, setMode] = useState<"single" | "mixed">("single");
  const [singleMethod, setSingleMethod] = useState(
    () => methods.find((method) => method.type === "cash")?.id ?? methods[0]?.id ?? "",
  );
  const [entries, setEntries] = useState<Record<string, PaymentEntry>>({});
  // Pesanan yang sedang dilanjutkan dari tahanan: id-nya dikirim ke
  // checkout agar tahanannya terhapus sesudah berhasil, dan total
  // snapshot-nya dibandingkan dengan hitung-ulang terkini (D-9).
  const [heldSaleId, setHeldSaleId] = useState<string | null>(null);
  const [heldTotal, setHeldTotal] = useState<number | null>(null);

  // FIX-POS Tahap 4 (POS2-05): konfirmasi penerimaan pembayaran
  // non-tunai tunggal (QRIS/bank) sebelum Bayar dapat ditekan.
  // Konfirmasi terikat pada pasangan (metode, total) yang dikonfirmasi
  // — mengganti metode atau total menggugurkannya secara derivasi,
  // tanpa efek reset.
  const [nonCashConfirmedFor, setNonCashConfirmedFor] = useState<{
    methodId: string;
    total: number;
  } | null>(null);
  const [lastSale, setLastSale] = useState<{ id: string; number: string } | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // POS-1 (D-19): keadaan panel utang (pelanggan, pencarian, jatuh tempo).
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [dueDate, setDueDate] = useState<string>(() => defaultDueDate(receivableDefaultTermDays));
  const [completedSale, setCompletedSale] = useState<CompletedSaleInfo | null>(null);

  const idempotencyKey = useRef(newUuid());
  // POS-IDEM-01: kunci quote boleh dipakai ulang sampai checkout dicoba;
  const checkoutAttempted = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // POS2-03: Enter sesudah ketikan secepat scanner = pindaian barcode.
  // A-28 UI-1 (UX-B01): terminal menyambut kasir dengan fokus LANGSUNG
  // di kotak cari — tanpa klik awal. Kembali dari nota = terminal
  // termuat ulang (efek ini berjalan lagi); tambah produk mengembalikan
  // fokus lewat addProduct; antrean offline lewat onSaleQueued.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const { prefs: display, update: updateDisplay, reset: resetDisplay } = usePosDisplayPrefs();
  const hydrated = useHydrated();
  const [fullscreenOverride, setFullscreenOverride] = useState<boolean | null>(null);
  const fullscreen = fullscreenOverride ?? (hydrated && display.autoFullscreen);

  // POS2-01: sidik jari keadaan yang menentukan quote — gudang,
  // kelompok harga, dan baris lengkap (qty, diskon, nomor seri).
  const cartSignature = useMemo(
    () =>
      JSON.stringify({
        warehouseId: selectedWarehouse,
        groupId,
        // FIX-GDG Tahap 4 (butir b): reservasi mengubah hasil quote
        // (domain mengecualikan stok tereservasi ini dari pengurangan
        // stok bebas) — wajib masuk sidik agar quote diperbarui.
        reservationId,
        lines: cart.map((line) => ({
          productId: line.productId,
          // S4: kemasan adalah bagian identitas baris — quote wajib
          // dihitung ulang saat satuan baris berganti.
          packagingId: line.packagingId ?? null,
          qty: line.qty,
          discountType: line.discountType ?? null,
          discountValue: line.discountValue ?? 0,
          serialNumbers: (line.serialNumbers ?? []).map((value) => value.trim()),
        })),
      }),
    [cart, selectedWarehouse, groupId, reservationId],
  );

  // FIX-ARS Tahap 5 (ARS2-01): kepedulian terminal yang stabil kini
  // hidup di hook-nya masing-masing (persistensi keranjang, quote,
  // tahanan/resume, antrean offline) — komponen ini menjadi komposisi.
  // Urutan pemanggilan menjaga urutan pendaftaran efek yang setara:
  // pulih/simpan snapshot, quote, resume, lalu pemicu offline.
  const { resumeGuardRef, storedActiveRef } = useCartPersistence({
    storageKey,
    resumeId,
    warehouses,
    groups,
    cart,
    groupId,
    selectedWarehouse,
    heldSaleId,
    heldTotal,
    reservationId,
    customer,
    dueDate,
    setCart,
    setGroupId,
    setSelectedWarehouse,
    setHeldSaleId,
    setHeldTotal,
    setReservationId,
    setCustomer,
    setDueDate,
  });

  const { resetPaymentInputs, resetNewSaleContext } = useTerminalReset({
    setEntries,
    setNonCashConfirmedFor,
    setCustomer,
    setCustomerQuery,
    setCustomerResults,
    setDueDate,
    receivableDefaultTermDays,
  });

  const offlineQuotePayload = useMemo(() => {
    if (!posOfflineEnabled) return null;
    const g = groups.find((row) => row.id === groupId);
    return {
      enabled: true,
      catalog: cache,
      group: g
        ? {
            roundingStep: g.roundingStep,
            roundingDirection: g.roundingDirection as "down" | "up" | "nearest",
            roundCashTotal: g.roundCashTotal,
          }
        : null,
      taxRate: offlineTaxRate,
      companyRoundingMode: offlineRoundingMode,
    };
  }, [posOfflineEnabled, groups, groupId, cache, offlineTaxRate, offlineRoundingMode]);

  const {
    quote,
    quoting,
    quoteError,
    quoteBusy,
    quoteLine,
    setQuoteResult,
    setQuoteNonce,
  } = useQuote({
    cart,
    selectedWarehouse,
    groupId,
    reservationId,
    cartSignature,
    serialIncomplete,
    setCache,
    offlineQuote: offlineQuotePayload,
  });
  const total = quote?.total ?? 0;
  const clearQuoteForResume = useCallback(() => setQuoteResult(null), [setQuoteResult]);

  const {
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
  } = useHeldSales({
    resumeId,
    cart,
    groupId,
    selectedWarehouse,
    reservationId,
    customerId: customer?.id ?? null,
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
    resumeGuardRef,
    storedActiveRef,
    onHoldSuccess: resetNewSaleContext,
    onResumeApplied: resetPaymentInputs,
    clearQuote: clearQuoteForResume,
  });

  const {
    online,
    queuedCount,
    setQueuedCount,
    oldestQueuedAt,
    setOldestQueuedAt,
    syncing,
    syncOfflineQueue,
  } = useOfflineQueue({ posOfflineEnabled });

  // POS2-05: konfirmasi hanya berlaku untuk metode & total yang
  // persis dikonfirmasi kasir.
  const nonCashConfirmed =
    nonCashConfirmedFor !== null &&
    nonCashConfirmedFor.methodId === singleMethod &&
    nonCashConfirmedFor.total === total;
  // Metode kredit pelanggan ikut dikenal peta metode agar simulasi
  // alokasi campuran (mixedPlan) memperlakukannya sebagai pembayaran
  // non-tunai — tetapi ia tidak dirender di daftar metode biasa.
  // POS-1 (D-19): metode utang (tipe credit) juga dikenal peta ini agar
  // alokasi & kembalian disimulasikan sebagai pembayaran kredit.
  const methodById = useMemo(() => {
    const all: Method[] = [...methods];
    if (creditMethod) {
      all.push({
        id: creditMethod.id,
        code: "CUSTCREDIT",
        name: creditMethod.name,
        type: "customer_credit",
        instructions: null,
      });
    }
    if (debtMethod) {
      all.push({
        id: debtMethod.id,
        code: "CREDIT",
        name: debtMethod.name,
        type: "credit",
        instructions: null,
      });
    }
    return new Map(all.map((m) => [m.id, m]));
  }, [methods, creditMethod, debtMethod]);
  const single = methodById.get(singleMethod);
  const isCreditSingle = single?.type === "credit";
  const cashTendered = Number(entries[singleMethod || "__none"]?.tendered ?? 0);

  const { search, setSearch, products, page, pageFull, searching, scanBarcode, goToPage } =
    useProductSearch({ initialProducts, selectedWarehouse, selectedCategory, setCache });

  const addProduct = useCallback(
    (product: ProductOption, packagingId?: string | null) => {
      // POS-1: produk terlacak stok yang habis tidak dapat masuk
      // keranjang — penjaga ini juga menolak jalur scan barcode, yang
      // menambahkan lewat fungsi yang sama. Diabaikan jika stok minus diizinkan.
      if (product.trackStock && product.stock <= 0 && !allowNegativeStock) {
        toast.error(`Stok ${product.name} habis — produk tidak dapat ditambahkan ke keranjang.`);
        return;
      }
      // S4: pindai barcode kemasan (atau pilihan eksplisit pemanggil)
      // menambahkan baris KEMASAN itu; klik kartu biasa tetap satuan
      // dasar. Baris digabung per (produk, kemasan).
      setCart((current) => addCartLine(current, product.id, packagingId ?? null));
      setCache((current) => ({ ...current, [product.id]: product }));
      setSearch("");
      searchRef.current?.focus();
    },
    [setSearch, allowNegativeStock],
  );

  useGlobalBarcodeScan({
    scanBarcode,
    addProduct,
    setSearch,
    searchRef,
    enabled: sessionOpen && !holdOpen && !resumeOffer && !completedSale,
  });

  const applyReservation = useCallback(
    async (reservation: TerminalReservation) => {
      setReservationId(reservation.id);
      let product = cache[reservation.productId];
      if (!product) {
        const result = await searchProductsAction(reservation.productSku, selectedWarehouse, 0);
        if (result.ok) {
          const found = result.data.find((row) => row.id === reservation.productId);
          if (found) {
            // Pemetaan yang sama dengan runSearch (bentuk baris aksi
            // pencarian sedikit berbeda dari ProductOption).
            product = {
              id: found.id,
              name: found.name,
              sku: found.sku,
              barcode: found.barcode,
              salePrice: found.salePrice,
              stock: Number((found as { stock?: string }).stock ?? 0),
              trackStock: (found as { trackStock?: boolean }).trackStock ?? true,
              unitCode: (found as { unitCode?: string | null }).unitCode ?? "PCS",
            };
          }
        }
      }
      if (!product) {
        toast.error("Produk reservasi tidak ditemukan di katalog gudang ini — tautan reservasi tetap dicatat.");
        return;
      }
      addProduct(product);
      const targetQty = Number(reservation.qty);
      if (Number.isFinite(targetQty) && targetQty > 0) {
        setCart((current) =>
          current.map((line) =>
            // Reservasi dinyatakan dalam satuan dasar — hanya baris
            // satuan dasar produk itu yang diselaraskan (S4).
            line.productId === reservation.productId && !line.packagingId
              ? { ...line, qty: targetQty }
              : line,
          ),
        );
      }
      toast.success(`Reservasi ${reservation.number} ditautkan — stok tereservasi dipakai untuk penjualan ini.`);
    },
    [addProduct, cache, selectedWarehouse],
  );


  // T3R-4: sidik jari state pembayaran (metode + nominal + diterima +
  // referensi, termasuk mode & metode tunggal terpilih). Perubahan
  // pembayaran sesudah percobaan checkout harus ikut mengganti kunci
  // idempotensi — bila tidak, checkout ulang memutar ulang penjualan
  // lama dan pembayaran yang sebenarnya diterima tidak tercatat.
  const paymentsFingerprint = useMemo(
    () =>
      JSON.stringify({
        mode,
        singleMethod,
        entries: Object.entries(entries)
          .map(
            ([methodId, entry]) =>
              [methodId, entry.amount, entry.tendered, entry.reference] as const,
          )
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        // POS-1 (D-19): pelanggan & jatuh tempo penjualan utang ikut
        // menjadi sidik jari — menggantinya sesudah percobaan checkout
        // harus memutar kunci agar piutang tidak tercatat ke pelanggan
        // atau tempo yang salah.
        customerId: customer?.id ?? null,
        dueDate,
      }),
    [mode, singleMethod, entries, customer, dueDate],
  );

  // POS-IDEM-01: ganti kunci idempotensi setiap kali isi transaksi
  // berubah SETELAH ada percobaan checkout (sukses maupun gagal) — tanpa
  // ini, checkout ulang atas keranjang yang sudah diedit akan memutar
  // ulang penjualan lama dan item tambahan hilang senyap.
  useEffect(() => {
    if (!checkoutAttempted.current) return;
    checkoutAttempted.current = false;
    idempotencyKey.current = newUuid();
  }, [cart, groupId, selectedWarehouse, paymentsFingerprint]);

  // S4: penyunting baris berkunci (produk, kemasan) — logika murninya
  // hidup di terminal/cart-lines.ts, komponen ini hanya mengikatnya
  // ke state keranjang.
  const setQty = (key: string, qty: number) =>
    setCart((current) => setCartLineQty(current, key, qty));

  const setSerial = (key: string, index: number, value: string) =>
    setCart((current) => setCartLineSerial(current, key, index, value));

  const setDiscount = (key: string, type: "percent" | "nominal" | null, value: number) =>
    setCart((current) => setCartLineDiscount(current, key, type, value));

  const setLinePackaging = (key: string, packagingId: string | null) =>
    setCart((current) => changeCartLinePackaging(current, key, packagingId));

  const { mixedPlan, change, outstanding, mixedShortfall, debtEntryAmount, debtActive, debtAmount, nonCashNeedsConfirm } =
    usePaymentPlan({ mode, entries, methodById, total, singleMethod, single, isCreditSingle, cashTendered, debtMethod });

  const credit = useReturnCredit({
    creditMethod,
    total,
    mixedAppliedTotal: mixedPlan.appliedTotal,
    entries,
    setEntries,
    setMode,
  });
  const { appliedCredit, resetCredit } = credit;

  const { checkout, submitting } = useTerminalCheckout({
    cart, sessionOpen, mode, singleMethod, single, cashTendered, entries, methodById,
    outstanding, debtActive, customer, dueDate, total, quote, cache, posOfflineEnabled,
    reservationId, selectedWarehouse, groupId, storageKey, sessionId, userId,
    receivableDefaultTermDays, appliedCredit, setCart, setEntries, setCustomer,
    setCustomerQuery, setCustomerResults, setDueDate, resetCredit, setQuoteResult,
    heldSaleId, setHeldSaleId, setHeldTotal, setLastSale, setReservationId, setQueuedCount,
    setOldestQueuedAt,
    idempotencyKeyRef: idempotencyKey, checkoutAttemptedRef: checkoutAttempted,
    // A-28 UI-1 (UX-B01): penjualan terantre offline tidak berpindah
    // halaman — fokus kembali ke kotak cari sesudah keranjang bersih.
    onSaleQueued: () => {
      setMobileCartOpen(false);
      searchRef.current?.focus();
    },
    onCheckoutSuccess: (sale) => {
      setMobileCartOpen(false);
      setCompletedSale(sale);
      // Transaksi berikutnya kembali ke alur tercepat: Tunai + Tunggal.
      setMode("single");
      setSingleMethod(methods.find((method) => method.type === "cash")?.id ?? methods[0]?.id ?? "");
    },
  });

  const payDisabled =
    submitting ||
    cart.length === 0 ||
    !sessionOpen ||
    quote === null ||
    quoting ||
    quoteError !== null ||
    (nonCashNeedsConfirm && !nonCashConfirmed) ||
    // A-28 UI-1 (UX-B07): campuran belum tertutup tidak dapat diklik.
    mixedShortfall;
  const payLabel = submitting
    ? "Menyimpan…"
    : cart.length === 0
      ? "Bayar"
      : serialIncomplete
        ? "Lengkapi nomor seri"
        : quoteError
          ? "Perhitungan gagal"
          : quoteBusy
            ? "Menghitung…"
            : mixedShortfall
              ? `Bayar — sisa ${formatIDR(outstanding)}`
              : `Bayar ${formatIDR(total)}`;

  // A-28 UI-1 (UX-B01/B03): pintasan global terminal (peta tombol di
  // lib/pos/terminal-shortcuts); ditahan selama dialog Tahan/Resume.
  useTerminalShortcuts({
    suspended: holdOpen || Boolean(resumeOffer) || Boolean(completedSale),
    onShortcut: (action: TerminalShortcutAction) => {
      switch (action) {
        case "focus-search":
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case "focus-tendered": {
          // Hanya ada pada mode tunai tunggal; di luar itu id tidak
          // ditemukan dan pintasan tidak berbuat apa-apa.
          const mobile = !window.matchMedia("(min-width: 1024px)").matches;
          const focusInput = () => focusPosTenderedInput(mobile);
          if (mobile && !mobileCartOpen) {
            setMobileCartOpen(true);
            window.requestAnimationFrame(() => window.requestAnimationFrame(focusInput));
          } else {
            focusInput();
          }
          break;
        }
        case "exact-cash":
          // Uang Pas: cermin persis chip "Uang Pas" mode tunggal.
          if (mode === "single" && single?.type === "cash" && total > 0) {
            setEntries((current) => ({
              ...current,
              [singleMethod]: {
                amount: String(total),
                tendered: String(total),
                reference: current[singleMethod]?.reference ?? "",
              },
            }));
          }
          break;
        case "hold":
          if (cart.length > 0) setHoldOpen(true);
          break;
        case "pay":
          if (!payDisabled) void checkout();
          break;
        case "toggle-mode":
          setMode((current) => (current === "single" ? "mixed" : "single"));
          break;
      }
    },
  });

  const { quickAddCustomer } = usePosCustomerActions({
    debtActive,
    customer,
    setCustomer,
    customerQuery,
    setCustomerResults,
    setCustomerSearching,
    quickName,
    quickPhone,
    setQuickName,
    setQuickPhone,
    setQuickAddOpen,
    setQuickBusy,
  });

  // POS-1 (D-19): isi baris utang campuran sebesar sisa tagihan —
  // nominal utang memang didefinisikan sebagai sisa yang tidak dibayar
  // metode lain.
  function fillDebtRemainder() {
    if (!debtMethod) return;
    const remainder = debtEntryAmount + outstanding;
    if (remainder <= 0) {
      toast.error("Tidak ada sisa tagihan untuk dijadikan utang.");
      return;
    }
    setEntries((current) => ({
      ...current,
      [debtMethod.id]: {
        amount: String(remainder),
        tendered: "",
        reference: current[debtMethod.id]?.reference ?? "",
      },
    }));
  }

  useTerminalDialogEscape({
    holdOpen,
    resumeOpen: Boolean(resumeOffer),
    resumeCancel,
    setHoldOpen,
  });

  useExitFullscreenOnEscape({
    fullscreen,
    suspended: holdOpen || Boolean(resumeOffer) || Boolean(completedSale) || mobileCartOpen,
    setFullscreenOverride,
  });

  const selectedGroup = groups.find((g) => g.id === groupId);

  const cartPanelProps = {
    cart,
    cache,
    quote,
    quoteLine,
    total,
    heldTotal,
    groupId,
    setGroupId,
    groups,
    selectedGroup,
    heldCount,
    setCart,
    setQty,
    setSerial,
    setDiscount,
    setLinePackaging,
    quoteBusy,
    allowNegativeStock,
  };

  const paymentPanelProps = {
    companyName,
    mode,
    setMode,
    methods,
    single,
    singleMethod,
    setSingleMethod,
    entries,
    setEntries,
    total,
    change,
    isCreditSingle,
    debtMethod,
    debtActive,
    debtAmount,
    qrisImage,
    nonCashNeedsConfirm,
    nonCashConfirmed,
    setNonCashConfirmedFor,
    creditMethod,
    credit,
    customer,
    setCustomer,
    customerQuery,
    setCustomerQuery,
    customerResults,
    customerSearching,
    quickAddOpen,
    setQuickAddOpen,
    quickName,
    setQuickName,
    quickPhone,
    setQuickPhone,
    quickBusy,
    quickAddCustomer,
    dueDate,
    setDueDate,
    outstanding,
    mixedPlan,
    fillDebtRemainder,
    cart,
    serialIncomplete,
    quoteError,
    quote,
    setQuoteNonce,
    payDisabled,
    payLabel,
    checkout,
    setHoldOpen,
    sessionOpen,
    lastSale,
  };

  useCloseMobileCartOnDesktop(setMobileCartOpen);

  return (
    <div
      style={{ "--pos-cart-w": `${display.cartWidth}px` } as React.CSSProperties}
      className={cn(
        "pos-terminal-root grid gap-3 pb-20 lg:grid-cols-[minmax(0,1fr)_var(--pos-cart-w)] lg:pb-0",
        fullscreen &&
          "fixed inset-0 z-[65] h-dvh overflow-y-auto bg-background p-3 lg:overflow-hidden",
      )}
    >
      {/* Products */}
      <ProductCatalog
        searchRef={searchRef}
        search={search}
        setSearch={setSearch}
        products={products}
        searching={searching}
        page={page}
        pageFull={pageFull}
        goToPage={goToPage}
        scanBarcode={scanBarcode}
        addProduct={addProduct}
        warehouses={warehouses}
        categories={categories}
        selectedWarehouse={selectedWarehouse}
        setSelectedWarehouse={setSelectedWarehouse}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        setReservationId={setReservationId}
        reservations={reservations}
        reservationId={reservationId}
        applyReservation={applyReservation}
        sessionOpen={sessionOpen}
        heldCount={heldCount}
        posOfflineEnabled={posOfflineEnabled}
        online={online}
        queuedCount={queuedCount}
        oldestQueuedAt={oldestQueuedAt}
        syncing={syncing}
        syncOfflineQueue={syncOfflineQueue}
        cart={cart}
        display={display}
        updateDisplay={updateDisplay}
        resetDisplay={resetDisplay}
        fullscreen={fullscreen}
        setFullscreenOverride={setFullscreenOverride}
        allowNegativeStock={allowNegativeStock}
      />

      {/* Cart + payment */}
      <aside
        id="pos-cart"
        className={cn(
          "hidden min-w-0 lg:block lg:overflow-x-hidden",
          // POS2-04: panel keranjang sticky saat produk menggulir.
          !fullscreen &&
            "lg:sticky lg:top-16 lg:max-h-[calc(100dvh-76px)] lg:self-start lg:overflow-y-auto lg:pr-1",
          fullscreen && "lg:min-h-0 lg:overflow-y-auto lg:pr-1",
        )}
      >
        <PosCheckoutWorkspace cartProps={cartPanelProps} paymentProps={paymentPanelProps} />
      </aside>

      <Sheet open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <SheetContent
          side="right"
          overlayClassName="z-[70]"
          showCloseButton={false}
          style={{ width: "100%" }}
          aria-label="Keranjang dan pembayaran"
          className="z-[71] w-full gap-3 overflow-x-hidden overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-0 sm:w-[520px] sm:max-w-[520px] lg:hidden"
        >
          <PosCheckoutWorkspace
            cartProps={cartPanelProps}
            paymentProps={paymentPanelProps}
            mobile
            onClose={() => setMobileCartOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <MobilePayBar
        cart={cart}
        total={total}
        payDisabled={payDisabled}
        payLabel={payLabel}
        checkout={checkout}
        onOpenCart={() => setMobileCartOpen(true)}
      />

      {holdOpen ? (
        <HoldDialog
          holdLabel={holdLabel}
          setHoldLabel={setHoldLabel}
          setHoldOpen={setHoldOpen}
          hold={hold}
        />
      ) : null}

      {/* POS2-02: dialog resume hanya bila keranjang aktif akan tertimpa. */}
      {resumeOffer ? (
        <ResumeDialog
          resumeOffer={resumeOffer}
          resumeHolding={resumeHolding}
          resumeHoldActiveFirst={resumeHoldActiveFirst}
          applyResume={applyResume}
          resumeCancel={resumeCancel}
        />
      ) : null}

      <CheckoutSuccessModal
        key={completedSale?.id ?? "no-sale"}
        sale={completedSale}
        onDismiss={() => {
          setCompletedSale(null);
          searchRef.current?.focus();
        }}
      />
    </div>
  );
}
