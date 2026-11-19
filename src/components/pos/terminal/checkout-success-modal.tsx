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
import { formatIDR } from "@/lib/money";
import { getPrinterPreferences } from "@/lib/escpos/printer-connection";
import { getOrCreateDeviceId } from "@/lib/pos-offline";
import { enqueuePrintJob, latestPrintJob, retryPrintJob } from "@/lib/pos/print-queue";
import { printReceiptViaPopup } from "@/components/pos/receipt-print-window";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrinterConfigModal } from "@/components/pos/printer-modal";

export interface CompletedSaleInfo {
  id: string;
  number: string;
  total: number;
  change: number;
}

export function CheckoutSuccessModal({
  sale,
  companyId,
  onDismiss,
}: {
  sale: CompletedSaleInfo | null;
  companyId: string;
  onDismiss: () => void;
}) {
  const [printStatus, setPrintStatus] = useState<"idle" | "printing" | "success" | "error">("idle");
  const [printMessage, setPrintMessage] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [prefs, setPrefs] = useState(getPrinterPreferences());
  const newSaleRef = useRef<HTMLButtonElement>(null);

  const triggerPrint = useCallback(async (saleId: string, saleNumber: string, forceBrowser = false) => {
    const currentPrefs = getPrinterPreferences();
    setPrefs(currentPrefs);

    if (
      !forceBrowser &&
      (currentPrefs.type === "bluetooth" ||
        currentPrefs.type === "usb" ||
        currentPrefs.type === "serial")
    ) {
      setPrintStatus("printing");
      setPrintMessage(`Masuk antrean cetak ${currentPrefs.name}...`);
      try {
        const latest = await latestPrintJob(saleId);
        if (latest?.status === "pending" || latest?.status === "printing") {
          setPrintStatus("printing");
          setPrintMessage("Struk masih dalam antrean cetak...");
          return;
        }
        if (latest?.status === "failed" || latest?.status === "uncertain") {
          await retryPrintJob(saleId);
        } else {
          await enqueuePrintJob({
            saleId,
            saleNumber,
            companyId,
            terminalId: getOrCreateDeviceId(),
            kind: latest ? "copy" : "receipt",
          });
        }
      } catch {
        setPrintStatus("error");
        setPrintMessage("Antrean cetak tidak tersedia. Periksa penyimpanan browser lalu coba lagi.");
      }
      return;
    }

    // Browser/Kiosk: popup independen. Iframe tersembunyi tidak dipakai
    // karena Chrome mencetak halaman induk POS, bukan nota.
    if (currentPrefs.type === "kiosk" || forceBrowser) {
      setPrintStatus("printing");
      setPrintMessage("Membuka jendela cetak nota...");
      const opened = printReceiptViaPopup(saleId);
      if (opened) {
        setPrintStatus("success");
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
  }, [companyId]);

  // Status job cetak dipantau dari antrean, bukan dari durasi transport.
  useEffect(() => {
    if (!sale) return;
    let active = true;
    const read = async () => {
      try {
        const job = await latestPrintJob(sale.id);
        if (!active || !job) return;
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
        if (!active) return;
        setPrintStatus("error");
        setPrintMessage("Antrean cetak tidak dapat dibaca.");
      }
    };
    void read();
    const interval = window.setInterval(() => void read(), 700);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [sale]);

  // Auto-print hanya untuk printer thermal langsung (Bluetooth/USB/Serial).
  // Browser/kiosk memerlukan klik "Cetak nota" agar popup tidak diblokir
  // dan Chrome tidak salah mencetak halaman POS.
  useEffect(() => {
    if (!sale) return;
    const currentPrefs = getPrinterPreferences();
    const directPrinter =
      currentPrefs.type === "bluetooth" ||
      currentPrefs.type === "usb" ||
      currentPrefs.type === "serial";
    if (currentPrefs.autoPrintOnCheckout && directPrinter) {
      const timeout = window.setTimeout(() => void triggerPrint(sale.id, sale.number), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [sale, triggerPrint]);

  const isConnected =
    prefs.type === "bluetooth" || prefs.type === "usb" || prefs.type === "serial";
  const isPrinting = printStatus === "printing";
  const printed = printStatus === "success";
  const autoPrintExpected =
    prefs.autoPrintOnCheckout &&
    (prefs.type === "bluetooth" || prefs.type === "usb" || prefs.type === "serial");
  const printLabel =
    printStatus === "error"
      ? "Coba cetak lagi"
      : printed
        ? "Cetak ulang"
        : "Cetak nota";

  // Sesudah struk tercetak, aksi utama berpindah ke transaksi berikutnya.
  useEffect(() => {
    if (printed && !configOpen) newSaleRef.current?.focus();
  }, [printed, configOpen]);

  const handleDismiss = () => {
    setPrintStatus("idle");
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
                  Transaksi berhasil
                </DialogTitle>
                <p className="mt-1 truncate text-sm text-muted-foreground">Nota {sale?.number}</p>
              </div>
            </DialogHeader>

            <section
              aria-label="Ringkasan pembayaran"
              className="mt-4 rounded-lg border border-border bg-background p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="text-sm text-muted-foreground">Total belanja</span>
                <strong className="num text-right text-lg font-semibold text-foreground">
                  {formatIDR(sale?.total ?? 0)}
                </strong>
              </div>
              {sale && sale.change > 0 ? (
                <div className="mt-3 flex items-center justify-between gap-4 border-t border-border pt-3">
                  <span className="text-sm font-medium text-foreground">Kembalian</span>
                  <strong className="num text-right text-2xl font-bold text-tone-teal">
                    {formatIDR(sale.change)}
                  </strong>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm font-medium text-tone-teal">
                  <CheckCircle2 aria-hidden="true" className="size-4" /> Pembayaran lunas
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
                    (isConnected
                      ? `Printer siap: ${prefs.name}`
                      : "Struk belum dicetak. Cetak lewat dialog browser atau atur printer thermal.")}
                </p>
              </div>

              <button
                type="button"
                onClick={() => sale && void triggerPrint(sale.id, sale.number, prefs.type === "none")}
                disabled={isPrinting}
                autoFocus={!autoPrintExpected}
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

              <button
                type="button"
                onClick={() => setConfigOpen(true)}
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
              autoFocus={printed || autoPrintExpected}
              className={
                printed || autoPrintExpected
                  ? "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-tone-teal px-4 text-base font-semibold text-white transition-colors hover:bg-tone-teal/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  : "flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-base font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              }
            >
              <span>Transaksi baru</span>
              <span aria-label="Enter" className="rounded bg-black/10 px-1.5 py-0.5 text-xs font-medium">
                Enter ↵
              </span>
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
              {sale ? (
                <Link
                  href={`/app/pos/nota/${sale.id}`}
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
