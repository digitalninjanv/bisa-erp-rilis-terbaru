"use client";

/**
 * Cetak nota lewat jendela popup independen.
 *
 * Chrome tidak dapat diandalkan untuk mencetak iframe tersembunyi:
 * `iframe.contentWindow.print()` sering mencetak halaman INDUK (terminal
 * POS) alih-alih nota. Popup adalah browsing context tersendiri, jadi
 * `print()` di dalamnya hanya mencetak nota. Ini juga jalur yang dipakai
 * tombol uji cetak kiosk.
 */
let printWindow: Window | null = null;

export function printReceiptViaPopup(saleId: string): boolean {
  if (typeof window === "undefined") return false;

  const url = `/app/pos/nota/${encodeURIComponent(saleId)}?autoprint=1&popup=1`;

  // Pakai ulang jendela yang masih terbuka supaya klik berulang tidak
  // menumpuk banyak tab.
  if (printWindow && !printWindow.closed) {
    try {
      printWindow.location.href = url;
      printWindow.focus();
      return true;
    } catch {
      // Jendela lama tidak dapat diakses (mis. berpindah origin); buka baru.
      printWindow = null;
    }
  }

  const width = 460;
  const height = 760;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + 32));
  printWindow = window.open(
    url,
    `bisa-pos-print-${saleId}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );

  if (!printWindow) return false;
  printWindow.focus();
  return true;
}
