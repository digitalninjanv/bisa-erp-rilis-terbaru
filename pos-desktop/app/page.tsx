"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Banknote,
  ChevronRight,
  CircleHelp,
  Cloud,
  History,
  LogOut,
  Maximize2,
  Menu as MenuIcon,
  Monitor,
  Printer,
  RefreshCw,
  Settings2,
  UserRound,
  Wifi,
} from "lucide-react";
import { cashTenderSuggestions, dateAfterDays, formatIDR, isValidIsoDate, todayISODate } from "../lib/pos-native-format";
import { d } from "@shared/lib/money";
import { kitchenTicketAgeLabel } from "@shared/lib/pos/kitchen-display";
import {
  eligiblePromotions,
  promotionDiscountForLine,
  type PromotionLine,
  type PromotionRule,
} from "@shared/lib/pos/promotions";
import { CashierTool, LoadingSkeleton, ToolScreen, trapDialogTab, useDialogFocusRestore } from "./components/dialog-primitives";
import { CommandPalette, type CommandAction } from "./components/command-palette";
import { CartLine, MixedPaymentEntry, HeldCartPayload, restoreHeldCart, lineKey, lineUnitPrice, lineTotal, lineBaseQty, filterReservationsForCart } from "../lib/pos-native-cart";
import { ServerSaleHistoryDetail } from "./components/server-sale-detail";
import { computeLocalOfflineQuote } from "@shared/lib/pos/pos-offline";
import {
  buildCashierNameIndex,
  displayCashierName,
  formatShiftDate,
  sessionMatchesSearch,
  selectDefaultWarehouseId,
} from "../lib/pos-native-display";
import {
  canSubmitCheckout,
  createDebounced,
  isCashLikeMethod,
  isQrisMethod,
  requiresReceiptConfirmation,
} from "../lib/pos-native-checkout";
import {
  POS_CART_WIDTHS,
  usePosDisplayPrefs,
  type PosDisplayPrefs,
} from "@shared/components/pos/pos-display";
import {
  cashierEnroll,
  cashierLogin,
  cashierLoginContinue,
  checkUpdateNow,
  closeCashSession,
  closeCustomerDisplay,
  countCashSessions,
  customerDisplayOpen,
  currentCashSession,
  getCashSessionSyncStatus,
  getServerCashSessionSummary,
  getSnapshotGroupPricing,
  getDeviceStatus,
  getPrinterStatus,
  listCupsPrinters,
  getSnapshotInfo,
  getQrisImage,
  getSnapshotProductsByIds,
  getUpdateStatus,
  findLocalProductByCode,
  installUpdateNow,
  isTauri,
  deleteLocalHeldSale,
  listCashSessions,
  listSessionSaleCounts,
  listSessionPaymentTotals,
  listPaymentTotalsInRange,
  type SessionSaleCount,
  type SessionPaymentTotal,
  type PaymentMethodTotal,
  listLocalCategories,
  listLocalHeldSales,
  listLocalIntents,
  listLocalPaymentMethods,
  listLocalProductsPage,
  listLocalSalesPage,
  getServerSaleDetail,
  getServerSalesPage,
  saveLocalHeldSale,
  listSnapshotNames,
  listSnapshotWarehouses,
  listSnapshotReservations,
  listKitchenTickets,
  listSnapshotPromotions,
  listLoyaltyBalances,
  type SnapshotPromotion,
  type KitchenTicket,
  type SnapshotWarehouse,
  type SnapshotReservation,
  listOutboxPage,
  listPrintJobs,
  listServerReceiptPrintJobs,
  onEngineEvent,
  onPrintEvent,
  onUpdateEvent,
  openCashSession,
  previewCashSession,
  recordCashSessionMovement,
  openCustomerDisplay,
  openDrawer,
  printReceipt,
  retryPrintJob,
  retryServerReceiptPrintJob,
  printServerReceipt,
  retryCashSessionClose,
  retryCashSessionOpen,
  retryCashSessionMovement,
  recordLocalSale,
  runServerSaleAction,
  refreshSnapshot,
  setPrinterConfig,
  syncNow,
  testPrint,
  updateCustomerDisplay,
  type CashSession,
  type CashierLoginView,
  type Denomination,
  type DeviceRuntimeStatus,
  type LocalPackaging,
  type LocalCategory,
  type LocalHeldSale,
  type LocalIntent,
  type LocalPaymentMethod,
  type LocalProduct,
  type LocalProductPage,
  type LocalSalesPage,
  type ServerSaleAction,
  type ServerSaleDetailResponse,
  type ServerSalesPage,
  type OfflineSalePayload,
  type OutboxPage,
  type PrintJob,
  type ServerReceiptPrintJob,
  type PrinterStatus,
  type SnapshotInfo,
  type SnapshotGroupPricing,
  type SnapshotName,
  type UpdateStatus,
} from "../lib/pos-bridge";

/**
 * Halaman terminal desktop (Langkah 1–5) — PEMBUKTIAN jalur, bukan
 * terminal produksi: katalog dirender dari DATABASE LOKAL Rust,
 * penjualan dicatat atomik ke outbox lokal, dan seluruh HTTP ke
 * server (snapshot delta berkursor + drain outbox) dijalankan
 * MESIN RUST — halaman ini hanya invoke + mendengarkan event
 * `pos-engine`. Token perangkat tidak pernah ada di JS: form di
 * bawah menyerahkannya satu kali ke Rust dan sesudah itu hanya
 * status "terkonfigurasi" yang terlihat.
 *
 * Cetak (Langkah 5, D6): setiap penjualan tercatat bersama tugas
 * cetaknya dalam transaksi yang sama; pekerja cetak Rust
 * membangkitkan byte ESC/POS dari data lokal + blok pengaturan
 * cetak di snapshot, lalu mengirimnya via TCP ke printer jaringan
 * (laci menendang hanya untuk penjualan tunai, dalam aliran yang
 * sama). Kemajuan antrean tiba sebagai event `pos-print`;
 * kegagalan printer tidak pernah memblokir penjualan.
 *
 * Sesi kas lokal: buka sesi dengan modal awal, jual seperti biasa
 * (penjualan tertanda sesi), tutup secara BUTA — kasir mengisi
 * hitungan denominasi tanpa melihat angka harapan; selisih
 * dihitung Rust sesudah hitungan masuk dan dicatat sebagai fakta
 * lokal + intent antrean.
 *
 * Pembaruan aplikasi (Langkah 7, D4): Rust memeriksa endpoint
 * dinamis server secara berkala (keputusan per terminal: rollout
 * bertahap + versi minimum), mengunduh paket di latar selama
 * shift, dan memasangnya hanya saat tidak ada sesi kas terbuka —
 * atau saat pengguna memerintahkannya di sini. Keadaan tiba
 * sebagai event `pos-update` dan dirender panel Pembaruan.
 *
 * Kemasan (Program Satuan Kemasan S5): katalog lokal membawa
 * blok kemasan per produk dari snapshot; pindai barcode kemasan
 * atau chip kemasan menambah baris berkemasan berharga kemasan,
 * pemilih satuan per baris menukar satuan (qty diatur ulang ke
 * 1), dan muatan penjualan membawa packagingId + isiSnapshot +
 * harga per kemasan — kontrak S4 yang sama dengan antrean web,
 * sehingga server mengonversi dari cuplikan muatan.
 *
 * Layar pelanggan (Langkah 8): halaman ini melaporkan keadaan
 * keranjang ke Rust setiap berubah; Rust memetakannya
 * (displaymap) dan memancarkannya ke jendela kedua `display`
 * (rute /display) lewat event `pos-display`. Sesudah penjualan
 * tuntas, layar menampilkan ucapan terima kasih ±8 detik
 * sebelum kembali mengikuti keranjang. Tanpa layar kedua fitur
 * ini diam — tidak ada pekerjaan tambahan apa pun.
 */

const DENOMINATIONS = [
  "100000", "75000", "50000", "20000", "10000", "5000", "2000", "1000", "500", "200", "100",
];
const OUTBOX_PAGE_SIZE = 50;
const CATEGORY_ACCENTS = ["#8b5e83", "#4f7b78", "#9a7148", "#597392", "#897149", "#6e718f"];

function categoryAccent(categoryId: string): string {
  let hash = 0;
  for (let index = 0; index < categoryId.length; index += 1) {
    hash = (hash * 31 + categoryId.charCodeAt(index)) | 0;
  }
  return CATEGORY_ACCENTS[Math.abs(hash) % CATEGORY_ACCENTS.length];
}

function isCashMethod(method: LocalPaymentMethod | undefined): boolean {
  return isCashLikeMethod(method);
}

function paymentFeeEligible(method: LocalPaymentMethod | undefined): method is LocalPaymentMethod {
  return Boolean(
    method &&
      !isCashMethod(method) &&
      method.type !== "credit" &&
      method.type !== "customer_credit" &&
      method.feeEnabled &&
      method.feeType !== "none",
  );
}

function configuredPaymentFee(method: LocalPaymentMethod, base: number): string {
  if (method.feeType === "percent") {
    return d(base).mul(d(method.feeValue || 0)).div(100).toDecimalPlaces(2).toString();
  }
  return method.feeValue || "0";
}

function resolvePaymentFee(
  method: LocalPaymentMethod,
  base: number,
  override: string | undefined,
): { fee?: number; error?: string } {
  if (!paymentFeeEligible(method)) return {};
  const fee = Number(override ?? configuredPaymentFee(method, base));
  if (!Number.isFinite(fee) || fee < 0) return { error: "Biaya pembayaran harus berupa angka nol atau lebih." };
  if (d(fee).gte(d(base)) && base > 0) {
    return { error: `Biaya ${method.name} tidak boleh sama dengan atau melebihi nominal pembayarannya.` };
  }
  return { fee };
}

export default function DesktopTerminalPage() {
  const [inTauri] = useState<boolean>(() => isTauri());
  const checkoutClientKeyRef = useRef<string | null>(null);
  const { prefs: displayPrefs, update: updateDisplayPrefs, reset: resetDisplayPrefs } = usePosDisplayPrefs();
  const [serverUrl, setServerUrl] = useState("");
  const [authReady, setAuthReady] = useState(!isTauri());
  const [cashierActive, setCashierActive] = useState(false);
  const [loginView, setLoginView] = useState<CashierLoginView | null>(null);
  const [loginMode, setLoginMode] = useState<"password" | "twoFactor" | "company">("password");
  const [cashierEmail, setCashierEmail] = useState("");
  const [cashierPassword, setCashierPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [cashierMenuOpen, setCashierMenuOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<CashierTool | null>(null);
  const [sessionScreen, setSessionScreen] = useState<"current" | "history">("current");
  const [helpOpen, setHelpOpen] = useState(false);
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mobileCheckoutOpen, setMobileCheckoutOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [device, setDevice] = useState<DeviceRuntimeStatus | null>(null);
  const [info, setInfo] = useState<SnapshotInfo | null>(null);
  const [catalog, setCatalog] = useState<LocalProductPage>({
    products: [],
    total: 0,
    page: 1,
    pageSize: 50,
    pageCount: 0,
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogCategoryId, setCatalogCategoryId] = useState("");
  const [catalogCategories, setCatalogCategories] = useState<LocalCategory[]>([]);
  const [methods, setMethods] = useState<LocalPaymentMethod[]>([]);
  const [customers, setCustomers] = useState<SnapshotName[]>([]);
  const [groupPricing, setGroupPricing] = useState<SnapshotGroupPricing>({ groups: [], prices: [] });
  const [heldSales, setHeldSales] = useState<LocalHeldSale[]>([]);
  const [serverHeldSales, setServerHeldSales] = useState<ServerSalesPage>({
    rows: [], total: 0, page: 1, pageSize: 50, canVoid: false, canReturn: false,
  });
  const [serverHeldLoading, setServerHeldLoading] = useState(false);
  const [serverHeldError, setServerHeldError] = useState("");
  const [serverHeldVerified, setServerHeldVerified] = useState(false);
  const [activeHeldSaleId, setActiveHeldSaleId] = useState<string | null>(null);
  const [activeHeldServerSaleId, setActiveHeldServerSaleId] = useState<string | null>(null);
  const [activeHeldGroupId, setActiveHeldGroupId] = useState<string | null>(null);
  const [activeHeldTotal, setActiveHeldTotal] = useState<number | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<
    | { kind: "local"; sale: LocalHeldSale }
    | { kind: "server"; sale: ServerSalesPage["rows"][number] }
    | null
  >(null);
  const [heldPanelOpen, setHeldPanelOpen] = useState(false);
  const [heldDeleteCandidateId, setHeldDeleteCandidateId] = useState<string | null>(null);
  const [serverHeldDeleteCandidateId, setServerHeldDeleteCandidateId] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerFieldOpen, setCustomerFieldOpen] = useState(false);
  const [clearOrderOpen, setClearOrderOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [discountEditorKey, setDiscountEditorKey] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: OUTBOX_PAGE_SIZE,
    pageCount: 0,
  });
  const [outboxLoading, setOutboxLoading] = useState(false);
  const outboxPageRef = useRef(1);
  const outboxRequestRef = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySource, setHistorySource] = useState<"local" | "server">("local");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"" | "completed" | "returned" | "void" | "held">("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [localSalesHistory, setLocalSalesHistory] = useState<LocalSalesPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    pageCount: 0,
  });
  const historyRequestRef = useRef(0);
  const serverDetailRequestRef = useRef(0);
  const serverHeldRequestRef = useRef(0);
  const heldRequestRef = useRef<Extract<ServerSaleAction, { action: "hold" }> | null>(null);
  const [serverHistoryLoading, setServerHistoryLoading] = useState(false);
  const [serverSalesHistory, setServerSalesHistory] = useState<ServerSalesPage>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    canVoid: false,
    canReturn: false,
  });
  const [serverSaleDetail, setServerSaleDetail] = useState<ServerSaleDetailResponse | null>(null);
  const [serverDetailLoading, setServerDetailLoading] = useState(false);
  const [returnQtyByLine, setReturnQtyByLine] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnMethod, setReturnMethod] = useState<"cash" | "transfer" | "store_credit" | "exchange">("cash");
  const [returnDisposition, setReturnDisposition] = useState<"sellable" | "write_off">("sellable");
  const [voidReason, setVoidReason] = useState("");
  const [voidArmed, setVoidArmed] = useState(false);
  const [session, setSession] = useState<CashSession | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<CashSession[]>([]);
  const [cashierNames, setCashierNames] = useState<SnapshotName[]>([]);
  const [sessionSaleCounts, setSessionSaleCounts] = useState<SessionSaleCount[]>([]);
  const [sessionPaymentTotals, setSessionPaymentTotals] = useState<SessionPaymentTotal[]>([]);
  const [reportRange, setReportRange] = useState<"today" | "7d" | "30d" | "custom">("today");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportTotals, setReportTotals] = useState<PaymentMethodTotal[]>([]);
  const [reportTxCount, setReportTxCount] = useState(0);
  const [reportSalesTotal, setReportSalesTotal] = useState(0);
  const [reportLoading, setReportLoading] = useState(false);
  const [sessionHistoryIntents, setSessionHistoryIntents] = useState<LocalIntent[]>([]);
  const [sessionHistoryRefresh, setSessionHistoryRefresh] = useState(0);
  const [sessionHistoryLoading, setSessionHistoryLoading] = useState(false);
  const [sessionHistoryError, setSessionHistoryError] = useState("");
  const [sessionHistorySearch, setSessionHistorySearch] = useState("");
  const [sessionHistoryStatus, setSessionHistoryStatus] = useState<"all" | "open" | "closed">("all");
  const [sessionRetryReasons, setSessionRetryReasons] = useState<Record<string, string>>({});
  const [lastClosed, setLastClosed] = useState<CashSession | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [sessionDifferenceReason, setSessionDifferenceReason] = useState("");
  const [cashMovementType, setCashMovementType] = useState<"deposit" | "withdrawal">("deposit");
  const [cashMovementAmount, setCashMovementAmount] = useState("");
  const [cashMovementNotes, setCashMovementNotes] = useState("");
  const [closePreview, setClosePreview] = useState<{
    countedTotal: string;
    expectedTotal: string;
    differenceTotal: string;
    requiresReason: boolean;
  } | null>(null);
  const [closePreviewSource, setClosePreviewSource] = useState<"server" | "terminal" | null>(null);
  const [closePreviewNotice, setClosePreviewNotice] = useState("");
  const [printer, setPrinter] = useState<PrinterStatus | null>(null);
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  const [serverReceiptPrintJobs, setServerReceiptPrintJobs] = useState<ServerReceiptPrintJob[]>([]);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [printerHost, setPrinterHost] = useState("");
  const [printerPort, setPrinterPort] = useState("9100");
  const [printerPaper, setPrinterPaper] = useState("80");
  const [printerTransport, setPrinterTransport] = useState<"tcp" | "cups" | "device">("tcp");
  const [printerDevicePath, setPrinterDevicePath] = useState("");
  const [printerQueue, setPrinterQueue] = useState("");
  const [cupsPrinters, setCupsPrinters] = useState<string[]>([]);
  const [cupsPrintersLoading, setCupsPrintersLoading] = useState(false);
  const [cupsPrintersError, setCupsPrintersError] = useState("");
  const [drawerReason, setDrawerReason] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [splitPayment, setSplitPayment] = useState(false);
  const [mixedPayments, setMixedPayments] = useState<MixedPaymentEntry[]>([]);
  const [cashTendered, setCashTendered] = useState("");
  const [closeCountOpen, setCloseCountOpen] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState<{
    clientKey: string;
    status: string;
    total: number;
    cashReceived: number | null;
    change: number | null;
  } | null>(null);
  const [successCopyQueued, setSuccessCopyQueued] = useState(false);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const paymentMethodTriggerRef = useRef<HTMLButtonElement | null>(null);
  const customerSearchRef = useRef<HTMLInputElement | null>(null);
  const cashierMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const clearOrderTriggerRef = useRef<HTMLButtonElement | null>(null);
  const receiptTitleRef = useRef<HTMLHeadingElement | null>(null);
  /** Pengunci sinkron untuk checkout: state React saja tidak cukup untuk
   *  mencegah dua klik/Enter dalam satu frame sebelum re-render. */
  const checkoutSubmittingRef = useRef(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  /** Selama jendela waktu ini sesudah pembayaran, pembaruan
   *  keranjang kosong TIDAK menimpa ucapan terima kasih di layar
   *  pelanggan. */
  const displayHoldUntilRef = useRef(0);
  const catalogQueryRef = useRef({ search: catalogSearch, page: catalogPage, categoryId: catalogCategoryId });
  const catalogRequestRef = useRef(0);
  useEffect(() => {
    catalogQueryRef.current = { search: catalogSearch, page: catalogPage, categoryId: catalogCategoryId };
  }, [catalogSearch, catalogPage, catalogCategoryId]);
  const [methodId, setMethodId] = useState<string>("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentFee, setPaymentFee] = useState<string | undefined>();
  /** Kasir menyatakan dana non-tunai benar-benar diterima sebelum Bayar. */
  const [nonCashConfirmed, setNonCashConfirmed] = useState(false);
  const [qrisImage, setQrisImage] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<SnapshotWarehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [reservations, setReservations] = useState<SnapshotReservation[]>([]);
  const [kitchenTickets, setKitchenTickets] = useState<KitchenTicket[]>([]);
  const [promotions, setPromotions] = useState<SnapshotPromotion[]>([]);
  const [loyaltyBalances, setLoyaltyBalances] = useState<Map<string, number>>(new Map());
  const [selectedReservationId, setSelectedReservationId] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [darkTheme, setDarkTheme] = useState(false);

  // Fokus kembali ke elemen pemicu saat setiap dialog ditutup.
  useDialogFocusRestore(cashierMenuOpen);
  useDialogFocusRestore(clearOrderOpen);
  useDialogFocusRestore(helpOpen);
  useDialogFocusRestore(displaySettingsOpen);
  useDialogFocusRestore(historyOpen);
  useDialogFocusRestore(heldPanelOpen);
  useDialogFocusRestore(Boolean(resumeCandidate));
  useDialogFocusRestore(closeCountOpen);
  useDialogFocusRestore(checkoutOpen);
  useDialogFocusRestore(Boolean(saleSuccess));

  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string }>({
    kind: "info",
    text: "Siap.",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    if (!cashierActive && !cashierMenuOpen && !activeTool && !historyOpen && !heldPanelOpen && !displaySettingsOpen && !saleSuccess && !helpOpen && !clearOrderOpen && !checkoutOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === "F1" &&
        cashierActive &&
        !cashierMenuOpen &&
        !activeTool &&
        !historyOpen &&
        !heldPanelOpen &&
        !displaySettingsOpen &&
        !helpOpen &&
        !clearOrderOpen &&
        !saleSuccess &&
        !checkoutOpen &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        setMobileCheckoutOpen(false);
        setHelpOpen(true);
        return;
      }
      if (
        event.key === "F2" &&
        cashierActive &&
        !cashierMenuOpen &&
        !activeTool &&
        !historyOpen &&
        !heldPanelOpen &&
        !displaySettingsOpen &&
        !helpOpen &&
        !clearOrderOpen &&
        !saleSuccess &&
        !checkoutOpen &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        scanInputRef.current?.focus();
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (saleSuccess) return;
      if (helpOpen) {
        setHelpOpen(false);
        window.requestAnimationFrame(() => scanInputRef.current?.focus());
      } else if (cashierMenuOpen) {
        setCashierMenuOpen(false);
        window.requestAnimationFrame(() => cashierMenuTriggerRef.current?.focus());
      } else if (closeCountOpen) setCloseCountOpen(false);
      else if (clearOrderOpen) dismissClearOrder();
      else if (activeTool) {
        setActiveTool(null);
        window.requestAnimationFrame(() => scanInputRef.current?.focus());
      } else if (historyOpen) setHistoryOpen(false);
      else if (heldPanelOpen) setHeldPanelOpen(false);
      else if (displaySettingsOpen) setDisplaySettingsOpen(false);
      else if (checkoutOpen) {
        setCheckoutOpen(false);
        window.requestAnimationFrame(() => scanInputRef.current?.focus());
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [activeTool, cashierActive, cashierMenuOpen, clearOrderOpen, closeCountOpen, checkoutOpen, displaySettingsOpen, heldPanelOpen, helpOpen, historyOpen, saleSuccess]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setDarkTheme(window.localStorage.getItem("bisa.pos.theme") === "dark");
      } catch {
        setDarkTheme(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    setDarkTheme((current) => {
      const next = !current;
      try { window.localStorage.setItem("bisa.pos.theme", next ? "dark" : "light"); } catch { /* storage tidak tersedia */ }
      return next;
    });
  }

  // Ctrl+K membuka palette aksi dari konteks mana pun.
  useEffect(() => {
    const handleCommand = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCashierMenuOpen(false);
        setMobileCheckoutOpen(false);
        setCommandOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", handleCommand);
    return () => document.removeEventListener("keydown", handleCommand);
  }, []);

  useEffect(() => {
    if (saleSuccess) receiptTitleRef.current?.focus();
  }, [saleSuccess]);

  useEffect(() => {
    if (!cashierActive || !displayPrefs.autoFullscreen || document.fullscreenElement) return;
    void document.documentElement.requestFullscreen().catch(() => {
      setStatus({ kind: "info", text: "Layar penuh otomatis tidak tersedia di perangkat ini." });
    });
  }, [cashierActive, displayPrefs.autoFullscreen]);

  async function handleToggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      setStatus({ kind: "error", text: `Layar penuh tidak tersedia: ${String(error)}` });
    }
  }

  function openTool(tool: CashierTool) {
    setCashierMenuOpen(false);
    setMobileCheckoutOpen(false);
    setCheckoutOpen(false);
    if (tool === "session") requestSessionHistoryRefresh();
    setActiveTool(tool);
  }

  const requestSessionHistoryRefresh = useCallback(() => {
    setSessionHistoryLoading(true);
    setSessionHistoryError("");
    setSessionHistoryRefresh((value) => value + 1);
  }, []);

  function openSessionTool(screen: "current" | "history") {
    setSessionScreen(screen);
    openTool("session");
  }

  function closeCashierMenu() {
    setCashierMenuOpen(false);
    window.requestAnimationFrame(() => cashierMenuTriggerRef.current?.focus());
  }

  function closeHelp() {
    setHelpOpen(false);
    window.requestAnimationFrame(() => scanInputRef.current?.focus());
  }

  function closeTool() {
    setActiveTool(null);
    window.requestAnimationFrame(() => scanInputRef.current?.focus());
  }

  function dismissClearOrder() {
    setClearOrderOpen(false);
    window.requestAnimationFrame(() => clearOrderTriggerRef.current?.focus());
  }

  function openCustomerPicker() {
    openTool("customer");
    window.requestAnimationFrame(() => customerSearchRef.current?.focus());
  }

  function selectCustomer(customer: SnapshotName | null) {
    setSelectedCustomerId(customer?.id ?? "");
    setCustomerQuery(customer?.name ?? "");
    setCustomerFieldOpen(Boolean(customer));
    setActiveHeldGroupId(customer?.groupId ?? null);
    setActiveTool(null);
    setMobileCheckoutOpen(true);
    setStatus({
      kind: "ok",
      text: customer ? `${customer.name} dipilih untuk transaksi.` : "Transaksi menggunakan pelanggan umum.",
    });
  }

  function chooseCustomerFromPicker(customer: SnapshotName | null) {
    if (requiresCustomer && !customer) return;
    selectCustomer(customer);
  }

  function setDisplayPreference<K extends keyof PosDisplayPrefs>(key: K, value: PosDisplayPrefs[K]) {
    updateDisplayPrefs({ [key]: value } as Pick<PosDisplayPrefs, K>);
  }
  const loadCatalogPage = useCallback(async (search: string, page: number, categoryId = "") => {
    if (!isTauri()) return;
    const requestId = ++catalogRequestRef.current;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const nextCatalog = await listLocalProductsPage(search, page, 50, categoryId || null);
      if (requestId !== catalogRequestRef.current) return;
      setCatalog(nextCatalog);
      setCatalogPage(nextCatalog.page);
    } catch (error) {
      if (requestId === catalogRequestRef.current) {
        setCatalogError(String(error));
      }
    } finally {
      if (requestId === catalogRequestRef.current) setCatalogLoading(false);
    }
  }, []);

  const loadOutboxPage = useCallback(async (requestedPage = outboxPageRef.current) => {
    if (!isTauri()) return;
    const requestId = ++outboxRequestRef.current;
    setOutboxLoading(true);
    try {
      const nextOutbox = await listOutboxPage(requestedPage, OUTBOX_PAGE_SIZE);
      if (requestId !== outboxRequestRef.current) return;
      outboxPageRef.current = nextOutbox.page;
      setOutbox(nextOutbox);
    } catch (error) {
      if (requestId === outboxRequestRef.current) {
        setStatus({ kind: "error", text: `Gagal membaca antrean lokal: ${String(error)}` });
      }
    } finally {
      if (requestId === outboxRequestRef.current) setOutboxLoading(false);
    }
  }, []);

  const loadLocalSalesHistory = useCallback(async (
    requestedPage = 1,
    query = historyQuery,
    from = historyFrom,
    to = historyTo,
  ) => {
    if (!isTauri()) return;
    if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to)) || (from && to && from > to)) {
      setHistoryError("Rentang tanggal tidak valid. Pastikan tanggal awal tidak sesudah tanggal akhir.");
      return;
    }
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const nextHistory = await listLocalSalesPage(requestedPage, query, 50, from, to);
      if (requestId !== historyRequestRef.current) return;
      setLocalSalesHistory(nextHistory);
    } catch (error) {
      if (requestId === historyRequestRef.current) {
        setStatus({ kind: "error", text: `Gagal membaca riwayat lokal: ${String(error)}` });
      }
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  }, [historyQuery, historyFrom, historyTo]);

  const loadServerSalesHistory = useCallback(async (
    requestedPage = 1,
    query = historyQuery,
    status = historyStatus,
    from = historyFrom,
    to = historyTo,
  ) => {
    if (!isTauri()) return;
    if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to)) || (from && to && from > to)) {
      setHistoryError("Rentang tanggal tidak valid. Pastikan tanggal awal tidak sesudah tanggal akhir.");
      return;
    }
    const requestId = ++historyRequestRef.current;
    setServerHistoryLoading(true);
    setHistoryError("");
    try {
      const nextHistory = await getServerSalesPage(requestedPage, query, status, from, to);
      if (requestId !== historyRequestRef.current) return;
      setServerSalesHistory(nextHistory);
    } catch (error) {
      if (requestId === historyRequestRef.current) {
        setHistoryError(`Riwayat server tidak dapat dimuat: ${String(error)}`);
      }
    } finally {
      if (requestId === historyRequestRef.current) setServerHistoryLoading(false);
    }
  }, [historyQuery, historyStatus, historyFrom, historyTo]);

  useEffect(() => () => {
    outboxRequestRef.current += 1;
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    const timer = window.setTimeout(
      () => void loadCatalogPage(catalogSearch, catalogPage, catalogCategoryId),
      catalogSearch.trim() ? 180 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      catalogRequestRef.current += 1;
    };
  }, [inTauri, catalogSearch, catalogPage, catalogCategoryId, loadCatalogPage]);

  const loadServerHeldSales = useCallback(async (page = 1) => {
    const requestId = ++serverHeldRequestRef.current;
    setServerHeldLoading(true);
    setServerHeldVerified(false);
    try {
      const result = await getServerSalesPage(page, "", "held");
      if (requestId !== serverHeldRequestRef.current) return;
      setServerHeldSales(result);
      setServerHeldError("");
      setServerHeldVerified(true);
      if (result.rows.length >= result.total) {
        const cached = await listLocalHeldSales();
        const staleIds = cached
          .filter((held) => {
            const serverId = held.payload.serverHeldSaleId;
            return typeof serverId === "string" && !result.rows.some((row) => row.id === serverId);
          })
          .map((held) => held.id);
        if (staleIds.length > 0) {
          await Promise.all(staleIds.map((id) => deleteLocalHeldSale(id)));
          setHeldSales((current) => current.filter((held) => !staleIds.includes(held.id)));
        }
      }
    } catch (error) {
      if (requestId === serverHeldRequestRef.current) {
        setServerHeldError(String(error));
        setServerHeldVerified(false);
      }
    } finally {
      if (requestId === serverHeldRequestRef.current) setServerHeldLoading(false);
    }
  }, []);

  const refreshLocal = useCallback(async () => {
    if (!isTauri()) return;
    const nextInfo = await getSnapshotInfo();
    const catalogQuery = catalogQueryRef.current;
    const [
        ,
        nextMethods,
        nextCategories,
        nextCustomers,
        nextGroupPricing,
        nextHeldSales,
        ,
        nextDevice,
        nextSessionCount,
        nextPrinter,
        nextPrintJobs,
        nextServerReceiptPrintJobs,
        nextUpdate,
      ] = await Promise.all([
        loadCatalogPage(catalogQuery.search, catalogQuery.page, catalogQuery.categoryId),
        listLocalPaymentMethods(),
        listLocalCategories(),
        listSnapshotNames("customer"),
        getSnapshotGroupPricing(),
        listLocalHeldSales(),
        loadOutboxPage(outboxPageRef.current),
        getDeviceStatus(),
        countCashSessions(),
        getPrinterStatus(),
        listPrintJobs(),
        listServerReceiptPrintJobs(),
        getUpdateStatus(),
      ]);
      setInfo(nextInfo);
      setMethods(nextMethods);
      setCatalogCategories(nextCategories);
      if (catalogQuery.categoryId && !nextCategories.some((category) => category.id === catalogQuery.categoryId)) {
        setCatalogCategoryId("");
        setCatalogPage(1);
      }
      setCustomers(nextCustomers);
      setGroupPricing(nextGroupPricing);
      setHeldSales(nextHeldSales);
      setDevice(nextDevice);
      if (nextDevice.tokenConfigured) {
        void loadServerHeldSales();
      } else {
        serverHeldRequestRef.current += 1;
        setServerHeldSales({ rows: [], total: 0, page: 1, pageSize: 50, canVoid: false, canReturn: false });
        setServerHeldError("");
        setServerHeldLoading(false);
        setServerHeldVerified(false);
      }
      setSessionCount(nextSessionCount);
      setPrinter(nextPrinter);
      setPrintJobs(nextPrintJobs);
      setServerReceiptPrintJobs(nextServerReceiptPrintJobs);
      setUpdate(nextUpdate);
      setDisplayOpen(await customerDisplayOpen());
      setServerUrl((current) => current || nextDevice.serverUrl || "");
      setMethodId((current) => current || nextMethods[0]?.methodId || "");
      setPrinterHost((current) => current || nextPrinter.host || "");
      if (nextPrinter.configured) {
        setPrinterTransport(nextPrinter.transport);
        if (nextPrinter.transport === "cups") setPrinterQueue(nextPrinter.host);
        if (nextPrinter.transport === "device") setPrinterDevicePath(nextPrinter.host);
        setPrinterPort((current) =>
          current === "9100" || current === "" ? String(nextPrinter.port) : current,
        );
        setPrinterPaper((current) =>
          current === "80" && nextPrinter.paperWidthMm === 58 ? "58" : current,
        );
      }
      if (nextInfo.warehouseId) {
        setSession(await currentCashSession(nextInfo.warehouseId));
      }
  }, [loadCatalogPage, loadOutboxPage, loadServerHeldSales]);

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    (async () => {
      try {
        await refreshLocal();
      } catch (error) {
        if (!cancelled) {
          setStatus({ kind: "error", text: `Gagal membaca keadaan lokal: ${String(error)}` });
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inTauri, refreshLocal]);

  useEffect(() => {
    if (!inTauri || activeTool !== "session") return;
    let cancelled = false;
    void Promise.all([
      listCashSessions(), listLocalIntents(), listSessionSaleCounts(), listSessionPaymentTotals(),
    ])
      .then(([rows, intents, counts, payments]) => {
        if (!cancelled) {
          setSessionHistory(rows);
          setSessionSaleCounts(counts);
          setSessionPaymentTotals(payments);
          setSessionHistoryIntents(intents.filter((intent) =>
            intent.kind === "cash_session_open" ||
            intent.kind === "cash_session_close" ||
            intent.kind === "cash_session_movement",
          ));
          setSessionHistoryError("");
        }
      })
      .catch((error) => {
        if (!cancelled) setSessionHistoryError(`Riwayat sesi tidak dapat dibaca: ${String(error)}`);
      })
      .finally(() => {
        if (!cancelled) setSessionHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTool, inTauri, sessionCount, sessionHistoryRefresh]);

  // Direktori nama kasir dipakai supaya riwayat shift menampilkan nama
  // manusia, bukan potongan UUID `openedBy` dari database lokal.
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void listSnapshotNames("cashier")
      .then((rows) => { if (!cancelled) setCashierNames(rows); })
      .catch(() => { if (!cancelled) setCashierNames([]); });
    return () => { cancelled = true; };
  }, [inTauri]);

  // Gudang tersedia dari snapshot server — dipilih kasir saat buka shift.
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void listSnapshotWarehouses()
      .then((rows) => {
        if (!cancelled) {
          setWarehouses(rows);
          setSelectedWarehouseId((current) => current || selectDefaultWarehouseId(rows));
        }
      })
      .catch(() => { if (!cancelled) setWarehouses([]); });
    return () => { cancelled = true; };
  }, [inTauri]);

  // Reservasi stok aktif dari snapshot — dipilih saat checkout.
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void listSnapshotReservations()
      .then((rows) => { if (!cancelled) setReservations(rows); })
      .catch(() => { if (!cancelled) setReservations([]); });
    return () => { cancelled = true; };
  }, [inTauri]);

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void listLoyaltyBalances()
      .then((rows) => { if (!cancelled) setLoyaltyBalances(new Map(rows.map((r) => [r.customerId, r.points]))); })
      .catch(() => { if (!cancelled) setLoyaltyBalances(new Map()); });
    return () => { cancelled = true; };
  }, [inTauri]);

  // Promosi aktif dari snapshot server (diterapkan sebagai diskon baris).
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void listSnapshotPromotions()
      .then((rows) => { if (!cancelled) setPromotions(rows); })
      .catch(() => { if (!cancelled) setPromotions([]); });
    return () => { cancelled = true; };
  }, [inTauri]);

  // Tiket dapur diambil dari snapshot server (penjualan terakhir 24 jam).
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void listKitchenTickets()
      .then((rows) => { if (!cancelled) setKitchenTickets(rows); })
      .catch(() => { if (!cancelled) setKitchenTickets([]); });
    return () => { cancelled = true; };
  }, [inTauri, activeTool]);

  // Gambar QRIS statis diambil dari pengaturan perusahaan lewat snapshot.
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void getQrisImage()
      .then((image) => { if (!cancelled) setQrisImage(image); })
      .catch(() => { if (!cancelled) setQrisImage(null); });
    return () => { cancelled = true; };
  }, [inTauri]);

  // Laporan Harian — rentang Hari ini / 7 hari / 30 hari / custom
  // (mengikuti filter Laporan Harian Accurate POS).
  useEffect(() => {
    if (!inTauri || activeTool !== "report") return;
    const from = reportRange === "custom"
      ? reportFrom
      : reportRange === "today" ? todayISODate() : dateAfterDays(reportRange === "7d" ? -6 : -29);
    const to = reportRange === "custom" ? reportTo : todayISODate();
    if (!from || !to) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      setReportLoading(true);
      void Promise.all([
        listPaymentTotalsInRange(from, to),
        listLocalSalesPage(1, "", 100, from, to),
      ])
        .then(([totals, page]) => {
          if (!cancelled) {
            setReportTotals(totals);
            setReportTxCount(page.total);
            setReportSalesTotal(totals.reduce((sum, row) => sum + row.total, 0));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setReportTotals([]);
            setReportTxCount(0);
            setReportSalesTotal(0);
          }
        })
        .finally(() => { if (!cancelled) setReportLoading(false); });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [activeTool, inTauri, reportRange, reportFrom, reportTo]);

  // Progres mesin Rust tiba sebagai event: segarkan tampilan lokal
  // pada peristiwa penutup (per item cukup mengubah teks status).
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    // Event mesin dapat datang bertumpuk (satu pass menyentuh banyak
    // item). Coalesce agar tidak memicu 13 invoke × N event.
    const refreshSoon = createDebounced(() => {
      if (!disposed) void refreshLocal();
    }, 150);
    const historySoon = createDebounced(() => {
      if (!disposed) requestSessionHistoryRefresh();
    }, 150);
    onEngineEvent((event) => {
      if (disposed) return;
      if (event.kind === "item") {
        setStatus({
          kind: "info",
          text: `Sinkron transaksi #${event.clientKey.slice(0, 8)}: ${event.status}`,
        });
      } else if (event.kind === "authFailed") {
        setStatus({ kind: "error", text: `Akses terminal ditolak server: ${event.message}` });
        refreshSoon();
      } else if (event.kind === "offline") {
        setStatus({ kind: "error", text: `Sinkron tertunda (antrean utuh): ${event.message}` });
      } else if (
        event.kind === "passFinished" ||
        event.kind === "snapshotApplied"
      ) {
        refreshSoon();
        if (event.kind === "passFinished") historySoon();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      refreshSoon.cancel();
      historySoon.cancel();
      unlisten?.();
    };
  }, [inTauri, refreshLocal, requestSessionHistoryRefresh]);

  // Kemajuan pekerja cetak Rust: kegagalan terlihat di sini dan di
  // antrean — penjualan sendiri tidak pernah terpengaruh.
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    onPrintEvent((event) => {
      if (disposed) return;
      if (event.kind === "jobFailed") {
        setStatus({
          kind: "error",
          text: `Cetak ${event.clientKey.slice(0, 8)}… gagal (tetap mengantre): ${event.message}`,
        });
      } else if (event.kind === "serverJobFailed") {
        setStatus({
          kind: "error",
          text: `Cetak ulang nota ${event.saleId.slice(0, 8)}… gagal; tugas tersimpan untuk dicoba lagi: ${event.message}`,
        });
      } else if (event.kind === "serverJobPrinted") {
        setStatus({
          kind: "ok",
          text: `Data nota ${event.saleId.slice(0, 8)}… sudah dikirim ke printer. Periksa kertas; terminal tidak dapat memastikan keluaran fisik.`,
        });
      } else if (event.kind === "passFinished") {
        void refreshLocal();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [inTauri, refreshLocal]);

  // Keadaan updater Rust tiba utuh sebagai event `pos-update`:
  // panel Pembaruan selalu mencerminkan fase terakhir (tersedia /
  // terunduh / menunggu tutup sesi / memasang).
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    onUpdateEvent((next) => {
      if (disposed) return;
      setUpdate(next);
      if (next.phase === "failed" && next.message) {
        setStatus({ kind: "error", text: `Pembaruan: ${next.message}` });
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [inTauri]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedCustomerGroup = selectedCustomer?.groupId
    ? groupPricing.groups.find((group) => group.id === selectedCustomer.groupId) ?? null
    : null;
  const localQuote = useMemo(
    () => {
      const priceRules = Object.fromEntries(
        groupPricing.prices
          .filter((price) => price.groupId === selectedCustomerGroup?.id)
          .map((price) => [price.productId, { type: price.ruleType, value: price.value }]),
      );
      const catalog = Object.fromEntries(cart.map(({ product }) => [
        product.productId,
        {
          name: product.name,
          sku: product.sku,
          salePrice: product.salePrice,
          stock: product.stock,
          trackStock: product.trackStock,
          trackSerial: product.trackSerial,
          packagings: product.packagings.map((packaging) => ({
            id: packaging.packagingId,
            name: packaging.name,
            isi: packaging.isi,
            salePrice: packaging.salePrice,
          })),
        },
      ]));
      const quote = computeLocalOfflineQuote({
        lines: cart.map((line) => ({
          productId: line.product.productId,
          qty: line.qty,
          discountType: line.discountType ?? null,
          discountValue: line.discountValue ?? 0,
          packagingId: line.packaging?.packagingId ?? null,
        })),
        catalog,
        group: selectedCustomerGroup,
        priceRules,
        taxRate: info?.taxEnabled ? Number(info.taxRate) : 0,
        companyRoundingMode: info?.roundingMode ?? "none",
      });
      return quote;
    },
    [cart, groupPricing, info, selectedCustomerGroup],
  );
  const cartTotal = localQuote?.total ?? cart.reduce((sum, line) => sum + lineTotal(line), 0);
  const selectedMethod = methods.find((method) => method.methodId === methodId);
  const usesReceivable = splitPayment
    ? mixedPayments.some((entry) =>
        Number(entry.amount) > 0 && methods.find((method) => method.methodId === entry.methodId)?.type === "credit",
      )
    : selectedMethod?.type === "credit";
  const requiresCustomer = splitPayment
    ? mixedPayments.some((entry) =>
        Number(entry.amount) > 0 && ["credit", "customer_credit"].includes(methods.find((method) => method.methodId === entry.methodId)?.type ?? ""),
      )
    : ["credit", "customer_credit"].includes(selectedMethod?.type ?? "");
  const customerMatches = customerQuery.trim()
    ? customers.filter((customer) => customer.name.toLocaleLowerCase().includes(customerQuery.trim().toLocaleLowerCase())).slice(0, 8)
    : [];
  const customerPickerMatches = useMemo(() => {
    const query = customerQuery.trim().toLocaleLowerCase("id-ID");
    const matches = query
      ? customers.filter((customer) => customer.name.toLocaleLowerCase("id-ID").includes(query))
      : customers;
    return matches.slice(0, 50);
  }, [customerQuery, customers]);
  const isCashPayment = isCashMethod(selectedMethod);
  const activeWarehouseId = selectedWarehouseId || info?.warehouseId || "";
  const cartReservationOptions = filterReservationsForCart(reservations, cart);
  const promotionRules: PromotionRule[] = promotions.map((promo) => ({
    id: promo.id,
    name: promo.name,
    type: promo.type,
    value: Number(promo.value),
    minSubtotal: Number(promo.minSubtotal),
    productId: promo.productId,
  }));
  const promotionLines: PromotionLine[] = cart.map((line) => ({
    productId: line.product.productId,
    qty: line.qty,
    unitPrice: lineUnitPrice(line),
    discountType: line.discountType ?? null,
    discountValue: line.discountValue ?? 0,
  }));
  const availablePromotions = eligiblePromotions(promotionLines, promotionRules);
  const needsReceiptConfirmation = splitPayment
    ? mixedPayments.some((entry) => requiresReceiptConfirmation(methods.find((m) => m.methodId === entry.methodId)))
    : requiresReceiptConfirmation(selectedMethod);
  const submitDisabled =
    !inTauri ||
    info?.posOfflineEnabled !== true ||
    Boolean(device?.authFailed) ||
    (splitPayment && mixedPayments.filter((entry) => entry.amount.trim() !== "").length < 2) ||
    !canSubmitCheckout({
      cartCount: cart.length,
      sessionOpen: Boolean(session),
      methodSelected: splitPayment ? mixedPayments.length >= 2 : Boolean(methodId && selectedMethod),
      busy,
      needsConfirmation: checkoutOpen && needsReceiptConfirmation,
      confirmed: nonCashConfirmed,
    });
  const mixedAllocated = mixedPayments.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const mixedRemainder = cartTotal - mixedAllocated;
  const cashQuickAmounts = useMemo(() => cashTenderSuggestions(cartTotal), [cartTotal]);
  const originalPrintJob = saleSuccess
    ? printJobs.find((job) => job.clientKey === saleSuccess.clientKey && job.copyIndex === 0) ?? null
    : null;

  // ------------------------------------------------------------------
  // Layar pelanggan (Langkah 8): laporkan keadaan keranjang ke
  // Rust; pemetaan & pancaran event milik Rust (displaymap).
  // ------------------------------------------------------------------

  const pushDisplayCart = useCallback(() => {
    if (!isTauri()) return;
    void updateCustomerDisplay({
      storeName: info?.terminal?.companyName ?? device?.companyName ?? null,
      phase: "cart",
      lines: cart.map((line, index) => ({
        name: line.packaging
          ? `${line.product.name} (${line.packaging.name})`
          : line.product.name,
        qty: line.qty,
        unitPrice: String(line.packaging
          ? lineUnitPrice(line)
          : localQuote?.lines[index]?.groupUnitPrice ?? lineUnitPrice(line)),
        lineTotal: String(localQuote?.lines[index]?.lineTotal ?? lineTotal(line)),
        discountAmount: String(localQuote?.lines[index]?.discountAmount ?? 0),
      })),
      cartTotal: String(cartTotal),
      paidTotal: null,
    }).catch(() => {
      /* Layar pelanggan adalah fitur diam: kegagalan melapor
         tidak pernah mengganggu kasir. */
    });
  }, [cart, cartTotal, info, device, localQuote]);

  const pushDisplayRef = useRef(pushDisplayCart);
  useEffect(() => {
    pushDisplayRef.current = pushDisplayCart;
  }, [pushDisplayCart]);

  useEffect(() => {
    // Keranjang kosong tepat sesudah pembayaran tidak menimpa
    // ucapan terima kasih yang sedang tampil.
    if (cart.length === 0 && Date.now() < displayHoldUntilRef.current) return;
    pushDisplayCart();
  }, [pushDisplayCart, cart.length]);

  async function handleToggleDisplay() {
    setBusy(true);
    try {
      if (displayOpen) {
        await closeCustomerDisplay();
        setDisplayOpen(false);
        setStatus({ kind: "info", text: "Layar pelanggan ditutup." });
      } else {
        await openCustomerDisplay();
        setDisplayOpen(true);
        pushDisplayRef.current();
        setStatus({
          kind: "ok",
          text: "Layar pelanggan terbuka (monitor kedua bila tersedia, selain itu jendela biasa).",
        });
      }
    } catch (error) {
      setStatus({ kind: "error", text: `Layar pelanggan gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  const countedPreview = useMemo(
    () =>
      DENOMINATIONS.reduce(
        (sum, denom) => sum + Number(denom) * (Number(counts[denom]) || 0),
        0,
      ),
    [counts],
  );
  const cashierNameIndex = useMemo(() => buildCashierNameIndex(cashierNames), [cashierNames]);
  const saleCountBySession = useMemo(
    () => new Map(sessionSaleCounts.map((entry) => [entry.sessionId, entry.count])),
    [sessionSaleCounts],
  );
  const paymentTotalsBySession = useMemo(() => {
    const bySession = new Map<string, Array<{ methodId: string; label: string; total: number }>>();
    for (const row of sessionPaymentTotals) {
      const label = methods.find((method) => method.methodId === row.methodId)?.name ?? `Metode ${row.methodId.slice(0, 6)}`;
      const rows = bySession.get(row.sessionId) ?? [];
      rows.push({ methodId: row.methodId, label, total: row.total });
      bySession.set(row.sessionId, rows);
    }
    return bySession;
  }, [sessionPaymentTotals, methods]);
  const sessionCashierName = useCallback(
    (openedBy: string | null | undefined) => displayCashierName(openedBy, cashierNameIndex),
    [cashierNameIndex],
  );
  const filteredSessionHistory = useMemo(() => {
    return sessionHistory.filter((entry) => {
      if (sessionHistoryStatus !== "all" && entry.status !== sessionHistoryStatus) return false;
      return sessionMatchesSearch(entry, sessionCashierName(entry.openedBy), sessionHistorySearch);
    });
  }, [sessionHistory, sessionHistorySearch, sessionHistoryStatus, sessionCashierName]);
  const sessionSyncById = useMemo(() => {
    const bySession = new Map<string, { open?: string; openIntent?: LocalIntent; close?: string; closeIntent?: LocalIntent; movements: LocalIntent[] }>();
    for (const intent of sessionHistoryIntents) {
      const sessionId = typeof intent.payload.sessionId === "string" ? intent.payload.sessionId : "";
      if (!sessionId) continue;
      const status = bySession.get(sessionId) ?? { movements: [] };
      if (intent.kind === "cash_session_open") {
        status.open = intent.status;
        status.openIntent = intent;
      }
      if (intent.kind === "cash_session_close") {
        status.close = intent.status;
        status.closeIntent = intent;
      }
      if (intent.kind === "cash_session_movement") status.movements.push(intent);
      bySession.set(sessionId, status);
    }
    return bySession;
  }, [sessionHistoryIntents]);
  const currentSessionMovements = session
    ? sessionSyncById.get(session.id)?.movements ?? []
    : [];
  const currentSessionSync = session ? sessionSyncById.get(session.id) : undefined;
  const serverHeldIds = useMemo(
    () => new Set(serverHeldSales.rows.map((held) => held.id)),
    [serverHeldSales.rows],
  );
  const visibleLocalHeldSales = useMemo(
    () => heldSales.filter((held) => {
      const serverId = held.payload.serverHeldSaleId;
      if (typeof serverId !== "string" || !serverHeldVerified) return true;
      // Saat server hidup, baris server adalah sumber yang berwenang.
      // Jangan tampilkan cermin lokalnya pada halaman lain sebagai duplikat.
      return false;
    }),
    [heldSales, serverHeldVerified],
  );

  async function finishCashierLogin(companyId: string) {
    setBusy(true);
    setLoginError(null);
    try {
      const next = await cashierEnroll(companyId);
      setDevice(next);
      setCashierActive(true);
      setLoginView(null);
      setLoginMode("password");
      setCashierPassword("");
      setTwoFactorCode("");
      setStatus({
        kind: "ok",
        text: next.offlineLoginReady
          ? `Siap melayani sebagai ${next.cashierName ?? "kasir"}. Login offline tersedia selama 7 hari sejak login ini.`
          : `Siap melayani sebagai ${next.cashierName ?? "kasir"}. Login offline belum tersimpan di keychain OS.`,
      });
      await refreshLocal();
    } catch (error) {
      setLoginError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCashierLogin() {
    setBusy(true);
    setLoginError(null);
    try {
      const view = await cashierLogin({ serverUrl, email: cashierEmail, password: cashierPassword });
      setLoginView(view);
      setCashierPassword("");
      if (view.step === "offlineAuthenticated") {
        setCashierActive(true);
        setLoginView(null);
        setLoginMode("password");
        setStatus({ kind: "info", text: `Mode offline: penjualan ${view.cashier.name} tersimpan di perangkat sampai server dapat dijangkau.` });
        try {
          await refreshLocal();
        } catch (error) {
          setStatus({ kind: "error", text: `Kasir terbuka offline, tetapi data lokal gagal dimuat: ${String(error)}` });
        }
        return;
      }
      if (view.step === "twoFactor") {
        setLoginMode("twoFactor");
        return;
      }
      const companyId = view.selectedCompanyId ?? (view.companies.length === 1 ? view.companies[0].id : "");
      setSelectedCompanyId(companyId);
      setLoginMode("company");
      if (companyId) await finishCashierLogin(companyId);
    } catch (error) {
      setLoginError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCashierTwoFactor() {
    setBusy(true);
    setLoginError(null);
    try {
      const view = await cashierLoginContinue(twoFactorCode);
      setLoginView(view);
      setTwoFactorCode("");
      if (view.step === "twoFactor") return;
      if (view.step !== "authenticated") return;
      const companyId = view.selectedCompanyId ?? (view.companies.length === 1 ? view.companies[0].id : "");
      setSelectedCompanyId(companyId);
      setLoginMode("company");
      if (companyId) await finishCashierLogin(companyId);
    } catch (error) {
      setLoginError(String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleCashierLogout() {
    if (session || outbox.total > 0) {
      setStatus({
        kind: "error",
        text: "Tutup sesi kas dan sinkronkan transaksi terlebih dahulu sebelum keluar dari kasir.",
      });
      return;
    }
    setCashierActive(false);
    setLoginView(null);
    setLoginMode("password");
    setCashierPassword("");
    setStatus({ kind: "info", text: "Kasir keluar. Terminal tetap terdaftar di perangkat ini." });
  }

  async function handleRefreshSnapshot() {
    setBusy(true);
    try {
      const summary = await refreshSnapshot();
      await refreshLocal();
      setStatus({
        kind: "ok",
        text:
          summary.mode === "delta"
            ? `Delta diterapkan: ${summary.products} berubah, ${summary.removed} dibuang.`
            : `Snapshot penuh diterapkan: ${summary.products} produk.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Snapshot gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow() {
    setBusy(true);
    try {
      const summary = await syncNow();
      await refreshLocal();
      if (!summary) {
        setStatus({ kind: "info", text: "Drain sedang berjalan atau perangkat belum dikonfigurasi." });
      } else if (summary.authFailed) {
        setStatus({ kind: "error", text: `Token ditolak server — terminal mungkin dicabut admin; pasangkan ulang. (${summary.error ?? ""})` });
      } else if (summary.error) {
        setStatus({ kind: "error", text: `Sinkron tertunda (antrean utuh): ${summary.error}` });
      } else {
        setStatus({
          kind: "ok",
          text: `Sinkron selesai: ${summary.synced} terkirim, ${summary.held} ditahan, sisa pending ${summary.remaining}.`,
        });
      }
    } catch (error) {
      setStatus({ kind: "error", text: `Sinkron gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckUpdate() {
    setBusy(true);
    try {
      const next = await checkUpdateNow();
      setUpdate(next);
      if (next.phase === "upToDate") {
        setStatus({ kind: "ok", text: `Aplikasi sudah versi terkini (${next.currentVersion}).` });
      } else if (next.phase === "failed") {
        setStatus({ kind: "error", text: `Pemeriksaan pembaruan gagal: ${next.message ?? "tidak diketahui"}` });
      } else {
        setStatus({
          kind: "info",
          text: `Pembaruan ${next.availableVersion ?? ""} ${next.phase === "waitingSession" ? "terunduh — menunggu sesi kas ditutup untuk dipasang." : "sedang disiapkan Rust."}`,
        });
      }
    } catch (error) {
      setStatus({ kind: "error", text: `Pemeriksaan pembaruan gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleInstallUpdate() {
    setBusy(true);
    try {
      const next = await installUpdateNow();
      setUpdate(next);
      setStatus({
        kind: "info",
        text:
          next.phase === "installing"
            ? "Memasang pembaruan — aplikasi akan dimulai ulang."
            : `Pemasangan belum berjalan (fase: ${next.phase}).`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Pemasangan pembaruan gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePrinter() {
    setBusy(true);
    try {
      const next = await setPrinterConfig({
        transport: printerTransport,
        host: printerTransport === "cups" ? printerQueue : printerTransport === "device" ? printerDevicePath : printerHost,
        port: Number(printerPort) || 9100,
        paperWidthMm: Number(printerPaper) || 80,
      });
      setPrinter(next);
      await refreshLocal();
      setStatus({ kind: "ok", text: "Konfigurasi printer tersimpan di Rust (printer.json)." });
    } catch (error) {
      setStatus({ kind: "error", text: `Konfigurasi printer gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleTestPrint() {
    setBusy(true);
    try {
      await testPrint();
      setStatus({ kind: "ok", text: "Tes cetak terkirim ke printer — periksa kertasnya." });
    } catch (error) {
      setStatus({ kind: "error", text: `Tes cetak gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshCupsPrinters() {
    setCupsPrintersLoading(true);
    setCupsPrintersError("");
    try {
      const queues = await listCupsPrinters();
      setCupsPrinters(queues);
      setPrinterQueue((current) => current && queues.includes(current) ? current : queues[0] ?? "");
    } catch (error) {
      setCupsPrintersError(`Daftar printer lokal tidak dapat dibaca: ${String(error)}`);
    } finally {
      setCupsPrintersLoading(false);
    }
  }

  async function handleOpenDrawer() {
    if (!drawerReason.trim()) {
      setStatus({ kind: "error", text: "Isi alasan membuka laci terlebih dahulu (wajib tercatat)." });
      return;
    }
    setBusy(true);
    try {
      await openDrawer(drawerReason.trim());
      setDrawerReason("");
      setStatus({ kind: "ok", text: "Laci dibuka; percobaan tercatat sebagai event lokal." });
    } catch (error) {
      setStatus({
        kind: "error",
        text: `Buka laci gagal (percobaan tetap tercatat): ${String(error)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  function handleOpenHistory() {
    setMobileCheckoutOpen(false);
    setHistoryQuery("");
    setHistoryStatus("");
    setHistoryError("");
    setHistorySource("local");
    setServerSaleDetail(null);
    setHistoryOpen(true);
    void loadLocalSalesHistory(1, "");
  }

  async function handleOpenServerSale(saleId: string, keepCurrentDetail = false) {
    const requestId = ++serverDetailRequestRef.current;
    if (!keepCurrentDetail) setServerSaleDetail(null);
    setServerDetailLoading(true);
    try {
      const result = await getServerSaleDetail(saleId);
      if (requestId !== serverDetailRequestRef.current) return;
      // A successful server read resolves an earlier ambiguous return or
      // void request before the cashier changes the pending action.
      try {
        localStorage.removeItem(`bisa-pos:desktop-return:${saleId}`);
        localStorage.removeItem(`bisa-pos:desktop-void:${saleId}`);
      } catch {
        // The detail can still be refreshed when browser storage is unavailable.
      }
      setServerSaleDetail(result);
      setReturnQtyByLine({});
      setReturnReason("");
      setReturnMethod("cash");
      setReturnDisposition("sellable");
      setVoidReason("");
      setVoidArmed(false);
    } catch (error) {
      if (requestId === serverDetailRequestRef.current) {
        setHistoryError(`Detail transaksi tidak dapat dimuat: ${String(error)}`);
      }
    } finally {
      if (requestId === serverDetailRequestRef.current) setServerDetailLoading(false);
    }
  }

  async function handleSubmitServerVoid(saleId: string) {
    const reason = voidReason.trim();
    if (reason.length < 3) {
      setStatus({ kind: "error", text: "Alasan void minimal 3 karakter." });
      return;
    }

    const fingerprint = JSON.stringify({ saleId, reason });
    const storageKey = `bisa-pos:desktop-void:${saleId}`;
    let idempotencyKey = "";
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as
        | { fingerprint?: string; key?: string }
        | null;
      if (stored && stored.fingerprint !== fingerprint) {
        setStatus({
          kind: "error",
          text: "Permintaan void sebelumnya belum terkonfirmasi. Muat ulang status nota sebelum mengubah alasan atau mencoba void lain.",
        });
        return;
      }
      idempotencyKey = stored?.fingerprint === fingerprint && typeof stored.key === "string"
        ? stored.key
        : crypto.randomUUID();
      localStorage.setItem(storageKey, JSON.stringify({ fingerprint, key: idempotencyKey }));
    } catch (error) {
      setStatus({
        kind: "error",
        text: `Void belum dikirim karena kunci pengaman tidak dapat disimpan di perangkat: ${String(error)}`,
      });
      return;
    }

    setBusy(true);
    try {
      await runServerSaleAction({ action: "void", saleId, idempotencyKey, reason });
      try { localStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
      setStatus({ kind: "ok", text: "Transaksi berhasil di-void melalui server." });
      setServerSaleDetail(null);
      setVoidReason("");
      setVoidArmed(false);
      await loadServerSalesHistory(serverSalesHistory.page, historyQuery, historyStatus);
    } catch (error) {
      setStatus({
        kind: "error",
        text: `Status void belum terkonfirmasi: ${String(error)}. Ulangi dengan alasan yang sama atau muat ulang status nota sebelum mengubah alasan.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitServerReturn(detail: ServerSaleDetailResponse["detail"]) {
    if (returnReason.trim().length < 3) {
      setStatus({ kind: "error", text: "Alasan retur minimal 3 karakter." });
      return;
    }
    const returnLines: Array<{ productId: string; saleLineId: string; qty: number }> = [];
    for (const line of detail.lines) {
      const qty = Number(returnQtyByLine[line.id] ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (qty > line.remainingQtyInput) {
        setStatus({ kind: "error", text: `Jumlah retur ${line.productName} melebihi sisa jumlah pada nota asal.` });
        return;
      }
      returnLines.push({ productId: line.productId, saleLineId: line.id, qty });
    }
    if (returnLines.length === 0) {
      setStatus({ kind: "error", text: "Masukkan jumlah barang yang diterima kembali." });
      return;
    }

    const fingerprint = JSON.stringify({
      saleId: detail.sale.id,
      lines: returnLines,
      reason: returnReason.trim(),
      refundMethod: returnMethod,
      disposition: returnDisposition,
    });
    const storageKey = `bisa-pos:desktop-return:${detail.sale.id}`;
    let idempotencyKey = "";
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { fingerprint?: string; key?: string } | null;
      if (stored && stored.fingerprint !== fingerprint) {
        setStatus({
          kind: "error",
          text: "Permintaan retur sebelumnya belum terkonfirmasi. Muat ulang status nota terlebih dahulu; jumlah retur baru akan dihitung dari data server.",
        });
        return;
      }
      idempotencyKey = stored?.fingerprint === fingerprint && typeof stored.key === "string"
        ? stored.key
        : crypto.randomUUID();
      localStorage.setItem(storageKey, JSON.stringify({ fingerprint, key: idempotencyKey }));
    } catch (error) {
      setStatus({ kind: "error", text: `Retur belum dikirim karena kunci idempotensi tidak dapat disimpan di perangkat: ${String(error)}` });
      return;
    }

    setBusy(true);
    try {
      const result = await runServerSaleAction({
        action: "return",
        saleId: detail.sale.id,
        idempotencyKey,
        disposition: returnDisposition,
        reason: returnReason.trim(),
        refundMethod: returnMethod,
        type: returnMethod === "exchange" ? "exchange" : "return",
        lines: returnLines,
      });
      try { localStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
      const number = typeof result.number === "string" ? result.number : "transaksi";
      setStatus({
        kind: "ok",
        text: returnMethod === "exchange"
          ? `Retur ${number} berhasil. Buat transaksi baru untuk barang pengganti dan pilih Kredit pelanggan dengan nomor dokumen ${number}.`
          : returnMethod === "store_credit"
            ? `Retur ${number} berhasil. Kredit pelanggan dapat digunakan pada transaksi berikutnya dengan nomor dokumen ${number}.`
            : `Retur ${number} berhasil diproses melalui server.`,
      });
      await handleOpenServerSale(detail.sale.id, true);
      await loadServerSalesHistory(serverSalesHistory.page, historyQuery, historyStatus);
    } catch (error) {
      setStatus({
        kind: "error",
        text: `Status retur belum terkonfirmasi: ${String(error)}. Ulangi dengan rincian yang sama atau muat ulang status nota sebelum mengubah jumlah.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleHistoryReprint(clientKey: string) {
    setBusy(true);
    try {
      const copy = await printReceipt(clientKey);
      await refreshLocal();
      setStatus({ kind: "ok", text: `Cetak ulang masuk antrean sebagai salinan ke-${copy.copyIndex}.` });
    } catch (error) {
      setStatus({ kind: "error", text: `Cetak ulang gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleServerHistoryReprint(saleId: string) {
    setBusy(true);
    try {
      const job = await printServerReceipt(saleId);
      await refreshLocal();
      setStatus({ kind: "ok", text: `Cetak ulang nota server masuk antrean (${job.id.slice(0, 8)}…). Status dan percobaan ulang tersedia di menu printer.` });
    } catch (error) {
      setStatus({ kind: "error", text: `Cetak ulang nota server gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryServerReceiptPrint(job: ServerReceiptPrintJob) {
    if (!window.confirm("Pengiriman sebelumnya bisa saja sudah sampai ke printer sebelum koneksi terputus. Pastikan nota tidak sudah keluar sebelum mencoba ulang agar tidak mencetak duplikat.")) return;
    setBusy(true);
    try {
      await retryServerReceiptPrintJob(job.id);
      await refreshLocal();
      setStatus({ kind: "ok", text: `Nota server ${job.saleId.slice(0, 8)}… dimasukkan kembali ke antrean.` });
    } catch (error) {
      setStatus({ kind: "error", text: `Percobaan ulang nota server gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleReprint(job: PrintJob) {
    setBusy(true);
    try {
      const copy = await printReceipt(job.clientKey);
      await refreshLocal();
      setStatus({
        kind: "ok",
        text: `Cetak ulang nota #${job.clientKey.slice(0, 8)} mengantre sebagai salinan ke-${copy.copyIndex} (pita SALINAN).`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Cetak ulang gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  function handleBeginCheckout() {
    if (info?.posOfflineEnabled !== true) {
      setStatus({
        kind: "error",
        text: "Mode offline POS belum aktif pada perusahaan ini. Segarkan snapshot setelah administrator mengaktifkannya sebelum menerima pembayaran.",
      });
      return;
    }
    if (cart.length === 0) {
      setStatus({ kind: "info", text: "Pindai barcode atau pilih produk sebelum melanjutkan ke pembayaran." });
      return;
    }
    if (!session) {
      setStatus({ kind: "info", text: "Buka sesi kasir terlebih dahulu. Keranjang tetap tersimpan saat Anda kembali." });
      openSessionTool("current");
      return;
    }
    setStatus({ kind: "info", text: "Pilih metode pembayaran, lalu periksa kembali total dan kembalian." });
    setMobileCheckoutOpen(false);
    setCheckoutOpen(true);
    window.requestAnimationFrame(() => paymentMethodTriggerRef.current?.focus());
  }

  function getCheckoutClientKey() {
    if (checkoutClientKeyRef.current) return checkoutClientKeyRef.current;
    const storageKey = "bisa-pos-desktop-pending-checkout-key";
    const isUuid = (value: string | null): value is string =>
      Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
    let key: string | null = null;
    try {
      const stored = window.localStorage.getItem(storageKey);
      key = isUuid(stored) ? stored : null;
      if (!key) {
        key = crypto.randomUUID();
        window.localStorage.setItem(storageKey, key);
      }
    } catch {
      key = crypto.randomUUID();
    }
    checkoutClientKeyRef.current = key;
    return key;
  }

  function clearCheckoutClientKey(key: string) {
    checkoutClientKeyRef.current = null;
    try {
      if (window.localStorage.getItem("bisa-pos-desktop-pending-checkout-key") === key) {
        window.localStorage.removeItem("bisa-pos-desktop-pending-checkout-key");
      }
    } catch {
      // The in-memory key is still cleared after the local transaction is confirmed.
    }
  }

  async function handlePrintSuccessCopy(clientKey: string) {
    if (successCopyQueued) return;
    setBusy(true);
    try {
      const copy = await printReceipt(clientKey);
      await refreshLocal();
      setSuccessCopyQueued(true);
      setStatus({ kind: "ok", text: `Salinan nota masuk antrean cetak ke-${copy.copyIndex}.` });
    } catch (error) {
      setStatus({ kind: "error", text: `Cetak salinan gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryOriginalPrint(job: PrintJob) {
    if (!window.confirm("Pengiriman sebelumnya bisa saja sudah sampai ke printer sebelum koneksi terputus. Pastikan nota tidak sudah keluar sebelum mencoba ulang agar tidak mencetak duplikat.")) return;
    setBusy(true);
    try {
      await retryPrintJob(job.id);
      await refreshLocal();
      setStatus({ kind: "ok", text: `Tugas nota ${job.copyIndex === 0 ? "asli" : `salinan ke-${job.copyIndex}`} dimasukkan kembali ke antrean cetak.` });
    } catch (error) {
      setStatus({ kind: "error", text: `Cetak ulang nota asli gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  function closeSaleSuccess() {
    setSaleSuccess(null);
    window.requestAnimationFrame(() => scanInputRef.current?.focus());
  }

  async function handleHoldSale(): Promise<boolean> {
    if (cart.length === 0) {
      setStatus({ kind: "error", text: "Keranjang masih kosong." });
      return false;
    }
    setBusy(true);
    try {
      const id = activeHeldSaleId ?? crypto.randomUUID();
      const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
      const timeLabel = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      const label = selectedCustomer ? `Pesanan ${selectedCustomer.name}` : `Pesanan ${timeLabel}`;
      let heldOnServer = false;
      let serverHeldSaleId: string | null = null;
      let pendingServerHold: Extract<ServerSaleAction, { action: "hold" }> | undefined;
      if (!activeHeldSaleId && !activeHeldServerSaleId && device?.tokenConfigured && !device.authFailed && activeWarehouseId) {
        const idempotencyKey = heldRequestRef.current?.idempotencyKey ?? crypto.randomUUID();
        const holdRequest: Extract<ServerSaleAction, { action: "hold" }> = {
          action: "hold",
          idempotencyKey,
          warehouseId: activeWarehouseId,
          groupId: selectedCustomer?.groupId ?? undefined,
          customerId: selectedCustomer?.id ?? undefined,
          dueDate: dueDate || undefined,
          label: label.slice(0, 80),
          lines: cart.map((line) => ({
            productId: line.product.productId,
            qty: line.qty,
            discountType: line.discountType ?? undefined,
            discountValue: line.discountType ? line.discountValue ?? 0 : undefined,
            serialNumbers: line.product.trackSerial ? line.serialNumbers : undefined,
            packagingId: line.packaging?.packagingId ?? undefined,
          })),
        };
        const withoutKey = (request: Extract<ServerSaleAction, { action: "hold" }>) =>
          JSON.stringify({ ...request, idempotencyKey: "" });
        if (heldRequestRef.current && withoutKey(heldRequestRef.current) !== withoutKey(holdRequest)) {
          setStatus({ kind: "error", text: "Hasil tahan server sebelumnya belum terkonfirmasi. Jangan ubah keranjang; coba tahan lagi dengan isi yang sama agar terminal merekonsiliasi permintaan yang sama." });
          return false;
        }
        heldRequestRef.current = holdRequest;
        // Tulis request dan idempotency key ke SQLite terlebih dahulu.
        // Jika aplikasi mati sesudah server commit, pesanan lokal tetap
        // memiliki bahan untuk meminta hasil yang sama secara aman.
        pendingServerHold = holdRequest;
      }
      let payload: HeldCartPayload = {
        cart,
        groupId: activeHeldGroupId ?? selectedCustomer?.groupId ?? null,
        serverHeldSaleId: activeHeldServerSaleId,
        pendingServerHold,
        heldTotal: String(cartTotal),
        selectedCustomerId,
        customerQuery,
        dueDate,
        methodId,
        paymentReference,
        paymentFee,
        splitPayment,
        mixedPayments,
        cashTendered,
      };
      let saved = await saveLocalHeldSale({ id, label, payload });
      setHeldSales((current) => [saved, ...current.filter((held) => held.id !== saved.id)]);
      heldRequestRef.current = null;

      if (pendingServerHold) {
        const request = pendingServerHold;
        try {
          const result = await runServerSaleAction(request);
          if (typeof result.id !== "string") throw new Error("Server tidak mengembalikan ID pesanan tahan.");
          serverHeldSaleId = result.id;
          heldOnServer = true;
          const confirmedPayload: HeldCartPayload = {
            ...payload,
            serverHeldSaleId,
            pendingServerHold: undefined,
          };
          try {
            saved = await saveLocalHeldSale({ id, label, payload: confirmedPayload });
            payload = confirmedPayload;
            pendingServerHold = undefined;
            setHeldSales((current) => [saved, ...current.filter((held) => held.id !== saved.id)]);
          } catch {
            // The durable request/key remains in the original local row;
            // retrying it later will return this same server hold.
          }
        } catch {
          // Keep the exact request/key in the local row. It is reconciled
          // before resume or checkout, never replaced with a new hold.
        }
      }
      setCart([]);
      setActiveHeldSaleId(null);
      setActiveHeldServerSaleId(null);
      setActiveHeldGroupId(null);
      setActiveHeldTotal(null);
      setDiscountEditorKey(null);
      setCashTendered("");
      setPaymentReference("");
      setPaymentFee(undefined);
      setMixedPayments([]);
      setCustomerQuery("");
      setSelectedCustomerId("");
      setCustomerFieldOpen(false);
      setDueDate("");
      setSplitPayment(false);
      await refreshLocal();
      if (heldOnServer) {
        await loadServerHeldSales();
        setStatus({ kind: pendingServerHold ? "info" : "ok", text: pendingServerHold
          ? "Server sudah menerima pesanan, tetapi tautan offline belum tersimpan. Panggil pesanan lokal untuk merekonsiliasi kunci yang sama sebelum checkout."
          : "Pesanan ditahan bersama terminal lain dan disimpan di perangkat untuk dipanggil saat offline." });
      } else if (activeHeldServerSaleId) {
        setStatus({ kind: "ok", text: "Perubahan pesanan disimpan di perangkat ini; pesanan server tetap dikunci sampai checkout tersinkron." });
      } else if (pendingServerHold) {
        setStatus({ kind: "info", text: "Pesanan disimpan lokal. Server belum mengonfirmasi status tahan; sambungkan jaringan lalu panggil pesanan agar permintaan yang sama direkonsiliasi sebelum checkout." });
      } else {
        setStatus({ kind: "ok", text: "Pesanan ditahan di perangkat ini dan siap dipanggil kembali." });
      }
      return true;
    } catch (error) {
      setStatus({ kind: "error", text: `Pesanan gagal ditahan: ${String(error)}` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmResumeCandidate() {
    const candidate = resumeCandidate;
    if (!candidate || busy) return;
    const held = await handleHoldSale();
    if (!held) return;
    setResumeCandidate(null);
    if (candidate.kind === "local") await handleResumeHeldSale(candidate.sale, true);
    else await handleResumeServerHeldSale(candidate.sale, true);
  }

  async function handleResumeHeldSale(held: LocalHeldSale, afterHoldingCurrent = false) {
    if (cart.length > 0 && !afterHoldingCurrent) {
      setResumeCandidate({ kind: "local", sale: held });
      return;
    }
    let resumePayload = held.payload;
    if (resumePayload.pendingServerHold && typeof resumePayload.pendingServerHold === "object") {
      setBusy(true);
      try {
        const pending = resumePayload.pendingServerHold as Extract<ServerSaleAction, { action: "hold" }>;
        const result = await runServerSaleAction(pending);
        if (typeof result.id !== "string") throw new Error("Server tidak mengembalikan ID pesanan tahan.");
        const saved = await saveLocalHeldSale({
          id: held.id,
          label: held.label,
          payload: { ...resumePayload, serverHeldSaleId: result.id, pendingServerHold: undefined },
        });
        resumePayload = saved.payload;
        setHeldSales((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      } catch (error) {
        setStatus({ kind: "error", text: `Status tahan server belum dapat direkonsiliasi. Pesanan tetap aman di perangkat; sambungkan jaringan dan coba panggil lagi. ${String(error)}` });
        return;
      } finally {
        setBusy(false);
      }
    }
    const restoredCart = restoreHeldCart(resumePayload);
    if (!restoredCart) {
      setStatus({ kind: "error", text: "Data pesanan tahan tidak valid atau tidak memiliki produk." });
      return;
    }
    const payload = resumePayload;
    const customerId = typeof payload.selectedCustomerId === "string" && customers.some((customer) => customer.id === payload.selectedCustomerId)
      ? payload.selectedCustomerId
      : "";
    const restoredMethod = typeof payload.methodId === "string" && methods.some((method) => method.methodId === payload.methodId)
      ? payload.methodId
      : methods[0]?.methodId ?? "";
    const restoredPayments = Array.isArray(payload.mixedPayments)
      ? payload.mixedPayments.flatMap((value): MixedPaymentEntry[] => {
          if (!value || typeof value !== "object") return [];
          const entry = value as Record<string, unknown>;
          if (
            typeof entry.methodId !== "string" ||
            !methods.some((method) => method.methodId === entry.methodId) ||
            typeof entry.amount !== "string"
          ) return [];
          return [{
            key: typeof entry.key === "string" ? entry.key : crypto.randomUUID(),
            methodId: entry.methodId,
            amount: entry.amount,
            tendered: typeof entry.tendered === "string" ? entry.tendered : "",
            reference: typeof entry.reference === "string" ? entry.reference : "",
            fee: typeof entry.fee === "string" ? entry.fee : undefined,
          }];
        })
      : [];
    setCart(restoredCart);
    setSelectedCustomerId(customerId);
    setCustomerQuery(customerId
      ? customers.find((customer) => customer.id === customerId)?.name ?? ""
      : typeof payload.customerQuery === "string" ? payload.customerQuery : "");
    setCustomerFieldOpen(Boolean(customerId || payload.customerQuery));
    setDueDate(typeof payload.dueDate === "string" ? payload.dueDate : "");
    setMethodId(restoredMethod);
    setPaymentReference(typeof payload.paymentReference === "string" ? payload.paymentReference : "");
    setPaymentFee(typeof payload.paymentFee === "string" ? payload.paymentFee : undefined);
    setSplitPayment(payload.splitPayment === true && restoredPayments.length >= 2);
    setMixedPayments(restoredPayments);
    setCashTendered(typeof payload.cashTendered === "string" ? payload.cashTendered : "");
    setDiscountEditorKey(null);
    setActiveHeldSaleId(held.id);
    setActiveHeldServerSaleId(typeof payload.serverHeldSaleId === "string" ? payload.serverHeldSaleId : null);
    const storedHeldTotal = Number(payload.heldTotal);
    setActiveHeldTotal(Number.isFinite(storedHeldTotal) ? storedHeldTotal : null);
    setActiveHeldGroupId(
      typeof payload.groupId === "string"
        ? payload.groupId
        : customerId ? customers.find((customer) => customer.id === customerId)?.groupId ?? null : null,
    );
    setHeldPanelOpen(false);
    setHeldDeleteCandidateId(null);
    setSaleSuccess(null);
    setStatus({ kind: "info", text: `${held.label} dipanggil. Pesanan ditutup setelah checkout berhasil tersinkron.` });
  }

  async function handleResumeServerHeldSale(held: ServerSalesPage["rows"][number], afterHoldingCurrent = false) {
    if (cart.length > 0 && !afterHoldingCurrent) {
      setResumeCandidate({ kind: "server", sale: held });
      return;
    }
    setBusy(true);
    try {
      const { detail } = await getServerSaleDetail(held.id);
      if (detail.sale.status !== "held" || !detail.held || detail.lines.length === 0) {
        throw new Error("Pesanan server sudah tidak tersedia untuk dipanggil.");
      }
      const productIds = [...new Set(detail.lines.map((line) => line.productId))];
      const products = await getSnapshotProductsByIds(productIds);
      const productById = new Map(products.map((product) => [product.productId, product]));
      const restoredCart: CartLine[] = detail.lines.map((line) => {
        const product = productById.get(line.productId);
        if (!product) throw new Error(`Produk ${line.productName} tidak ada di snapshot terminal. Segarkan data POS lalu coba lagi.`);
        const packaging = line.packagingId
          ? product.packagings.find((item) => item.packagingId === line.packagingId) ?? null
          : null;
        if (line.packagingId && !packaging) {
          throw new Error(`Kemasan ${line.packagingName ?? "pesanan"} tidak ada di snapshot terminal. Segarkan data POS lalu coba lagi.`);
        }
        const qty = Number(line.qtyInput);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Jumlah ${line.productName} pada pesanan server tidak valid.`);
        return {
          product,
          packaging,
          qty,
          discountType: line.discountType ?? undefined,
          discountValue: line.discountType ? Number(line.discountValue ?? 0) : undefined,
        };
      });
      const customerId = detail.held.customerId && customers.some((customer) => customer.id === detail.held?.customerId)
        ? detail.held.customerId
        : "";
      setCart(restoredCart);
      setSelectedCustomerId(customerId);
      setCustomerQuery(customerId ? customers.find((customer) => customer.id === customerId)?.name ?? "" : "");
      setCustomerFieldOpen(Boolean(customerId));
      setDueDate(detail.held.dueDate ?? "");
      setMethodId(methods[0]?.methodId ?? "");
      setPaymentReference("");
      setPaymentFee(undefined);
      setSplitPayment(false);
      setMixedPayments([]);
      setCashTendered("");
      setDiscountEditorKey(null);
      const existingCache = heldSales.find((sale) => sale.payload.serverHeldSaleId === held.id);
      const localCacheId = existingCache?.id ?? crypto.randomUUID();
      const selectedCustomerName = customerId
        ? customers.find((customer) => customer.id === customerId)?.name ?? ""
        : "";
      let cachedForOffline = false;
      try {
        const saved = await saveLocalHeldSale({
          id: localCacheId,
          label: held.heldLabel || held.number,
          payload: {
            cart: restoredCart,
            groupId: detail.held.groupId,
            serverHeldSaleId: held.id,
            heldTotal: String(held.total),
            selectedCustomerId: customerId,
            customerQuery: selectedCustomerName,
            dueDate: detail.held.dueDate ?? "",
            methodId: methods[0]?.methodId ?? "",
            paymentReference: "",
            splitPayment: false,
            mixedPayments: [],
            cashTendered: "",
          },
        });
        setHeldSales((current) => [saved, ...current.filter((sale) => sale.id !== saved.id)]);
        cachedForOffline = true;
      } catch {
        cachedForOffline = false;
      }
      setActiveHeldSaleId(cachedForOffline ? localCacheId : null);
      setActiveHeldServerSaleId(held.id);
      setActiveHeldGroupId(detail.held.groupId);
      const serverHeldTotal = Number(held.total);
      setActiveHeldTotal(Number.isFinite(serverHeldTotal) ? serverHeldTotal : null);
      setHeldPanelOpen(false);
      setServerHeldDeleteCandidateId(null);
      setSaleSuccess(null);
      setStatus({
        kind: cachedForOffline ? "info" : "error",
        text: cachedForOffline
          ? `${held.heldLabel || held.number} dipanggil dari server dan disimpan di perangkat. Checkout akan mengunci pesanan saat tersinkron.`
          : `${held.heldLabel || held.number} dipanggil dari server, tetapi salinan lokal gagal disimpan. Tetap online sampai checkout selesai.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Pesanan server gagal dipanggil: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteHeldSale(held: LocalHeldSale) {
    if (held.id === activeHeldSaleId) return;
    setBusy(true);
    try {
      const serverId = typeof held.payload.serverHeldSaleId === "string" ? held.payload.serverHeldSaleId : null;
      if (serverId) {
        if (!device?.tokenConfigured) {
          throw new Error("Pesanan ini juga tersimpan di server. Sambungkan jaringan untuk menghapusnya dari semua terminal.");
        }
        const serverListComplete = serverHeldVerified && serverHeldSales.rows.length >= serverHeldSales.total;
        if (!(serverListComplete && !serverHeldIds.has(serverId))) {
          await runServerSaleAction({ action: "deleteHeld", saleId: serverId });
        }
      }
      await deleteLocalHeldSale(held.id);
      setHeldDeleteCandidateId(null);
      await refreshLocal();
      if (typeof held.payload.serverHeldSaleId === "string") await loadServerHeldSales();
      setStatus({ kind: "ok", text: typeof held.payload.serverHeldSaleId === "string" ? "Pesanan tahan dihapus dari server dan perangkat ini." : "Pesanan tahan dihapus dari perangkat ini." });
    } catch (error) {
      setStatus({ kind: "error", text: `Pesanan tahan gagal dihapus: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteServerHeldSale(held: ServerSalesPage["rows"][number]) {
    if (held.id === activeHeldServerSaleId) return;
    setBusy(true);
    try {
      await runServerSaleAction({ action: "deleteHeld", saleId: held.id });
      const cachedMirror = heldSales.find((sale) => sale.payload.serverHeldSaleId === held.id);
      if (cachedMirror) await deleteLocalHeldSale(cachedMirror.id);
      setServerHeldDeleteCandidateId(null);
      if (cachedMirror) setHeldSales((current) => current.filter((sale) => sale.id !== cachedMirror.id));
      const lastPageAfterDelete = Math.max(1, Math.ceil(Math.max(0, serverHeldSales.total - 1) / serverHeldSales.pageSize));
      await loadServerHeldSales(Math.min(serverHeldSales.page, lastPageAfterDelete));
      setStatus({ kind: "ok", text: "Pesanan server dihapus." });
    } catch (error) {
      setStatus({ kind: "error", text: `Pesanan server gagal dihapus: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  function addToCart(product: LocalProduct, packaging: LocalPackaging | null = null) {
    setCart((current) => {
      const key = `${product.productId}::${packaging?.packagingId ?? "base"}`;
      const existing = current.find((line) => lineKey(line) === key);
      if (existing) {
        return current.map((line) =>
          lineKey(line) === key ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [...current, { product, packaging, qty: 1 }];
    });
  }

  function addCatalogProduct(product: LocalProduct, packaging: LocalPackaging | null = null) {
    addToCart(product, packaging);
    setCatalogSearch("");
    setCatalogPage(1);
    // Keep rapid scanning natural after selecting a product with a mouse.
    // Coarse pointers are left alone so a touchscreen does not summon its
    // keyboard every time a cashier taps a product card.
    if (window.matchMedia("(pointer: fine)").matches) {
      window.requestAnimationFrame(() => scanInputRef.current?.focus({ preventScroll: true }));
    }
  }

  function clearActiveOrder() {
    setCart([]);
    setActiveHeldSaleId(null);
    setActiveHeldServerSaleId(null);
    setActiveHeldGroupId(null);
    setActiveHeldTotal(null);
    setDiscountEditorKey(null);
    setCashTendered("");
    setPaymentReference("");
    setPaymentFee(undefined);
    setSplitPayment(false);
    setMixedPayments([]);
    setCustomerQuery("");
    setSelectedCustomerId("");
    setCustomerFieldOpen(false);
    setDueDate("");
    setMobileCheckoutOpen(false);
    setClearOrderOpen(false);
    setStatus({
      kind: "info",
      text: "Pesanan aktif dikosongkan. Pesanan yang sebelumnya ditahan tetap tersimpan.",
    });
    window.requestAnimationFrame(() => scanInputRef.current?.focus());
  }

  /** Ganti satuan satu baris (cermin POS web): qty diatur ulang ke
   *  1 dalam satuan baru dan baris bergabung bila satuan tujuan
   *  sudah ada di keranjang. */
  function changeLinePackaging(line: CartLine, packaging: LocalPackaging | null) {
    setCart((current) => {
      const sourceKey = lineKey(line);
      const target: CartLine = { product: line.product, packaging, qty: 1 };
      const targetKey = lineKey(target);
      const rest = current.filter((entry) => lineKey(entry) !== sourceKey);
      const existing = rest.find((entry) => lineKey(entry) === targetKey);
      if (existing) {
        return rest.map((entry) =>
          lineKey(entry) === targetKey ? { ...entry, qty: entry.qty + 1 } : entry,
        );
      }
      return [...rest, target];
    });
  }

  function adjustLineQty(line: CartLine, change: number) {
    setCart((current) =>
      current
        .map((entry) =>
          lineKey(entry) === lineKey(line) ? { ...entry, qty: entry.qty + change } : entry,
        )
        .filter((entry) => entry.qty > 0),
    );
  }

  function updateLineDiscount(
    line: CartLine,
    discountType: CartLine["discountType"],
    discountValue: number,
  ) {
    setCart((current) => current.map((entry) =>
      lineKey(entry) === lineKey(line)
        ? { ...entry, discountType, discountValue: discountType ? Math.max(0, discountValue) : 0 }
        : entry,
    ));
  }

  function updateLineSerials(line: CartLine, raw: string) {
    const serialNumbers = raw.split(/[\r\n,;]+/).map((value) => value.trim()).filter(Boolean);
    setCart((current) => current.map((entry) =>
      lineKey(entry) === lineKey(line) ? { ...entry, serialNumbers } : entry,
    ));
  }

  function removeCartLine(line: CartLine) {
    setCart((current) => current.filter((entry) => lineKey(entry) !== lineKey(line)));
  }

  /** Pindai barcode (S5): barcode kemasan aktif menyelesaikan ke
   *  baris KEMASAN berharga kemasan; barcode/SKU produk ke baris
   *  satuan dasar — resolusi lokal dari snapshot, cermin
   *  findProductByAnyBarcode server (kemasan nonaktif tak
   *  menyelesaikan). */
  async function handleScan(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    try {
      const match = await findLocalProductByCode(code);
      if (!match) {
        if (/^\d{6,}$/.test(code)) {
          setStatus({ kind: "error", text: `Barcode "${code}" tidak ditemukan di katalog terminal.` });
        }
        return;
      }
      const { product } = match;
      const packaging = match.packagingId
        ? product.packagings.find((entry) => entry.packagingId === match.packagingId) ?? null
        : null;
      if (match.packagingId && !packaging) {
        setStatus({ kind: "error", text: "Kemasan barcode tidak ditemukan di snapshot lokal." });
        return;
      }
      addToCart(product, packaging);
      setCatalogSearch("");
      setCatalogPage(1);
      setStatus({
        kind: "ok",
        text: packaging
          ? `Pindai: ${product.name} — 1 ${packaging.name} (${formatIDR(lineUnitPrice({ product, packaging, qty: 1 }))}).`
          : `Pindai: ${product.name} — satuan dasar.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Pencarian barcode gagal: ${String(error)}` });
    }
  }

  function applyPromotionToCart(promo: PromotionRule) {
    setCart((current) => current.map((line) => {
      const discount = promotionDiscountForLine({
        productId: line.product.productId,
        qty: line.qty,
        unitPrice: lineUnitPrice(line),
        discountType: line.discountType ?? null,
        discountValue: line.discountValue ?? 0,
      }, promo);
      return discount ? { ...line, ...discount } : line;
    }));
    setStatus({ kind: "ok", text: `Promo "${promo.name}" diterapkan pada baris yang memenuhi syarat.` });
  }

  async function handleRecordSale() {
    if (info?.posOfflineEnabled !== true) {
      setStatus({
        kind: "error",
        text: "Penjualan diblokir karena Mode offline POS belum aktif atau snapshot terminal belum diperbarui.",
      });
      return;
    }
    if (!session) {
      setCheckoutOpen(false);
      setStatus({ kind: "info", text: "Sesi kasir belum dibuka. Keranjang tetap tersimpan; buka sesi sebelum menerima pembayaran." });
      openSessionTool("current");
      return;
    }
    if (device?.authFailed) {
      setStatus({
        kind: "error",
        text: `Server menolak akses terminal: ${device.authFailed} Sambungkan kembali atau daftarkan ulang terminal sebelum mencatat penjualan baru.`,
      });
      return;
    }
    if (!activeWarehouseId) {
      setStatus({ kind: "error", text: "Snapshot belum diterapkan — gudang terminal belum diketahui." });
      return;
    }
    if (cart.length === 0 || (!splitPayment && (!methodId || !selectedMethod))) {
      setStatus({ kind: "error", text: "Keranjang kosong atau metode pembayaran belum dipilih." });
      return;
    }
    if (requiresCustomer && !selectedCustomer) {
      setStatus({ kind: "error", text: "Pilih pelanggan untuk transaksi kredit/piutang." });
      return;
    }
    if (usesReceivable && !dueDate) {
      setStatus({ kind: "error", text: "Tanggal jatuh tempo wajib diisi untuk transaksi kredit." });
      return;
    }
    const usedSerialsByProduct = new Map<string, Set<string>>();
    for (const line of cart) {
      if (!line.product.trackSerial) continue;
      const rawRequired = lineBaseQty(line);
      const required = Math.round(rawRequired);
      if (!Number.isSafeInteger(required) || required < 1 || Math.abs(rawRequired - required) > 1e-9) {
        setStatus({ kind: "error", text: `${line.product.name}: jumlah unit serial harus bilangan bulat positif.` });
        return;
      }
      const serials = (line.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean);
      if (serials.length !== required) {
        setStatus({ kind: "error", text: `${line.product.name}: masukkan ${required} nomor seri untuk ${required} unit.` });
        return;
      }
      const productSerials = usedSerialsByProduct.get(line.product.productId) ?? new Set<string>();
      for (const serial of serials) {
        if (productSerials.has(serial)) {
          setStatus({ kind: "error", text: `Nomor seri ${serial} untuk ${line.product.name} tercantum lebih dari sekali di keranjang.` });
          return;
        }
        productSerials.add(serial);
      }
      usedSerialsByProduct.set(line.product.productId, productSerials);
    }
    let salePayments: OfflineSalePayload["payments"];
    if (splitPayment) {
      const filledEntries = mixedPayments.filter((entry) => entry.amount.trim() !== "");
      if (filledEntries.length < 2) {
        setStatus({ kind: "error", text: "Pembayaran campuran memerlukan sedikitnya dua metode dengan nominal." });
        return;
      }
      const seenMethods = new Set<string>();
      const normalized: OfflineSalePayload["payments"] = [];
      for (const entry of filledEntries) {
        const method = methods.find((candidate) => candidate.methodId === entry.methodId);
        const amount = Number(entry.amount);
        if (!method || seenMethods.has(entry.methodId) || !Number.isFinite(amount) || amount <= 0) {
          setStatus({ kind: "error", text: "Setiap baris campuran harus memilih metode unik dan nominal lebih dari nol." });
          return;
        }
        if (method.type === "customer_credit" && !entry.reference.trim()) {
          setStatus({ kind: "error", text: "Kredit pelanggan memerlukan nomor dokumen retur asal." });
          return;
        }
        const paymentFeeResult = resolvePaymentFee(method, amount, entry.fee);
        if (paymentFeeResult.error) {
          setStatus({ kind: "error", text: paymentFeeResult.error });
          return;
        }
        if (entry.reference.trim().length > 120) {
          setStatus({ kind: "error", text: "Referensi pembayaran maksimal 120 karakter." });
          return;
        }
        seenMethods.add(entry.methodId);
        const tendered = isCashMethod(method) ? Number(entry.tendered || amount) : amount;
        if (!Number.isFinite(tendered) || tendered < amount) {
          setStatus({ kind: "error", text: `Uang diterima untuk ${method.name} tidak boleh lebih kecil dari nominalnya.` });
          return;
        }
        normalized.push({
          methodId: method.methodId,
          amount,
          tendered,
          reference: entry.reference.trim() || undefined,
          fee: paymentFeeResult.fee,
        });
      }
      const allocated = normalized.reduce((sum, payment) => sum + payment.amount, 0);
      if (Math.abs(allocated - cartTotal) > 0.01) {
        setStatus({ kind: "error", text: `Nominal pembayaran harus sama dengan total ${formatIDR(cartTotal)}.` });
        return;
      }
      salePayments = normalized;
    } else {
      const amount = cartTotal;
      const tendered = isCashPayment ? Number(cashTendered || amount) : amount;
      if (selectedMethod?.type === "customer_credit" && !paymentReference.trim()) {
        setStatus({ kind: "error", text: "Kredit pelanggan memerlukan nomor dokumen retur asal." });
        return;
      }
      if (paymentReference.trim().length > 120) {
        setStatus({ kind: "error", text: "Referensi pembayaran maksimal 120 karakter." });
        return;
      }
      const paymentFeeResult = resolvePaymentFee(selectedMethod!, amount, paymentFee);
      if (paymentFeeResult.error) {
        setStatus({ kind: "error", text: paymentFeeResult.error });
        return;
      }
      if (!Number.isFinite(tendered) || tendered < amount) {
        setStatus({ kind: "error", text: "Uang diterima tidak boleh lebih kecil dari nominal pembayaran tunai." });
        return;
      }
      salePayments = [{
        methodId,
        amount,
        tendered,
        reference: paymentReference.trim() || undefined,
        fee: paymentFeeResult.fee,
      }];
    }
    if (needsReceiptConfirmation && !nonCashConfirmed) {
      setStatus({ kind: "error", text: "Centang konfirmasi penerimaan pembayaran non-tunai terlebih dahulu." });
      return;
    }
    // Pengunci sinkron: dua klik/Enter dalam satu frame tidak boleh
    // menghasilkan dua transaksi lokal dengan kunci berbeda.
    if (checkoutSubmittingRef.current) return;
    checkoutSubmittingRef.current = true;
    setBusy(true);
    let submittedClientKey: string | null = null;
    try {
      const sale: OfflineSalePayload = {
        clientKey: getCheckoutClientKey(),
        warehouseId: activeWarehouseId,
        heldSaleId: activeHeldServerSaleId ?? undefined,
        groupId: activeHeldGroupId ?? selectedCustomer?.groupId ?? undefined,
        customerId: selectedCustomer?.id ?? undefined,
        dueDate: usesReceivable ? dueDate : undefined,
        reservationId: selectedReservationId || undefined,
        date: todayISODate(),
        cashierId: device?.cashierId ?? undefined,
        originSessionId: session?.id,
        lines: cart.map((line, index) =>
          line.packaging
            ? {
                productId: line.product.productId,
                qty: line.qty,
                serialNumbers: line.product.trackSerial ? line.serialNumbers : undefined,
                discountType: line.discountType ?? undefined,
                discountValue: line.discountType ? line.discountValue ?? 0 : undefined,
                // Kontrak S4: unitPrice snapshot = harga PER
                // KEMASAN; isiSnapshot = faktor saat transaksi —
                // server mengonversi dari cuplikan ini.
                unitPrice: lineUnitPrice(line),
                packagingId: line.packaging.packagingId,
                isiSnapshot: Number(line.packaging.isi),
              }
            : {
                productId: line.product.productId,
                qty: line.qty,
                serialNumbers: line.product.trackSerial ? line.serialNumbers : undefined,
                discountType: line.discountType ?? undefined,
                discountValue: line.discountType ? line.discountValue ?? 0 : undefined,
                // Harga sebelum diskon manual dibekukan sebagai harga
                // kelompok saat transaksi berlangsung. Review offline
                // tetap dapat memakai harga struk meski aturan server
                // berubah sebelum koneksi pulih.
                unitPrice: localQuote?.lines[index]?.groupUnitPrice ?? Number(line.product.salePrice),
              },
        ),
        payments: salePayments,
        queuedAt: new Date().toISOString(),
        deviceId: info?.terminal?.terminalId ?? "tauri-desktop",
        expectedTotal: cartTotal,
      };
      submittedClientKey = sale.clientKey;
      const item = await recordLocalSale(sale, activeHeldSaleId);
      clearCheckoutClientKey(sale.clientKey);
      setActiveHeldSaleId(null);
      setActiveHeldServerSaleId(null);
      setActiveHeldGroupId(null);
      setActiveHeldTotal(null);
      setMobileCheckoutOpen(false);
      setCheckoutOpen(false);
      setSuccessCopyQueued(false);
      const cashPayments = salePayments.filter((payment) =>
        isCashMethod(methods.find((method) => method.methodId === payment.methodId)),
      );
      const cashReceived = cashPayments.reduce((sum, payment) => sum + payment.tendered, 0);
      const cashApplied = cashPayments.reduce((sum, payment) => sum + payment.amount, 0);
      setSaleSuccess({
        clientKey: item.clientKey,
        status: item.status,
        total: cartTotal,
        cashReceived: cashPayments.length ? cashReceived : null,
        change: cashPayments.length ? Math.max(0, cashReceived - cashApplied) : null,
      });
      // Layar pelanggan: ucapkan terima kasih ±8 detik; keranjang
      // yang dikosongkan sesudah ini tidak menimpanya (gerbang
      // displayHoldUntilRef di effect keranjang), lalu effect
      // timeout mengembalikan layar mengikuti keranjang.
      if (isTauri()) {
        displayHoldUntilRef.current = Date.now() + 8000;
        void updateCustomerDisplay({
          storeName: info?.terminal?.companyName ?? device?.companyName ?? null,
          phase: "paid",
          lines: [],
          paidTotal: String(cartTotal),
        }).catch(() => {});
        window.setTimeout(() => {
          displayHoldUntilRef.current = 0;
          pushDisplayRef.current();
        }, 8000);
      }
      setCart([]);
      setCashTendered("");
      setPaymentReference("");
      setPaymentFee(undefined);
      setNonCashConfirmed(false);
      setSplitPayment(false);
      setMixedPayments([]);
      setCustomerQuery("");
      setSelectedCustomerId("");
      setDueDate("");
      setSelectedReservationId("");
      setStatus({
        kind: "ok",
        text: `Transaksi #${item.clientKey.slice(0, 8)} tersimpan di perangkat. Sinkronisasi berjalan di latar.`,
      });
      void refreshLocal().catch((error) => {
        setStatus({
          kind: "error",
          text: `Transaksi #${item.clientKey.slice(0, 8)} sudah tersimpan; pembaruan tampilan gagal: ${String(error)}`,
        });
      });
    } catch (error) {
      const retryHint = submittedClientKey
        ? `Checkout tersimpan dengan kunci ${submittedClientKey.slice(0, 8)}… bila pencatatan sudah sempat berhasil. Coba ulang checkout yang sama atau periksa Riwayat lokal sebelum membuat transaksi baru.`
        : "Periksa Riwayat lokal sebelum mencoba pembayaran lagi.";
      setStatus({ kind: "error", text: `Belum ada konfirmasi dari terminal. ${retryHint} Detail: ${String(error)}` });
    } finally {
      checkoutSubmittingRef.current = false;
      setBusy(false);
    }
  }

  async function handleOpenSession() {
    if (!activeWarehouseId) return;
    if (!device?.cashierId) {
      setStatus({ kind: "error", text: "Akun kasir terminal belum tersinkron. Hubungkan server lalu muat ulang sesi terminal." });
      return;
    }
    const openingAmount = openingCash.trim();
    if (!/^\d{1,15}$/.test(openingAmount) || !Number.isSafeInteger(Number(openingAmount))) {
      setStatus({ kind: "error", text: "Modal awal harus berupa rupiah bulat antara Rp 0 dan Rp 999.999.999.999.999." });
      return;
    }
    setBusy(true);
    try {
      const opened = await openCashSession({
        warehouseId: activeWarehouseId,
        openingCash: openingAmount,
        openedBy: device.cashierId,
      });
      setSession(opened);
      setOpeningCash("");
      setLastClosed(null);
      await refreshLocal();
      setStatus({ kind: "ok", text: `Sesi kas dibuka (modal ${formatIDR(Number(opened.openingCash))}); sinkronisasi sesi berjalan di latar.` });
    } catch (error) {
      setStatus({ kind: "error", text: `Buka sesi gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function resolveSessionClosePreview(counted: Denomination[]) {
    if (!session) throw new Error("Sesi kas tidak tersedia.");
    const terminalPreview = await previewCashSession({ sessionId: session.id, counted });
    const terminalDifference = d(terminalPreview.differenceTotal);
    const terminalResult = (notice: string) => ({
      preview: { ...terminalPreview, requiresReason: !terminalDifference.isZero() },
      source: "terminal" as const,
      notice,
    });

    try {
      await syncNow();
    } catch {
      // Pemeriksaan lokal per sesi di bawah tetap menentukan apakah angka
      // server sudah mencakup seluruh transaksi sesi ini.
    }

    let syncStatus: Awaited<ReturnType<typeof getCashSessionSyncStatus>>;
    try {
      syncStatus = await getCashSessionSyncStatus(session.id);
    } catch {
      return terminalResult(
        "Antrean terminal belum dapat diverifikasi. Angka ini hanya estimasi lokal; saldo resmi akan dihitung saat terminal tersambung dan tersinkron.",
      );
    }

    if (syncStatus.pendingSales > 0 || syncStatus.pendingIntents > 0) {
      return terminalResult(
        `Sesi ini masih memiliki ${syncStatus.pendingSales} transaksi dan ${syncStatus.pendingIntents} mutasi kas yang belum diterima server. Angka ini hanya estimasi terminal sampai sinkronisasi sesi selesai.`,
      );
    }

    let serverSummary;
    try {
      serverSummary = await getServerCashSessionSummary(session.id);
    } catch {
      return terminalResult(
        "Saldo server belum dapat dibaca. Angka ini hanya estimasi terminal; server akan menghitung ulang setelah koneksi pulih.",
      );
    }
    if (serverSummary.status !== "open") {
      throw new Error("Sesi kas di server sudah ditutup. Muat ulang sesi sebelum melanjutkan.");
    }

    const differenceTotal = d(terminalPreview.countedTotal)
      .minus(serverSummary.expectedCash)
      .toDecimalPlaces(4)
      .toString();
    const serverAndTerminalDiffer = !d(serverSummary.expectedCash)
      .minus(terminalPreview.expectedTotal)
      .isZero();
    return {
      preview: {
        countedTotal: terminalPreview.countedTotal,
        expectedTotal: serverSummary.expectedCash,
        differenceTotal,
        // Tutup lokal memvalidasi selisih lokal, sedangkan rekonsiliasi
        // final server memakai seluruh mutasi resmi termasuk refund tunai.
        requiresReason: !d(differenceTotal).isZero() || !terminalDifference.isZero(),
      },
      source: "server" as const,
      notice: serverAndTerminalDiffer
        ? "Saldo resmi memakai buku kas server dan berbeda dari estimasi terminal. Alasan selisih tetap dicatat bila salah satu hitungan menunjukkan selisih."
        : "Saldo resmi berasal dari buku kas server, termasuk penjualan, setoran, penarikan, dan refund tunai yang sudah tercatat.",
    };
  }

  async function handlePreviewSessionClose() {
    if (!session) return;
    setBusy(true);
    try {
      const counted: Denomination[] = DENOMINATIONS.map((denom) => ({
        denomination: denom,
        count: Number(counts[denom]) || 0,
      })).filter((entry) => entry.count > 0);
      const result = await resolveSessionClosePreview(counted);
      setClosePreview(result.preview);
      setClosePreviewSource(result.source);
      setClosePreviewNotice(result.notice);
      if (!result.preview.requiresReason) setSessionDifferenceReason("");
      setStatus({
        kind: "info",
        text: result.source === "server"
          ? "Hitungan fisik dibandingkan dengan saldo kas resmi server. Periksa selisih sebelum menutup shift."
          : "Hitungan fisik dibandingkan dengan estimasi terminal. Periksa status sinkronisasi sebelum menutup shift.",
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Tinjauan hitungan gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseSession() {
    if (!session) return;
    // Accurate POS: shift tidak boleh ditutup selama masih ada Open Bill.
    if (visibleLocalHeldSales.length > 0) {
      setStatus({
        kind: "error",
        text: `Masih ada ${visibleLocalHeldSales.length} pesanan ditahan di perangkat. Selesaikan atau hapus pesanan tersebut sebelum menutup shift.`,
      });
      return;
    }
    if (!closePreview) {
      setStatus({ kind: "error", text: "Tinjau hitungan fisik terlebih dahulu sebelum menutup shift." });
      return;
    }
    setBusy(true);
    try {
      const counted: Denomination[] = DENOMINATIONS.map((denom) => ({
        denomination: denom,
        count: Number(counts[denom]) || 0,
      })).filter((entry) => entry.count > 0);
      const result = await resolveSessionClosePreview(counted);
      const preview = result.preview;
      const previewChanged = result.source !== closePreviewSource ||
        result.preview.countedTotal !== closePreview.countedTotal ||
        result.preview.expectedTotal !== closePreview.expectedTotal ||
        result.preview.differenceTotal !== closePreview.differenceTotal ||
        result.preview.requiresReason !== closePreview.requiresReason;
      if (previewChanged) {
        setClosePreview(result.preview);
        setClosePreviewSource(result.source);
        setClosePreviewNotice(result.notice);
        setStatus({
          kind: "info",
          text: "Saldo atau status sinkronisasi berubah sejak ditinjau. Periksa ringkasan terbaru lalu konfirmasi kembali.",
        });
        return;
      }
      if (preview.requiresReason && sessionDifferenceReason.trim().length < 3) {
        const reasonDifference = d(preview.differenceTotal).isZero()
          ? closePreview.differenceTotal
          : preview.differenceTotal;
        const reasonMessage = closePreviewSource === "server" && d(preview.differenceTotal).isZero()
          ? `Saldo server seimbang, tetapi estimasi terminal menunjukkan selisih ${formatIDR(Math.abs(Number(reasonDifference)))}.`
          : `Ada selisih ${formatIDR(Math.abs(Number(reasonDifference)))}.`;
        setStatus({
          kind: "error",
          text: `${reasonMessage} Isi alasan minimal 3 karakter sebelum menutup sesi.`,
        });
        return;
      }
      const closed = await closeCashSession({
        sessionId: session.id,
        counted,
        differenceReason: sessionDifferenceReason.trim() || undefined,
      });
      setSession(null);
      setCloseCountOpen(false);
      setClosePreview(null);
      setClosePreviewSource(null);
      setClosePreviewNotice("");
      setLastClosed(closed);
      setCounts({});
      setSessionDifferenceReason("");
      await refreshLocal();
      setStatus({
        kind: "ok",
        text: `Sesi ditutup di terminal: fisik ${formatIDR(Number(closed.countedTotal))}, harapan lokal ${formatIDR(Number(closed.expectedTotal))}, selisih lokal ${formatIDR(Number(closed.differenceTotal))}. Penutupan final menunggu konfirmasi sinkronisasi server.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Tutup sesi gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetrySessionClose(intent: LocalIntent) {
    setBusy(true);
    try {
      const reason = sessionRetryReasons[intent.id]?.trim();
      await retryCashSessionClose(intent.id, reason || undefined);
      setSessionRetryReasons((current) => {
        const next = { ...current };
        delete next[intent.id];
        return next;
      });
      await refreshLocal();
      requestSessionHistoryRefresh();
      setStatus({
        kind: "info",
        text: "Penutupan shift masuk kembali ke antrean sinkronisasi. Periksa status server pada riwayat sesi.",
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Pengiriman ulang tutup shift gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetrySessionOpen(intent: LocalIntent) {
    setBusy(true);
    try {
      await retryCashSessionOpen(intent.id);
      requestSessionHistoryRefresh();
      await refreshLocal();
      setStatus({
        kind: "info",
        text: "Pembukaan shift masuk kembali ke antrean. Status penerimaan server akan muncul di riwayat kasir.",
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Pengiriman ulang pembukaan sesi gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordCashMovement() {
    if (!session) return;
    const amount = cashMovementAmount.trim();
    const notes = cashMovementNotes.trim();
    if (!/^\d{1,15}$/.test(amount) || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) {
      setStatus({ kind: "error", text: "Nominal harus berupa rupiah bulat lebih dari Rp 0." });
      return;
    }
    if (notes.length < 3 || notes.length > 200) {
      setStatus({ kind: "error", text: "Isi alasan mutasi kas dengan 3–200 karakter." });
      return;
    }
    setBusy(true);
    try {
      await recordCashSessionMovement({
        clientKey: crypto.randomUUID(),
        sessionId: session.id,
        movementType: cashMovementType,
        amount,
        notes,
      });
      setCashMovementAmount("");
      setCashMovementNotes("");
      requestSessionHistoryRefresh();
      await refreshLocal();
      setStatus({
        kind: "ok",
        text: `${cashMovementType === "deposit" ? "Setoran ke bank" : "Penarikan dari bank"} dicatat di terminal dan akan disinkronkan dengan jurnal saat server tersedia.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Mutasi kas gagal dicatat: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetrySessionMovement(intent: LocalIntent) {
    setBusy(true);
    try {
      await retryCashSessionMovement(intent.id);
      requestSessionHistoryRefresh();
      await refreshLocal();
      setStatus({
        kind: "info",
        text: "Mutasi kas masuk kembali ke antrean. Tutup shift menunggu sampai mutasi ini diterima server.",
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Pengiriman ulang mutasi kas gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  if (!authReady) {
    return (
      <main className="native-splash" aria-busy="true">
        <div className="native-mark">b</div>
        <p>Menyiapkan kasir…</p>
      </main>
    );
  }

  if (!cashierActive) {
    const companies = loginView?.step === "authenticated" ? loginView.companies : [];
    return (
      <main className="login-shell">
        <section className="login-card" aria-labelledby="cashier-login-title">
          <div className="login-brand">
            <div className="native-mark">b</div>
            <span>Bisa <strong>POS</strong></span>
          </div>
          <div className="login-heading">
            <p className="eyebrow">TERMINAL KASIR</p>
            <h1 id="cashier-login-title">
              {loginMode === "twoFactor" ? "Verifikasi akun" : loginMode === "company" ? "Pilih perusahaan" : "Masuk untuk mulai"}
            </h1>
            <p>
              {loginMode === "twoFactor"
                ? "Masukkan kode dari aplikasi autentikator untuk melanjutkan."
                : loginMode === "company"
                  ? `Akun ${loginView?.step === "authenticated" ? loginView.cashier.name : "kasir"} memiliki akses ke beberapa perusahaan.`
                  : "Gunakan akun ERP yang memiliki izin kasir POS."}
            </p>
          </div>

          {loginMode === "password" ? (
            <form
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCashierLogin();
              }}
            >
              <label className="field">
                Server ERP
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                  placeholder="https://erp.perusahaan.id"
                  autoComplete="url"
                  required
                />
              </label>
              <label className="field">
                Email
                <input
                  type="email"
                  value={cashierEmail}
                  onChange={(event) => setCashierEmail(event.target.value)}
                  placeholder="nama@perusahaan.id"
                  autoComplete="username"
                  required
                  autoFocus
                />
              </label>
              <label className="field">
                Kata sandi
                <input
                  type="password"
                  value={cashierPassword}
                  onChange={(event) => setCashierPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {serverUrl.trim().startsWith("http://") && !/http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(serverUrl.trim()) ? (
                <p className="login-security-note" role="note">
                  Server LAN memakai HTTP. Untuk penggunaan rutin, aktifkan HTTPS agar kata sandi terlindungi saat melewati Wi-Fi.
                </p>
              ) : null}
              <button className="primary login-submit" type="submit" disabled={busy || !inTauri}>
                {busy ? "Memeriksa akun…" : "Masuk kasir"}
              </button>
            </form>
          ) : null}

          {loginMode === "twoFactor" ? (
            <form
              className="login-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCashierTwoFactor();
              }}
            >
              <label className="field">
                Kode autentikator
                <input
                  value={twoFactorCode}
                  onChange={(event) => setTwoFactorCode(event.target.value.replace(/\s/g, ""))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  autoFocus
                  required
                />
              </label>
              <button className="primary login-submit" type="submit" disabled={busy || twoFactorCode.length < 6}>
                {busy ? "Memverifikasi…" : "Verifikasi & lanjutkan"}
              </button>
            </form>
          ) : null}

          {loginMode === "company" ? (
            <div className="login-form">
              <label className="field">
                Perusahaan
                <select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}>
                  <option value="">Pilih perusahaan</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </label>
              <button
                className="primary login-submit"
                type="button"
                disabled={busy || !selectedCompanyId}
                onClick={() => void finishCashierLogin(selectedCompanyId)}
              >
                {busy ? "Menyiapkan terminal…" : "Lanjut ke kasir"}
              </button>
            </div>
          ) : null}

          {loginError ? <p className="login-error" role="alert">{loginError}</p> : null}
          {!inTauri ? <p className="login-error" role="alert">Login kasir hanya tersedia di aplikasi Bisa POS desktop.</p> : null}
          <div className="login-footer">
            <span>{device?.offlineLoginReady ? "Login offline tersedia untuk terminal ini" : device?.tokenConfigured ? "Terminal ini sudah terdaftar" : "Terminal akan didaftarkan otomatis setelah login"}</span>
            <span>Data penjualan yang belum tersinkron tetap tersimpan di perangkat.</span>
          </div>
        </section>
      </main>
    );
  }

  const commandActions: CommandAction[] = [
    { id: "session-open", label: "Buka sesi kas", hint: "Mulai shift baru", run: () => openSessionTool("current") },
    { id: "session-history", label: "Riwayat kasir", hint: "Lihat seluruh shift", run: () => openSessionTool("history") },
    { id: "report", label: "Laporan harian", hint: "Omzet & per metode bayar", run: () => setActiveTool("report") },
    { id: "kitchen", label: "Layar dapur", hint: "Antrian pesanan", run: () => setActiveTool("kitchen") },
    { id: "sync", label: "Sinkronkan sekarang", hint: "Kirim antrean transaksi", run: () => void handleSyncNow() },
    { id: "printer", label: "Pengaturan printer", hint: "ESC/POS & antrean cetak", run: () => setActiveTool("printer") },
    { id: "display", label: "Layar pelanggan", hint: "Jendela kedua", run: () => setActiveTool("display") },
    { id: "help", label: "Bantuan pintasan", hint: "F1, F2, Enter", run: () => setHelpOpen(true) },
  ];

  return (
    <main
      className={`desktop-app ${checkoutOpen ? "checkout-active" : ""}`}
      data-theme={darkTheme ? "dark" : "light"}
      data-font-scale={displayPrefs.fontScale}
      data-density={displayPrefs.density}
      data-card-shape={displayPrefs.cardShape}
      data-cart-width={displayPrefs.cartWidth}
      style={{ "--pos-cart-width": `${displayPrefs.cartWidth}px` } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand">
          Bisa <span>POS</span>
        </div>
        <div className="topbar-context">
          <button
            className={`connection-pill ${device?.authFailed ? "is-error" : outbox.total ? "is-pending" : "is-online"}`}
            type="button"
            onClick={() => openTool("sync")}
            aria-haspopup="dialog"
            aria-expanded={activeTool === "sync"}
            aria-label={device?.authFailed ? "Perlu sinkronisasi" : outbox.total ? `${outbox.total} transaksi menunggu sinkronisasi` : "Sinkronisasi siap"}
            title="Buka status sinkronisasi offline"
          >
            <i aria-hidden="true" />
            <span className="topbar-status-label">
              {device?.authFailed ? "Perlu sinkron" : outbox.total ? `${outbox.total} menunggu sinkron` : "Siap"}
            </span>
          </button>
          <button
            className={`shift-pill ${session ? "is-open" : ""}`}
            type="button"
            onClick={() => openSessionTool("current")}
            aria-haspopup="dialog"
            aria-expanded={activeTool === "session"}
            aria-label={session ? "Sesi kas dibuka" : "Sesi kas belum dibuka"}
          >
            <Banknote aria-hidden="true" />
            <span className="topbar-status-label">{session ? "Sesi kas dibuka" : "Sesi kas belum dibuka"}</span>
          </button>
          <span className="cashier-context"><UserRound aria-hidden="true" />{device?.cashierName ?? "Kasir"}</span>
          <button className="utility-toggle" type="button" onClick={handleOpenHistory} aria-label="Riwayat transaksi" aria-haspopup="dialog">
            <History aria-hidden="true" />
            <span className="utility-label">Riwayat</span>
          </button>
          <button
            className="utility-toggle"
            type="button"
            onClick={() => void handleToggleFullscreen()}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? "Keluar layar penuh" : "Layar penuh"}
          >
            <Maximize2 aria-hidden="true" />
            <span className="utility-label">{fullscreen ? "Keluar layar penuh" : "Layar penuh"}</span>
          </button>
          <button
            className="utility-toggle more-toggle"
            type="button"
            ref={cashierMenuTriggerRef}
            onClick={() => { setMobileCheckoutOpen(false); setCashierMenuOpen(true); }}
            aria-expanded={cashierMenuOpen}
            aria-haspopup="dialog"
            aria-label="Lainnya"
          >
            <MenuIcon aria-hidden="true" />
            <span className="utility-label">Lainnya</span>
          </button>
        </div>
      </header>

      {status.text !== "Siap." ? (
        <div className={`desktop-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.text}</div>
      ) : null}
      {info && !info.posOfflineEnabled ? (
        <div className="desktop-status error" role="alert">
          <span>Penjualan POS Desktop belum diizinkan. Minta administrator mengaktifkan Mode offline POS, lalu segarkan snapshot terminal.</span>
          <button type="button" onClick={() => void handleRefreshSnapshot()} disabled={busy}>Segarkan snapshot</button>
        </div>
      ) : null}

      <div className={`layout ${checkoutOpen ? "is-checkout" : ""}`} data-product-view={displayPrefs.view}>
        <div>
          <ToolScreen
            open={activeTool === "customer"}
            title="Pelanggan transaksi"
            description="Pilih pelanggan untuk harga kelompok atau pembayaran tempo. Pilihan berlaku untuk pesanan yang sedang dibuka."
            onBack={closeTool}
          >
            <section className="panel tools-panel customer-picker-panel">
              <h2>Pilih pelanggan</h2>
              <label className="field customer-picker-search">
                Cari pelanggan
                <input
                  ref={customerSearchRef}
                  value={customerQuery}
                  onChange={(event) => {
                    setCustomerQuery(event.currentTarget.value);
                    setSelectedCustomerId("");
                    setActiveHeldGroupId(null);
                  }}
                  placeholder="Ketik nama pelanggan"
                  autoComplete="off"
                />
              </label>
              <div className="customer-picker-summary">
                <span>{customerPickerMatches.length} hasil ditampilkan · {customers.length} pelanggan di snapshot</span>
                {selectedCustomer ? <strong>Terpilih: {selectedCustomer.name}</strong> : null}
              </div>
              {customerPickerMatches.length ? (
                <ul className="customer-picker-list" aria-label="Daftar pelanggan">
                  {customerPickerMatches.map((customer) => {
                    const group = customer.groupId
                      ? groupPricing.groups.find((entry) => entry.id === customer.groupId)
                      : null;
                    const selected = customer.id === selectedCustomerId;
                    return (
                      <li key={customer.id}>
                        <button
                          type="button"
                          className={`customer-picker-row ${selected ? "is-selected" : ""}`}
                          aria-pressed={selected}
                          onClick={() => chooseCustomerFromPicker(customer)}
                        >
                          <span className="customer-picker-avatar" aria-hidden="true">{customer.name.trim().slice(0, 1).toLocaleUpperCase("id-ID") || "P"}</span>
                          <span className="customer-picker-copy">
                            <strong>{customer.name}</strong>
                            <small>{group ? `Harga kelompok · ${group.name}` : "Harga normal"}</small>
                          </span>
                          <span className="customer-picker-check" aria-hidden="true">{selected ? "Terpilih" : "Pilih"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="customer-picker-empty" role="status">
                  {customers.length ? "Pelanggan tidak ditemukan. Periksa ejaan atau kata kunci." : "Belum ada pelanggan tersimpan di terminal. Segarkan snapshot atau tambahkan pelanggan dari sistem utama."}
                </p>
              )}
              <div className="customer-picker-footer">
                <span>{requiresCustomer ? "Pelanggan wajib untuk metode pembayaran tempo." : "Pelanggan umum dapat dipakai untuk transaksi tanpa piutang."}</span>
                <button type="button" onClick={() => chooseCustomerFromPicker(null)} disabled={requiresCustomer}>
                  Gunakan pelanggan umum
                </button>
              </div>
            </section>
          </ToolScreen>

          <ToolScreen
            open={activeTool === "terminal"}
            title="Terminal dan koneksi"
            description="Periksa identitas perangkat, cabang, gudang, dan data katalog yang tersimpan di terminal ini."
            onBack={closeTool}
          >
          <section className="panel tools-panel">
            <h2>Terminal dan koneksi</h2>
            {device?.paired ? (
              <>
                <div className="row">
                  <span className="muted">
                    Terpasang sebagai <strong>{device.terminalName ?? "terminal"}</strong>
                    {device.companyName ? ` — ${device.companyName}` : ""}
                    {device.warehouseName ? ` · ${device.warehouseName}` : ""} · server{" "}
                    {device.serverUrl}
                  </span>
                </div>
                <div className="row">
                  <button onClick={handleRefreshSnapshot} disabled={busy || !inTauri}>
                    Segarkan snapshot (delta)
                  </button>
                  <span className="muted">
                    {device.tokenStorage === "keychain"
                      ? "Data katalog dan transaksi tersinkron otomatis di latar belakang. Status penerimaan server terlihat di layar ini."
                      : device.tokenStorage === "file"
                        ? "PERINGATAN: keychain OS tidak tersedia di mesin ini — token tersimpan di berkas berizin ketat (0600) milik Rust. Aktifkan layanan keychain (Secret Service/Credential Manager) agar token berpindah ke brankas OS."
                        : "Token terkonfigurasi."}
                  </span>
                </div>
              </>
            ) : (
              <div className="row">
                <p className="status error" role="alert">
                  Terminal belum terdaftar. Keluar lalu masuk kembali dengan akun yang memiliki akses kasir POS, atau hubungi administrator.
                </p>
                <button type="button" onClick={handleCashierLogout} disabled={busy || session !== null || outbox.total > 0}>
                  Keluar dari kasir
                </button>
              </div>
            )}
            <div className="row">
              <div className={`status ${status.kind === "info" ? "" : status.kind}`} role="status">
                {status.text}
              </div>
            </div>
          </section>
          </ToolScreen>

          <ToolScreen
            open={activeTool === "updates"}
            title="Pembaruan aplikasi"
            description="Pembaruan diunduh di latar dan dipasang setelah sesi kas ditutup."
            onBack={closeTool}
          >
          <section className="panel tools-panel">
            <h2>Pembaruan aplikasi (dipasang otomatis saat sesi ditutup)</h2>
            <div className="row">
              <span className="muted">
                Versi berjalan <strong>{update?.currentVersion ?? "—"}</strong>
                {update?.lastCheckedAt
                  ? ` · terakhir diperiksa ${new Date(update.lastCheckedAt).toLocaleString("id-ID")}`
                  : " · belum pernah diperiksa"}
              </span>
            </div>
            {update && update.phase !== "idle" && update.phase !== "upToDate" ? (
              <div className="row">
                <span>
                  {update.phase === "checking"
                    ? "Memeriksa pembaruan ke server…"
                    : update.phase === "available"
                      ? `Versi ${update.availableVersion} tersedia — akan diunduh di latar.`
                      : update.phase === "downloading"
                        ? `Mengunduh versi ${update.availableVersion} di latar…`
                        : update.phase === "downloaded"
                          ? `Versi ${update.availableVersion} terunduh & siap dipasang.`
                          : update.phase === "waitingSession"
                            ? `Versi ${update.availableVersion} terunduh — menunggu sesi kas ditutup untuk dipasang.`
                            : update.phase === "installing"
                              ? "Memasang pembaruan — aplikasi akan dimulai ulang…"
                              : `Pemeriksaan terakhir gagal: ${update.message ?? "tidak diketahui"}`}
                  {update.mandatory ? (
                    <strong> Pembaruan ini WAJIB (versi berjalan di bawah minimum server).</strong>
                  ) : null}
                </span>
              </div>
            ) : null}
            {update?.notes ? (
              <div className="row">
                <span className="muted">Catatan rilis: {update.notes}</span>
              </div>
            ) : null}
            <div className="row">
              <button onClick={handleCheckUpdate} disabled={busy || !inTauri || !device?.paired}>
                Periksa pembaruan
              </button>
              <button
                className="primary"
                onClick={handleInstallUpdate}
                disabled={
                  busy ||
                  !inTauri ||
                  !update ||
                  (update.phase !== "downloaded" && update.phase !== "waitingSession")
                }
              >
                Pasang sekarang
              </button>
              <span className="muted">
                Pemasangan otomatis menunggu sesi kas tertutup; tombol Pasang adalah
                perintah eksplisitmu dan boleh berjalan kapan pun paket siap.
              </span>
            </div>
          </section>
          </ToolScreen>

          <ToolScreen
            open={activeTool === "session"}
            title="Sesi kasir"
            description="Mulai shift, hitung modal, tutup kas, dan lihat riwayat kasir."
            onBack={closeTool}
          >
          <div className="cashier-tool-tabs" role="group" aria-label="Tampilan sesi kas">
            <button
              type="button"
              aria-pressed={sessionScreen === "current"}
              className={sessionScreen === "current" ? "is-active" : ""}
              onClick={() => setSessionScreen("current")}
            >Sesi berjalan</button>
            <button
              type="button"
              aria-pressed={sessionScreen === "history"}
              className={sessionScreen === "history" ? "is-active" : ""}
              onClick={() => setSessionScreen("history")}
            >Riwayat kasir <span>{sessionCount}</span></button>
          </div>
          {sessionScreen === "current" ? (
          <section className="panel session-panel" aria-label="Sesi kas yang berjalan">
            <header className="session-panel-heading">
              <div>
                <p className="eyebrow">{session ? "SHIFT AKTIF" : "MULAI SHIFT"}</p>
                <h2>{session ? "Sesi kas berjalan" : "Buka sesi kas"}</h2>
                <p className="muted">
                  {session
                    ? "Selesaikan hitung fisik sebelum meninggalkan laci kas."
                    : "Catat modal awal laci. Sesi tersimpan di perangkat kasir ini."}
                </p>
              </div>
              <span className={`session-live-state ${session ? "is-open" : "is-closed"}`}>
                {session ? "Berjalan" : "Belum dibuka"}
              </span>
            </header>
            {!session ? (
              <div className="session-open-card">
                {warehouses.length > 1 ? (
                  <label className="field">
                    Gudang / register
                    <select
                      value={activeWarehouseId}
                      onChange={(event) => {
                        const nextId = event.target.value;
                        setSelectedWarehouseId(nextId);
                        void currentCashSession(nextId)
                          .then((found) => setSession(found))
                          .catch(() => setSession(null));
                      }}
                      disabled={busy}
                    >
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.name} ({warehouse.code}){warehouse.isDefault ? " — utama" : ""}
                        </option>
                      ))}
                    </select>
                    <small className="muted">Sesi kas dan penjualan akan dicatat pada gudang ini.</small>
                  </label>
                ) : null}
                <label className="field session-opening-field">
                  Modal awal laci
                  <input
                    value={openingCash}
                    maxLength={15}
                    onChange={(event) => setOpeningCash(event.target.value.replace(/\D/g, "").slice(0, 15))}
                    inputMode="numeric"
                    aria-label="Modal awal laci dalam rupiah"
                    placeholder="Pilih nominal di bawah"
                    autoFocus
                  />
                </label>
                <div className="opening-cash-actions" role="group" aria-label="Nominal modal awal cepat">
                  {[0, 50_000, 100_000, 200_000].map((amount) => (
                    <button key={amount} type="button" aria-pressed={Number(openingCash || 0) === amount} onClick={() => setOpeningCash(String(amount))}>
                      {amount === 0 ? "Tanpa modal" : formatIDR(amount)}
                    </button>
                  ))}
                </div>
                <button
                  className="primary"
                  onClick={handleOpenSession}
                  disabled={busy || !inTauri || !activeWarehouseId}
                >
                  {busy ? "Membuka sesi…" : "Mulai shift"}
                </button>
                <p className="session-operational-note">
                  Penjualan terminal ditautkan ke shift ini. Pembukaan, mutasi, dan penutupan disinkronkan saat server tersedia; server tetap menjadi sumber rekonsiliasi resmi.
                </p>
              </div>
            ) : null}
            {session ? (
              <div className="session-current-card">
                {currentSessionSync?.open === "held" && currentSessionSync.openIntent ? (
                  <div className="session-sync-review" role="group" aria-label="Pembukaan shift perlu ditinjau">
                    <strong>Pembukaan shift belum diterima server</strong>
                    <p>{typeof currentSessionSync.openIntent.payload.syncMessage === "string" ? currentSessionSync.openIntent.payload.syncMessage : "Server meminta peninjauan pembukaan sesi."}</p>
                    <button type="button" onClick={() => void handleRetrySessionOpen(currentSessionSync.openIntent!)} disabled={busy}>Kirim ulang pembukaan</button>
                  </div>
                ) : null}
                <div className="session-summary-cards">
                  <div><span>Modal awal</span><strong>{formatIDR(Number(session.openingCash))}</strong></div>
                  <div><span>Mulai shift</span><strong>{new Date(session.openedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</strong></div>
                  <div><span>Kasir</span><strong>{device?.cashierName ?? sessionCashierName(session.openedBy)}</strong></div>
                </div>
                <section className="session-movement-card" aria-labelledby="session-movement-title">
                  <div className="session-movement-heading">
                    <div>
                      <h3 id="session-movement-title">Mutasi kas laci</h3>
                      <p>Setoran mengurangi uang di laci; penarikan menambah uang dari bank.</p>
                    </div>
                    <div className="session-movement-switch" role="group" aria-label="Jenis mutasi kas">
                      <button type="button" aria-pressed={cashMovementType === "deposit"} onClick={() => setCashMovementType("deposit")}>Setor ke bank</button>
                      <button type="button" aria-pressed={cashMovementType === "withdrawal"} onClick={() => setCashMovementType("withdrawal")}>Tarik dari bank</button>
                    </div>
                  </div>
                  <div className="session-movement-form">
                    <label className="field">
                      Nominal (Rp)
                      <input
                        value={cashMovementAmount}
                        maxLength={15}
                        onChange={(event) => setCashMovementAmount(event.currentTarget.value.replace(/\D/g, "").slice(0, 15))}
                        inputMode="numeric"
                        aria-label="Nominal mutasi kas dalam rupiah"
                        placeholder="Contoh: 50000"
                      />
                    </label>
                    <label className="field">
                      Alasan
                      <input
                        value={cashMovementNotes}
                        maxLength={200}
                        onChange={(event) => setCashMovementNotes(event.currentTarget.value)}
                        placeholder={cashMovementType === "deposit" ? "Contoh: setoran kas ke bank" : "Contoh: tambah uang kembalian"}
                      />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      onClick={handleRecordCashMovement}
                      disabled={busy || cashMovementAmount.length === 0 || cashMovementNotes.trim().length < 3}
                    >
                      {busy ? "Mencatat…" : cashMovementType === "deposit" ? "Catat setoran" : "Catat penarikan"}
                    </button>
                  </div>
                  {currentSessionMovements.length > 0 ? (
                    <ol className="session-movement-list" aria-label="Mutasi sesi kas ini">
                      {currentSessionMovements.slice(-5).reverse().map((intent) => {
                        const movementType = intent.payload.movementType === "deposit" ? "deposit" : "withdrawal";
                        const amount = Number(intent.payload.amount ?? 0);
                        const message = typeof intent.payload.syncMessage === "string" ? intent.payload.syncMessage : "";
                        const date = typeof intent.payload.createdAt === "string" ? intent.payload.createdAt : intent.createdAt;
                        return (
                          <li key={intent.id}>
                            <div>
                              <strong>{movementType === "deposit" ? "Setoran ke bank" : "Penarikan dari bank"}</strong>
                              <span>{typeof intent.payload.notes === "string" ? intent.payload.notes : "—"}</span>
                              {message ? <small role="alert">{message}</small> : null}
                            </div>
                            <div className="session-movement-value">
                              <strong>{formatIDR(amount)}</strong>
                              <span className={`session-sync-status ${intent.status === "synced" ? "is-synced" : intent.status === "held" ? "is-held" : "is-pending"}`}>
                                {intent.status === "synced" ? "Tercatat server" : intent.status === "held" ? "Perlu ditinjau" : "Menunggu sinkronisasi"}
                              </span>
                              <time dateTime={date}>{new Date(date).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>
                              {intent.status === "held" ? (
                                <button type="button" onClick={() => void handleRetrySessionMovement(intent)} disabled={busy}>
                                  Kirim ulang
                                </button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="session-movement-empty">Belum ada setoran atau penarikan pada shift ini.</p>
                  )}
                </section>
                <p className="session-operational-note">
                  {closePreviewNotice || "Hitung uang fisik terlebih dahulu. Saat antrean bersih dan server terhubung, saldo resmi akan diperiksa sebelum sesi ditutup."}
                </p>
                {!closeCountOpen ? (
                <button className="session-close-start" type="button" onClick={() => { setClosePreview(null); setClosePreviewSource(null); setClosePreviewNotice(""); setSessionDifferenceReason(""); setCloseCountOpen(true); }}>
                    Hitung kas &amp; tutup shift
                  </button>
                ) : (
                  <section className="session-count-card" aria-labelledby="session-count-title">
                    <div className="session-count-heading">
                      <div>
                        <span className="eyebrow">TUTUP SHIFT</span>
                        <h3 id="session-count-title">Hitung uang di laci</h3>
                        <p>Masukkan jumlah lembar atau keping yang benar-benar ada.</p>
                      </div>
                      <strong>{formatIDR(closePreview ? Number(closePreview.countedTotal) : countedPreview)}</strong>
                    </div>
                    {closePreview ? (
                      <div className="session-close-review">
                        <div className="session-close-review-grid">
                          <div><span>Kas fisik dihitung</span><strong>{formatIDR(Number(closePreview.countedTotal))}</strong></div>
                          <div><span>{closePreviewSource === "server" ? "Saldo resmi server" : "Estimasi terminal"}</span><strong>{formatIDR(Number(closePreview.expectedTotal))}</strong></div>
                          <div className={d(closePreview.differenceTotal).isZero() ? "is-balanced" : Number(closePreview.differenceTotal) > 0 ? "is-over" : "is-short"}>
                            <span>{d(closePreview.differenceTotal).isZero() ? "Selisih" : Number(closePreview.differenceTotal) > 0 ? "Kas lebih" : "Kas kurang"}</span>
                            <strong>{formatIDR(Math.abs(Number(closePreview.differenceTotal)))}</strong>
                          </div>
                        </div>
                        <p>{closePreviewNotice}{closePreviewSource === "terminal" ? " Estimasi ini dapat belum mencakup refund atau retur tunai yang dicatat di server." : ""}</p>
                        {closePreview.requiresReason ? (
                          <label className="field session-difference-field">
                            Alasan selisih <span>wajib untuk menutup shift</span>
                            <input
                              value={sessionDifferenceReason}
                              maxLength={200}
                              onChange={(event) => setSessionDifferenceReason(event.currentTarget.value)}
                              placeholder="Contoh: salah kembalian, uang rusak"
                            />
                          </label>
                        ) : null}
                        <div className="session-count-actions">
                          <button
                            className="primary"
                            onClick={handleCloseSession}
                            disabled={busy || (closePreview.requiresReason && sessionDifferenceReason.trim().length < 3)}
                          >
                            {busy ? "Menutup shift…" : "Konfirmasi tutup shift"}
                          </button>
                          <button type="button" onClick={() => { setClosePreview(null); setClosePreviewSource(null); setClosePreviewNotice(""); setSessionDifferenceReason(""); }} disabled={busy}>Ubah hitungan</button>
                        </div>
                      </div>
                    ) : (
                      <>
                    <div className="denomination-list">
                      {DENOMINATIONS.map((denom) => (
                        <div className="denomination-row" key={denom}>
                          <div><strong>{formatIDR(Number(denom))}</strong><span>lembar / keping</span></div>
                          <div className="denomination-stepper">
                            <button
                              type="button"
                              aria-label={`Kurangi jumlah pecahan ${formatIDR(Number(denom))}`}
                              disabled={Number(counts[denom] || 0) <= 0}
                              onClick={() => { setClosePreview(null); setSessionDifferenceReason(""); setCounts((current) => ({ ...current, [denom]: String(Math.max(0, (Number(current[denom]) || 0) - 1)) })); }}
                            >−</button>
                            <input
                              aria-label={`Jumlah pecahan ${formatIDR(Number(denom))}`}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min="0"
                              maxLength={6}
                              value={counts[denom] ?? ""}
                              onChange={(event) => { setClosePreview(null); setSessionDifferenceReason(""); setCounts((current) => ({ ...current, [denom]: event.target.value.replace(/\D/g, "").slice(0, 6) })); }}
                            />
                            <button
                              type="button"
                              aria-label={`Tambah jumlah pecahan ${formatIDR(Number(denom))}`}
                              onClick={() => { setClosePreview(null); setSessionDifferenceReason(""); setCounts((current) => ({ ...current, [denom]: String(Math.min(999_999, (Number(current[denom]) || 0) + 1)) })); }}
                            >+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="session-count-actions">
                      <button className="primary" onClick={handlePreviewSessionClose} disabled={busy}>
                        {busy ? "Memeriksa hitungan…" : "Tinjau hasil hitung"}
                      </button>
                      <button type="button" onClick={() => { setCloseCountOpen(false); setClosePreview(null); }} disabled={busy}>Kembali</button>
                    </div>
                      </>
                    )}
                  </section>
                )}
              </div>
            ) : null}
            {lastClosed ? (
              <div className="session-last-closed" role="status">
                <strong>Shift terakhir ditutup</strong>
                <span>{lastClosed.closedAt ? new Date(lastClosed.closedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "Waktu penutupan tidak tersedia"}</span>
                <div><span>Kas fisik <b>{formatIDR(Number(lastClosed.countedTotal ?? 0))}</b></span><span>Harapan lokal <b>{formatIDR(Number(lastClosed.expectedTotal ?? 0))}</b></span><span>Selisih <b>{formatIDR(Number(lastClosed.differenceTotal ?? 0))}</b></span></div>
                <small>Hitungan tersimpan di terminal. Status pengiriman ke server terlihat pada riwayat shift.</small>
              </div>
            ) : null}
          </section>
          ) : (
            <section className="panel session-history-panel" aria-labelledby="session-history-title">
              <div className="session-history-heading">
                <div>
                  <p className="eyebrow">RIWAYAT KASIR</p>
                  <h2 id="session-history-title">Riwayat kasir</h2>
                  <p className="muted">Catatan shift yang tersimpan pada terminal ini.</p>
                </div>
                <span className="session-history-count">{sessionCount} sesi</span>
              </div>
              <div className="session-history-filters">
                <label className="field">
                  Cari nama kasir, tanggal, atau ID shift
                  <input value={sessionHistorySearch} onChange={(event) => setSessionHistorySearch(event.target.value)} placeholder="Contoh: Sari, 17 Nov, atau 8a31…" />
                </label>
                <label className="field">
                  Status shift
                  <select value={sessionHistoryStatus} onChange={(event) => setSessionHistoryStatus(event.target.value as "all" | "open" | "closed")}>
                    <option value="all">Semua status</option>
                    <option value="open">Sedang berjalan</option>
                    <option value="closed">Sudah ditutup</option>
                  </select>
                </label>
              </div>
              <p className="session-history-result-count">{filteredSessionHistory.length} shift ditemukan</p>
              {sessionHistoryLoading ? <LoadingSkeleton label="Memuat riwayat shift…" /> : null}
              {sessionHistoryError ? <p className="status error" role="alert">{sessionHistoryError}</p> : null}
              {!sessionHistoryLoading && !sessionHistoryError && sessionHistory.length === 0 ? (
                <p className="session-history-empty">Belum ada shift yang tercatat di terminal ini.</p>
              ) : null}
              {!sessionHistoryLoading && !sessionHistoryError && sessionHistory.length > 0 && filteredSessionHistory.length === 0 ? (
                <p className="session-history-empty">Tidak ada shift yang cocok dengan pencarian ini.</p>
              ) : null}
              {filteredSessionHistory.length > 0 ? (
                <ol className="session-history-list">
                  {filteredSessionHistory.slice(0, 20).map((entry) => {
                    const sessionSync = sessionSyncById.get(entry.id);
                    const syncStatus = entry.status === "open" ? sessionSync?.open : sessionSync?.close;
                    const syncLabel = syncStatus === "synced"
                      ? entry.status === "open" ? "Pembukaan tercatat di server" : "Penutupan terkirim ke server"
                      : syncStatus === "pending"
                        ? "Belum tersinkron ke server"
                        : syncStatus === "held"
                          ? "Server meminta tindakan kasir"
                        : "Status server belum tersedia";
                    const closeIntent = sessionSync?.closeIntent;
                    const openIntent = sessionSync?.openIntent;
                    const openMessage = typeof openIntent?.payload.syncMessage === "string"
                      ? openIntent.payload.syncMessage
                      : "Server belum menerima pembukaan shift ini.";
                    const closeMessage = typeof closeIntent?.payload.syncMessage === "string"
                      ? closeIntent.payload.syncMessage
                      : "Server belum menerima penutupan shift ini.";
                    const retryNeedsReason = /selisih kas|alasan selisih/i.test(closeMessage);
                    return (
                    <li key={entry.id}>
                      <div className="session-history-row-heading">
                        <div className="session-history-row-status">
                          <strong>{entry.status === "open" ? "Shift masih berjalan" : "Shift ditutup"}</strong>
                          <span className={`session-live-state ${entry.status === "open" ? "is-open" : "is-closed"}`}>{entry.status === "open" ? "Aktif" : "Selesai"}</span>
                        </div>
                        <time dateTime={entry.openedAt}>{formatShiftDate(entry.openedAt)}</time>
                      </div>
                      <small className="session-history-id">Shift {entry.id.slice(0, 8)} · Kasir {sessionCashierName(entry.openedBy)} · {saleCountBySession.get(entry.id) ?? 0} transaksi</small>
                      <small className={`session-sync-status ${syncStatus === "synced" ? "is-synced" : syncStatus === "pending" ? "is-pending" : syncStatus === "held" ? "is-held" : "is-unknown"}`} role="status">{syncLabel}</small>
                      <div className="session-history-values">
                        <span>Modal awal <strong>{formatIDR(Number(entry.openingCash))}</strong></span>
                        {entry.countedTotal !== null ? <span>Kas fisik <strong>{formatIDR(Number(entry.countedTotal))}</strong></span> : null}
                        {entry.expectedTotal !== null ? <span>Harapan lokal <strong>{formatIDR(Number(entry.expectedTotal))}</strong></span> : null}
                        {entry.differenceTotal !== null ? <span>Selisih <strong>{formatIDR(Number(entry.differenceTotal))}</strong></span> : null}
                      </div>
                      {paymentTotalsBySession.get(entry.id)?.length ? (
                        <div className="session-payment-breakdown" role="group" aria-label="Total per metode pembayaran pada shift ini">
                          <strong>Penerimaan per metode</strong>
                          <ul>
                            {paymentTotalsBySession.get(entry.id)!.map((row) => (
                              <li key={row.methodId}><span>{row.label}</span><strong>{formatIDR(row.total)}</strong></li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {entry.closedAt ? <small>Ditutup {formatShiftDate(entry.closedAt)}</small> : null}
                      {sessionSync?.open === "held" && openIntent ? (
                        <div className="session-sync-review" role="group" aria-label="Tindakan pembukaan shift yang ditolak server">
                          <strong>Pembukaan shift tertunda</strong>
                          <p>{openMessage}</p>
                          <button type="button" className="primary" onClick={() => void handleRetrySessionOpen(openIntent)} disabled={busy}>
                            Kirim ulang pembukaan
                          </button>
                        </div>
                      ) : null}
                      {sessionSync?.movements.length ? (
                        <div className="session-history-movements">
                          <strong>Setoran &amp; penarikan</strong>
                          {sessionSync.movements.map((movement) => {
                            const deposit = movement.payload.movementType === "deposit";
                            const amount = Number(movement.payload.amount ?? 0);
                            const message = typeof movement.payload.syncMessage === "string" ? movement.payload.syncMessage : "";
                            const movementDate = typeof movement.payload.createdAt === "string" ? movement.payload.createdAt : movement.createdAt;
                            return (
                              <div className="session-history-movement" key={movement.id}>
                                <span>
                                  {deposit ? "Setor ke bank" : "Tarik dari bank"} · {new Date(movementDate).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                                  {typeof movement.payload.notes === "string" ? ` · ${movement.payload.notes}` : ""}
                                  {message ? <small role="alert">{message}</small> : null}
                                </span>
                                <strong>{formatIDR(amount)}</strong>
                                <span className={`session-sync-status ${movement.status === "synced" ? "is-synced" : movement.status === "held" ? "is-held" : "is-pending"}`}>
                                  {movement.status === "synced" ? "Tercatat server" : movement.status === "held" ? "Perlu ditinjau" : "Menunggu sinkronisasi"}
                                </span>
                                {movement.status === "held" ? (
                                  <button type="button" onClick={() => void handleRetrySessionMovement(movement)} disabled={busy}>Kirim ulang mutasi</button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {syncStatus === "held" && closeIntent ? (
                        <div className="session-sync-review" role="group" aria-label="Tindakan penutupan shift yang ditolak server">
                          <strong>Penutupan server tertunda</strong>
                          <p>{closeMessage}</p>
                          <label className="field">
                            Alasan selisih kas server (jika diminta)
                            <input
                              value={sessionRetryReasons[closeIntent.id] ?? ""}
                              maxLength={200}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setSessionRetryReasons((current) => ({ ...current, [closeIntent.id]: value }));
                              }}
                              placeholder="Jelaskan penyebab selisih"
                            />
                          </label>
                          <button
                            type="button"
                            className="primary"
                            onClick={() => void handleRetrySessionClose(closeIntent)}
                            disabled={busy || (retryNeedsReason && (sessionRetryReasons[closeIntent.id]?.trim().length ?? 0) < 3)}
                          >
                            Kirim ulang penutupan
                          </button>
                          <small>Server menghitung kas dari mutasi resminya. Penjualan terminal tetap tersimpan; catatan ini tidak mengubah uang yang dihitung.</small>
                        </div>
                      ) : null}
                    </li>
                    );
                  })}
                </ol>
              ) : null}
              <p className="session-history-note">
                {filteredSessionHistory.length > 20 ? "Menampilkan 20 hasil terbaru. " : ""}
                Riwayat ini berasal dari database terminal ini, bukan daftar shift seluruh cabang. Penutupan terminal belum menggantikan rekonsiliasi kas dan jurnal resmi di server.
              </p>
            </section>
          )}
          </ToolScreen>

          <section className="panel catalog-panel">
            <h2>Produk ({info?.productCount ?? 0})</h2>
            <div className="catalog-toolbar catalog-toolbar-single">
              <label className="field catalog-search-field">
                <span className="sr-only">Pindai barcode atau cari nama dan SKU</span>
                <input
                  ref={scanInputRef}
                  type="search"
                  value={catalogSearch}
                  onChange={(event) => {
                    setCatalogSearch(event.currentTarget.value);
                    setCatalogPage(1);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleScan(catalogSearch);
                  }}
                  placeholder="Pindai barcode atau cari nama / SKU · F2"
                  aria-keyshortcuts="F2 Enter"
                  autoComplete="off"
                  autoFocus
                />
              </label>
              <span className="catalog-search-hint">Pindai lalu Enter, atau pilih produk dari katalog</span>
            </div>
            {catalogCategories.length > 0 ? (
              <div className="catalog-category-filters" role="group" aria-label="Filter kategori produk">
                <button
                  type="button"
                  className={`catalog-category-chip ${catalogCategoryId === "" ? "active" : ""}`}
                  aria-pressed={catalogCategoryId === ""}
                  onClick={() => {
                    setCatalogCategoryId("");
                    setCatalogPage(1);
                  }}
                >
                  Semua <span>{info?.productCount ?? catalog.total}</span>
                </button>
                {catalogCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`catalog-category-chip ${catalogCategoryId === category.id ? "active" : ""}`}
                    aria-pressed={catalogCategoryId === category.id}
                    onClick={() => {
                      setCatalogCategoryId(category.id);
                      setCatalogPage(1);
                    }}
                  >
                    {category.name} <span>{category.count.toLocaleString("id-ID")}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="catalog-summary">
              <span>{catalogLoading ? "Memuat katalog…" : `${catalog.products.length} dari ${catalog.total} produk`}</span>
              <span>{info?.version ? "Katalog tersimpan di perangkat" : "Belum ada snapshot produk"}</span>
            </div>
            {catalogError ? <p className="status error" role="alert">Gagal membaca katalog lokal: {catalogError}</p> : null}
            {info?.productCount === 0 ? (
              <p className="muted">Belum ada produk di DB lokal. Segarkan snapshot terlebih dahulu.</p>
            ) : catalogLoading && catalog.products.length === 0 ? (
              <LoadingSkeleton label="Memuat katalog lokal…" />
            ) : catalogError ? null : catalog.total === 0 ? (
              <p className="muted">Tidak ada produk yang cocok. Ubah kata kunci pencarian.</p>
            ) : (
              <div
                className={`product-grid ${displayPrefs.view === "list" ? "is-list" : ""}`}
                data-columns={displayPrefs.columns}
              >
                {catalog.products.map((product) => (
                  <div
                    key={product.productId}
                    className={`product-card ${displayPrefs.view === "list" ? "is-list" : ""}`}
                    style={displayPrefs.colorByCategory && product.categoryId
                      ? { "--category-accent": categoryAccent(product.categoryId) } as CSSProperties
                      : undefined}
                  >
                    <button
                      className="product"
                      onClick={() => addCatalogProduct(product)}
                      disabled={!inTauri}
                    >
                      <span className="name">{product.name}</span>
                      {displayPrefs.showCategory && product.categoryName ? (
                        <span className="category-label">{product.categoryName}</span>
                      ) : null}
                      {displayPrefs.showPrice ? (
                        <span className="price">{formatIDR(Number(product.salePrice))}</span>
                      ) : null}
                      {displayPrefs.showSku || displayPrefs.showStock ? (
                        <span className="meta">
                          {displayPrefs.showSku ? product.sku : null}
                          {displayPrefs.showSku && displayPrefs.showStock ? " · " : null}
                          {displayPrefs.showStock ? `Stok ${product.stock}${product.unitCode ? ` ${product.unitCode}` : ""}` : null}
                        </span>
                      ) : null}
                    </button>
                    {displayPrefs.showPackaging && product.packagings.some((entry) => entry.isActive) ? (
                      <div className="packs">
                        {product.packagings
                          .filter((entry) => entry.isActive)
                          .map((packaging) => (
                            <button
                              key={packaging.packagingId}
                              className="pack-chip"
                              onClick={() => addCatalogProduct(product, packaging)}
                              disabled={!inTauri}
                            >
                              + {packaging.name} ×{Number(packaging.isi)} ·{" "}
                              {formatIDR(
                                lineUnitPrice({ product, packaging, qty: 1 }),
                              )}
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {catalog.pageCount > 1 ? (
              <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                <button
                  onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}
                  disabled={catalogLoading || catalog.page <= 1}
                >
                  Sebelumnya
                </button>
                <span className="muted">
                  Halaman {catalog.page} dari {catalog.pageCount}
                </span>
                <button
                  onClick={() =>
                    setCatalogPage((page) => Math.min(catalog.pageCount, page + 1))
                  }
                  disabled={catalogLoading || catalog.page >= catalog.pageCount}
                >
                  Berikutnya
                </button>
              </div>
            ) : null}
          </section>

          <ToolScreen
            open={activeTool === "sync"}
            title="Sinkronisasi offline"
            description="Periksa transaksi yang menunggu server dan jalankan sinkronisasi dengan aman."
            onBack={closeTool}
          >
          <section className="panel tools-panel">
            <h2>Transaksi menunggu sinkronisasi</h2>
            {outbox.total === 0 ? (
              <p className="muted">Antrean kosong.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Kunci</th>
                    <th>Status</th>
                    <th className="num">Total</th>
                    <th>Pesan terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.items.map((item) => (
                    <tr key={item.clientKey}>
                      <td>Transaksi #{item.clientKey.slice(0, 8)}</td>
                      <td>
                        <span className={`tag ${item.status}`}>{item.status}</span>
                      </td>
                      <td className="num">
                        {item.expectedTotal === null
                          ? "—"
                          : formatIDR(Number(item.expectedTotal))}
                      </td>
                      <td className="muted">{item.lastMessage ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="row">
              <span className="muted">
                Menampilkan {outbox.items.length} dari {outbox.total} transaksi
                {outboxLoading ? " · Memuat…" : ""}
              </span>
              {outbox.pageCount > 1 ? (
                <>
                  <button
                    onClick={() => void loadOutboxPage(outbox.page - 1)}
                    disabled={outboxLoading || outbox.page <= 1}
                  >
                    Sebelumnya
                  </button>
                  <span className="muted">
                    Halaman {outbox.page} dari {outbox.pageCount}
                  </span>
                  <button
                    onClick={() => void loadOutboxPage(outbox.page + 1)}
                    disabled={outboxLoading || outbox.page >= outbox.pageCount}
                  >
                    Berikutnya
                  </button>
                </>
              ) : null}
            </div>
            <div className="row">
              <button onClick={handleSyncNow} disabled={busy || !inTauri}>
                Sinkronkan sekarang
              </button>
              <span className="muted">
                Drain juga berjalan otomatis di latar; penjualan baru memicunya segera.
              </span>
            </div>
          </section>
          </ToolScreen>

          <ToolScreen
            open={activeTool === "printer"}
            title="Printer dan laci kas"
            description="Atur printer nota, tes hasil cetak, tinjau antrean cetak, atau buka laci kas dengan alasan tercatat."
            onBack={closeTool}
          >
          <section className="panel tools-panel">
            <h2>Printer thermal native</h2>
            <div className="row">
              <label className="field">
                Sambungan printer
                <select value={printerTransport} onChange={(event) => {
                  const nextTransport = event.target.value as "tcp" | "cups" | "device";
                  setPrinterTransport(nextTransport);
                  if (nextTransport === "cups" && cupsPrinters.length === 0) void handleRefreshCupsPrinters();
                }}>
                  <option value="tcp">Jaringan (TCP)</option>
                  <option value="cups">Printer lokal (CUPS / USB)</option>
                  <option value="device">Perangkat langsung (USB/Bluetooth node)</option>
                </select>
              </label>
              {printerTransport === "tcp" ? (
                <>
                  <label className="field">
                    Host printer jaringan
                    <input value={printerHost} onChange={(event) => setPrinterHost(event.target.value)} placeholder="192.168.1.50" />
                  </label>
                  <label className="field">
                    Port RAW
                    <input value={printerPort} onChange={(event) => setPrinterPort(event.target.value)} inputMode="numeric" />
                  </label>
                </>
              ) : printerTransport === "device" ? (
                <>
                  <label className="field">
                    Path perangkat printer
                    <input value={printerDevicePath} onChange={(event) => setPrinterDevicePath(event.target.value)} placeholder="/dev/usb/lp0 atau /dev/rfcomm0" />
                    <small className="muted">Byte ESC/POS ditulis langsung ke node perangkat OS. USB/Bluetooth harus sudah terpasang & terhubung sebagai perangkat karakter.</small>
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    Antrean printer sistem
                    <select value={printerQueue} onChange={(event) => setPrinterQueue(event.target.value)}>
                      <option value="">Pilih antrean printer</option>
                      {printerQueue && !cupsPrinters.includes(printerQueue) ? <option value={printerQueue}>{printerQueue} (tersimpan)</option> : null}
                      {cupsPrinters.map((queue) => <option key={queue} value={queue}>{queue}</option>)}
                    </select>
                  </label>
                  <div className="field cups-printer-refresh">
                    <span>Printer lokal tersedia</span>
                    <button type="button" onClick={() => void handleRefreshCupsPrinters()} disabled={cupsPrintersLoading}>
                      {cupsPrintersLoading ? "Mencari…" : "Deteksi antrean"}
                    </button>
                    {cupsPrintersError ? <span className="cups-printer-error" role="alert">{cupsPrintersError}</span> : null}
                  </div>
                </>
              )}
              <label className="field">
                Lebar kertas
                <select
                  value={printerPaper}
                  onChange={(event) => setPrinterPaper(event.target.value)}
                >
                  <option value="58">58mm (32 kolom)</option>
                  <option value="80">80mm (48 kolom)</option>
                </select>
              </label>
            </div>
            {printerTransport === "cups" ? (
              <p className="muted cups-printer-note">
                Printer USB harus lebih dulu dipasang sebagai antrean thermal raw di pengaturan Linux. Mode raw didukung CUPS 2.x; CUPS 3 telah menghapus antrean raw. Cetak diuji dari aplikasi setelah antrean dipilih.
              </p>
            ) : null}
            <div className="row">
              <button className="primary" onClick={handleSavePrinter} disabled={busy || !inTauri}>
                Simpan printer
              </button>
              <button onClick={handleTestPrint} disabled={busy || !inTauri || !printer?.configured}>
                Tes cetak
              </button>
              <span className="muted">
                {printer?.configured
                  ? `${printer.transport === "cups" ? `Antrean CUPS ${printer.host}` : `${printer.host}:${printer.port}`} · ${printer.paperWidthMm}mm · antre ${printer.pendingCount} · gagal ${printer.failedCount}${printer.printing ? " · sedang mencetak" : ""}. Struk dibangkitkan dan dikirim oleh Rust; tendangan laci hanya untuk penjualan tunai.`
                  : "Belum diatur — penjualan tetap tercatat & mengantre cetak sampai printer diatur."}
              </span>
            </div>
            <div className="row">
              <label className="field">
                Alasan buka laci (wajib, tercatat)
                <input
                  value={drawerReason}
                  onChange={(event) => setDrawerReason(event.target.value)}
                  placeholder="mis. tukar uang pecahan"
                />
              </label>
              <button onClick={handleOpenDrawer} disabled={busy || !inTauri || !printer?.configured}>
                Buka laci
              </button>
            </div>
            <h3>Antrean cetak lokal</h3>
            {printJobs.length === 0 ? (
              <p className="muted">Belum ada tugas cetak. Setiap penjualan lokal membuat satu tugas secara atomik.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Salinan</th>
                    <th>Status</th>
                    <th className="num">Coba</th>
                    <th>Galat terakhir</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {printJobs.map((job) => (
                    <tr key={job.id}>
                      <td className="mono">{job.clientKey.slice(0, 8)}…</td>
                      <td>{job.copyIndex === 0 ? "Asli" : `Ke-${job.copyIndex}`}</td>
                      <td>
                        <span className={`tag ${job.status}`}>{job.status}</span>
                      </td>
                      <td className="num">{job.attempts}</td>
                      <td className="muted">{job.lastError ?? "—"}</td>
                      <td>
                        <button
                          onClick={() => job.status === "failed" ? handleRetryOriginalPrint(job) : handleReprint(job)}
                          disabled={busy || !inTauri || job.status === "pending" || job.status === "printing"}
                        >
                          {job.status === "failed" ? "Coba tugas ini lagi" : job.status === "printed" ? "Cetak salinan" : job.status === "printing" ? "Sedang mencetak…" : "Menunggu"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3>Antrean cetak nota server</h3>
            {serverReceiptPrintJobs.length === 0 ? (
              <p className="muted">Belum ada cetak ulang transaksi server pada terminal ini.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Transaksi</th>
                    <th>Status</th>
                    <th className="num">Percobaan</th>
                    <th>Galat terakhir</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {serverReceiptPrintJobs.map((job) => (
                    <tr key={job.id}>
                      <td className="mono">{job.saleId.slice(0, 8)}…</td>
                      <td><span className={`tag ${job.status}`}>{job.status}</span></td>
                      <td className="num">{job.attempts}</td>
                      <td className="muted">{job.lastError ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => job.status === "failed" ? handleRetryServerReceiptPrint(job) : handleServerHistoryReprint(job.saleId)}
                          disabled={busy || !inTauri || job.status === "pending" || job.status === "printing"}
                        >
                          {job.status === "failed" ? "Coba lagi" : job.status === "printed" ? "Cetak ulang" : job.status === "printing" ? "Sedang mencetak…" : "Menunggu"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          </ToolScreen>

          <ToolScreen
            open={activeTool === "display"}
            title="Layar pelanggan"
            description="Tampilkan daftar belanja, total, dan konfirmasi pembayaran pada monitor kedua."
            onBack={closeTool}
          >
          <section className="panel tools-panel">
            <h2>Layar pelanggan (jendela kedua)</h2>
            <p className="muted">
              Menampilkan nama toko, isi keranjang berjalan, dan total besar di monitor kedua;
              sesudah pembayaran tampil ucapan terima kasih. Data mengalir dari Rust lewat event —
              jendela ini tanpa token/HTTP. Tanpa layar kedua, fitur ini diam dan tidak mengganggu.
            </p>
            <div className="row">
              <button onClick={() => void handleToggleDisplay()} disabled={busy || !inTauri}>
                {displayOpen ? "Tutup layar pelanggan" : "Buka layar pelanggan"}
              </button>
              <span className="muted">{displayOpen ? "Terbuka" : "Tertutup"}</span>
            </div>
          </section>
          </ToolScreen>

          <ToolScreen
            open={activeTool === "report"}
            title="Laporan harian"
            description="Ringkasan penjualan terminal: jumlah transaksi, total, dan penerimaan per metode."
            onBack={closeTool}
          >
            <section className="panel tools-panel">
              <div className="report-range" role="group" aria-label="Rentang laporan">
                {(["today", "7d", "30d", "custom"] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={reportRange === preset}
                    onClick={() => setReportRange(preset)}
                  >
                    {preset === "today" ? "Hari ini" : preset === "7d" ? "7 hari" : preset === "30d" ? "30 hari" : "Custom"}
                  </button>
                ))}
              </div>
              {reportRange === "custom" ? (
                <div className="report-custom-range">
                  <label className="field">Dari <input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label>
                  <label className="field">Sampai <input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label>
                </div>
              ) : null}
              {reportLoading ? <LoadingSkeleton label="Menghitung laporan…" /> : null}
              <div className="report-summary">
                <div><span>Jumlah transaksi</span><strong>{reportTxCount}</strong></div>
                <div><span>Total penjualan</span><strong>{formatIDR(reportSalesTotal)}</strong></div>
              </div>
              <h3>Penerimaan per metode</h3>
              {reportTotals.length ? (
                <table className="report-table">
                  <thead><tr><th>Metode</th><th>Transaksi</th><th>Total</th></tr></thead>
                  <tbody>
                    {reportTotals.map((row) => (
                      <tr key={row.methodId}>
                        <td>{methods.find((method) => method.methodId === row.methodId)?.name ?? `Metode ${row.methodId.slice(0, 6)}`}</td>
                        <td>{row.count}</td>
                        <td>{formatIDR(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">Belum ada transaksi pada rentang ini.</p>
              )}
              <p className="history-note">
                Angka dihitung dari transaksi yang tersimpan di terminal ini. Transaksi yang belum tersinkron tetap
                dihitung dan ditandai pada status sinkronisasinya di riwayat.
              </p>
            </section>
          </ToolScreen>

          <ToolScreen
            open={activeTool === "kitchen"}
            title="Layar dapur"
            description="Antrian pesanan dari penjualan terakhir, diurut dari yang paling lama."
            onBack={closeTool}
          >
            <section className="panel tools-panel">
              {kitchenTickets.length === 0 ? (
                <p className="muted">Belum ada pesanan pada 24 jam terakhir.</p>
              ) : (
                <ol className="kitchen-ticket-list">
                  {kitchenTickets.map((ticket) => (
                    <li key={ticket.saleId} className="kitchen-ticket">
                      <div className="kitchen-ticket-head">
                        <strong>{ticket.number}</strong>
                        <span>{kitchenTicketAgeLabel(ticket.createdAt)}</span>
                      </div>
                      <ul>
                        {ticket.lines.map((line, index) => (
                          <li key={`${ticket.saleId}-${index}`}>
                            <strong>{line.qty}×</strong>
                            <span>{line.productName}{line.packagingName ? ` · ${line.packagingName}` : ""}</span>
                            {line.unitCode ? <small>{line.unitCode}</small> : null}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
              <p className="history-note">
                Tiket berasal dari penjualan yang sudah diposting server. Penanda usia membantu dapur
                mengurut pesanan; status &quot;siap&quot; belum tersedia di kontrak server saat ini.
              </p>
            </section>
          </ToolScreen>
        </div>

        <aside
          id="desktop-checkout"
          className={`panel checkout-panel ${mobileCheckoutOpen ? "mobile-open" : ""} ${checkoutOpen ? "checkout-workspace" : ""}`}
          aria-label={checkoutOpen ? "Pembayaran dan pemeriksaan pesanan" : "Keranjang"}
          aria-labelledby={checkoutOpen ? "desktop-checkout-title" : undefined}
          aria-modal={checkoutOpen || mobileCheckoutOpen ? "true" : undefined}
          role={checkoutOpen || mobileCheckoutOpen ? "dialog" : undefined}
          onKeyDown={checkoutOpen || mobileCheckoutOpen ? trapDialogTab : undefined}
        >
          <div className="cart-heading">
            <h2 id="desktop-checkout-title">
              {checkoutOpen ? (
                <button type="button" className="checkout-back" onClick={() => setCheckoutOpen(false)}>
                  <ArrowLeft aria-hidden="true" /> Kembali
                </button>
              ) : null}
              <span>{checkoutOpen ? "Pembayaran" : "Keranjang"}</span>
              <span className="muted">{cart.length} baris</span>
            </h2>
            <div className="cart-heading-actions">
              <button
                className="mobile-cart-toggle"
                type="button"
                onClick={() => setMobileCheckoutOpen((open) => !open)}
                aria-expanded={mobileCheckoutOpen}
                aria-controls="desktop-checkout"
              >
                {mobileCheckoutOpen ? "Tutup" : "Rincian"}
              </button>
              {cart.length > 0 ? (
                <button ref={clearOrderTriggerRef} className="cart-clear" type="button" onClick={() => setClearOrderOpen(true)} disabled={busy}>
                  Kosongkan
                </button>
              ) : null}
              <button type="button" onClick={() => void handleHoldSale()} disabled={busy || cart.length === 0}>
                Tahan pesanan
              </button>
              <button type="button" onClick={() => {
                setMobileCheckoutOpen(false);
                setHeldPanelOpen(true);
                if (device?.tokenConfigured) void loadServerHeldSales();
              }} aria-haspopup="dialog">
                Ditahan ({visibleLocalHeldSales.length + (serverHeldVerified ? serverHeldSales.total : 0)})
              </button>
            </div>
          </div>
          <div className="cart-lines">
            {cart.length === 0 ? (
              <p className="muted">Pindai barcode atau pilih produk untuk mulai.</p>
            ) : (
              <table>
                <tbody>
                  {cart.map((line, index) => (
                    <tr key={lineKey(line)}>
                      <td>
                        <span className="cart-name">{line.product.name}</span>
                        {localQuote?.lines[index]?.groupDiscountAmount ? (
                          <div className="cart-subline">
                            Harga kelompok −{formatIDR(localQuote.lines[index].groupDiscountAmount)}
                          </div>
                        ) : null}
                        <div className="cart-subline">
                          <select
                            aria-label={`Satuan ${line.product.name}`}
                            value={line.packaging?.packagingId ?? ""}
                            onChange={(event) => {
                              const next = line.product.packagings.find((entry) => entry.packagingId === event.target.value) ?? null;
                              changeLinePackaging(line, next);
                            }}
                            disabled={!inTauri}
                          >
                            <option value="">{line.product.unitCode ?? "Pcs"} (dasar)</option>
                            {line.product.packagings.filter((entry) => entry.isActive).map((packaging) => (
                              <option key={packaging.packagingId} value={packaging.packagingId}>
                                {packaging.name} (isi {Number(packaging.isi)})
                              </option>
                            ))}
                          </select>
                        </div>
                        {info?.canDiscount ? (
                          <div className="cart-discount">
                            <button
                              type="button"
                              className="discount-toggle"
                              aria-expanded={discountEditorKey === lineKey(line)}
                              onClick={() => setDiscountEditorKey((current) => current === lineKey(line) ? null : lineKey(line))}
                            >
                              {line.discountType ? "Ubah diskon" : "Tambah diskon"}
                            </button>
                            {line.discountType ? (
                              <span className="discount-applied">
                                {line.discountType === "percent" ? `${line.discountValue ?? 0}%` : `${formatIDR((line.discountValue ?? 0) * lineBaseQty(line))}`} diskon
                              </span>
                            ) : null}
                            {discountEditorKey === lineKey(line) ? (
                              <div className="discount-editor">
                                <select
                                  aria-label={`Jenis diskon ${line.product.name}`}
                                  value={line.discountType ?? ""}
                                  onChange={(event) => {
                                    const value = event.target.value as "percent" | "nominal" | "";
                                    updateLineDiscount(line, value || null, value ? line.discountValue ?? 0 : 0);
                                  }}
                                >
                                  <option value="">Tanpa diskon</option>
                                  <option value="percent">Persentase</option>
                                  <option value="nominal">Nominal per unit dasar</option>
                                </select>
                                {line.discountType ? (
                                  <label className="field">
                                    {line.discountType === "percent" ? "Diskon (%)" : "Potongan / unit dasar (Rp)"}
                                    <input
                                      inputMode="decimal"
                                      value={line.discountValue || ""}
                                      onChange={(event) => {
                                        const raw = event.target.value.replace(/[^\d.]/g, "");
                                        const parsed = Number(raw || 0);
                                        if (Number.isFinite(parsed)) {
                                          updateLineDiscount(line, line.discountType, line.discountType === "percent" ? Math.min(100, parsed) : parsed);
                                        }
                                      }}
                                    />
                                  </label>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {line.product.trackSerial ? (
                          <label className="serial-entry">
                            <span className="serial-entry-heading">
                              Nomor seri
                              <strong>
                                {(line.serialNumbers ?? []).filter((value) => value.trim()).length} / {lineBaseQty(line)}
                              </strong>
                            </span>
                            <textarea
                              rows={Math.min(5, Math.max(2, Math.ceil(lineBaseQty(line))))}
                              value={(line.serialNumbers ?? []).join("\n")}
                              onChange={(event) => updateLineSerials(line, event.currentTarget.value)}
                              placeholder="Pindai atau masukkan satu nomor per baris"
                              aria-label={`Nomor seri ${line.product.name}`}
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <span className="serial-entry-help">
                              Satu nomor per unit. Ketersediaan diverifikasi server saat sinkron.
                            </span>
                          </label>
                        ) : null}
                      </td>
                      <td>
                        <div className="qty-control" aria-label={`Jumlah ${line.product.name}`}>
                          <button type="button" onClick={() => adjustLineQty(line, -1)} aria-label={`Kurangi ${line.product.name}`}>−</button>
                          <span className="qty-value">{line.qty}</span>
                          <button type="button" onClick={() => adjustLineQty(line, 1)} aria-label={`Tambah ${line.product.name}`}>+</button>
                        </div>
                        {line.packaging ? <div className="cart-subline num">{lineBaseQty(line)} {line.product.unitCode ?? "Pcs"}</div> : null}
                      </td>
                      <td className="num"><strong>{formatIDR(localQuote?.lines[index]?.lineTotal ?? lineTotal(line))}</strong></td>
                      <td>
                        <button className="cart-remove" type="button" onClick={() => removeCartLine(line)} aria-label={`Hapus ${line.product.name}`}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {availablePromotions.length ? (
            <div className="promo-panel" role="group" aria-label="Promosi yang tersedia">
              <strong>Promosi tersedia</strong>
              <div className="promo-options">
                {availablePromotions.map((promo) => (
                  <button key={promo.id} type="button" onClick={() => applyPromotionToCart(promo)} disabled={busy}>
                    <span>{promo.name}</span>
                    <small>{promo.type === "percent" ? `${promo.value}%` : formatIDR(promo.value)}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="payment-block">
            {!splitPayment ? (
              <>
                <div className="payment-step-heading">
                  <div>
                    <span className="eyebrow">LANGKAH 1</span>
                    <h3>Pilih cara bayar</h3>
                  </div>
                  <button
                    className="split-toggle-inline"
                    type="button"
                    onClick={() => {
                      const first = Math.floor(cartTotal / 2);
                      const secondMethod = methods.find((method) => method.methodId !== methodId);
                      if (selectedMethod?.type === "credit" || secondMethod?.type === "credit") {
                        setDueDate((current) => current || dateAfterDays(7));
                      }
                      setMixedPayments(methodId && secondMethod ? [
                        { key: crypto.randomUUID(), methodId, amount: String(first), tendered: "", reference: "" },
                        { key: crypto.randomUUID(), methodId: secondMethod.methodId, amount: String(cartTotal - first), tendered: "", reference: "" },
                      ] : []);
                      setSplitPayment(true);
                    }}
                    disabled={methods.length < 2}
                  >
                    Campuran
                  </button>
                </div>
                {methods.length ? (
                  <div className="payment-method-grid" role="group" aria-label="Metode pembayaran">
                    {methods.map((method) => {
                      const isSelected = methodId === method.methodId;
                      const hint = isCashMethod(method)
                        ? "Tunai"
                        : method.type === "credit" || method.type === "customer_credit"
                          ? "Kredit pelanggan"
                          : "Non-tunai";
                      return (
                        <button
                          key={method.methodId}
                          ref={method.methodId === (selectedMethod?.methodId ?? methods[0]?.methodId) ? paymentMethodTriggerRef : undefined}
                          type="button"
                          className={`payment-method-option ${isSelected ? "is-selected" : ""}`}
                          aria-pressed={isSelected}
                          onClick={() => {
                            setMethodId(method.methodId);
                            setPaymentFee(undefined);
                            setNonCashConfirmed(false);
                            if (method.type === "credit") setDueDate((current) => current || dateAfterDays(7));
                          }}
                        >
                          <strong>{method.name}</strong>
                          <span>{hint}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="payment-empty">Metode pembayaran belum tersedia di snapshot terminal. Segarkan data terminal sebelum melanjutkan.</p>
                )}
                {isCashPayment ? (
                  <label className="field cash-tendered">
                    Uang diterima
                    <input
                      value={cashTendered}
                      onChange={(event) => setCashTendered(event.target.value.replace(/[^\d.]/g, ""))}
                      inputMode="decimal"
                      placeholder={String(Math.round(cartTotal))}
                    />
                    <span className="cash-change-value">Kembalian <strong>{formatIDR(Math.max(0, Number(cashTendered || cartTotal) - cartTotal))}</strong></span>
                    <div className="cash-quick-amounts" aria-label="Nominal cepat uang diterima">
                      <button type="button" onClick={() => setCashTendered(String(Math.ceil(cartTotal)))}>Uang pas</button>
                      {cashQuickAmounts.filter((amount) => amount > Math.ceil(cartTotal)).slice(0, 3).map((amount) => (
                        <button key={amount} type="button" onClick={() => setCashTendered(String(amount))}>{formatIDR(amount)}</button>
                      ))}
                    </div>
                  </label>
                ) : null}
                {selectedMethod && !isCashPayment && selectedMethod.type !== "credit" ? (
                  <label className="field cash-tendered">
                    {selectedMethod.type === "customer_credit" ? "Nomor dokumen retur asal (wajib)" : "Referensi pembayaran (opsional)"}
                    <input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      required={selectedMethod.type === "customer_credit"}
                      placeholder={selectedMethod.type === "customer_credit" ? "Nomor retur" : `No. referensi ${selectedMethod.name}`}
                    />
                  </label>
                ) : null}
                {isQrisMethod(selectedMethod) && qrisImage ? (
                  <div className="qris-payment-panel" role="group" aria-label="Kode QRIS untuk pembayaran">
                    <strong>{selectedMethod?.name ?? "QRIS"}</strong>
                    {/* eslint-disable-next-line @next/next/no-img-element -- QRIS adalah data URL dari pengaturan perusahaan, bukan aset Next. */}
                    <img src={qrisImage} alt="Kode QRIS untuk pembayaran pelanggan" />
                    <small>Tunjukkan kode ini kepada pelanggan, lalu centang konfirmasi penerimaan.</small>
                  </div>
                ) : null}
                {paymentFeeEligible(selectedMethod) ? (
                  <label className="field cash-tendered">
                    Biaya (fee/MDR) {selectedMethod.name}
                    <input
                      value={paymentFee ?? configuredPaymentFee(selectedMethod, cartTotal)}
                      onChange={(event) => setPaymentFee(event.target.value.replace(/[^\d.]/g, ""))}
                      inputMode="decimal"
                      placeholder="0"
                    />
                    <span className="muted">
                      Masuk bersih {formatIDR(Math.max(0, cartTotal - Number(paymentFee ?? configuredPaymentFee(selectedMethod, cartTotal))))}; biaya ditanggung toko dan tidak menambah tagihan pelanggan.
                    </span>
                  </label>
                ) : null}
              </>
            ) : (
              <div className="mixed-fields">
                {mixedPayments.map((entry) => {
                  const method = methods.find((candidate) => candidate.methodId === entry.methodId);
                  const amount = Number(entry.amount) || 0;
                  const availableMethods = methods.filter((candidate) =>
                    candidate.methodId === entry.methodId || !mixedPayments.some((other) => other.key !== entry.key && other.methodId === candidate.methodId),
                  );
                  return (
                    <div className="mixed-payment-row" key={entry.key}>
                      <div className="mixed-payment-heading">
                        <label htmlFor={`mixed-method-${entry.key}`}>Metode</label>
                        <button type="button" onClick={() => setMixedPayments((current) => current.filter((row) => row.key !== entry.key))} aria-label={`Hapus metode ${method?.name ?? "pembayaran"}`}>
                          Hapus
                        </button>
                      </div>
                      <select
                        id={`mixed-method-${entry.key}`}
                        value={entry.methodId}
                        onChange={(event) => {
                          const nextMethod = methods.find((candidate) => candidate.methodId === event.target.value);
                          setMixedPayments((current) => current.map((row) => row.key === entry.key ? { ...row, methodId: event.target.value, fee: undefined, reference: "" } : row));
                          if (nextMethod?.type === "credit") setDueDate((current) => current || dateAfterDays(7));
                        }}
                      >
                        <option value="">Pilih metode</option>
                        {availableMethods.map((candidate) => (
                          <option key={candidate.methodId} value={candidate.methodId}>{candidate.name}</option>
                        ))}
                      </select>
                      <label className="field">
                        Nominal
                        <input
                          value={entry.amount}
                          onChange={(event) => {
                            const amountValue = event.target.value.replace(/[^\d.]/g, "");
                            setMixedPayments((current) => current.map((row) => row.key === entry.key ? { ...row, amount: amountValue } : row));
                          }}
                          inputMode="decimal"
                          placeholder="0"
                        />
                      </label>
                      {isCashMethod(method) ? (
                        <label className="field">
                          Uang diterima
                          <input
                            value={entry.tendered}
                            onChange={(event) => {
                              const tendered = event.target.value.replace(/[^\d.]/g, "");
                              setMixedPayments((current) => current.map((row) => row.key === entry.key ? { ...row, tendered } : row));
                            }}
                            inputMode="decimal"
                            placeholder={String(Math.round(amount))}
                          />
                          <span className="muted">Kembalian: {formatIDR(Math.max(0, Number(entry.tendered || amount) - amount))}</span>
                          <div className="cash-quick-amounts" aria-label={`Nominal cepat uang diterima untuk ${method?.name ?? "tunai"}`}>
                            <button type="button" onClick={() => setMixedPayments((current) => current.map((row) => row.key === entry.key ? { ...row, tendered: String(Math.ceil(amount)) } : row))}>Uang pas</button>
                            {cashTenderSuggestions(amount).filter((value) => value > Math.ceil(amount)).slice(0, 2).map((value) => (
                              <button key={value} type="button" onClick={() => setMixedPayments((current) => current.map((row) => row.key === entry.key ? { ...row, tendered: String(value) } : row))}>{formatIDR(value)}</button>
                            ))}
                          </div>
                        </label>
                      ) : method && method.type !== "credit" ? (
                        <label className="field">
                          {method.type === "customer_credit" ? "Nomor dokumen retur (wajib)" : "Referensi (opsional)"}
                          <input
                            value={entry.reference}
                            onChange={(event) => setMixedPayments((current) => current.map((row) => row.key === entry.key ? { ...row, reference: event.target.value } : row))}
                            required={method.type === "customer_credit"}
                            placeholder={method.type === "customer_credit" ? "Nomor retur asal" : `No. referensi ${method.name}`}
                          />
                        </label>
                      ) : null}
                      {paymentFeeEligible(method) ? (
                        <label className="field">
                          Biaya (fee/MDR) {method.name}
                          <input
                            value={entry.fee ?? configuredPaymentFee(method, amount)}
                            onChange={(event) => {
                              const fee = event.target.value.replace(/[^\d.]/g, "");
                              setMixedPayments((current) => current.map((row) => row.key === entry.key ? { ...row, fee } : row));
                            }}
                            inputMode="decimal"
                            placeholder="0"
                          />
                          <span className="muted">
                            Masuk bersih {formatIDR(Math.max(0, amount - Number(entry.fee ?? configuredPaymentFee(method, amount))))}; biaya ditanggung toko.
                          </span>
                        </label>
                      ) : null}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="add-payment-method"
                  disabled={methods.every((method) => mixedPayments.some((entry) => entry.methodId === method.methodId))}
                  onClick={() => {
                    const used = new Set(mixedPayments.map((entry) => entry.methodId));
                    const nextMethod = methods.find((method) => !used.has(method.methodId));
                    if (!nextMethod) return;
                    setMixedPayments((current) => [...current, {
                      key: crypto.randomUUID(),
                      methodId: nextMethod.methodId,
                      amount: "",
                      tendered: "",
                      reference: "",
                    }]);
                  }}
                >
                  + Tambah metode pembayaran
                </button>
                <div className={`split-remaining ${Math.abs(mixedRemainder) > 0.01 ? "has-remainder" : "is-balanced"}`}>
                  <span>Terbagi {formatIDR(mixedAllocated)} dari {formatIDR(cartTotal)}</span>
                  <strong>{mixedRemainder >= 0 ? `Sisa ${formatIDR(mixedRemainder)}` : `Lebih ${formatIDR(Math.abs(mixedRemainder))}`}</strong>
                  <button
                    type="button"
                    onClick={() => {
                      const target = [...mixedPayments].reverse().find((entry) => entry.methodId);
                      if (!target) return;
                      const otherTotal = mixedPayments.filter((entry) => entry.key !== target.key).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
                      const amount = Math.max(0, cartTotal - otherTotal);
                      setMixedPayments((current) => current.map((entry) => entry.key === target.key ? { ...entry, amount: String(amount) } : entry));
                    }}
                  >
                    Isi sisa
                  </button>
                </div>
              </div>
            )}
            <button
              className="split-toggle customer-toggle"
              type="button"
              onClick={() => setCustomerFieldOpen((open) => !open)}
              aria-expanded={customerFieldOpen || requiresCustomer}
            >
              {selectedCustomer ? `Pelanggan: ${selectedCustomer.name}` : requiresCustomer ? "Pilih pelanggan untuk pembayaran kredit" : "Tambah pelanggan (opsional)"}
            </button>
            {customerFieldOpen || requiresCustomer || selectedCustomerId ? (
              <div className="customer-fields">
                <label className="field">
                  Pelanggan {requiresCustomer ? "(wajib)" : "(opsional)"}
                  <input
                    ref={customerSearchRef}
                    value={customerQuery}
                    onChange={(event) => {
                      setCustomerQuery(event.target.value);
                      setSelectedCustomerId("");
                      setActiveHeldGroupId(null);
                    }}
                    placeholder={customers.length ? "Cari nama pelanggan" : "Segarkan snapshot pelanggan"}
                    autoComplete="off"
                  />
                </label>
                {customerMatches.length > 0 ? (
                  <div className="customer-matches" role="listbox" aria-label="Hasil pencarian pelanggan">
                    {customerMatches.map((customer) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedCustomerId === customer.id}
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setCustomerQuery(customer.name);
                          setActiveHeldGroupId(customer.groupId ?? null);
                        }}
                      >
                        {customer.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                {selectedCustomer ? (
                  <div className="selected-customer">
                    <span>{selectedCustomer.name}</span>
                    {loyaltyBalances.has(selectedCustomer.id) ? (
                      <small className="loyalty-points">{loyaltyBalances.get(selectedCustomer.id)} poin</small>
                    ) : null}
                    <button type="button" onClick={() => { setSelectedCustomerId(""); setCustomerQuery(""); setActiveHeldGroupId(null); }}>Ganti</button>
                  </div>
                ) : null}
                {selectedCustomerGroup ? (
                  <div className="muted" role="status">Harga kelompok: {selectedCustomerGroup.name}</div>
                ) : null}
                {usesReceivable ? (
                  <label className="field">
                    Jatuh tempo
                    <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                  </label>
                ) : null}
              </div>
            ) : null}
            {splitPayment ? (
              <button
                className="split-toggle"
                type="button"
                onClick={() => {
                  const firstMethodId = mixedPayments.find((entry) => entry.methodId)?.methodId;
                  if (firstMethodId) setMethodId(firstMethodId);
                  setMixedPayments([]);
                  setSplitPayment(false);
                }}
                aria-expanded="true"
              >
                Kembali ke satu metode
              </button>
            ) : null}
            {cartReservationOptions.length ? (
              <label className="field">
                Reservasi stok yang dipenuhi
                <select value={selectedReservationId} onChange={(event) => setSelectedReservationId(event.target.value)} disabled={busy}>
                  <option value="">Tidak memakai reservasi</option>
                  {cartReservationOptions.map((reservation) => (
                    <option key={reservation.id} value={reservation.id}>
                      {reservation.number} · {reservation.qty} {reservation.reason ? `· ${reservation.reason}` : ""}
                    </option>
                  ))}
                </select>
                <small className="muted">Stok yang dijanjikan pada reservasi ini tidak memblokir penjualan.</small>
              </label>
            ) : null}
            {needsReceiptConfirmation ? (
              <label className="non-cash-confirm">
                <input
                  type="checkbox"
                  checked={nonCashConfirmed}
                  onChange={(event) => setNonCashConfirmed(event.currentTarget.checked)}
                />
                <span>Saya sudah menerima pembayaran non-tunai ini</span>
              </label>
            ) : null}
          </div>

          <div className="checkout-total">
            {activeHeldTotal !== null && Math.abs(cartTotal - activeHeldTotal) > 0.01 ? (
              <p className="held-total-warning" role="status" aria-live="polite">
                Total pesanan berubah dari {formatIDR(activeHeldTotal)} menjadi {formatIDR(cartTotal)}. Periksa harga dan diskon sebelum checkout.
              </p>
            ) : null}
            <div className="total-breakdown">
              {localQuote && localQuote.discountTotal > 0 ? <span>Diskon <strong>−{formatIDR(localQuote.discountTotal)}</strong></span> : null}
              {localQuote && localQuote.taxTotal > 0 ? <span>Termasuk PPN <strong>{formatIDR(localQuote.taxTotal)}</strong></span> : null}
              {localQuote && localQuote.roundingAdjustment !== 0 ? <span>Pembulatan <strong>{formatIDR(localQuote.roundingAdjustment)}</strong></span> : null}
              <span>Total</span>
            </div>
            <span className="total">{formatIDR(cartTotal)}</span>
          </div>
          <button
            className="primary checkout-submit"
            onClick={() => checkoutOpen ? void handleRecordSale() : handleBeginCheckout()}
            disabled={submitDisabled}
            title={info?.posOfflineEnabled === true ? undefined : "Mode offline POS harus aktif agar transaksi desktop dapat disinkronkan."}
          >
            {busy ? "Menyimpan…" : checkoutOpen ? `Konfirmasi pembayaran · ${formatIDR(cartTotal)}` : `Lanjut pembayaran · ${formatIDR(cartTotal)}`}
          </button>
          <p className="checkout-note">
            {checkoutOpen
              ? "Transaksi disimpan di perangkat terlebih dahulu. Status server akan diperbarui setelah sinkronisasi."
              : info?.posOfflineEnabled !== true
                ? "Mode offline POS harus aktif di server sebelum POS Desktop dapat menerima transaksi."
                : session
                ? "Periksa jumlah barang. Pembayaran dimulai pada langkah berikutnya."
                : "Sesi kas belum dibuka. Buka shift untuk mulai menerima pembayaran."}
          </p>
          {device?.authFailed ? (
            <p className="history-error" role="alert">Akses terminal ditolak server. Sambungkan ulang atau daftarkan terminal sebelum membuat transaksi baru.</p>
          ) : null}
        </aside>
      </div>
      {clearOrderOpen ? (
        <div className="clear-order-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissClearOrder(); }}>
          <section className="clear-order-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-order-title" aria-describedby="clear-order-description" onKeyDown={trapDialogTab}>
            <span className="clear-order-mark" aria-hidden="true">×</span>
            <h2 id="clear-order-title">Kosongkan pesanan ini?</h2>
            <p id="clear-order-description">{cart.length} baris akan dihapus dari keranjang aktif. Pesanan yang sudah disimpan di menu Ditahan tetap aman dan bisa dipanggil kembali.</p>
            <div className="clear-order-actions">
              <button type="button" autoFocus onClick={dismissClearOrder} disabled={busy}>Kembali ke keranjang</button>
              <button className="danger-action" type="button" onClick={clearActiveOrder} disabled={busy}>Kosongkan pesanan</button>
            </div>
          </section>
        </div>
      ) : null}
      {cashierMenuOpen ? (
        <div
          className="cashier-menu-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCashierMenu();
          }}
        >
          <section className="cashier-menu" role="dialog" aria-modal="true" aria-labelledby="cashier-menu-title" onKeyDown={trapDialogTab}>
            <header className="cashier-menu-header">
              <div>
                <p className="eyebrow">BISA POS · TERMINAL KASIR</p>
                <h2 id="cashier-menu-title">Menu kasir</h2>
                <p>Akses shift, transaksi, dan perangkat kasir.</p>
              </div>
              <button className="menu-close" type="button" autoFocus onClick={closeCashierMenu} aria-label="Tutup menu">×</button>
            </header>

            <div className="cashier-menu-content">
              <section className="cashier-menu-group" aria-labelledby="menu-operations-title">
                <h3 id="menu-operations-title">OPERASIONAL</h3>
                <button className="cashier-menu-item" type="button" onClick={() => openSessionTool("current")}>
                  <span className="cashier-menu-icon"><Banknote aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Sesi kas</strong><small>Buka shift, hitung kas, dan tutup sesi</small></span>
                  <span className={`menu-state ${session ? "is-ready" : "is-waiting"}`}>{session ? "Terbuka" : "Belum dibuka"}</span>
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => openSessionTool("history")}>
                  <span className="cashier-menu-icon"><History aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Riwayat kasir</strong><small>Shift, hitungan kas, dan status sinkronisasi</small></span>
                  <span className="menu-count">{sessionCount}</span>
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => { setCashierMenuOpen(false); setActiveTool("report"); }}>
                  <span className="cashier-menu-icon"><Banknote aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Laporan harian</strong><small>Omzet, transaksi, dan penerimaan per metode</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => { setCashierMenuOpen(false); setActiveTool("kitchen"); }}>
                  <span className="cashier-menu-icon"><Printer aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Layar dapur</strong><small>Antrian pesanan dan usia tiket</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
                <button className="cashier-menu-item" type="button" onClick={openCustomerPicker}>
                  <span className="cashier-menu-icon"><UserRound aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Pelanggan transaksi</strong><small>{selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomerGroup?.name ?? "harga normal"}` : "Pilih pelanggan dan harga kelompok"}</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => { setCashierMenuOpen(false); handleOpenHistory(); }}>
                  <span className="cashier-menu-icon"><History aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Riwayat transaksi</strong><small>Cari nota, cetak ulang, retur, atau void</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => {
                  setCashierMenuOpen(false);
                  setMobileCheckoutOpen(false);
                  setHeldPanelOpen(true);
                  if (device?.tokenConfigured) void loadServerHeldSales();
                }}>
                  <span className="cashier-menu-icon"><Cloud aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Pesanan ditahan</strong><small>Lanjutkan pesanan dari terminal ini atau terminal lain</small></span>
                  <span className="menu-count">{visibleLocalHeldSales.length + (serverHeldVerified ? serverHeldSales.total : 0)}</span>
                </button>
              </section>

              <section className="cashier-menu-group" aria-labelledby="menu-device-title">
                <h3 id="menu-device-title">PERANGKAT DAN KONEKSI</h3>
                <button className="cashier-menu-item" type="button" onClick={() => openTool("sync")}>
                  <span className="cashier-menu-icon"><RefreshCw aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Peninjauan offline</strong><small>Periksa transaksi yang menunggu sinkronisasi</small></span>
                  <span className={`menu-count ${outbox.total ? "has-items" : ""}`}>{outbox.total}</span>
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => openTool("printer")}>
                  <span className="cashier-menu-icon"><Printer aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Printer dan laci kas</strong><small>Atur koneksi, tes, dan antrean cetak</small></span>
                  <span className={`menu-state ${printer?.configured ? "is-ready" : "is-waiting"}`}>{printer?.configured ? "Siap" : "Atur"}</span>
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => openTool("display")}>
                  <span className="cashier-menu-icon"><Monitor aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Layar pelanggan</strong><small>{displayOpen ? "Layar kedua sedang aktif" : "Tampilkan ringkasan belanja pelanggan"}</small></span>
                  <span className={`menu-state ${displayOpen ? "is-ready" : ""}`}>{displayOpen ? "Aktif" : "Nonaktif"}</span>
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => openTool("terminal")}>
                  <span className="cashier-menu-icon"><Wifi aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Terminal dan data</strong><small>{device?.terminalName ?? "Identitas terminal, gudang, dan snapshot"}</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => openTool("updates")}>
                  <span className="cashier-menu-icon"><Settings2 aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Pembaruan aplikasi</strong><small>{update?.availableVersion ? `Versi ${update.availableVersion} tersedia` : `Versi berjalan ${update?.currentVersion ?? "—"}`}</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </section>

              <section className="cashier-menu-group" aria-labelledby="menu-preferences-title">
                <h3 id="menu-preferences-title">PREFERENSI</h3>
                <button className="cashier-menu-item" type="button" onClick={() => { setCashierMenuOpen(false); setMobileCheckoutOpen(false); setDisplaySettingsOpen(true); }}>
                  <span className="cashier-menu-icon"><Settings2 aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Tampilan kasir</strong><small>Atur ukuran kartu, kolom, dan informasi katalog</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
                <button className="cashier-menu-item" type="button" onClick={toggleTheme} aria-pressed={darkTheme}>
                  <span className="cashier-menu-icon"><Monitor aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Mode gelap</strong><small>{darkTheme ? "Aktif — klik untuk kembali ke mode terang" : "Nonaktif — klik untuk mengaktifkan"}</small></span>
                  <span className={`menu-state ${darkTheme ? "is-ready" : "is-waiting"}`}>{darkTheme ? "Aktif" : "Nonaktif"}</span>
                </button>
                <button className="cashier-menu-item" type="button" onClick={() => { setCashierMenuOpen(false); setMobileCheckoutOpen(false); setHelpOpen(true); }}>
                  <span className="cashier-menu-icon"><CircleHelp aria-hidden="true" /></span>
                  <span className="cashier-menu-copy"><strong>Bantuan dan pintasan</strong><small>Lihat alur kasir dan tombol cepat</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </section>
            </div>

            <footer className="cashier-menu-footer">
              <span><UserRound aria-hidden="true" />{device?.cashierName ?? "Kasir"}</span>
              <button type="button" onClick={() => { setCashierMenuOpen(false); handleCashierLogout(); }}>
                <LogOut aria-hidden="true" />
                Keluar dari kasir
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {helpOpen ? (
        <div className="cashier-help-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeHelp(); }}>
          <section className="cashier-help" role="dialog" aria-modal="true" aria-labelledby="cashier-help-title" onKeyDown={trapDialogTab}>
            <header className="cashier-help-header">
              <div className="cashier-menu-icon"><CircleHelp aria-hidden="true" /></div>
              <div>
                <p className="eyebrow">PANDUAN SINGKAT</p>
                <h2 id="cashier-help-title">Cara melayani transaksi</h2>
                <p>Alur dasar kasir tetap berada di satu layar.</p>
              </div>
              <button className="menu-close" type="button" autoFocus onClick={closeHelp} aria-label="Tutup bantuan">×</button>
            </header>
            <ol className="cashier-help-steps">
              <li><span>1</span><div><strong>Cari atau pindai produk</strong><small>Pilih kategori, ketik nama/SKU, atau pindai barcode lalu tekan Enter.</small></div></li>
              <li><span>2</span><div><strong>Periksa keranjang</strong><small>Ubah jumlah, satuan, atau diskon pada baris produk sebelum pembayaran.</small></div></li>
              <li><span>3</span><div><strong>Pilih pembayaran dan bayar</strong><small>Non-tunai wajib dicentang &quot;sudah diterima&quot; sebelum tombol Bayar aktif. Pembayaran campuran dan jatuh tempo tersedia di panel checkout.</small></div></li>
              <li><span>4</span><div><strong>Cetak atau lanjutkan</strong><small>Setelah berhasil, cetak salinan nota atau mulai transaksi berikutnya.</small></div></li>
            </ol>
            <div className="cashier-help-shortcuts">
              <h3>PINTASAN</h3>
              <div><kbd>F1</kbd><span>Bantuan kasir</span></div>
              <div><kbd>F2</kbd><span>Fokus ke pencarian dan barcode</span></div>
              <div><kbd>Enter</kbd><span>Tambahkan barcode yang dipindai</span></div>
              <div><kbd>Esc</kbd><span>Tutup menu atau panel aktif</span></div>
              <div><kbd>Ctrl+K</kbd><span>Buka aksi cepat: sesi, laporan, sinkron, printer</span></div>
            </div>
            <footer className="cashier-help-footer">
              <span>Penjualan offline tersimpan di perangkat dan menunggu sinkronisasi.</span>
              <button className="primary" type="button" onClick={closeHelp}>Mengerti</button>
            </footer>
          </section>
        </div>
      ) : null}
      {mobileCheckoutOpen ? (
        <button
          className="mobile-cart-backdrop"
          type="button"
          aria-label="Tutup rincian keranjang"
          onClick={() => setMobileCheckoutOpen(false)}
        />
      ) : null}
      {displaySettingsOpen ? (
        <div
          className="display-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDisplaySettingsOpen(false);
          }}
        >
          <section className="display-dialog" role="dialog" aria-modal="true" aria-labelledby="display-dialog-title" onKeyDown={trapDialogTab}>
            <header className="display-dialog-header">
              <div>
                <p className="eyebrow">PREFERENSI PERANGKAT</p>
                <h2 id="display-dialog-title">Tampilan kasir</h2>
                <p className="muted">Atur katalog agar nyaman dibaca di layar dan jarak kerja ini.</p>
              </div>
              <button type="button" className="held-close" onClick={() => setDisplaySettingsOpen(false)} aria-label="Tutup pengaturan tampilan">×</button>
            </header>

            <div className="display-dialog-content">
              <section className="display-setting-group" aria-labelledby="display-presets-title">
                <h3 id="display-presets-title">Preset</h3>
                <div className="display-presets">
                  <button
                    type="button"
                    aria-pressed={displayPrefs.view === "grid" && displayPrefs.fontScale === "large" && displayPrefs.density === "comfortable"}
                    onClick={() => updateDisplayPrefs({ view: "grid", density: "comfortable", columns: "auto", fontScale: "large" })}
                  >
                    <strong>Seimbang</strong><span>Katalog umum</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={displayPrefs.view === "grid" && displayPrefs.fontScale === "xl" && displayPrefs.columns === "4"}
                    onClick={() => updateDisplayPrefs({ view: "grid", density: "comfortable", columns: "4", fontScale: "xl" })}
                  >
                    <strong>Sentuh besar</strong><span>Teks dan kartu besar</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={displayPrefs.view === "list"}
                    onClick={() => updateDisplayPrefs({ view: "list", density: "comfortable", fontScale: "large" })}
                  >
                    <strong>Daftar</strong><span>Nama panjang</span>
                  </button>
                </div>
              </section>

              <div className="display-setting-columns">
                <label className="field">
                  Susunan produk
                  <select value={displayPrefs.view} onChange={(event) => setDisplayPreference("view", event.target.value as PosDisplayPrefs["view"])}>
                    <option value="grid">Kotak</option><option value="list">Daftar</option>
                  </select>
                </label>
                <label className="field">
                  Jumlah kolom
                  <select value={displayPrefs.columns} onChange={(event) => setDisplayPreference("columns", event.target.value as PosDisplayPrefs["columns"])}>
                    <option value="auto">Otomatis</option><option value="4">4 kolom</option><option value="5">5 kolom</option><option value="6">6 kolom</option>
                  </select>
                </label>
                <label className="field">
                  Kerapatan
                  <select value={displayPrefs.density} onChange={(event) => setDisplayPreference("density", event.target.value as PosDisplayPrefs["density"])}>
                    <option value="comfortable">Nyaman</option><option value="compact">Padat</option>
                  </select>
                </label>
                <label className="field">
                  Ukuran teks
                  <select value={displayPrefs.fontScale} onChange={(event) => setDisplayPreference("fontScale", event.target.value as PosDisplayPrefs["fontScale"])}>
                    <option value="normal">Standar</option><option value="large">Besar</option><option value="xl">Sangat besar</option>
                  </select>
                </label>
                <label className="field">
                  Bentuk kartu
                  <select value={displayPrefs.cardShape} onChange={(event) => setDisplayPreference("cardShape", event.target.value as PosDisplayPrefs["cardShape"])}>
                    <option value="rounded">Sudut lembut</option><option value="square">Kotak</option>
                  </select>
                </label>
                <label className="field">
                  Lebar keranjang
                  <select value={displayPrefs.cartWidth} onChange={(event) => setDisplayPreference("cartWidth", Number(event.target.value))}>
                    {POS_CART_WIDTHS.map((width) => <option key={width} value={width}>{width} px</option>)}
                  </select>
                </label>
              </div>

              <section className="display-setting-group" aria-labelledby="display-details-title">
                <h3 id="display-details-title">Informasi katalog</h3>
                {([
                  ["showPrice", "Harga jual"],
                  ["showStock", "Informasi stok"],
                  ["showSku", "SKU produk"],
                  ["showPackaging", "Pilihan kemasan"],
                  ["showCategory", "Nama kategori"],
                  ["colorByCategory", "Aksen warna kategori"],
                ] as const).map(([key, label]) => (
                  <label className="display-toggle-row" key={key}>
                    <span>{label}</span>
                    <input type="checkbox" checked={displayPrefs[key]} onChange={(event) => setDisplayPreference(key, event.target.checked)} />
                  </label>
                ))}
                <label className="display-toggle-row">
                  <span>Masuk layar penuh otomatis</span>
                  <input type="checkbox" checked={displayPrefs.autoFullscreen} onChange={(event) => setDisplayPreference("autoFullscreen", event.target.checked)} />
                </label>
              </section>

              <div className="display-dialog-actions">
                <button type="button" onClick={resetDisplayPrefs}>Kembalikan bawaan</button>
                <button className="primary" type="button" onClick={() => setDisplaySettingsOpen(false)}>Selesai</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {historyOpen ? (
        <div className="held-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}>
          <section className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title" onKeyDown={trapDialogTab}>
            <header className="display-dialog-header">
              <div>
                <p className="eyebrow">RIWAYAT POS</p>
                <h2 id="history-dialog-title">Riwayat transaksi</h2>
                <p className="muted">Buka transaksi lokal saat offline, atau cari transaksi server untuk melihat detail dan memproses retur atau void.</p>
              </div>
              <button type="button" className="held-close" onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat">×</button>
            </header>
            <div className="history-content">
              <div className="history-source-tabs" role="tablist" aria-label="Sumber riwayat transaksi">
                <button
                  type="button"
                  role="tab"
                  aria-selected={historySource === "local"}
                  className={historySource === "local" ? "active" : ""}
                  onClick={() => {
                    setHistorySource("local");
                    setServerSaleDetail(null);
                    setHistoryError("");
                    void loadLocalSalesHistory(1, historyQuery);
                  }}
                >
                  Terminal ini
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={historySource === "server"}
                  className={historySource === "server" ? "active" : ""}
                  onClick={() => {
                    setHistorySource("server");
                    setServerSaleDetail(null);
                    setHistoryError("");
                    void loadServerSalesHistory(1, historyQuery, historyStatus);
                  }}
                >
                  Semua transaksi
                </button>
              </div>
              <div className="history-search">
                <label htmlFor="local-history-search">
                  {historySource === "local" ? "Cari tanggal atau ID transaksi di terminal ini" : "Cari nomor nota atau nama pelanggan"}
                </label>
                <div>
                  <input
                    id="local-history-search"
                    type="search"
                    value={historyQuery}
                    placeholder={historySource === "local" ? "YYYY-MM-DD atau ID transaksi" : "Nomor nota atau nama pelanggan"}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      if (historySource === "local") void loadLocalSalesHistory(1, historyQuery);
                      else void loadServerSalesHistory(1, historyQuery, historyStatus);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => historySource === "local"
                      ? void loadLocalSalesHistory(1, historyQuery)
                      : void loadServerSalesHistory(1, historyQuery, historyStatus)}
                    disabled={historySource === "local" ? historyLoading : serverHistoryLoading}
                  >
                    {historySource === "local" ? (historyLoading ? "Memuat…" : "Terapkan") : (serverHistoryLoading ? "Memuat…" : "Terapkan")}
                  </button>
                </div>
              </div>
              <div className="history-date-range" aria-label="Filter rentang tanggal">
                <label htmlFor="history-date-from">Dari tanggal
                  <input id="history-date-from" type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} />
                </label>
                <label htmlFor="history-date-to">Sampai tanggal
                  <input id="history-date-to" type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryFrom("");
                    setHistoryTo("");
                    setHistoryError("");
                    if (historySource === "local") void loadLocalSalesHistory(1, historyQuery, "", "");
                    else void loadServerSalesHistory(1, historyQuery, historyStatus, "", "");
                  }}
                  disabled={!historyFrom && !historyTo}
                >
                  Hapus tanggal
                </button>
              </div>
              {historySource === "server" ? (
                <label className="history-status-filter">
                  Status transaksi
                  <select
                    value={historyStatus}
                    onChange={(event) => {
                      const nextStatus = event.target.value as typeof historyStatus;
                      setHistoryStatus(nextStatus);
                      setServerSaleDetail(null);
                      void loadServerSalesHistory(1, historyQuery, nextStatus);
                    }}
                  >
                    <option value="">Semua status</option>
                    <option value="completed">Selesai</option>
                    <option value="returned">Diretur penuh</option>
                    <option value="void">Dibatalkan</option>
                    <option value="held">Ditahan</option>
                  </select>
                </label>
              ) : null}
              {historyError ? <p className="history-error" role="alert">{historyError}</p> : null}
              {historySource === "local" ? (
                <>
                  {historyLoading ? <LoadingSkeleton label="Memuat riwayat lokal…" /> : null}
                  {!historyLoading && localSalesHistory.items.length === 0 ? (
                    <p className="held-empty">Belum ada transaksi lokal yang cocok.</p>
                  ) : null}
                  {localSalesHistory.items.length > 0 ? (
                    <ul className="history-list">
                      {localSalesHistory.items.map((item) => (
                        <li className="history-row" key={item.clientKey}>
                          <div className="history-main">
                            <div className="history-title-row">
                              <strong>{item.saleDate}</strong>
                              <span className={`tag ${item.status}`}>
                                {item.status === "synced" ? "Tersinkron" : item.status === "held" ? "Perlu ditinjau" : item.status === "pending" || item.status === "inflight" ? "Menunggu sinkron" : "Status tidak diketahui"}
                              </span>
                            </div>
                            <span className="mono">{item.clientKey}</span>
                            <span>{item.lineCount} baris{item.lastMessage ? ` · ${item.lastMessage}` : ""}</span>
                          </div>
                          <div className="history-total">
                            <strong>{formatIDR(Number(item.expectedTotal))}</strong>
                            <button type="button" onClick={() => void handleHistoryReprint(item.clientKey)} disabled={busy || !printer?.configured} title={printer?.configured ? "Cetak salinan nota" : "Atur printer dahulu"}>
                              Cetak ulang
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="history-footer">
                    <span>{localSalesHistory.total} transaksi di terminal ini{historyLoading ? " · Memuat…" : ""}</span>
                    <div>
                      <button type="button" onClick={() => void loadLocalSalesHistory(localSalesHistory.page - 1, historyQuery)} disabled={historyLoading || localSalesHistory.page <= 1}>Sebelumnya</button>
                      <span>Halaman {localSalesHistory.page} dari {Math.max(1, localSalesHistory.pageCount)}</span>
                      <button type="button" onClick={() => void loadLocalSalesHistory(localSalesHistory.page + 1, historyQuery)} disabled={historyLoading || localSalesHistory.page >= localSalesHistory.pageCount}>Berikutnya</button>
                    </div>
                  </div>
                  <p className="history-note">Riwayat lokal tetap tersedia saat jaringan terputus. Transaksi yang menunggu sinkron belum menjadi penjualan resmi server.</p>
                </>
              ) : serverSaleDetail ? (
                <ServerSaleHistoryDetail
                  response={serverSaleDetail}
                  loading={serverDetailLoading}
                  busy={busy}
                  returnQtyByLine={returnQtyByLine}
                  setReturnQtyByLine={setReturnQtyByLine}
                  returnReason={returnReason}
                  setReturnReason={setReturnReason}
                  returnMethod={returnMethod}
                  setReturnMethod={setReturnMethod}
                  returnDisposition={returnDisposition}
                  setReturnDisposition={setReturnDisposition}
                  voidReason={voidReason}
                  setVoidReason={setVoidReason}
                  voidArmed={voidArmed}
                  setVoidArmed={setVoidArmed}
                  onBack={() => { setServerSaleDetail(null); setVoidArmed(false); }}
                  onRefresh={() => void handleOpenServerSale(serverSaleDetail.detail.sale.id, true)}
                  onReprint={() => void handleServerHistoryReprint(serverSaleDetail.detail.sale.id)}
                  onReturn={() => void handleSubmitServerReturn(serverSaleDetail.detail)}
                  onVoid={() => void handleSubmitServerVoid(serverSaleDetail.detail.sale.id)}
                />
              ) : (
                <>
                  {serverHistoryLoading ? <p className="held-empty" role="status">Memuat semua transaksi dari server…</p> : null}
                  {serverDetailLoading ? <LoadingSkeleton label="Memuat detail nota dari server…" /> : null}
                  {!serverHistoryLoading && !historyError && serverSalesHistory.rows.length === 0 ? (
                    <p className="held-empty">Tidak ada transaksi server yang cocok.</p>
                  ) : null}
                  {serverSalesHistory.rows.length > 0 ? (
                    <ul className="history-list server-history-list">
                      {serverSalesHistory.rows.map((sale) => (
                        <li className="history-row server-history-row" key={sale.id}>
                          <div className="history-main">
                            <div className="history-title-row">
                              <strong>{sale.number}</strong>
                              <span className={`server-status server-status-${sale.status}`}>{sale.status === "completed" ? "Selesai" : sale.status === "returned" ? "Diretur penuh" : sale.status === "void" ? "Dibatalkan" : "Ditahan"}</span>
                            </div>
                            <span>{sale.customerName ?? "Pelanggan umum"} · {sale.cashierName ?? "Kasir"}</span>
                            <span>{new Date(sale.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} · {sale.itemCount} item</span>
                          </div>
                          <div className="history-total server-history-total">
                            <strong>{formatIDR(Number(sale.total))}</strong>
                            <button type="button" className="history-detail-button" onClick={() => void handleOpenServerSale(sale.id)} disabled={serverDetailLoading}>
                              Lihat detail
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="history-footer">
                    <span>{serverSalesHistory.total} transaksi di server{serverHistoryLoading ? " · Memuat…" : ""}</span>
                    <div>
                      <button type="button" onClick={() => void loadServerSalesHistory(serverSalesHistory.page - 1, historyQuery, historyStatus)} disabled={serverHistoryLoading || serverSalesHistory.page <= 1}>Sebelumnya</button>
                      <span>Halaman {serverSalesHistory.page} dari {Math.max(1, Math.ceil(serverSalesHistory.total / serverSalesHistory.pageSize))}</span>
                      <button type="button" onClick={() => void loadServerSalesHistory(serverSalesHistory.page + 1, historyQuery, historyStatus)} disabled={serverHistoryLoading || serverSalesHistory.page >= Math.ceil(serverSalesHistory.total / serverSalesHistory.pageSize)}>Berikutnya</button>
                    </div>
                  </div>
                  <p className="history-note">Riwayat server mencakup transaksi dari semua terminal dalam perusahaan ini. Retur dan void memerlukan koneksi server serta izin POS yang sesuai.</p>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {heldPanelOpen ? (
        <div className="held-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setHeldPanelOpen(false); }}>
          <section className="held-dialog" role="dialog" aria-modal="true" aria-labelledby="held-dialog-title" onKeyDown={trapDialogTab}>
            <header className="held-dialog-header">
              <div>
                <h2 id="held-dialog-title">Pesanan ditahan</h2>
                <p className="muted">Hold server dibagi lintas terminal. Pesanan yang sudah tersimpan di perangkat ini tetap bisa dipanggil tanpa jaringan.</p>
              </div>
              <div className="held-header-actions">
                <button type="button" onClick={() => void loadServerHeldSales()} disabled={serverHeldLoading || !device?.tokenConfigured}>
                  {serverHeldLoading ? "Memuat…" : "Segarkan"}
                </button>
                <button type="button" className="held-close" onClick={() => setHeldPanelOpen(false)} aria-label="Tutup daftar pesanan">×</button>
              </div>
            </header>
            {serverHeldError ? <p className="held-warning">Server belum bisa dijangkau. Hold yang sudah tersimpan di perangkat tetap tersedia.</p> : null}
            <h3 className="held-section-title">Bersama terminal lain <span>{serverHeldVerified ? serverHeldSales.total : 0}</span></h3>
            {!serverHeldVerified || serverHeldSales.rows.length === 0 ? (
              <p className="held-empty">
                {serverHeldLoading
                  ? "Memuat pesanan server…"
                  : serverHeldError
                    ? "Daftar server belum terverifikasi. Segarkan setelah koneksi kembali."
                    : !device?.tokenConfigured
                      ? "Hubungkan terminal untuk melihat pesanan dari kasir lain."
                      : serverHeldVerified
                        ? "Tidak ada pesanan server yang ditahan."
                        : "Hubungkan ke server untuk memuat pesanan ditahan."}
              </p>
            ) : (
              <ul className="held-list">
                {serverHeldSales.rows.map((held) => {
                  const canDelete = serverHeldSales.canDeleteHeld || held.cashierId === device?.cashierId;
                  const active = held.id === activeHeldServerSaleId;
                  return (
                    <li key={`server-${held.id}`} className="held-row">
                      <div className="held-details">
                        <strong>{held.heldLabel || held.number}</strong>
                        <span>{held.itemCount} item · {held.customerName || "Pelanggan umum"} · {formatIDR(Number(held.total))} · {new Date(held.createdAt).toLocaleString("id-ID")}{active ? " · sedang dibuka" : ""}</span>
                      </div>
                      {serverHeldDeleteCandidateId === held.id ? (
                        <div className="held-confirm-delete">
                          <span>Hapus untuk semua terminal?</span>
                          <button type="button" onClick={() => void handleDeleteServerHeldSale(held)} disabled={busy}>Hapus</button>
                          <button type="button" onClick={() => setServerHeldDeleteCandidateId(null)} disabled={busy}>Batal</button>
                        </div>
                      ) : (
                        <div className="held-row-actions">
                          <button className="primary" type="button" onClick={() => void handleResumeServerHeldSale(held)} disabled={busy || active}>
                            Panggil
                          </button>
                          {canDelete ? <button type="button" onClick={() => setServerHeldDeleteCandidateId(held.id)} disabled={busy || active}>Hapus</button> : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {serverHeldVerified && serverHeldSales.total > serverHeldSales.pageSize ? (
              <nav className="held-pagination" aria-label="Halaman pesanan ditahan dari server">
                <button
                  type="button"
                  onClick={() => void loadServerHeldSales(serverHeldSales.page - 1)}
                  disabled={serverHeldLoading || busy || serverHeldSales.page <= 1}
                >
                  Sebelumnya
                </button>
                <span>Halaman {serverHeldSales.page} dari {Math.max(1, Math.ceil(serverHeldSales.total / serverHeldSales.pageSize))}</span>
                <button
                  type="button"
                  onClick={() => void loadServerHeldSales(serverHeldSales.page + 1)}
                  disabled={serverHeldLoading || busy || serverHeldSales.page >= Math.ceil(serverHeldSales.total / serverHeldSales.pageSize)}
                >
                  Berikutnya
                </button>
              </nav>
            ) : null}
            <h3 className="held-section-title">Tersimpan di perangkat <span>{visibleLocalHeldSales.length}</span></h3>
            {visibleLocalHeldSales.length === 0 ? (
              <p className="held-empty">Tidak ada pesanan lokal.</p>
            ) : (
              <ul className="held-list">
                {visibleLocalHeldSales.map((held) => {
                  const lineCount = Array.isArray(held.payload.cart) ? held.payload.cart.length : 0;
                  const active = held.id === activeHeldSaleId;
                  const cachedServerId = typeof held.payload.serverHeldSaleId === "string" ? held.payload.serverHeldSaleId : null;
                  const serverHoldUnconfirmed = Boolean(held.payload.pendingServerHold);
                  const canDeleteLocal = !cachedServerId || Boolean(device?.tokenConfigured && serverHeldVerified);
                  return (
                    <li key={`local-${held.id}`} className="held-row">
                      <div className="held-details">
                        <strong>{held.label}</strong>
                        <span>{lineCount} baris · {new Date(held.updatedAt).toLocaleString("id-ID")}{serverHoldUnconfirmed ? " · status server perlu direkonsiliasi" : cachedServerId ? " · salinan offline hold server" : ""}{active ? " · sedang dibuka" : ""}</span>
                      </div>
                      {heldDeleteCandidateId === held.id ? (
                        <div className="held-confirm-delete">
                          <span>Hapus pesanan ini?</span>
                          <button type="button" onClick={() => void handleDeleteHeldSale(held)} disabled={busy}>Hapus</button>
                          <button type="button" onClick={() => setHeldDeleteCandidateId(null)} disabled={busy}>Batal</button>
                        </div>
                      ) : (
                        <div className="held-row-actions">
                          <button className="primary" type="button" onClick={() => void handleResumeHeldSale(held)} disabled={busy || active}>Panggil</button>
                          <button type="button" onClick={() => setHeldDeleteCandidateId(held.id)} disabled={busy || active || !canDeleteLocal} title={!canDeleteLocal ? "Hubungkan server untuk menghapus hold bersama." : undefined}>Hapus</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {cart.length > 0 ? <p className="held-warning">Kosongkan atau tahan keranjang aktif sebelum memanggil pesanan lain.</p> : null}
          </section>
        </div>
      ) : null}
      {resumeCandidate ? (
        <div className="held-overlay">
          <section className="held-dialog resume-confirm" role="dialog" aria-modal="true" aria-labelledby="resume-confirm-title" onKeyDown={trapDialogTab}>
            <h2 id="resume-confirm-title">Simpan keranjang aktif?</h2>
            <p className="muted">
              Keranjang sekarang akan ditahan di perangkat sebelum {resumeCandidate.kind === "local" ? resumeCandidate.sale.label : (resumeCandidate.sale.heldLabel || resumeCandidate.sale.number)} dipanggil. Jika penyimpanan gagal, keranjang sekarang tetap terbuka.
            </p>
            <div className="display-dialog-actions">
              <button type="button" onClick={() => setResumeCandidate(null)} disabled={busy}>Kembali ke keranjang</button>
              <button className="primary" type="button" onClick={() => void handleConfirmResumeCandidate()} disabled={busy || cart.length === 0}>
                {busy ? "Menyimpan…" : "Tahan & panggil"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {saleSuccess ? (
        <div className="receipt-overlay">
          <section
            className="receipt-success"
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-success-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSaleSuccess();
                return;
              }
              if (event.key !== "Tab") return;
              const focusable = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
              const first = focusable.item(0);
              const last = focusable.item(focusable.length - 1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <button className="receipt-close" type="button" aria-label="Tutup" onClick={closeSaleSuccess}>×</button>
            <div className="success-mark" aria-hidden="true">✓</div>
            <p className="eyebrow">TRANSAKSI TERCATAT</p>
            <h2 id="receipt-success-title" ref={receiptTitleRef} tabIndex={-1}>Pembayaran berhasil</h2>
            <p className="receipt-total">{formatIDR(saleSuccess.total)}</p>
            {saleSuccess.cashReceived !== null && saleSuccess.change !== null ? (
              <dl className="receipt-payment">
                <div><dt>Uang tunai diterima</dt><dd>{formatIDR(saleSuccess.cashReceived)}</dd></div>
                <div><dt>Kembalian</dt><dd>{formatIDR(saleSuccess.change)}</dd></div>
              </dl>
            ) : null}
            <p className="muted">
              {saleSuccess.status === "synced" ? "Sudah diterima server." : "Tersimpan di perangkat dan menunggu sinkronisasi."}
            </p>
            <div className={`receipt-print-state ${originalPrintJob?.status ?? "pending"}`} role="status" aria-live="polite">
              <Printer aria-hidden="true" />
              <div>
                <strong>
                  {!printer?.configured
                    ? "Printer belum diatur"
                    : !originalPrintJob
                      ? "Menyiapkan nota asli"
                      : originalPrintJob.status === "printed"
                        ? "Data nota diterima printer"
                        : originalPrintJob.status === "failed"
                          ? "Pengiriman nota gagal atau belum terkonfirmasi"
                          : originalPrintJob.status === "printing"
                            ? "Printer sedang mencetak"
                            : "Nota asli menunggu antrean"}
                </strong>
                <span>
                  {!printer?.configured
                    ? "Atur printer terminal untuk mencetak nota dari kasir."
                    : originalPrintJob?.status === "printed"
                      ? "Terminal selesai mengirim data; periksa kertas karena printer tidak mengonfirmasi hasil fisiknya."
                      : originalPrintJob?.status === "failed"
                        ? `${originalPrintJob.lastError ?? "Pengiriman terputus."} Periksa kertas sebelum mencoba ulang karena nota mungkin sudah tercetak sebagian atau seluruhnya.`
                        : "Penjualan tersimpan; status tugas cetak dipantau terpisah."}
                </span>
              </div>
            </div>
            <div className="receipt-actions">
              {!printer?.configured ? (
                <button
                  type="button"
                  onClick={() => {
                    setSaleSuccess(null);
                    openTool("printer");
                  }}
                >
                  Atur printer
                </button>
              ) : originalPrintJob?.status === "failed" ? (
                <button type="button" onClick={() => void handleRetryOriginalPrint(originalPrintJob)} disabled={busy}>
                  Coba cetak lagi
                </button>
              ) : originalPrintJob?.status === "printed" ? (
                <button type="button" onClick={() => void handlePrintSuccessCopy(saleSuccess.clientKey)} disabled={busy || successCopyQueued}>
                  {successCopyQueued ? "Salinan masuk antrean" : "Cetak salinan"}
                </button>
              ) : (
                <button type="button" disabled>
                  {originalPrintJob?.status === "printing" ? "Sedang mencetak…" : "Menunggu cetak…"}
                </button>
              )}
              <button className="primary" type="button" onClick={closeSaleSuccess}>
                Transaksi berikutnya
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <CommandPalette open={commandOpen} actions={commandActions} onClose={() => setCommandOpen(false)} />
    </main>
  );
}
