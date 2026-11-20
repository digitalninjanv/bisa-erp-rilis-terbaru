"use client";

import { useEffect, useRef } from "react";
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
/**
 * POS-NOTA-02: tinggi kertas thermal mengikuti isi nota. `@page` statis
 * 80mm × 297mm memotong nota panjang dan menyisakan kertas kosong pada
 * nota pendek; Chrome menghormati ukuran eksplisit, jadi ukur elemen
 * cetak lalu timpa aturan @page sebelum dialog cetak dibuka.
 */
function prepareThermalPageSize() {
  const doc = document.querySelector<HTMLElement>(".print-doc[data-paper]");
  const paper = doc?.dataset.paper;
  if (!doc || (paper !== "thermal58" && paper !== "thermal80")) return;

  const widthMm = paper === "thermal58" ? 58 : 80;
  const contentMm = (doc.getBoundingClientRect().height * 25.4) / 96;
  // 2 × 2mm margin + sedikit cadangan agar baris terakhir tidak terpotong.
  const heightMm = Math.max(60, Math.ceil(contentMm + 6));

  const rule = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; } body { margin: 0; padding: 2mm; }`;
  // PrintShell menaruh aturan @page di dalam .print-doc. Ganti aturan
  // itu langsung; menambah <style> baru sebelum elemennya membuat
  // aturan statis 297mm tetap menang dalam cascade.
  const shellStyle = doc.querySelector<HTMLStyleElement>(":scope > style");
  if (shellStyle) {
    shellStyle.textContent = rule;
    return;
  }

  let style = document.getElementById("bisa-print-page-size") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "bisa-print-page-size";
    document.body.appendChild(style);
  }
  style.textContent = rule;
}

function printClean() {
  prepareThermalPageSize();
  toast.dismiss();
  window.print();
}

export function ReceiptPrint({
  auto = false,
  returnTo,
  closeAfterPrint = false,
}: {
  auto?: boolean;
  /**
   * Setelah dialog cetak selesai (termasuk saat kiosk-printing),
   * kembali ke halaman ini. Dipakai alur checkout agar kasir tidak
   * tertahan di halaman nota.
   */
  returnTo?: string;
  /** Popup cetak: tutup jendela setelah dialog cetak selesai. */
  closeAfterPrint?: boolean;
}) {
  // Tombol Cetak manual membatalkan auto-print yang belum sempat jalan,
  // supaya satu kunjungan halaman tidak membuka dua dialog cetak.
  const manualPrintRef = useRef(false);
  const printManually = () => {
    manualPrintRef.current = true;
    printClean();
  };

  // Ctrl+P / menu browser juga harus memakai tinggi kertas dinamis,
  // bukan hanya tombol Cetak.
  useEffect(() => {
    const onBeforePrint = () => prepareThermalPageSize();
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);

  useEffect(() => {
    if (!auto) return;
    // Sengaja TANPA ref penjaga: React Strict Mode (next dev)
    // menjalankan efek dua kali (setup → cleanup → setup). Ref yang
    // bertahan antar-invoke membuat run kedua diblokir sementara run
    // pertama sudah dibatalkan — auto-print tidak pernah terpanggil.
    // Cleanup di bawah membatalkan timer run pertama dengan benar.
    let cancelled = false;
    const onAfterPrint = () => {
      if (cancelled) return;
      if (closeAfterPrint) {
        window.close();
        return;
      }
      if (returnTo) window.location.assign(returnTo);
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
      if (cancelled || manualPrintRef.current) return;
      printClean();
    };
    void run();

    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [auto, returnTo, closeAfterPrint]);

  return (
    <button
      type="button"
      onClick={printManually}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
    >
      <Printer className="size-3.5" /> Cetak
    </button>
  );
}
