"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

/**
 * POS-NOTA-01: toast transien disingkirkan SEBELUM dialog cetak
 * dibuka. Toast Sonner adalah elemen fixed berlapis tertinggi;
 * tanpa ini toast sukses checkout ("Transaksi … tersimpan") yang
 * umurnya ±4 detik ikut terrender ke pratinjau/hasil cetak dan
 * menimpa kop nota — autoprint terpicu hanya 400ms sesudah toast
 * tampil, jadi tabrakannya selalu terjadi. Aturan @media print
 * untuk [data-sonner-toaster] di globals.css adalah jaring kedua
 * untuk jalur cetak di luar tombol ini (mis. Ctrl+P).
 */
function printClean() {
  toast.dismiss();
  window.print();
}

export function ReceiptPrint({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const timer = setTimeout(printClean, 400);
    return () => clearTimeout(timer);
  }, [auto]);

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
