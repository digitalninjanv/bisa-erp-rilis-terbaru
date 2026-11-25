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
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        // CookieStore in a worker cannot read a cookie outside its script URL
        // scope. The page can, so hand the non-authorizing cache id to the
        // worker and let it remember the id in Cache Storage for offline reloads.
        const cacheId = document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("pos_shell_cache_id="))
          ?.slice("pos_shell_cache_id=".length);
        if (cacheId && registration.active) {
          registration.active.postMessage({ type: "pos-shell-cache-id", cacheId: decodeURIComponent(cacheId) });
        }
      })
      .catch(() => undefined);
  }, [enabled]);
  return null;
}
