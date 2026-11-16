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
  type PaperWidth,
  type PrinterPreferences,
} from "@/lib/escpos/types";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function PrinterStatusButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  // Server dan render awal browser harus memakai nilai yang sama; preferensi
  // tersimpan di localStorage baru dibaca setelah komponen terhidrasi.
  const [prefs, setPrefs] = useState<PrinterPreferences>(DEFAULT_PRINTER_PREFERENCES);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={connected ? `Printer siap: ${prefs.name} (${prefs.paperWidth})` : prefs.type === "kiosk" ? "Mode cetak sistem aktif" : "Hubungkan printer kasir"}
        className={cn(
          compact
            ? "grid size-10 place-items-center rounded-md border transition-colors"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
          connected
            ? "border-tone-teal/40 bg-tone-teal-soft/40 text-tone-teal hover:bg-tone-teal-soft/60"
            : "border-border bg-card text-foreground hover:bg-muted",
        )}
        title={
          connected
            ? `Printer siap: ${prefs.name} (${prefs.paperWidth})`
            : "Klik untuk menghubungkan printer thermal kasir"
        }
      >
        <span
          className={`size-2 rounded-full ${
            connected ? "bg-tone-teal animate-pulse" : "bg-amber-500 animate-ping"
          }`}
        />
        <Printer className={`size-3.5 ${connected ? "text-tone-teal" : "text-amber-600 dark:text-amber-400"}`} />
        <span className={compact ? "sr-only" : "hidden sm:inline"}>
          {connected ? `${prefs.name} (${prefs.paperWidth})` : prefs.type === "kiosk" ? "Printer Sistem" : "Hubungkan Printer Kasir"}
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
  const [isSecure, setIsSecure] = useState(true);
  const [connected, setConnected] = useState(isPrinterConnected());

  const bluetoothOk = isBluetoothSupported();
  const usbOk = isUsbSupported();
  const serialOk = isSerialSupported();

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsSecure(window.isSecureContext ?? false);
    }
  }, []);

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
      window.print();
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
            <div>Status : Mode Kiosk Aktif</div>
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
    const updated = savePrinterPreferences({ autoPrintOnCheckout: !prefs.autoPrintOnCheckout });
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
                <strong className="text-foreground">Printer Wi‑Fi/LAN:</strong> POS web tidak dapat membuka koneksi TCP printer secara langsung. Gunakan aplikasi Bisa POS Desktop untuk mengatur IP printer dan port (default 9100). Pastikan terminal dan printer berada di jaringan yang sama. Mode Kiosk web memakai printer default sistem operasi.
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
                  <li>Pilih tombol koneksi yang sesuai. Perangkat SPP dipilih dari tombol Serial / COM; koneksi serial memakai baud rate 9600.</li>
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

                {/* Auto Print saat Checkout */}
                <label className="flex items-center justify-between text-[12px] cursor-pointer">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Printer className="size-3.5" /> Cetak Otomatis saat Klik Bayar
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs.autoPrintOnCheckout}
                    onChange={toggleAutoPrint}
                    className="size-4 rounded border-input"
                  />
                </label>
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
                          ? "Struk dicetak otomatis melalui driver OS (Windows / Linux CUPS)."
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
                        toast.success("Mode Kiosk aktif! Struk akan dikirim ke printer default sistem.");
                      }}
                      className="rounded bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Aktifkan Mode Kiosk
                    </button>
                  )}
                </div>
              </div>

              {prefs.type === "kiosk" ? (
                <button
                  type="button"
                  onClick={handleTestKioskPrint}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/60 p-2.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                >
                  <Play className="size-3.5 text-tone-teal" />
                  <span>Uji Coba Cetak Kiosk (Driver OS)</span>
                </button>
              ) : null}

              <div className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <HelpCircle className="size-4 text-primary" />
                  <span>Kelebihan Mode Kiosk (Sangat Cocok untuk Akses Jaringan LAN):</span>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Bekerja 100% normal pada akses IP lokal (<code>http://192.168.x.x</code>) tanpa perlu pengaturan izin browser khusus. Cukup jadikan printer thermal sebagai <strong>Default Printer</strong> di Windows, dan buka browser dengan flag <strong>--kiosk-printing</strong> agar struk keluar seketika tanpa dialog.
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
                  <li>Buka browser melalui shortcut tersebut dan kasir siap mencetak seketika tanpa dialog.</li>
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
