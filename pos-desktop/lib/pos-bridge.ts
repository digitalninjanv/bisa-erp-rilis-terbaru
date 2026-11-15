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
  salePrice: string;
  stock: number;
  trackStock: boolean;
  trackSerial: boolean;
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

export type LocalProductMatch = {
  product: LocalProduct;
  packagingId: string | null;
};

export type LocalPaymentMethod = {
  methodId: string;
  code: string;
  name: string;
  type: string;
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
  authFailed: string | null;
  pendingCount: number;
  syncing: boolean;
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

/** Status printer dari Rust — tanpa kredensial apa pun. */
export type PrinterStatus = {
  configured: boolean;
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

export async function listLocalProductsPage(search: string, page: number, pageSize = 50) {
  return invoke<LocalProductPage>("list_snapshot_products_page", { search, page, pageSize });
}

export async function findLocalProductByCode(code: string) {
  return invoke<LocalProductMatch | null>("find_snapshot_product_by_code", { code });
}

export async function listLocalPaymentMethods() {
  return invoke<LocalPaymentMethod[]>("list_snapshot_payment_methods");
}

export async function recordLocalSale(sale: OfflineSalePayload) {
  return invoke<OutboxItem>("record_local_sale", { sale });
}

export async function listOutbox(status?: string) {
  return invoke<OutboxItem[]>("list_outbox", { status: status ?? null });
}

export async function listOutboxPage(page: number, pageSize = 50) {
  return invoke<OutboxPage>("list_outbox_page", { page, pageSize });
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
}) {
  return invoke<CashSession>("close_cash_session", {
    sessionId: input.sessionId,
    counted: input.counted,
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

export async function listLocalIntents() {
  return invoke<LocalIntent[]>("list_local_intents");
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

export async function setPrinterConfig(input: {
  host: string;
  port: number;
  paperWidthMm: number;
}) {
  return invoke<PrinterStatus>("set_printer_config", {
    host: input.host,
    port: input.port,
    paperWidthMm: input.paperWidthMm,
  });
}

export async function listPrintJobs(status?: string) {
  return invoke<PrintJob[]>("list_print_jobs", { status: status ?? null });
}

/** Cetak ulang struk: salinan berikutnya (pita SALINAN) mengantre. */
export async function printReceipt(clientKey: string) {
  return invoke<PrintJob>("print_receipt", { clientKey });
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
};

export type DisplayInput = {
  storeName: string | null;
  phase: "cart" | "paid";
  lines: DisplayCartLine[];
  paidTotal: string | null;
};

export type DisplayLineView = {
  name: string;
  qtyText: string;
  unitPriceText: string;
  lineTotalText: string;
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
