/**
 * Jembatan JS ↔ Rust untuk Bisa POS desktop (Langkah 1–6).
 *
 * Langkah 4 menyederhanakan jembatan ini menjadi MURNI invoke +
 * events (RENCANA-TAURI D7):
 * - JS TIDAK lagi memanggil HTTP `/api/pos/*` dan TIDAK pernah
 *   menerima nilai token perangkat;
 * - Langkah 6: JS juga tidak lagi MENYERAHKAN token — ia
 *   menyerahkan KODE PASANGAN sekali pakai lewat `pairDevice`;
 *   Rust menukarnya menjadi token per-terminal dan menyimpannya
 *   di keychain OS. Yang menyeberang kembali hanya status:
 *   `tokenConfigured`, `tokenStorage` (keychain/file), identitas
 *   terminal;
 * - snapshot & sinkronisasi dijalankan mesin Rust (thread latar +
 *   command `refreshSnapshot`/`syncNow`); progresnya tiba sebagai
 *   event `pos-engine`;
 * - tipe di sini cermin struct serde di src-tauri (posdb.rs,
 *   syncengine.rs, runtime.rs) — camelCase, nama field sama persis.
 *
 * Di luar Tauri (peramban biasa) `invoke` tidak tersedia: halaman
 * menandai mode pratinjau dan menonaktifkan aksi Rust.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  OfflineSalePayload,
  OfflineSyncItemResult,
} from "@shared/lib/pos/pos-offline";

export type { OfflineSalePayload, OfflineSyncItemResult };

// ---------------------------------------------------------------------------
// Tipe cermin Rust
// ---------------------------------------------------------------------------

/** Kemasan produk di snapshot lokal (S5) — cermin
 *  posdb::SnapshotPackaging: isi string numeric ke satuan dasar,
 *  harga jual per kemasan (null = belum diatur), barcode kemasan. */
export type LocalPackaging = {
  packagingId: string;
  name: string;
  isi: string;
  salePrice: string | null;
  barcode: string | null;
  isActive: boolean;
  isDefaultSale: boolean;
};

export type LocalProduct = {
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  salePrice: string;
  stock: number;
  trackStock: boolean;
  trackSerial: boolean;
  isTaxExempt?: boolean;
  unitCode: string | null;
  packagings: LocalPackaging[];
};

export type LocalProductPage = {
  products: LocalProduct[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type LocalCategory = { id: string; name: string; count: number };

export type LocalProductMatch = {
  product: LocalProduct;
  packagingId: string | null;
};

export type LocalPaymentMethod = {
  methodId: string;
  code: string;
  name: string;
  type: string;
  feeEnabled: boolean;
  feeType: string;
  feeValue: string;
};

export type TerminalIdentity = {
  terminalId: string;
  name: string;
  companyName: string;
  warehouseId: string | null;
  warehouseName: string | null;
};

export type SnapshotInfo = {
  version: string | null;
  cursor: string | null;
  generatedAt: string | null;
  warehouseId: string | null;
  productCount: number;
  paymentMethodCount: number;
  terminal: TerminalIdentity | null;
  canDiscount: boolean;
  posOfflineEnabled: boolean;
  taxEnabled: boolean;
  taxRate: string;
  roundingMode: string;
};

export type SnapshotName = { id: string; name: string; groupId: string | null };

export type LocalCustomerGroup = {
  id: string;
  name: string;
  roundingStep: number;
  roundingDirection: "down" | "up" | "nearest";
  roundCashTotal: boolean;
};

export type LocalGroupPrice = {
  groupId: string;
  productId: string;
  ruleType: "percent" | "fixed";
  value: string;
};

export type SnapshotGroupPricing = {
  groups: LocalCustomerGroup[];
  prices: LocalGroupPrice[];
};

export type LocalHeldSale = {
  id: string;
  label: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OutboxItem = {
  clientKey: string;
  status: "pending" | "inflight" | "synced" | "held";
  payload: OfflineSalePayload;
  attempts: number;
  lastMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OutboxSummary = {
  clientKey: string;
  status: "pending" | "inflight" | "held";
  expectedTotal: string | null;
  attempts: number;
  lastMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OutboxPage = {
  items: OutboxSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type LocalSaleHistoryRow = {
  clientKey: string;
  saleDate: string;
  expectedTotal: string;
  status: string;
  lastMessage: string | null;
  lineCount: number;
  createdAt: string;
};

export type LocalSalesPage = {
  items: LocalSaleHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type ServerSaleRow = {
  id: string;
  number: string;
  cashierId?: string | null;
  heldLabel?: string | null;
  date: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  total: string;
  paidTotal: string;
  cashierName: string | null;
  customerName: string | null;
  itemCount: number;
};

export type ServerSalesPage = {
  rows: ServerSaleRow[];
  total: number;
  page: number;
  pageSize: number;
  canVoid: boolean;
  canReturn: boolean;
  canDeleteHeld?: boolean;
};

export type ServerSaleDetail = {
  sale: {
    id: string;
    number: string;
    date: string;
    createdAt: string;
    status: string;
    paymentStatus: string;
    total: string;
    paidTotal: string;
  };
  lines: Array<{
    id: string;
    productId: string;
    productName: string;
    productSku: string | null;
    qty: string;
    qtyInput: string;
    isiSnapshot: string;
    packagingId?: string | null;
    discountType?: "percent" | "nominal" | null;
    discountValue?: string | null;
    unitPrice: string;
    lineTotal: string;
    packagingName: string | null;
    remainingQtyInput: number;
  }>;
  payments: Array<{
    id: string;
    amount: string;
    tendered: string;
    reference: string | null;
    methodName: string | null;
    methodType: string | null;
  }>;
  returns: Array<{
    id: string;
    number: string;
    date: string;
    createdAt: string;
    type: string;
    status: string;
    refundMethod: string;
    disposition: string;
    total: string;
    creditUsed: string;
    cashRefunded: string;
    reason: string;
    lines: Array<{
      productName: string;
      qtyInput: string;
      lineTotal: string;
    }>;
  }>;
  customer: { name: string; phone: string | null } | null;
  cashier: { name: string } | null;
  held: {
    warehouseId: string;
    customerId: string | null;
    dueDate: string | null;
    groupId: string | null;
  } | null;
};

export type ServerSaleDetailResponse = {
  detail: ServerSaleDetail;
  permissions: { canVoid: boolean; canReturn: boolean };
};

export type ServerSaleAction =
  | { action: "void"; saleId: string; idempotencyKey: string; reason: string }
  | {
      action: "hold";
      idempotencyKey: string;
      warehouseId: string;
      groupId?: string | null;
      customerId?: string | null;
      dueDate?: string | null;
      label?: string;
      lines: Array<{
        productId: string;
        qty: number;
        discountType?: "percent" | "nominal" | null;
        discountValue?: number;
        serialNumbers?: string[];
        packagingId?: string | null;
      }>;
    }
  | { action: "deleteHeld"; saleId: string }
  | {
      action: "return";
      saleId: string;
      idempotencyKey: string;
      disposition: "sellable" | "write_off";
      reason: string;
      refundMethod: "cash" | "transfer" | "store_credit" | "exchange";
      type: "return" | "exchange";
      lines: Array<{ productId: string; saleLineId: string; qty: number }>;
    };

/** Status perangkat dari Rust — token TIDAK pernah termasuk.
 *  `tokenStorage` memperlihatkan fallback berkas bila keychain
 *  OS tidak tersedia di mesin ini (Langkah 6, D5). */
export type DeviceRuntimeStatus = {
  serverUrl: string;
  tokenConfigured: boolean;
  tokenStorage: "keychain" | "file" | "none";
  paired: boolean;
  terminalName: string | null;
  companyName: string | null;
  warehouseName: string | null;
  terminalId: string | null;
  cashierId: string | null;
  cashierName: string | null;
  offlineLoginReady: boolean;
  authFailed: string | null;
  pendingCount: number;
  syncing: boolean;
};

export type CashierLoginView =
  | { step: "twoFactor"; methods: string[] }
  | {
      step: "authenticated";
      cashier: { id: string; name: string; email: string };
      companies: Array<{ id: string; name: string }>;
      selectedCompanyId: string | null;
    }
  | {
      step: "offlineAuthenticated";
      cashier: { id: string; name: string; email: string };
      company: { id: string; name: string };
    };

export type RefreshSummary = {
  mode: "full" | "delta";
  products: number;
  removed: number;
  cursor: string | null;
};

export type DrainSummary = {
  attempted: number;
  synced: number;
  held: number;
  remaining: number;
  authFailed: boolean;
  error: string | null;
};

export type Denomination = { denomination: string; count: number };

export type CashSession = {
  id: string;
  warehouseId: string;
  openedAt: string;
  openedBy: string | null;
  openingCash: string;
  closedAt: string | null;
  status: "open" | "closed";
  counted: Denomination[] | null;
  countedTotal: string | null;
  expectedTotal: string | null;
  differenceTotal: string | null;
};

export type ServerCashSessionSummary = {
  sessionId: string;
  status: "open" | "closed";
  expectedCash: string;
};

export type CashSessionSyncStatus = {
  pendingSales: number;
  pendingIntents: number;
};

export type LocalIntent = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
};

/** Peristiwa mesin sinkron Rust (event Tauri `pos-engine`). */
export type EngineEvent =
  | { kind: "passStarted" }
  | { kind: "item"; clientKey: string; status: string }
  | { kind: "passFinished"; pending: number; synced: number; held: number }
  | { kind: "authFailed"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "snapshotApplied"; mode: string; products: number; removed: number };

// ---------------------------------------------------------------------------
// Printer ESC/POS (Langkah 5) — cermin posdb::PrintJob,
// runtime::PrinterRuntimeStatus, printing::PrintEvent
// ---------------------------------------------------------------------------

export type PrintJob = {
  id: string;
  clientKey: string;
  copyIndex: number;
  status: "pending" | "printing" | "printed" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  printedAt: string | null;
};

export type ServerReceiptPrintJob = {
  id: string;
  saleId: string;
  status: "pending" | "printing" | "printed" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  printedAt: string | null;
};

/** Status printer dari Rust — tanpa kredensial apa pun. */
export type PrinterStatus = {
  configured: boolean;
  transport: "tcp" | "cups" | "device";
  host: string;
  port: number;
  paperWidthMm: number;
  pendingCount: number;
  failedCount: number;
  printing: boolean;
};

/** Peristiwa pekerja cetak Rust (event Tauri `pos-print`). */
export type PrintEvent =
  | { kind: "jobPrinted"; jobId: string; clientKey: string; copyIndex: number }
  | { kind: "jobFailed"; jobId: string; clientKey: string; copyIndex: number; message: string }
  | { kind: "serverJobPrinted"; jobId: string; saleId: string }
  | { kind: "serverJobFailed"; jobId: string; saleId: string; message: string }
  | { kind: "passFinished"; printed: number; failed: number; pending: number };

// ---------------------------------------------------------------------------
// Invoke
// ---------------------------------------------------------------------------

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getSnapshotInfo() {
  return invoke<SnapshotInfo>("snapshot_info");
}

/** Gambar QRIS statis dari pengaturan perusahaan (data URL raster). */
export async function getQrisImage() {
  return invoke<string | null>("get_qris_image");
}

export async function listLocalProductsPage(
  search: string,
  page: number,
  pageSize = 50,
  categoryId: string | null = null,
) {
  return invoke<LocalProductPage>("list_snapshot_products_page", {
    search,
    page,
    pageSize,
    categoryId,
  });
}

export type SnapshotWarehouse = { id: string; code: string; name: string; isDefault: boolean };

/** Gudang yang tersedia untuk pemilih register (dari snapshot server). */
export async function listSnapshotWarehouses() {
  return invoke<SnapshotWarehouse[]>("list_snapshot_warehouses");
}

export type SnapshotReservation = {
  id: string;
  number: string;
  productId: string;
  qty: string;
  expiresAt: string | null;
  reason: string | null;
};

/** Reservasi stok aktif yang bisa dipilih saat checkout. */
export async function listSnapshotReservations() {
  return invoke<SnapshotReservation[]>("list_snapshot_reservations");
}

export type LoyaltyBalance = { customerId: string; points: number };

/** Saldo poin loyalitas dari snapshot server. */
export async function listLoyaltyBalances() {
  return invoke<LoyaltyBalance[]>("list_snapshot_loyalty_balances");
}

export type SnapshotPromotion = {
  id: string;
  name: string;
  type: "percent" | "nominal";
  value: string;
  minSubtotal: string;
  productId: string | null;
};

/** Promosi aktif dari snapshot server. */
export async function listSnapshotPromotions() {
  return invoke<SnapshotPromotion[]>("list_snapshot_promotions");
}

export type KitchenTicketLine = {
  productName: string;
  qty: string;
  unitCode: string | null;
  packagingName: string | null;
};
export type KitchenTicket = {
  saleId: string;
  number: string;
  createdAt: string;
  lines: KitchenTicketLine[];
};

/** Tiket dapur dari penjualan terbaru (snapshot server). */
export async function listKitchenTickets() {
  return invoke<KitchenTicket[]>("list_snapshot_kitchen_tickets");
}

export async function listLocalCategories() {
  return invoke<LocalCategory[]>("list_snapshot_categories");
}

export async function findLocalProductByCode(code: string) {
  return invoke<LocalProductMatch | null>("find_snapshot_product_by_code", { code });
}

export async function getSnapshotProductsByIds(productIds: string[]) {
  return invoke<LocalProduct[]>("get_snapshot_products_by_ids", { productIds });
}

export async function listLocalPaymentMethods() {
  return invoke<LocalPaymentMethod[]>("list_snapshot_payment_methods");
}

export async function listSnapshotNames(kind: "customer" | "cashier") {
  return invoke<SnapshotName[]>("list_snapshot_names", { kind });
}

export async function getSnapshotGroupPricing() {
  return invoke<SnapshotGroupPricing>("snapshot_group_pricing");
}

export async function listLocalHeldSales() {
  return invoke<LocalHeldSale[]>("list_local_held_sales");
}

export async function saveLocalHeldSale(input: {
  id: string;
  label: string;
  payload: Record<string, unknown>;
}) {
  return invoke<LocalHeldSale>("save_local_held_sale", input);
}

export async function deleteLocalHeldSale(id: string) {
  return invoke<void>("delete_local_held_sale", { id });
}

export async function recordLocalSale(sale: OfflineSalePayload, heldSaleId?: string | null) {
  return invoke<OutboxItem>("record_local_sale", { sale, heldSaleId: heldSaleId ?? null });
}

export async function listOutbox(status?: string) {
  return invoke<OutboxItem[]>("list_outbox", { status: status ?? null });
}

export async function listOutboxPage(page: number, pageSize = 50) {
  return invoke<OutboxPage>("list_outbox_page", { page, pageSize });
}

export async function listLocalSalesPage(page: number, query = "", pageSize = 50, from = "", to = "") {
  return invoke<LocalSalesPage>("list_local_sales_page", { page, pageSize, query, from: from || null, to: to || null });
}

export async function getServerSalesPage(page: number, query = "", status = "", from = "", to = "") {
  return invoke<ServerSalesPage>("fetch_server_pos_transactions", { page, query, status: status || null, from: from || null, to: to || null, saleId: null });
}

export async function getServerSaleDetail(saleId: string) {
  return invoke<ServerSaleDetailResponse>("fetch_server_pos_transactions", {
    page: 1,
    query: "",
    status: null,
    from: null,
    to: null,
    saleId,
  });
}

export async function printServerReceipt(saleId: string) {
  return invoke<ServerReceiptPrintJob>("print_server_receipt", { saleId });
}

export async function runServerSaleAction(payload: ServerSaleAction) {
  return invoke<Record<string, unknown>>("post_server_pos_transaction", { payload });
}

export async function getDeviceStatus() {
  return invoke<DeviceRuntimeStatus>("get_device_status");
}

/** Pasangkan terminal: serahkan URL server + kode pasangan
 *  sekali pakai dari admin web. Rust menukarnya menjadi token
 *  per-terminal dan menyimpannya di keychain OS — kode & token
 *  tidak pernah dikembalikan command apa pun. */
export async function pairDevice(input: { serverUrl: string; code: string }) {
  return invoke<DeviceRuntimeStatus>("pair_device", {
    serverUrl: input.serverUrl,
    code: input.code,
  });
}

/** Authenticate a cashier. Passwords and Better Auth cookies stay in Rust. */
export async function cashierLogin(input: {
  serverUrl: string;
  email: string;
  password: string;
}) {
  return invoke<CashierLoginView>("cashier_login", {
    serverUrl: input.serverUrl,
    email: input.email,
    password: input.password,
  });
}

export async function cashierLoginContinue(twoFactorCode: string) {
  return invoke<CashierLoginView>("cashier_login_continue", { twoFactorCode });
}

export async function cashierEnroll(companyId: string) {
  return invoke<DeviceRuntimeStatus>("cashier_enroll", { companyId });
}

/** Lepas pasangan terminal ini (token dihapus di Rust). */
export async function unpairDevice() {
  return invoke<DeviceRuntimeStatus>("unpair_device");
}

export async function refreshSnapshot() {
  return invoke<RefreshSummary>("refresh_snapshot");
}

export async function syncNow() {
  return invoke<DrainSummary | null>("sync_now");
}

export async function openCashSession(input: {
  warehouseId: string;
  openingCash: string;
  openedBy?: string;
}) {
  return invoke<CashSession>("open_cash_session", {
    warehouseId: input.warehouseId,
    openingCash: input.openingCash,
    openedBy: input.openedBy ?? null,
  });
}

export async function closeCashSession(input: {
  sessionId: string;
  counted: Denomination[];
  differenceReason?: string;
}) {
  return invoke<CashSession>("close_cash_session", {
    sessionId: input.sessionId,
    counted: input.counted,
    differenceReason: input.differenceReason ?? null,
  });
}

export async function previewCashSession(input: {
  sessionId: string;
  counted: Denomination[];
}) {
  return invoke<{ countedTotal: string; expectedTotal: string; differenceTotal: string }>(
    "preview_cash_session",
    { sessionId: input.sessionId, counted: input.counted },
  );
}

export async function getServerCashSessionSummary(sessionId: string) {
  return invoke<ServerCashSessionSummary>("fetch_server_pos_cash_session_summary", { sessionId });
}

export async function getCashSessionSyncStatus(sessionId: string) {
  return invoke<CashSessionSyncStatus>("get_cash_session_sync_status", { sessionId });
}

export async function recordCashSessionMovement(input: {
  clientKey: string;
  sessionId: string;
  movementType: "deposit" | "withdrawal";
  amount: string;
  notes: string;
}) {
  return invoke<LocalIntent>("record_cash_session_movement", {
    movement: {
      clientKey: input.clientKey,
      sessionId: input.sessionId,
      movementType: input.movementType,
      amount: input.amount,
      notes: input.notes,
    },
  });
}

export async function currentCashSession(warehouseId: string) {
  return invoke<CashSession | null>("current_cash_session", { warehouseId });
}

export async function listCashSessions() {
  return invoke<CashSession[]>("list_cash_sessions");
}

export async function countCashSessions() {
  return invoke<number>("count_cash_sessions");
}

export type SessionSaleCount = { sessionId: string; count: number };
export type SessionPaymentTotal = { sessionId: string; methodId: string; total: number };

export async function listSessionSaleCounts() {
  return invoke<SessionSaleCount[]>("list_session_sales_counts");
}

export async function listSessionPaymentTotals() {
  return invoke<SessionPaymentTotal[]>("list_session_payment_totals");
}

export type PaymentMethodTotal = { methodId: string; count: number; total: number };

export async function listPaymentTotalsInRange(from: string, to: string) {
  return invoke<PaymentMethodTotal[]>("list_payment_totals_in_range", { from, to });
}

export async function listLocalIntents() {
  return invoke<LocalIntent[]>("list_local_intents");
}

export async function retryCashSessionClose(intentId: string, differenceReason?: string) {
  return invoke<LocalIntent>("retry_cash_session_close", {
    intentId,
    differenceReason: differenceReason?.trim() || null,
  });
}

export async function retryCashSessionMovement(intentId: string) {
  return invoke<LocalIntent>("retry_cash_session_movement", { intentId });
}

export async function retryCashSessionOpen(intentId: string) {
  return invoke<LocalIntent>("retry_cash_session_open", { intentId });
}

export async function onEngineEvent(
  handler: (event: EngineEvent) => void,
): Promise<UnlistenFn> {
  return listen<EngineEvent>("pos-engine", (event) => handler(event.payload));
}

// ---------------------------------------------------------------------------
// Invoke printer (Langkah 5)
// ---------------------------------------------------------------------------

export async function getPrinterStatus() {
  return invoke<PrinterStatus>("get_printer_status");
}

export async function listCupsPrinters() {
  return invoke<string[]>("list_cups_printers");
}

export async function setPrinterConfig(input: {
  transport: "tcp" | "cups" | "device";
  host: string;
  port: number;
  paperWidthMm: number;
}) {
  return invoke<PrinterStatus>("set_printer_config", {
    transport: input.transport,
    host: input.host,
    port: input.port,
    paperWidthMm: input.paperWidthMm,
  });
}

export async function listPrintJobs(status?: string) {
  return invoke<PrintJob[]>("list_print_jobs", { status: status ?? null });
}

export async function listServerReceiptPrintJobs(status?: string) {
  return invoke<ServerReceiptPrintJob[]>("list_server_receipt_print_jobs", { status: status ?? null });
}

/** Cetak ulang struk: salinan berikutnya (pita SALINAN) mengantre. */
export async function printReceipt(clientKey: string) {
  return invoke<PrintJob>("print_receipt", { clientKey });
}

export async function retryPrintJob(jobId: string) {
  return invoke<PrintJob>("retry_print_job", { jobId });
}

export async function retryServerReceiptPrintJob(jobId: string) {
  return invoke<ServerReceiptPrintJob>("retry_server_receipt_print_job", { jobId });
}

export async function testPrint() {
  return invoke<void>("test_print");
}

/** Buka laci tanpa penjualan — alasan wajib & tercatat di Rust. */
export async function openDrawer(reason: string) {
  return invoke<void>("open_drawer", { reason });
}

export async function onPrintEvent(
  handler: (event: PrintEvent) => void,
): Promise<UnlistenFn> {
  return listen<PrintEvent>("pos-print", (event) => handler(event.payload));
}

// ---------------------------------------------------------------------------
// Updater aplikasi (Langkah 7, D4) — cermin updater::UpdateStatusView.
// Keadaan dikirim Rust sebagai status command + event `pos-update`
// (muatannya status itu sendiri). Token tidak pernah terlibat di JS:
// pemeriksaan & unduhan membawa header dari Rust.
// ---------------------------------------------------------------------------

export type UpdateStatus = {
  phase:
    | "idle"
    | "checking"
    | "upToDate"
    | "available"
    | "downloading"
    | "downloaded"
    | "waitingSession"
    | "installing"
    | "failed";
  currentVersion: string;
  availableVersion: string | null;
  mandatory: boolean;
  notes: string | null;
  lastCheckedAt: string | null;
  message: string | null;
};

export async function getUpdateStatus() {
  return invoke<UpdateStatus>("get_update_status");
}

/** Paksa periksa sekarang; unduhan berjalan di Rust, pemasangan
 *  mengikuti gerbang sesi kas. */
export async function checkUpdateNow() {
  return invoke<UpdateStatus>("check_update_now");
}

/** Perintah eksplisit pengguna: pasang paket terunduh sekarang. */
export async function installUpdateNow() {
  return invoke<UpdateStatus>("install_update_now");
}

export async function onUpdateEvent(
  handler: (status: UpdateStatus) => void,
): Promise<UnlistenFn> {
  return listen<UpdateStatus>("pos-update", (event) => handler(event.payload));
}

// ---------------------------------------------------------------------------
// Layar pelanggan (Langkah 8) — cermin displaymap.rs.
//
// Jendela utama MENULIS keadaan keranjang lewat
// `updateCustomerDisplay`; Rust memetakannya (murni) dan
// memancarkannya sebagai event `pos-display`. Jendela display
// hanya MEMBACA: `getCustomerDisplay` saat dibuka + listen
// event. Tidak ada token/HTTP/DB yang menyeberang ke jendela
// kedua (D7).
// ---------------------------------------------------------------------------

export type DisplayCartLine = {
  name: string;
  qty: number;
  /** Harga satuan string desimal — persis `LocalProduct.salePrice`. */
  unitPrice: string;
  /** Nominal baris hasil quote, sesudah diskon. */
  lineTotal?: string;
  /** Diskon kelompok + manual dari quote kasir. */
  discountAmount?: string;
};

export type DisplayInput = {
  storeName: string | null;
  phase: "cart" | "paid";
  lines: DisplayCartLine[];
  /** Total yang sama dengan quote kasir, termasuk pajak/pembulatan. */
  cartTotal?: string | null;
  paidTotal: string | null;
};

export type DisplayLineView = {
  name: string;
  qtyText: string;
  unitPriceText: string;
  lineTotalText: string;
  discountText?: string | null;
};

export type DisplayPayload = {
  mode: "idle" | "cart" | "thanks";
  storeName: string;
  headline: string;
  lines: DisplayLineView[];
  moreLines: number;
  totalQtyText: string;
  totalText: string;
};

export async function updateCustomerDisplay(input: DisplayInput) {
  return invoke<DisplayPayload>("update_customer_display", { input });
}

export async function getCustomerDisplay() {
  return invoke<DisplayPayload>("get_customer_display");
}

export async function openCustomerDisplay() {
  return invoke<boolean>("open_customer_display");
}

export async function closeCustomerDisplay() {
  return invoke<boolean>("close_customer_display");
}

export async function customerDisplayOpen() {
  return invoke<boolean>("customer_display_open");
}

export async function onDisplayEvent(
  handler: (payload: DisplayPayload) => void,
): Promise<UnlistenFn> {
  return listen<DisplayPayload>("pos-display", (event) => handler(event.payload));
}
