"use client";

/**
 * Utilitas untuk mencetak nota di balik layar menggunakan iframe tersembunyi.
 * Mencegah browser berpindah halaman atau unmount terminal POS saat mencetak nota.
 *
 * Bila Chrome dijalankan dengan flag `--kiosk --kiosk-printing`, panggilan ini
 * akan langsung mencetak ke printer bawaan secara 100% senyap tanpa dialog!
 */
export function printReceiptViaHiddenIframe(saleId: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(false);
      return;
    }

    const FRAME_ID = "bisa-pos-hidden-print-frame";
    let iframe = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;

    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = FRAME_ID;
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      iframe.style.visibility = "hidden";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);
    }

    const printUrl = `/app/pos/nota/${saleId}?autoprint=1`;

    let resolved = false;
    const cleanupAndResolve = (success: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(success);
    };

    iframe.onload = () => {
      try {
        const frameWindow = iframe?.contentWindow;
        if (!frameWindow) {
          cleanupAndResolve(false);
          return;
        }

        // Tunggu konten nota selesai dimuat
        setTimeout(() => {
          try {
            frameWindow.focus();
            frameWindow.print();
            cleanupAndResolve(true);
          } catch {
            cleanupAndResolve(false);
          }
        }, 500);
      } catch {
        cleanupAndResolve(false);
      }
    };

    // Timeout pengaman bila iframe gagal dimuat
    setTimeout(() => {
      cleanupAndResolve(false);
    }, 5000);

    iframe.src = printUrl;
  });
}
