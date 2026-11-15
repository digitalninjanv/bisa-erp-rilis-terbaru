"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkUpdateNow,
  closeCashSession,
  closeCustomerDisplay,
  countCashSessions,
  customerDisplayOpen,
  currentCashSession,
  getDeviceStatus,
  getPrinterStatus,
  getSnapshotInfo,
  getUpdateStatus,
  findLocalProductByCode,
  installUpdateNow,
  isTauri,
  listLocalPaymentMethods,
  listLocalProductsPage,
  listOutboxPage,
  listPrintJobs,
  onEngineEvent,
  onPrintEvent,
  onUpdateEvent,
  openCashSession,
  openCustomerDisplay,
  openDrawer,
  printReceipt,
  pairDevice,
  recordLocalSale,
  refreshSnapshot,
  setPrinterConfig,
  syncNow,
  testPrint,
  unpairDevice,
  updateCustomerDisplay,
  type CashSession,
  type Denomination,
  type DeviceRuntimeStatus,
  type LocalPackaging,
  type LocalPaymentMethod,
  type LocalProduct,
  type LocalProductPage,
  type OfflineSalePayload,
  type OutboxPage,
  type PrintJob,
  type PrinterStatus,
  type SnapshotInfo,
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

function formatIDR(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function todayISODate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Baris keranjang (S5): satuan adalah (produk, kemasan?) — kemasan
 * null = satuan dasar. `qty` selalu qty INPUT dalam satuan baris
 * (1 = 1 Dus untuk baris berkemasan); konversi ke satuan dasar
 * terjadi lewat cuplikan isi di muatan & di Rust, cermin POS web.
 */
type CartLine = {
  product: LocalProduct;
  packaging: LocalPackaging | null;
  qty: number;
};

function lineKey(line: CartLine): string {
  return `${line.product.productId}::${line.packaging?.packagingId ?? "base"}`;
}

/** Harga yang dibebankan PER SATUAN BARIS: per kemasan untuk baris
 *  berkemasan (harga kemasan independen; belum diatur → harga
 *  satuan dasar × isi, cermin quote lokal web), harga satuan
 *  dasar untuk baris biasa. */
function lineUnitPrice(line: CartLine): number {
  if (!line.packaging) return Number(line.product.salePrice);
  if (line.packaging.salePrice != null) return Number(line.packaging.salePrice);
  return Number(line.product.salePrice) * Number(line.packaging.isi);
}

function lineTotal(line: CartLine): number {
  return lineUnitPrice(line) * line.qty;
}

/** Kuantitas satuan dasar baris (qty input × isi cuplikan). */
function lineBaseQty(line: CartLine): number {
  return line.qty * (line.packaging ? Number(line.packaging.isi) : 1);
}

export default function DesktopTerminalPage() {
  const [inTauri] = useState<boolean>(() => isTauri());
  const [serverUrl, setServerUrl] = useState("");
  const [pairCode, setPairCode] = useState("");
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
  const [methods, setMethods] = useState<LocalPaymentMethod[]>([]);
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
  const [session, setSession] = useState<CashSession | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastClosed, setLastClosed] = useState<CashSession | null>(null);
  const [openingCash, setOpeningCash] = useState("100000");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [printer, setPrinter] = useState<PrinterStatus | null>(null);
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [printerHost, setPrinterHost] = useState("");
  const [printerPort, setPrinterPort] = useState("9100");
  const [printerPaper, setPrinterPaper] = useState("80");
  const [drawerReason, setDrawerReason] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanCode, setScanCode] = useState("");
  const [displayOpen, setDisplayOpen] = useState(false);
  /** Selama jendela waktu ini sesudah pembayaran, pembaruan
   *  keranjang kosong TIDAK menimpa ucapan terima kasih di layar
   *  pelanggan. */
  const displayHoldUntilRef = useRef(0);
  const catalogQueryRef = useRef({ search: catalogSearch, page: catalogPage });
  const catalogRequestRef = useRef(0);
  useEffect(() => {
    catalogQueryRef.current = { search: catalogSearch, page: catalogPage };
  }, [catalogSearch, catalogPage]);
  const [methodId, setMethodId] = useState<string>("");
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string }>({
    kind: "info",
    text: "Siap. Konfigurasikan perangkat, lalu segarkan snapshot.",
  });
  const [busy, setBusy] = useState(false);
  const loadCatalogPage = useCallback(async (search: string, page: number) => {
    if (!isTauri()) return;
    const requestId = ++catalogRequestRef.current;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const nextCatalog = await listLocalProductsPage(search, page, 50);
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

  useEffect(() => () => {
    outboxRequestRef.current += 1;
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    const timer = window.setTimeout(
      () => void loadCatalogPage(catalogSearch, catalogPage),
      catalogSearch.trim() ? 180 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      catalogRequestRef.current += 1;
    };
  }, [inTauri, catalogSearch, catalogPage, loadCatalogPage]);

  const refreshLocal = useCallback(async () => {
    if (!isTauri()) return;
    const nextInfo = await getSnapshotInfo();
    const catalogQuery = catalogQueryRef.current;
    const [
        ,
        nextMethods,
        ,
        nextDevice,
        nextSessionCount,
        nextPrinter,
        nextPrintJobs,
        nextUpdate,
      ] = await Promise.all([
        loadCatalogPage(catalogQuery.search, catalogQuery.page),
        listLocalPaymentMethods(),
        loadOutboxPage(outboxPageRef.current),
        getDeviceStatus(),
        countCashSessions(),
        getPrinterStatus(),
        listPrintJobs(),
        getUpdateStatus(),
      ]);
      setInfo(nextInfo);
      setMethods(nextMethods);
      setDevice(nextDevice);
      setSessionCount(nextSessionCount);
      setPrinter(nextPrinter);
      setPrintJobs(nextPrintJobs);
      setUpdate(nextUpdate);
      setDisplayOpen(await customerDisplayOpen());
      setServerUrl((current) => current || nextDevice.serverUrl || "");
      setMethodId((current) => current || nextMethods[0]?.methodId || "");
      setPrinterHost((current) => current || nextPrinter.host || "");
      if (nextPrinter.configured) {
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
  }, [loadCatalogPage, loadOutboxPage]);

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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inTauri, refreshLocal]);

  // Progres mesin Rust tiba sebagai event: segarkan tampilan lokal
  // pada peristiwa penutup (per item cukup mengubah teks status).
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    onEngineEvent((event) => {
      if (disposed) return;
      if (event.kind === "item") {
        setStatus({
          kind: "info",
          text: `Sinkron: ${event.clientKey.slice(0, 8)}… → ${event.status}`,
        });
      } else if (event.kind === "authFailed") {
        setStatus({ kind: "error", text: `Token ditolak server: ${event.message}` });
        void refreshLocal();
      } else if (event.kind === "offline") {
        setStatus({ kind: "error", text: `Sinkron tertunda (antrean utuh): ${event.message}` });
      } else if (
        event.kind === "passFinished" ||
        event.kind === "snapshotApplied"
      ) {
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

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + lineTotal(line), 0),
    [cart],
  );

  // ------------------------------------------------------------------
  // Layar pelanggan (Langkah 8): laporkan keadaan keranjang ke
  // Rust; pemetaan & pancaran event milik Rust (displaymap).
  // ------------------------------------------------------------------

  const pushDisplayCart = useCallback(() => {
    if (!isTauri()) return;
    void updateCustomerDisplay({
      storeName: info?.terminal?.companyName ?? device?.companyName ?? null,
      phase: "cart",
      lines: cart.map((line) => ({
        name: line.packaging
          ? `${line.product.name} (${line.packaging.name})`
          : line.product.name,
        qty: line.qty,
        unitPrice: String(lineUnitPrice(line)),
      })),
      paidTotal: null,
    }).catch(() => {
      /* Layar pelanggan adalah fitur diam: kegagalan melapor
         tidak pernah mengganggu kasir. */
    });
  }, [cart, info, device]);

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

  async function handlePair() {
    setBusy(true);
    try {
      const next = await pairDevice({ serverUrl, code: pairCode });
      setDevice(next);
      setPairCode("");
      setStatus({
        kind: "ok",
        text: `Terpasang sebagai "${next.terminalName ?? "terminal"}". Token tersimpan di ${
          next.tokenStorage === "keychain" ? "keychain OS" : "berkas cadangan (keychain OS tidak tersedia)"
        } — segarkan snapshot untuk menarik katalog.`,
      });
      await refreshLocal();
    } catch (error) {
      setStatus({ kind: "error", text: `Pemasangan gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpair() {
    setBusy(true);
    try {
      const next = await unpairDevice();
      setDevice(next);
      setStatus({
        kind: "info",
        text: "Pasangan dilepas. Token terhapus dari terminal ini; penjualan lokal yang belum tersinkron tetap tersimpan.",
      });
      await refreshLocal();
    } catch (error) {
      setStatus({ kind: "error", text: `Lepas pasangan gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
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
        host: printerHost,
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

  async function handleReprint(job: PrintJob) {
    setBusy(true);
    try {
      const copy = await printReceipt(job.clientKey);
      await refreshLocal();
      setStatus({
        kind: "ok",
        text: `Cetak ulang ${job.clientKey.slice(0, 8)}… mengantre sebagai salinan ke-${copy.copyIndex} (pita SALINAN).`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Cetak ulang gagal: ${String(error)}` });
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

  /** Pindai barcode (S5): barcode kemasan aktif menyelesaikan ke
   *  baris KEMASAN berharga kemasan; barcode/SKU produk ke baris
   *  satuan dasar — resolusi lokal dari snapshot, cermin
   *  findProductByAnyBarcode server (kemasan nonaktif tak
   *  menyelesaikan). */
  async function handleScan() {
    const code = scanCode.trim();
    if (!code) return;
    try {
      const match = await findLocalProductByCode(code);
      if (!match) {
        setStatus({ kind: "error", text: `Barcode "${code}" tidak dikenal katalog lokal.` });
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
      setScanCode("");
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

  async function handleRecordSale() {
    if (!info?.warehouseId) {
      setStatus({ kind: "error", text: "Snapshot belum diterapkan — gudang terminal belum diketahui." });
      return;
    }
    if (cart.length === 0 || !methodId) {
      setStatus({ kind: "error", text: "Keranjang kosong atau metode pembayaran belum dipilih." });
      return;
    }
    setBusy(true);
    try {
      const sale: OfflineSalePayload = {
        clientKey: crypto.randomUUID(),
        warehouseId: info.warehouseId,
        date: todayISODate(),
        originSessionId: session?.id,
        lines: cart.map((line) =>
          line.packaging
            ? {
                productId: line.product.productId,
                qty: line.qty,
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
                unitPrice: Number(line.product.salePrice),
              },
        ),
        payments: [{ methodId, amount: cartTotal, tendered: cartTotal }],
        queuedAt: new Date().toISOString(),
        deviceId: info?.terminal?.terminalId ?? "tauri-desktop",
        expectedTotal: cartTotal,
      };
      const item = await recordLocalSale(sale);
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
      await refreshLocal();
      setStatus({
        kind: "ok",
        text: `Penjualan lokal tercatat atomik → outbox ${item.status} (${item.clientKey.slice(0, 8)}…). Drain latar terpicu.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Pencatatan lokal gagal (transaksi dibatalkan utuh): ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenSession() {
    if (!info?.warehouseId) return;
    setBusy(true);
    try {
      const opened = await openCashSession({
        warehouseId: info.warehouseId,
        openingCash: openingCash || "0",
      });
      setSession(opened);
      setLastClosed(null);
      await refreshLocal();
      setStatus({ kind: "ok", text: `Sesi kas lokal dibuka (modal ${formatIDR(Number(opened.openingCash))}).` });
    } catch (error) {
      setStatus({ kind: "error", text: `Buka sesi gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseSession() {
    if (!session) return;
    setBusy(true);
    try {
      const counted: Denomination[] = DENOMINATIONS.map((denom) => ({
        denomination: denom,
        count: Number(counts[denom]) || 0,
      })).filter((entry) => entry.count > 0);
      const closed = await closeCashSession({ sessionId: session.id, counted });
      setSession(null);
      setLastClosed(closed);
      setCounts({});
      await refreshLocal();
      setStatus({
        kind: "ok",
        text: `Sesi ditutup (buta): fisik ${formatIDR(Number(closed.countedTotal))}, harapan ${formatIDR(Number(closed.expectedTotal))}, selisih ${formatIDR(Number(closed.differenceTotal))}. Intent tutup sesi mengantre lokal.`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: `Tutup sesi gagal: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          Bisa <span>POS</span> — Desktop
        </div>
        <span className={`badge ${inTauri ? "on" : ""}`}>
          {inTauri ? "Tauri: mesin Rust aktif" : "Mode peramban (pratinjau)"}
        </span>
        {info?.version ? <span className="badge">Snapshot {info.version.slice(0, 19)}…</span> : null}
        <span className="badge">Outbox hidup: {outbox.total}</span>
        {printer && printer.pendingCount > 0 ? (
          <span className="badge">Cetak mengantre: {printer.pendingCount}</span>
        ) : null}
        {printer && printer.failedCount > 0 ? (
          <span className="badge">Cetak gagal: {printer.failedCount}</span>
        ) : null}
        {device?.authFailed ? <span className="badge">Token ditolak server</span> : null}
        {info?.terminal ? (
          <span className="badge on">
            {info.terminal.name}
            {info.terminal.companyName ? ` · ${info.terminal.companyName}` : ""}
          </span>
        ) : null}
        {session ? <span className="badge on">Sesi kas terbuka</span> : null}
      </header>

      <div className="layout">
        <div>
          <section className="panel">
            <h2>Terminal (pasangan dikelola Rust — token tidak pernah tampil di sini)</h2>
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
                  <button onClick={handleUnpair} disabled={busy || !inTauri}>
                    Lepas pasangan
                  </button>
                  <span className="muted">
                    {device.tokenStorage === "keychain"
                      ? "Token tersimpan di keychain OS. Snapshot & sinkronisasi dijalankan Rust (kursor delta + drain outbox di thread latar)."
                      : device.tokenStorage === "file"
                        ? "PERINGATAN: keychain OS tidak tersedia di mesin ini — token tersimpan di berkas berizin ketat (0600) milik Rust. Aktifkan layanan keychain (Secret Service/Credential Manager) agar token berpindah ke brankas OS."
                        : "Token terkonfigurasi."}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="row">
                  <label className="field">
                    URL server ERP
                    <input
                      value={serverUrl}
                      onChange={(event) => setServerUrl(event.target.value)}
                      placeholder="http://localhost:3000"
                    />
                  </label>
                  <label className="field">
                    Kode pasangan (dari admin web — sekali pakai, 15 menit)
                    <input
                      value={pairCode}
                      onChange={(event) => setPairCode(event.target.value)}
                      placeholder="XXXXX-XXXXX"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="row">
                  <button
                    className="primary"
                    onClick={handlePair}
                    disabled={busy || !inTauri || !pairCode.trim()}
                  >
                    Pasangkan terminal
                  </button>
                  <span className="muted">
                    Admin membuat terminal & kode pasangan di POS web → Terminal desktop.
                    Rust menukar kode menjadi token per-terminal dan menyimpannya di
                    keychain OS — kode tidak disimpan.
                  </span>
                </div>
              </>
            )}
            <div className="row">
              <div className={`status ${status.kind === "info" ? "" : status.kind}`} role="status">
                {status.text}
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Pembaruan aplikasi (diperiksa &amp; diunduh Rust — dipasang saat sesi tutup)</h2>
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

          <section className="panel">
            <h2>Sesi kas lokal</h2>
            {!session && !lastClosed ? (
              <div className="row">
                <label className="field">
                  Modal awal laci (Rp)
                  <input
                    value={openingCash}
                    onChange={(event) => setOpeningCash(event.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <button
                  className="primary"
                  onClick={handleOpenSession}
                  disabled={busy || !inTauri || !info?.warehouseId}
                >
                  Buka sesi kas
                </button>
                <span className="muted">Sesi lokal terminal ini — posting jurnal sesi tetap milik server (POS web).</span>
              </div>
            ) : null}
            {session ? (
              <div>
                <p className="muted">
                  Sesi {session.id.slice(0, 8)}… dibuka {session.openedAt} · modal{" "}
                  {formatIDR(Number(session.openingCash))}. Tutup sesi bersifat buta: isi
                  hitungan fisik per denominasi — angka harapan tidak ditampilkan.
                </p>
                <div className="grid">
                  {DENOMINATIONS.map((denom) => (
                    <label className="field" key={denom}>
                      {formatIDR(Number(denom))}
                      <input
                        inputMode="numeric"
                        placeholder="0 lembar"
                        value={counts[denom] ?? ""}
                        onChange={(event) =>
                          setCounts((current) => ({ ...current, [denom]: event.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                  <span className="total">Fisik terhitung: {formatIDR(countedPreview)}</span>
                  <button className="primary" onClick={handleCloseSession} disabled={busy}>
                    Tutup sesi (buta)
                  </button>
                </div>
              </div>
            ) : null}
            {lastClosed ? (
              <p className="muted">
                Sesi terakhir ditutup {lastClosed.closedAt}: fisik{" "}
                {formatIDR(Number(lastClosed.countedTotal))} · harapan{" "}
                {formatIDR(Number(lastClosed.expectedTotal))} · selisih{" "}
                {formatIDR(Number(lastClosed.differenceTotal))} — tercatat sebagai fakta
                lokal + intent antrean.
              </p>
            ) : null}
            {sessionCount > 0 ? (
              <p className="muted">{sessionCount} sesi tercatat di DB lokal.</p>
            ) : null}
          </section>

          <section className="panel">
            <h2>Katalog lokal ({info?.productCount ?? 0} produk)</h2>
            <div className="row">
              <label className="field">
                Cari produk lokal
                <input
                  value={catalogSearch}
                  onChange={(event) => {
                    setCatalogSearch(event.currentTarget.value);
                    setCatalogPage(1);
                  }}
                  placeholder="Nama, SKU, atau barcode"
                  autoComplete="off"
                />
              </label>
              <span className="muted">
                Menampilkan {catalog.products.length} dari {catalog.total} hasil
                {catalogLoading ? " · Memuat…" : ""}; katalog lengkap tetap tersedia saat offline.
              </span>
            </div>
            {catalogError ? (
              <p className="status error" role="alert">
                Gagal membaca katalog lokal: {catalogError}
              </p>
            ) : null}
            <div className="row">
              <label className="field">
                Pindai barcode (produk atau kemasan dus)
                <input
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleScan();
                  }}
                  placeholder="Pindai / ketik barcode lalu Enter"
                  autoComplete="off"
                />
              </label>
              <button onClick={() => void handleScan()} disabled={!inTauri || !scanCode.trim()}>
                Tambah dari pindai
              </button>
              <span className="muted">
                Barcode kemasan menambah baris kemasan berharga kemasan; barcode produk
                menambah satuan dasar.
              </span>
            </div>
            {info?.productCount === 0 ? (
              <p className="muted">Belum ada produk di DB lokal. Segarkan snapshot terlebih dahulu.</p>
            ) : catalogLoading && catalog.products.length === 0 ? (
              <p className="muted">Memuat katalog lokal…</p>
            ) : catalogError ? null : catalog.total === 0 ? (
              <p className="muted">Tidak ada produk yang cocok. Ubah kata kunci pencarian.</p>
            ) : (
              <div className="grid">
                {catalog.products.map((product) => (
                  <div key={product.productId} className="product-card">
                    <button
                      className="product"
                      onClick={() => addToCart(product)}
                      disabled={!inTauri}
                    >
                      <span className="name">{product.name}</span>
                      <span className="price">{formatIDR(Number(product.salePrice))}</span>
                      <span className="meta">
                        {product.sku} · Stok {product.stock}
                        {product.unitCode ? ` ${product.unitCode}` : ""}
                      </span>
                    </button>
                    {product.packagings.some((entry) => entry.isActive) ? (
                      <div className="packs">
                        {product.packagings
                          .filter((entry) => entry.isActive)
                          .map((packaging) => (
                            <button
                              key={packaging.packagingId}
                              className="pack-chip"
                              onClick={() => addToCart(product, packaging)}
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

          <section className="panel">
            <h2>Antrean outbox lokal</h2>
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
                      <td className="mono">{item.clientKey.slice(0, 8)}…</td>
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
                Sinkronkan sekarang (Rust)
              </button>
              <span className="muted">
                Drain juga berjalan otomatis di latar; penjualan baru memicunya segera.
              </span>
            </div>
          </section>

          <section className="panel">
            <h2>Printer ESC/POS (Rust)</h2>
            <div className="row">
              <label className="field">
                Host printer (jaringan)
                <input
                  value={printerHost}
                  onChange={(event) => setPrinterHost(event.target.value)}
                  placeholder="192.168.1.50"
                />
              </label>
              <label className="field">
                Port RAW
                <input
                  value={printerPort}
                  onChange={(event) => setPrinterPort(event.target.value)}
                  inputMode="numeric"
                />
              </label>
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
            <div className="row">
              <button className="primary" onClick={handleSavePrinter} disabled={busy || !inTauri}>
                Simpan printer
              </button>
              <button onClick={handleTestPrint} disabled={busy || !inTauri || !printer?.configured}>
                Tes cetak
              </button>
              <span className="muted">
                {printer?.configured
                  ? `Teratur: ${printer.host}:${printer.port} · ${printer.paperWidthMm}mm · antre ${printer.pendingCount} · gagal ${printer.failedCount}${printer.printing ? " · sedang mencetak" : ""}. Struk dibangkitkan Rust dari data lokal + pengaturan cetak snapshot; tendangan laci hanya untuk penjualan tunai.`
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
                        <button onClick={() => handleReprint(job)} disabled={busy || !inTauri}>
                          Cetak ulang
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel">
            <h2>Layar pelanggan (jendela kedua — Langkah 8)</h2>
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
        </div>

        <aside className="panel">
          <h2>Penjualan lokal baru</h2>
          {cart.length === 0 ? (
            <p className="muted">Klik produk di katalog untuk menambah baris.</p>
          ) : (
            <table>
              <tbody>
                {cart.map((line) => (
                  <tr key={lineKey(line)}>
                    <td>
                      {line.product.name}
                      <div>
                        <select
                          value={line.packaging?.packagingId ?? ""}
                          onChange={(event) => {
                            const next =
                              line.product.packagings.find(
                                (entry) => entry.packagingId === event.target.value,
                              ) ?? null;
                            changeLinePackaging(line, next);
                          }}
                          disabled={!inTauri}
                        >
                          <option value="">
                            {line.product.unitCode ?? "Pcs"} (satuan dasar)
                          </option>
                          {line.product.packagings
                            .filter((entry) => entry.isActive)
                            .map((packaging) => (
                              <option
                                key={packaging.packagingId}
                                value={packaging.packagingId}
                              >
                                {packaging.name} (isi {Number(packaging.isi)})
                              </option>
                            ))}
                        </select>
                      </div>
                    </td>
                    <td className="num">
                      ×{line.qty}
                      {line.packaging ? (
                        <div className="muted">
                          = {lineBaseQty(line)} {line.product.unitCode ?? "Pcs"}
                        </div>
                      ) : null}
                    </td>
                    <td className="num">{formatIDR(lineTotal(line))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Metode pembayaran (dari snapshot)</h3>
          <select value={methodId} onChange={(event) => setMethodId(event.target.value)}>
            <option value="">— pilih —</option>
            {methods.map((method) => (
              <option key={method.methodId} value={method.methodId}>
                {method.name} ({method.type})
              </option>
            ))}
          </select>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="total">{formatIDR(cartTotal)}</span>
            <button className="primary" onClick={handleRecordSale} disabled={busy || !inTauri}>
              Simpan penjualan lokal
            </button>
          </div>
          <p className="muted">
            Penjualan tersimpan atomik di SQLite lokal (penjualan + baris + outbox + tugas
            cetak dalam satu transaksi Rust), tertanda sesi kas terbuka bila ada, dan baru
            menjadi penjualan resmi sesudah mesin sinkron Rust mengirimnya dan server
            menerimanya. Struk tercetak lokal tidak menunggu sinkronisasi.
          </p>
        </aside>
      </div>
    </main>
  );
}
