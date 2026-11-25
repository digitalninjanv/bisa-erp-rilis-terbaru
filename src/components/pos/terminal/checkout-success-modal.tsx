"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Printer,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getDesktopPrintBridge, type DesktopPrinterConfig } from "@/lib/pos/desktop-print";
import { receiptHref } from "@/lib/pos/receipt-links";
import { renderReceiptHtml } from "@/lib/pos/receipt-html";
import { formatIDR } from "@/lib/money";
import { getPrinterPreferences } from "@/lib/escpos/printer-connection";
import { getOrCreateDeviceId } from "@/lib/pos-offline";
import { enqueuePrintJob, latestPrintJob, retryPrintJob, PRINT_QUEUE_EVENT } from "@/lib/pos/print-queue";
import { printReceiptViaPopup } from "@/components/pos/receipt-print-window";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrinterConfigModal } from "@/components/pos/printer-modal";

import type { ReceiptData } from "@/lib/escpos/types";

export interface CompletedSaleInfo {
  id: string;
  number: string;
  total: number;
  change: number;
  /** Token cetak pertama dari checkout server; bukan izin cetak ulang. */
  receiptToken?: string;
  offlineReceipt?: ReceiptData;
  /** Snapshot struk online untuk cetak instan pertama (ESC/POS & Electron). */
  instantReceipt?: ReceiptData;
  /** Saat modal dibuka ulang dari tombol nota terakhir di terminal, jangan auto-cetak ulang otomatis. */
  skipAutoPrint?: boolean;
}

export function CheckoutSuccessModal({
  sale,
  companyId,
  userId,
  canReprint,
  onDismiss,
}: {
  sale: CompletedSaleInfo | null;
  companyId: string;
  userId: string;
  canReprint: boolean;
  onDismiss: () => void;
}) {
  const [printStatus, setPrintStatus] = useState<"idle" | "printing" | "success" | "error">("idle");
  const [printMessage, setPrintMessage] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [prefs, setPrefs] = useState(getPrinterPreferences());
  const submittingPrint = useRef(false);
  const desktopSent = useRef(false);
  const desktopUncertain = useRef(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const cancelRetryRef = useRef<HTMLButtonElement>(null);
  const [browserOpened, setBrowserOpened] = useState(false);
  const [desktopConfig, setDesktopConfig] = useState<DesktopPrinterConfig | null>(null);
  const newSaleRef = useRef<HTMLButtonElement>(null);
  const printBtnRef = useRef<HTMLButtonElement>(null);
  const autoPrintedSaleId = useRef<string | null>(null);

  const triggerPrint = useCallback(async (saleId: string, saleNumber: string, retryConfirmed = false) => {
    if (submittingPrint.current) return;
    const receiptSource = sale?.offlineReceipt ?? sale?.instantReceipt;
    const desktop = getDesktopPrintBridge();
    if (desktop) {
      if (desktopSent.current && !canReprint) return;
      if (desktopUncertain.current && !retryConfirmed) {
        setConfirmRetry(true);
        return;
      }
      submittingPrint.current = true;
      setPrintStatus("printing");
      setPrintMessage("Mengirim struk ke printer yang dipilih…");
      try {
        // Cetak pertama memakai HTML lokal agar instan tanpa fetch SSR ulang;
        // cetak ulang tetap memuat /app/pos/nota/[id]?salinan=1 agar tercatat audit.
        const rawHtml =
          !desktopSent.current && receiptSource
            ? renderReceiptHtml({ ...receiptSource, copyIndex: 0 })
            : undefined;
        const result = await desktop.printReceipt(
          saleId,
          desktopSent.current,
          rawHtml,
          retryConfirmed,
          sale?.receiptToken,
        );
        desktopUncertain.current = Boolean(result.uncertain);
        if (result.ok) desktopSent.current = true;
        setPrintStatus(result.ok ? "success" : "error");
        setPrintMessage(result.ok
          ? "Data struk dikirim ke antrean printer. Periksa hasil cetaknya."
          : result.message ?? "Gagal mengirim struk.");
      } catch {
        desktopUncertain.current = true;
        setPrintStatus("error");
        setPrintMessage("Status cetak belum pasti. Periksa printer sebelum mengulang.");
      } finally {
        submittingPrint.current = false;
      }
      return;
    }
    const currentPrefs = getPrinterPreferences();
    setPrefs(currentPrefs);

    if (
      currentPrefs.type === "bluetooth" ||
      currentPrefs.type === "usb" ||
      currentPrefs.type === "serial"
    ) {
      submittingPrint.current = true;
      setPrintStatus("printing");
      setPrintMessage(`Masuk antrean cetak ${currentPrefs.name}...`);
      try {
        const latest = await latestPrintJob(saleId);
        if (latest?.status === "pending" || latest?.status === "printing") {
          setPrintStatus("printing");
          setPrintMessage("Struk masih dalam antrean cetak...");
          return;
        }
        if (latest?.status === "sent" && (!canReprint || sale?.offlineReceipt)) {
          setPrintStatus("success");
          setPrintMessage("Data struk sudah terkirim ke printer.");
          return;
        }
        if (latest?.status === "uncertain" && !retryConfirmed) {
          setConfirmRetry(true);
          setPrintStatus("error");
          setPrintMessage(latest.lastError ?? "Hasil cetak belum pasti.");
          return;
        }
        if (latest?.status === "failed" || latest?.status === "uncertain") {
          await retryPrintJob(saleId);
        } else {
          await enqueuePrintJob({
            saleId,
            saleNumber,
            companyId,
            userId,
            terminalId: getOrCreateDeviceId(),
            kind: latest ? "copy" : sale?.offlineReceipt ? "offline-receipt" : "receipt",
            copyIndex: latest ? undefined : 0,
            printToken: latest ? null : (sale?.receiptToken ?? null),
            receiptData: latest ? sale?.offlineReceipt : receiptSource,
          });
        }
      } catch {
        setPrintStatus("error");
        setPrintMessage("Antrean cetak tidak tersedia. Periksa penyimpanan browser lalu coba lagi.");
      } finally {
        submittingPrint.current = false;
      }
      return;
    }

    // Browser/Kiosk: popup independen. Iframe tersembunyi tidak dipakai
    // karena Chrome mencetak halaman induk POS, bukan nota.
    if (sale?.offlineReceipt) {
      setPrintStatus("error");
      setPrintMessage("Hubungkan printer thermal langsung untuk mencetak struk offline.");
      return;
    }

    if (currentPrefs.type === "kiosk" || currentPrefs.type === "none") {
      setPrintStatus("printing");
      setPrintMessage("Membuka jendela cetak nota...");
      const opened = printReceiptViaPopup(saleId, sale?.receiptToken);
      if (opened) {
        setPrintStatus("idle");
        setBrowserOpened(true);
        setPrintMessage("Jendela cetak dibuka. Selesaikan dialog cetak di jendela tersebut.");
      } else {
        setPrintStatus("error");
        setPrintMessage(
          "Popup cetak diblokir browser. Izinkan pop-up untuk situs ini, lalu klik Cetak nota lagi.",
        );
      }
      return;
    }

    setPrintStatus("idle");
    setPrintMessage("Printer thermal belum terhubung");
  }, [canReprint, companyId, sale, userId]);

  // Status job cetak dipantau dari antrean, bukan dari durasi transport.
  useEffect(() => {
    if (!sale || (getDesktopPrintBridge() && !sale.offlineReceipt)) return;
    let active = true;
    let readSequence = 0;
    const read = async () => {
      const sequence = ++readSequence;
      try {
        const job = await latestPrintJob(sale.id);
        if (!active || sequence !== readSequence || !job) return;
        if (job.status === "pending" || job.status === "printing") {
          setPrintStatus("printing");
          setPrintMessage(
            job.status === "pending" ? "Menunggu antrean cetak..." : `Mengirim ke ${getPrinterPreferences().name}...`,
          );
        } else if (job.status === "sent") {
          setPrintStatus("success");
          setPrintMessage("Data nota terkirim ke printer. Periksa hasil cetaknya.");
        } else if (job.status === "failed" || job.status === "uncertain") {
          setPrintStatus("error");
          setPrintMessage(job.lastError || "Cetak gagal. Periksa printer lalu coba lagi.");
        }
      } catch {
        if (!active || sequence !== readSequence) return;
        setPrintStatus("error");
        setPrintMessage("Antrean cetak tidak dapat dibaca.");
      }
    };
    void read();
    const onQueueChange = () => void read();
    window.addEventListener(PRINT_QUEUE_EVENT, onQueueChange);
    return () => {
      active = false;
      window.removeEventListener(PRINT_QUEUE_EVENT, onQueueChange);
    };
  }, [sale]);

  const isConnected =
    prefs.type === "bluetooth" || prefs.type === "usb" || prefs.type === "serial";
  const desktopAutoPrintable = Boolean(desktopConfig?.printer);
  const printerReady = desktopAutoPrintable || isConnected || prefs.type === "kiosk";
  const isPrinting = printStatus === "printing";
  const printed = printStatus === "success";
  const printLabel =
    browserOpened ? "Dialog cetak dibuka" : printStatus === "error"
      ? "Coba cetak lagi"
      : printed
        ? "Cetak ulang"
        : "Cetak struk";

  // Pantau konfigurasi printer Desktop agar perubahan dari menu Atur printer langsung terbaca.
  useEffect(() => {
    const desktop = getDesktopPrintBridge();
    if (!desktop) return;
    let active = true;
    void desktop.getPrinterConfig?.().then((cfg) => {
      if (active && cfg) setDesktopConfig(cfg);
    }).catch(() => undefined);
    const unsub = desktop.onPrinterConfigChanged?.((cfg) => {
      if (active) setDesktopConfig(cfg);
    });
    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  // Auto-cetak pasca bayar bila printer terkonfigurasi dan toggle aktif.
  useEffect(() => {
    if (!sale || sale.skipAutoPrint || autoPrintedSaleId.current === sale.id) return;
    autoPrintedSaleId.current = sale.id;
    let active = true;
    const desktop = getDesktopPrintBridge();
    if (desktop) {
      void desktop.getPrinterConfig?.()
        .then((cfg) => {
          if (!active) return;
          if (cfg) setDesktopConfig(cfg);
          if (cfg?.printer && cfg?.autoPrint !== false) {
            void triggerPrint(sale.id, sale.number);
          }
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }
    const currentPrefs = getPrinterPreferences();
    const webReady =
      currentPrefs.type === "bluetooth" ||
      currentPrefs.type === "usb" ||
      currentPrefs.type === "serial" ||
      (currentPrefs.type === "kiosk" && !sale.offlineReceipt);
    if (webReady && currentPrefs.autoPrint !== false) {
      void Promise.resolve().then(() => {
        if (active) void triggerPrint(sale.id, sale.number);
      });
    }
    return () => {
      active = false;
    };
  }, [sale, triggerPrint]);

  // Ergonomi kasir: fokus Enter ke "Transaksi baru" setelah cetak berjalan/selesai
  // atau bila belum ada printer; bila printer siap namun auto-cetak dimatikan,
  // fokuskan ke "Cetak struk" agar Enter tidak melewati cetak struk.
  useEffect(() => {
    if (!sale || configOpen) return;
    if (printed || isPrinting || browserOpened || !printerReady) {
      newSaleRef.current?.focus();
    } else if (printStatus === "idle") {
      printBtnRef.current?.focus();
    }
  }, [sale, printed, isPrinting, browserOpened, printerReady, printStatus, configOpen]);

  const handleDismiss = () => {
    setPrintStatus("idle");
    setBrowserOpened(false);
    setConfirmRetry(false);
    setPrintMessage("");
    onDismiss();
  };

  return (
    <>
      <Dialog
        open={Boolean(sale)}
        disablePointerDismissal
        onOpenChange={(open) => !open && handleDismiss()}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-md gap-0 overflow-hidden p-0"
        >
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Tutup dialog transaksi berhasil"
            className="absolute right-2 top-2 z-10 grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </button>

          <div className="p-5 pb-4 sm:p-6 sm:pb-4">
            <DialogHeader className="flex flex-row items-center gap-3 space-y-0 pr-12 text-left">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tone-teal-soft text-tone-teal">
                <CheckCircle2 aria-hidden="true" className="size-6" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-xl font-semibold leading-tight text-foreground">
                  {sale?.offlineReceipt ? "Tersimpan di perangkat" : "Transaksi berhasil"}
                </DialogTitle>
                <p className="mt-1 truncate text-sm text-muted-foreground">{sale?.offlineReceipt ? "Menunggu sinkronisasi · " : "Nota "}{sale?.number}</p>
              </div>
            </DialogHeader>

            <section
              aria-label="Ringkasan pembayaran"
              className="mt-4 rounded-lg border border-border bg-background p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="text-sm text-muted-foreground">Total belanja</span>
                <strong className="num text-right text-xl font-bold text-foreground">
                  {formatIDR(sale?.total ?? 0)}
                </strong>
              </div>
              {sale && sale.change > 0 ? (
                <div className="mt-3 flex items-center justify-between gap-4 border-t border-border pt-3">
                  <span className="text-sm font-semibold text-foreground">Kembalian</span>
                  <strong className="num text-right text-3xl font-extrabold tracking-tight text-tone-teal">
                    {formatIDR(sale.change)}
                  </strong>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm font-semibold text-tone-teal">
                  <CheckCircle2 aria-hidden="true" className="size-4" />{" "}
                  {sale?.offlineReceipt ? "Tersimpan lokal · Lunas" : "Uang Pas · Transaksi tersimpan"}
                </div>
              )}
            </section>

            <section aria-label="Cetak nota" className="mt-4 space-y-3">
              <div aria-live="polite" className="flex items-start gap-2 text-sm">
                {printStatus === "printing" ? (
                  <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                ) : printStatus === "success" ? (
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-teal" />
                ) : printStatus === "error" ? (
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tone-red" />
                ) : (
                  <Printer aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <p className={printStatus === "error" ? "text-tone-red" : "text-muted-foreground"}>
                  {printMessage ||
                    (desktopConfig
                      ? desktopConfig.printer
                        ? `Printer Desktop: ${desktopConfig.printer} (${desktopConfig.width} mm)`
                        : "Printer Desktop belum dipilih — klik \"Atur printer\" di bawah."
                      : isConnected
                        ? `Printer dipilih: ${prefs.name}`
                        : "Struk belum dicetak. Cetak lewat dialog browser atau atur printer thermal.")}
                </p>
              </div>

              <button
                type="button"
                ref={printBtnRef}
                onClick={() => sale && void triggerPrint(sale.id, sale.number)}
                disabled={isPrinting || browserOpened || (printed && (!canReprint || Boolean(sale?.offlineReceipt)))}
                className={
                  printed
                    ? "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
                    : "inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-tone-teal px-4 text-base font-semibold text-white transition-colors hover:bg-tone-teal/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                }
              >
                {isPrinting ? (
                  <RefreshCw aria-hidden="true" className="size-5 animate-spin" />
                ) : (
                  <Printer aria-hidden="true" className="size-5" />
                )}
                {isPrinting ? "Mencetak…" : printLabel}
              </button>

              {sale && !sale.offlineReceipt && printStatus === "error" && (
                <Link
                  href={receiptHref(sale.id, { printToken: sale.receiptToken })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-3 inline-flex min-h-8 items-center text-sm text-primary underline"
                >
                  Buka nota untuk cetak lewat browser
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  const desktop = getDesktopPrintBridge();
                  if (desktop && !sale?.offlineReceipt) {
                    void desktop.openPrinterSettings().catch(() => toast.error("Pengaturan printer tidak bisa dibuka."));
                    return;
                  }
                  setConfigOpen(true);
                }}
                className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings2 aria-hidden="true" className="size-4" /> Atur printer
              </button>
            </section>
          </div>

          <div className="space-y-3 border-t border-border bg-muted/30 p-5 sm:p-6">
            <button
              type="button"
              ref={newSaleRef}
              onClick={handleDismiss}
              className={
                printed || isPrinting || browserOpened || !printerReady
                  ? "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-tone-teal px-4 text-base font-semibold text-white transition-colors hover:bg-tone-teal/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  : "flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-base font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              }
            >
              <span>
                {printed || isPrinting || browserOpened || !printerReady
                  ? "Transaksi baru"
                  : "Lanjut tanpa cetak"}
              </span>
              <span aria-label="Enter" className="rounded bg-black/10 px-1.5 py-0.5 text-xs font-medium">
                {printed || isPrinting || browserOpened || !printerReady ? "Enter ↵" : "Esc"}
              </span>
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
              {sale && !sale.offlineReceipt ? (
                <Link
                  href={receiptHref(sale.id, { printToken: sale.receiptToken })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Buka detail nota <ExternalLink aria-hidden="true" className="size-3.5" />
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted-foreground">Enter: aksi utama · Esc: tutup</span>
            </div>
          </div>
        </DialogContent>
        <Dialog open={confirmRetry} onOpenChange={setConfirmRetry}>
          <DialogContent initialFocus={cancelRetryRef} showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Kirim ulang struk?</DialogTitle>
            </DialogHeader>
            <DialogDescription>
              Hasil cetak sebelumnya belum pasti. Periksa printer sebelum mengirim ulang.
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <button type="button" ref={cancelRetryRef} onClick={() => setConfirmRetry(false)}
                className="h-10 rounded-md border px-3 text-sm font-medium">
                Batal
              </button>
              <button type="button" onClick={() => {
                setConfirmRetry(false);
                if (sale) void triggerPrint(sale.id, sale.number, true);
              }} className="h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                Kirim ulang
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </Dialog>

      {configOpen ? (
        <PrinterConfigModal
          onClose={() => {
            setConfigOpen(false);
            const updated = getPrinterPreferences();
            setPrefs(updated);
          }}
        />
      ) : null}
    </>
  );
}
