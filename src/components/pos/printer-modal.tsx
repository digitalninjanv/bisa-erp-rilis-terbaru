"use client";

import { useState, useEffect } from "react";
import {
  Printer,
  Bluetooth,
  Usb,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Scissors,
  DollarSign,
  Play,
  Cpu,
  Info,
  Terminal,
  AlertTriangle,
} from "lucide-react";
import {
  getPrinterPreferences,
  savePrinterPreferences,
  connectBluetoothPrinter,
  connectDirectUsbPrinter,
  connectSerialPrinter,
  disconnectActivePrinter,
  printTestReceipt,
  isBluetoothSupported,
  isUsbSupported,
  isSerialSupported,
  isPrinterConnected,
  subscribePrinterStatus,
  initPrinterAutoReconnect,
} from "@/lib/escpos/printer-connection";
import {
  DEFAULT_PRINTER_PREFERENCES,
  SERIAL_BAUD_RATES,
  type PaperWidth,
  type PrinterPreferences,
  type SerialBaudRate,
} from "@/lib/escpos/types";
import { toast } from "sonner";
import { getDesktopPrintBridge, type DesktopPrinterConfig } from "@/lib/pos/desktop-print";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function PrinterStatusButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  // Server dan render awal browser harus memakai nilai yang sama; preferensi
  // tersimpan di localStorage baru dibaca setelah komponen terhidrasi.
  const [prefs, setPrefs] = useState<PrinterPreferences>(DEFAULT_PRINTER_PREFERENCES);
  const [connected, setConnected] = useState(false);
  const [desktopConfig, setDesktopConfig] = useState<DesktopPrinterConfig | null>(null);

  useEffect(() => {
    const desktop = getDesktopPrintBridge();
    if (desktop) {
      let active = true;
      void desktop.getPrinterConfig?.().then((cfg) => {
        if (active && cfg) setDesktopConfig(cfg);
      }).catch(() => undefined);
      const unsubDesktop = desktop.onPrinterConfigChanged?.((cfg) => {
        if (active) setDesktopConfig(cfg);
      });
      return () => {
        active = false;
        unsubDesktop?.();
      };
    }

    // Inisialisasi auto-reconnect dan event listeners browser
    const cleanupAuto = initPrinterAutoReconnect();
    const unsubscribe = subscribePrinterStatus((isConnected) => {
      setConnected(isConnected);
      setPrefs(getPrinterPreferences());
    });

    return () => {
      cleanupAuto();
      unsubscribe();
    };
  }, []);

  const ready = desktopConfig ? Boolean(desktopConfig.printer) : connected;
  const labelText = desktopConfig
    ? desktopConfig.printer
      ? `${desktopConfig.printer} (${desktopConfig.width} mm)`
      : "Pilih Printer Kasir"
    : connected
      ? `${prefs.name} (${prefs.paperWidth})`
      : prefs.type === "kiosk"
        ? "Printer Sistem"
        : "Hubungkan Printer Kasir";
  const ariaText = desktopConfig
    ? desktopConfig.printer
      ? `Printer desktop siap: ${desktopConfig.printer} (${desktopConfig.width} mm)`
      : "Pilih printer kasir desktop"
    : connected
      ? `Printer siap: ${prefs.name} (${prefs.paperWidth})`
      : prefs.type === "kiosk"
        ? "Mode cetak sistem aktif"
        : "Hubungkan printer kasir";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const desktop = getDesktopPrintBridge();
          if (desktop) {
            void desktop.openPrinterSettings().catch(() => toast.error("Pengaturan printer tidak bisa dibuka."));
          } else {
            setOpen(true);
          }
        }}
        aria-label={ariaText}
        className={cn(
          compact
            ? "grid size-11 place-items-center rounded-md border transition-colors"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
          ready
            ? "border-tone-teal/40 bg-tone-teal-soft/40 text-tone-teal hover:bg-tone-teal-soft/60"
            : "border-border bg-card text-foreground hover:bg-muted",
        )}
        title={ariaText}
      >
        <span
          className={`size-2 rounded-full ${
            ready ? "bg-tone-teal animate-pulse" : "bg-amber-500 animate-ping"
          }`}
        />
        <Printer className={`size-3.5 ${ready ? "text-tone-teal" : "text-amber-600 dark:text-amber-400"}`} />
        <span className={compact ? "sr-only" : "hidden sm:inline"}>
          {labelText}
        </span>
      </button>

      {open ? <PrinterConfigModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function PrinterConfigModal({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<PrinterPreferences>(getPrinterPreferences());
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tab, setTab] = useState<"thermal" | "kiosk">("thermal");
  // Nilai awal dihitung sekali saat mount; tidak ada setState di efek.
  const [isSecure] = useState(
    () => typeof window === "undefined" || Boolean(window.isSecureContext),
  );
  const [connected, setConnected] = useState(isPrinterConnected());

  const bluetoothOk = isBluetoothSupported();
  const usbOk = isUsbSupported();
  const serialOk = isSerialSupported();

  useEffect(() => {
    return subscribePrinterStatus((status) => {
      setConnected(status);
      setPrefs(getPrinterPreferences());
    });
  }, []);

  async function handleConnectBluetooth() {
    setConnecting(true);
    const res = await connectBluetoothPrinter();
    setConnecting(false);
    if (res.ok) {
      toast.success(`Koneksi aktif ke ${res.name}`);
      setPrefs(getPrinterPreferences());
    } else {
      toast.error(res.message);
    }
  }

  async function handleConnectDirectUsb() {
    setConnecting(true);
    const res = await connectDirectUsbPrinter();
    setConnecting(false);
    if (res.ok) {
      toast.success(`Koneksi aktif ke ${res.name}`);
      setPrefs(getPrinterPreferences());
    } else {
      toast.error(res.message);
    }
  }

  async function handleConnectSerial() {
    setConnecting(true);
    const res = await connectSerialPrinter();
    setConnecting(false);
    if (res.ok) {
      toast.success(`Koneksi aktif ke ${res.name}`);
      setPrefs(getPrinterPreferences());
    } else {
      toast.error(res.message);
    }
  }

  function handleDisconnect() {
    disconnectActivePrinter();
    setPrefs(getPrinterPreferences());
    toast.success("Koneksi printer diputuskan.");
  }

  async function handleTestPrint() {
    setTesting(true);
    const res = await printTestReceipt();
    setTesting(false);
    if (res.ok) {
      toast.success("Data uji coba terkirim. Periksa apakah struk keluar dari printer.");
    } else {
      toast.error(res.message || "Gagal mencetak halaman uji coba.");
    }
  }

  function handleTestKioskPrint() {
    const win = window.open("", "_blank", "width=350,height=500");
    if (!win) {
      toast.error("Jendela cetak diblokir. Izinkan pop-up untuk situs ini lalu uji lagi.");
      return;
    }
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Uji Coba Cetak Kiosk - BISA ERP</title>
          <style>
            @page { margin: 0; size: auto; }
            body { font-family: monospace; font-size: 12px; margin: 8px; text-align: center; }
            .bold { font-weight: bold; }
            .line { border-top: 1px dashed #000; margin: 6px 0; }
          </style>
        </head>
        <body>
          <div class="bold">BISA ERP POS</div>
          <div>UJI COBA CETAK KIOSK</div>
          <div class="line"></div>
          <div style="text-align: left;">
            <div>Mode : Cetak melalui driver OS</div>
            <div>Waktu  : ${new Date().toLocaleTimeString("id-ID")}</div>
            <div>Driver : Windows / OS Default</div>
          </div>
          <div class="line"></div>
          <div>Jika browser dijalankan dengan flag --kiosk-printing, struk ini langsung tercetak otomatis tanpa dialog.</div>
          <br/><br/>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 300);
  }

  function updatePaperWidth(paperWidth: PaperWidth) {
    const updated = savePrinterPreferences({ paperWidth });
    setPrefs(updated);
  }

  function toggleAutoDrawer() {
    const updated = savePrinterPreferences({ openCashDrawer: !prefs.openCashDrawer });
    setPrefs(updated);
  }

  function toggleAutoCut() {
    const updated = savePrinterPreferences({ cutPaper: !prefs.cutPaper });
    setPrefs(updated);
  }

  function toggleAutoPrint() {
    const updated = savePrinterPreferences({ autoPrint: prefs.autoPrint === false });
    setPrefs(updated);
  }

  function updateBaudRate(serialBaudRate: SerialBaudRate) {
    const updated = savePrinterPreferences({ serialBaudRate });
    setPrefs(updated);
  }

  const isKioskConfigured = prefs.type === "kiosk";
  const isConnected = connected;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        {/* Header Modal */}
        <DialogHeader className="border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Printer className="size-4 text-primary" />
            <DialogTitle className="text-sm font-semibold text-foreground">
              Pengaturan Printer Thermal Kasir
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Tab Pilihan Mode */}
        <div className="flex border-b border-border bg-muted/40 px-5 pt-2">
          <button
            type="button"
            onClick={() => setTab("thermal")}
            className={`pb-2.5 text-[12px] font-semibold border-b-2 transition-colors ${
              tab === "thermal"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Direct Thermal (USB / Serial / Bluetooth)
          </button>
          <button
            type="button"
            onClick={() => setTab("kiosk")}
            className={`ml-5 pb-2.5 text-[12px] font-semibold border-b-2 transition-colors ${
              tab === "kiosk"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Kiosk Mode (Windows / Driver OS)
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[68vh] overflow-y-auto">
          {tab === "thermal" ? (
            <>
              {/* Status Koneksi Saat Ini */}
              <div
                className={`rounded-lg border p-3.5 ${
                  isConnected
                    ? "border-tone-teal/40 bg-tone-teal-soft/30"
                    : "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {isConnected || isKioskConfigured ? (
                      <CheckCircle2 className="size-5 text-tone-teal shrink-0" />
                    ) : (
                      <AlertCircle className="size-5 text-amber-600 dark:text-amber-400 shrink-0" />
                    )}
                    <div>
                      <p className="text-[12px] font-semibold text-foreground">
                        {isKioskConfigured
                          ? "Mode Kiosk aktif"
                          : isConnected
                            ? `Terhubung: ${prefs.name}`
                            : prefs.type !== "none"
                              ? `Belum tersambung: ${prefs.name}`
                              : "Belum Ada Printer Terhubung"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {isKioskConfigured
                          ? "Cetak melalui dialog/browser dan printer default sistem; koneksi perangkat tidak dipantau."
                          : isConnected
                            ? `Mode ESC/POS (${prefs.type.toUpperCase()}) · Kertas ${prefs.paperWidth} · koneksi aktif`
                            : prefs.type !== "none"
                              ? "Printer tersimpan tetapi koneksi aktif tidak ditemukan. Sambungkan ulang sebelum transaksi berikutnya."
                              : "Pilih metode koneksi di bawah untuk menghubungkan printer kasir Anda."}
                      </p>
                    </div>
                  </div>

                  {isConnected || isKioskConfigured ? (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      className="rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                    >
                      Putuskan
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Browser hardware APIs require a secure origin. */}
              {!isSecure ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-50/70 p-3.5 text-[11px] dark:bg-amber-950/30 space-y-2 text-foreground">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-amber-800 dark:text-amber-300">
                        Koneksi aman diperlukan
                      </p>
                      <p className="text-muted-foreground leading-relaxed">
                        Koneksi USB, Bluetooth, dan Serial memerlukan HTTPS. Minta administrator mengaktifkan HTTPS; jangan mengubah flag keamanan browser.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">Printer Wi‑Fi/LAN:</strong> POS web tidak dapat membuka soket TCP mentah ke printer jaringan. Gunakan aplikasi Bisa POS Desktop untuk cetak senyap lewat printer yang terpasang di sistem operasi, atau aktifkan Mode Kiosk dengan printer default OS.
              </div>

              {/* 3 Opsi Pilihan Koneksi Perangkat Keras */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Pilih Jalur Koneksi Printer
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* USB Langsung */}
                  <button
                    type="button"
                    onClick={() => {
                      void handleConnectDirectUsb();
                    }}
                    disabled={connecting}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Usb className="size-5 text-primary" />
                    <span className="text-[12px] font-semibold text-foreground">Kabel USB</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      WebUSB (Epson, Xprinter, Panda)
                    </span>
                    {!isSecure && !usbOk ? (
                      <span className="mt-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                        Perlu HTTPS
                      </span>
                    ) : null}
                  </button>

                  {/* Serial / Virtual COM */}
                  <button
                    type="button"
                    onClick={() => {
                      void handleConnectSerial();
                    }}
                    disabled={connecting}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Cpu className="size-5 text-primary" />
                    <span className="text-[12px] font-semibold text-foreground">Serial / COM</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      COM, USB-RS232, atau Bluetooth SPP yang sudah dipasangkan di OS
                    </span>
                    {!isSecure && !serialOk ? (
                      <span className="mt-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                        Perlu HTTPS
                      </span>
                    ) : null}
                  </button>

                  {/* Bluetooth */}
                  <button
                    type="button"
                    onClick={() => {
                      void handleConnectBluetooth();
                    }}
                    disabled={connecting}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Bluetooth className="size-5 text-primary" />
                    <span className="text-[12px] font-semibold text-foreground">Bluetooth</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      BLE Portabel 58mm/80mm baterai
                    </span>
                    {!isSecure && !bluetoothOk ? (
                      <span className="mt-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                        Perlu HTTPS
                      </span>
                    ) : null}
                  </button>
                </div>
              </div>

              {/* Panduan Singkat Cara Menghubungkan */}
              <div className="rounded-lg border border-border/80 bg-muted/20 p-3 text-[11px] space-y-1.5 text-muted-foreground">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Info className="size-3.5 text-primary" />
                  <span>Petunjuk Pemasangan Cepat:</span>
                </div>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Nyalakan printer dan pastikan kertas thermal terpasang rapi.</li>
                  <li>Colokkan printer USB; untuk Bluetooth BLE, nyalakan printer; untuk Bluetooth Classic SPP, pasangkan printer lebih dulu di pengaturan Bluetooth komputer.</li>
                  <li>Pilih tombol koneksi yang sesuai. Perangkat SPP dipilih dari tombol Serial / COM sesuai baud rate printer (umumnya 9600 atau 115200 bps).</li>
                  <li>
                    Klik <strong>&ldquo;Uji Coba Cetak&rdquo;</strong> di bawah untuk memastikan struk keluar sempurna.
                  </li>
                </ol>
              </div>

              {/* Pengaturan Kertas & Perangkat Keras */}
              <div className="rounded-lg border border-border p-3.5 space-y-3 bg-card">
                <h3 className="text-[12px] font-semibold text-foreground">Pengaturan Cetak Nota</h3>

                {/* Lebar Kertas */}
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">Lebar Kertas Thermal</span>
                  <div className="flex rounded-md border border-input p-0.5 bg-background">
                    <button
                      type="button"
                      onClick={() => updatePaperWidth("58mm")}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                        prefs.paperWidth === "58mm"
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      58 mm (32 kolom)
                    </button>
                    <button
                      type="button"
                      onClick={() => updatePaperWidth("80mm")}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                        prefs.paperWidth === "80mm"
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      80 mm (48 kolom)
                    </button>
                  </div>
                </div>

                {/* Fitur Laci Kasir */}
                <label className="flex items-center justify-between text-[12px] cursor-pointer">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <DollarSign className="size-3.5" /> Buka Laci Kasir Otomatis (RJ11)
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs.openCashDrawer}
                    onChange={toggleAutoDrawer}
                    className="size-4 rounded border-input"
                  />
                </label>

                {/* Potong Kertas */}
                <label className="flex items-center justify-between text-[12px] cursor-pointer">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Scissors className="size-3.5" /> Potong Kertas Otomatis (Auto-Cutter)
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs.cutPaper}
                    onChange={toggleAutoCut}
                    className="size-4 rounded border-input"
                  />
                </label>

                {/* Auto-Cetak Setelah Bayar */}
                <label className="flex items-center justify-between text-[12px] cursor-pointer">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Printer className="size-3.5" /> Cetak Struk Otomatis Setelah Bayar
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs.autoPrint !== false}
                    onChange={toggleAutoPrint}
                    className="size-4 rounded border-input"
                  />
                </label>

                {/* Kecepatan Serial (COM/SPP) */}
                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-muted-foreground">Baud Rate Serial / COM</span>
                  <select
                    value={prefs.serialBaudRate ?? 9600}
                    onChange={(event) => updateBaudRate(Number(event.target.value) as SerialBaudRate)}
                    aria-label="Baud Rate Serial"
                    className="h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium"
                  >
                    {SERIAL_BAUD_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate} bps
                      </option>
                    ))}
                  </select>
                </div>

              </div>

              {/* Uji Coba Cetak */}
                  {isConnected && prefs.type !== "kiosk" ? (
                <button
                  type="button"
                  onClick={handleTestPrint}
                  disabled={testing}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/60 p-2.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Play className="size-3.5 text-tone-teal" />
                  <span>{testing ? "Mencetak..." : "Uji Coba Cetak 1 Lembar (Test Print)"}</span>
                </button>
              ) : null}
            </>
          ) : (
            <div className="space-y-3 text-[12px]">
              {/* Status & Kontrol Mode Kiosk */}
              <div
                className={`rounded-lg border p-3.5 ${
                  prefs.type === "kiosk"
                    ? "border-tone-teal/40 bg-tone-teal-soft/30"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {prefs.type === "kiosk" ? (
                      <CheckCircle2 className="size-5 text-tone-teal shrink-0" />
                    ) : (
                      <Printer className="size-5 text-muted-foreground shrink-0" />
                    )}
                    <div>
                      <p className="text-[12px] font-semibold text-foreground">
                        {prefs.type === "kiosk"
                          ? "Mode Kiosk Aktif: Driver Bawaan OS"
                          : "Mode Kiosk Belum Aktif"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {prefs.type === "kiosk"
                          ? "Setelah pembayaran, klik Cetak struk untuk menggunakan driver OS."
                          : "Gunakan mode ini jika printer sudah terinstal driver-nya di komputer kasir."}
                      </p>
                    </div>
                  </div>

                  {prefs.type === "kiosk" ? (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      className="rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                    >
                      Nonaktifkan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const updated = savePrinterPreferences({
                          type: "kiosk",
                          name: "Printer Bawaan OS (Kiosk)",
                        });
                        setPrefs(updated);
                        toast.success("Driver OS dipilih. Jalankan cetak uji untuk memeriksa printer.");
                      }}
                      className="rounded bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Aktifkan Mode Kiosk
                    </button>
                  )}
                </div>
              </div>

              {prefs.type === "kiosk" ? (
                <>
                  <label className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-[12px] cursor-pointer">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <Printer className="size-3.5 text-primary" /> Cetak Struk Otomatis Setelah Bayar
                    </span>
                    <input
                      type="checkbox"
                      checked={prefs.autoPrint !== false}
                      onChange={toggleAutoPrint}
                      className="size-4 rounded border-input"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleTestKioskPrint}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/60 p-2.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                  >
                    <Play className="size-3.5 text-tone-teal" />
                    <span>Uji Coba Cetak Kiosk (Driver OS)</span>
                  </button>
                </>
              ) : null}

              <div className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <HelpCircle className="size-4 text-primary" />
                  <span>Cetak lewat driver OS</span>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Tambahkan printer USB atau LAN di pengaturan sistem, lalu cetak halaman uji dari sistem operasi. Saat memilih Cetak struk, gunakan dialog untuk memilih printer dan ukuran kertas yang sesuai.
                </p>
              </div>

              <div className="rounded-lg border border-border p-3.5 space-y-2 bg-card">
                <p className="font-semibold text-foreground">Cara Menjalankan Silent Printing di Windows:</p>
                <ol className="list-decimal pl-4 space-y-1.5 text-muted-foreground">
                  <li>
                    Jadikan printer thermal Anda sebagai <strong>Default Printer</strong> di Settings Windows.
                  </li>
                  <li>
                    Klik kanan shortcut Google Chrome / Edge di Desktop &rarr; pilih <strong>Properties</strong>.
                  </li>
                  <li>
                    Pada kolom <strong>Target</strong>, tambahkan parameter di bagian paling akhir:
                    <br />
                    <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground select-all">
                      --kiosk-printing
                    </code>
                  </li>
                  <li>Buka browser melalui shortcut tersebut, lalu uji Cetak struk untuk memastikan hasilnya dikirim ke printer yang benar.</li>
                </ol>
              </div>

              <div className="rounded-lg border border-border p-3.5 space-y-2 bg-card">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Terminal className="size-3.5 text-primary" /> Pengguna Linux (Fedora / Ubuntu):
                </p>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  Agar WebUSB / WebSerial dapat mengakses perangkat USB tanpa diblokir hak akses, tambahkan user Anda ke grup printer:
                </p>
                <code className="block rounded bg-muted p-2 font-mono text-[11px] text-foreground">
                  sudo usermod -aG lp,dialout $USER
                </code>
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Selesai
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
