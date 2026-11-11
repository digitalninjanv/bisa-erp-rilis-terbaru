"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

/**
 * POS-NOTA-01: toast transien disingkirkan SEBELUM dialog cetak
 * dibuka. Toast Sonner adalah elemen fixed berlapis tertinggi;
 * tanpa ini toast sukses checkout ("Transaksi … tersimpan") yang
 * umurnya ±4 detik ikut terrender ke pratinjau/hasil cetak dan
 * menimpa kop nota. Aturan @media print untuk [data-sonner-toaster]
 * di globals.css adalah jaring kedua untuk jalur cetak di luar
 * tombol ini (mis. Ctrl+P).
 */
function printClean() {
  toast.dismiss();
  window.print();
}

export function ReceiptPrint({
  auto = false,
  returnTo,
}: {
  auto?: boolean;
  /**
   * Setelah dialog cetak selesai (termasuk saat kiosk-printing),
   * kembali ke halaman ini. Dipakai alur checkout agar kasir tidak
   * tertahan di halaman nota.
   */
  returnTo?: string;
}) {
  useEffect(() => {
    if (!auto) return;
    // Sengaja TANPA ref penjaga: React Strict Mode (next dev)
    // menjalankan efek dua kali (setup → cleanup → setup). Ref yang
    // bertahan antar-invoke membuat run kedua diblokir sementara run
    // pertama sudah dibatalkan — auto-print tidak pernah terpanggil.
    // Cleanup di bawah membatalkan timer run pertama dengan benar.
    let cancelled = false;
    const onAfterPrint = () => {
      if (!cancelled && returnTo) window.location.assign(returnTo);
    };
    window.addEventListener("afterprint", onAfterPrint);

    const run = async () => {
      // Tunggu font/logo/QR selesai dirender agar hasil cetak tidak
      // terpotong atau memakai font fallback.
      try {
        await document.fonts?.ready;
      } catch {
        // Font API tidak tersedia di browser lama; lanjut.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      if (cancelled) return;
      printClean();
    };
    void run();

    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [auto, returnTo]);

  return (
    <button
      type="button"
      onClick={printClean}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
    >
      <Printer className="size-3.5" /> Cetak
    </button>
  );
}
