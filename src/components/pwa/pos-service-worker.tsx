"use client";

import { useEffect } from "react";

// A-24 T6B — pendaftar service worker terminal POS. Komponen tak
// terlihat ini hanya dipasang halaman terminal (/app/pos) dan hanya
// mendaftarkan worker bila saklar offline perusahaan menyala; worker
// tinggal di public/pos-sw.js dan didaftarkan dengan scope tepat
// "/app/pos" (lihat alasan penempatan & kontrak cache di berkas itu).
//
// Batas secure context ditegakkan peramban: pada konteks tidak aman
// (mis. http://IP LAN) `navigator.serviceWorker` tidak ada dan
// komponen ini diam — tidak ada error, tidak ada janji palsu. Bila
// saklar dimatikan sesudah worker terdaftar, pendaftaran dicabut
// supaya shell berhenti disajikan dari cache.
export function PosServiceWorker({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!enabled) {
      navigator.serviceWorker
        .getRegistration("/app/pos")
        .then((registration) => registration?.unregister())
        .catch(() => undefined);
      return;
    }
    navigator.serviceWorker
      .register("/pos-sw.js", { scope: "/app/pos" })
      .catch(() => undefined);
  }, [enabled]);
  return null;
}
