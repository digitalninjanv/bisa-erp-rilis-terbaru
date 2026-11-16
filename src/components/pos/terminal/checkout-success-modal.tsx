"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CheckCircle2, Printer, ArrowRight, ExternalLink, RefreshCw, AlertCircle, Settings2 } from "lucide-react";
import { formatIDR } from "@/lib/money";
import { getSaleReceiptDataAction } from "@/server/actions/pos-receipt";
import { formatReceiptToEscPos } from "@/lib/escpos/receipt-template";
import { getPrinterPreferences, sendEscPosToPrinter } from "@/lib/escpos/printer-connection";
import { printReceiptViaHiddenIframe } from "@/components/pos/hidden-iframe-printer";
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
  onDismiss,
}: {
  sale: CompletedSaleInfo | null;
  onDismiss: () => void;
}) {
  const [printStatus, setPrintStatus] = useState<"idle" | "printing" | "success" | "error">("idle");
  const [printMessage, setPrintMessage] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [prefs, setPrefs] = useState(getPrinterPreferences());

  const triggerPrint = useCallback(async (saleId: string, forceBrowser = false) => {
    const currentPrefs = getPrinterPreferences();
    setPrefs(currentPrefs);

    // 1. Jika terhubung ke Direct Thermal Printer (Bluetooth / USB / Serial) -> 100% Silent, Tanpa Dialog!
    if (
      currentPrefs.type === "bluetooth" ||
      currentPrefs.type === "usb" ||
      currentPrefs.type === "serial"
    ) {
      setPrintStatus("printing");
      setPrintMessage(`Mengirim data ke ${currentPrefs.name}...`);
      try {
        const res = await getSaleReceiptDataAction(saleId);
        if (!res.ok) {
          throw new Error(res.message || "Gagal mengambil data nota.");
        }

        const escposBytes = formatReceiptToEscPos({
          ...res.data,
          paperWidth: currentPrefs.paperWidth,
          openCashDrawer: currentPrefs.openCashDrawer,
          cutPaper: currentPrefs.cutPaper,
        });

        const printRes = await sendEscPosToPrinter(escposBytes);
        if (printRes.ok) {
          setPrintStatus("success");
          setPrintMessage(`Data nota terkirim ke ${currentPrefs.name}. Periksa hasil cetaknya.`);
        } else {
          setPrintStatus("error");
          setPrintMessage(printRes.message || "Gagal mencetak ke printer thermal.");
        }
      } catch (err: any) {
        setPrintStatus("error");
        setPrintMessage(err.message || "Gagal mencetak nota thermal.");
      }
      return;
    }

    // 2. Jika kasir menyetel Kiosk Mode atau secara sadar klik "Cetak via Browser"
    if (currentPrefs.type === "kiosk" || forceBrowser) {
      setPrintStatus("printing");
      setPrintMessage("Mencetak via antrean browser...");
      try {
        const ok = await printReceiptViaHiddenIframe(saleId);
        if (ok) {
          setPrintStatus("success");
          setPrintMessage("Permintaan cetak dikirim ke browser. Periksa dialog atau printer default.");
        } else {
          setPrintStatus("error");
          setPrintMessage("Printer browser tidak merespons.");
        }
      } catch {
        setPrintStatus("error");
        setPrintMessage("Gagal memicu cetak printer.");
      }
      return;
    }

    // 3. Jika belum terhubung printer sama sekali (prefs.type === "none"):
    // JANGAN memicu dialog browser secara otomatis agar kasir tidak terganggu!
    setPrintStatus("idle");
    setPrintMessage("Printer thermal belum terhubung");
  }, []);

  // Hanya jalankan auto-print bila printer thermal sudah terhubung atau mode kiosk aktif
  useEffect(() => {
    if (!sale) return;
    const currentPrefs = getPrinterPreferences();
    setPrefs(currentPrefs);
    if (currentPrefs.autoPrintOnCheckout && currentPrefs.type !== "none") {
      void triggerPrint(sale.id);
    }
  }, [sale, triggerPrint]);

  // Keyboard shortcut: Tekan Enter, Space, atau Escape untuk langsung mulai transaksi baru
  useEffect(() => {
    if (!sale || configOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sale, configOpen, onDismiss]);

  const isConnected =
    prefs.type === "bluetooth" || prefs.type === "usb" || prefs.type === "serial";

  return (
    <>
      <Dialog open={Boolean(sale)} onOpenChange={(open) => !open && onDismiss()}>
        <DialogContent className="max-w-md p-6 space-y-4">
          <DialogHeader className="flex flex-row items-center gap-3 space-y-0 text-left">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tone-teal-soft text-tone-teal">
              <CheckCircle2 className="size-6" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold leading-tight text-foreground">
                Transaksi Selesai
              </DialogTitle>
              <p className="num text-[12px] text-muted-foreground">{sale?.number}</p>
            </div>
          </DialogHeader>

          {/* Kotak Kembalian Utama (Sangat Jelas & Kontras untuk Kasir) */}
          <div className="rounded-lg border border-border/70 bg-muted/40 p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {sale && sale.change > 0 ? "Uang Kembalian" : "Status Pembayaran"}
            </p>
            <div className="mt-1">
              {sale && sale.change > 0 ? (
                <span className="num text-[32px] font-extrabold tracking-tight text-tone-teal">
                  {formatIDR(sale.change)}
                </span>
              ) : (
                <span className="text-[24px] font-bold text-foreground">
                  LUNAS (Uang Pas)
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
              <span>Total: <strong className="num text-foreground">{formatIDR(sale?.total ?? 0)}</strong></span>
              {sale && sale.change > 0 ? (
                <>
                  <span>·</span>
                  <span>Diterima: <strong className="num text-foreground">{formatIDR(sale.total + sale.change)}</strong></span>
                </>
              ) : null}
            </div>
          </div>

          {/* Status Cetak Nota */}
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2 text-[12px]">
            <div className="flex items-center gap-2">
              {printStatus === "printing" ? (
                <RefreshCw className="size-4 animate-spin text-primary" />
              ) : printStatus === "success" ? (
                <CheckCircle2 className="size-4 text-tone-teal" />
              ) : printStatus === "error" ? (
                <AlertCircle className="size-4 text-tone-red" />
              ) : isConnected ? (
                <Printer className="size-4 text-tone-teal" />
              ) : (
                <Printer className="size-4 text-muted-foreground" />
              )}
              <span className="text-muted-foreground truncate max-w-[200px]">
                {printMessage || (isConnected ? `Siap (${prefs.name})` : "Printer belum terhubung")}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!isConnected ? (
                <button
                  type="button"
                  onClick={() => setConfigOpen(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  <Settings2 className="size-3" /> Hubungkan
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => sale && void triggerPrint(sale.id)}
                  disabled={printStatus === "printing"}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                >
                  <Printer className="size-3" /> Cetak ulang
                </button>
              )}
            </div>
          </div>

          {/* Tombol Aksi */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={onDismiss}
              autoFocus
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-tone-teal text-sm font-semibold text-white shadow-sm transition-colors hover:bg-tone-teal/90"
            >
              <span>Transaksi Baru</span>
              <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                Enter ↵
              </span>
              <ArrowRight className="size-4" />
            </button>

            <div className="flex items-center justify-between pt-1 text-[11px]">
              <div className="flex items-center gap-3">
                {sale ? (
                  <Link
                    href={`/app/pos/nota/${sale.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Buka nota <ExternalLink className="size-3" />
                  </Link>
                ) : null}
                {sale && !isConnected ? (
                  <button
                    type="button"
                    onClick={() => void triggerPrint(sale.id, true)}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Cetak browser (PDF)
                  </button>
                ) : null}
              </div>
              <span className="text-muted-foreground">Tekan Space / Esc</span>
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
            if (sale && (updated.type === "bluetooth" || updated.type === "usb")) {
              void triggerPrint(sale.id);
            }
          }}
        />
      ) : null}
    </>
  );
}
