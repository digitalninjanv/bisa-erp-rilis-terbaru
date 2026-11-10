"use client";

import { useEffect, useState } from "react";
import {
  getCustomerDisplay,
  isTauri,
  onDisplayEvent,
  type DisplayPayload,
} from "../../lib/pos-bridge";

/**
 * Layar pelanggan (Langkah 8) — jendela kedua Tauri `display`.
 *
 * Halaman ini SENGAJA bodoh: ia tidak memanggil HTTP, tidak
 * membaca database, dan tidak pernah menerima token (D7).
 * Isinya adalah muatan siap-tampil `DisplayPayload` yang
 * dipetakan Rust dari keadaan keranjang jendela utama
 * (displaymap): ditarik sekali saat jendela dibuka lewat
 * `getCustomerDisplay`, lalu diikuti lewat event `pos-display`.
 * Tanpa jendela ini pun terminal bekerja penuh — fitur diam.
 *
 * Di luar Tauri (pratinjau peramban) halaman menampilkan contoh
 * muatan berlabel pratinjau agar tata letaknya bisa dinilai.
 */

const PREVIEW_PAYLOAD: DisplayPayload = {
  mode: "cart",
  storeName: "Bisa Minimarket",
  headline: "",
  lines: [
    { name: "Aqua Air Mineral 600ml", qtyText: "2", unitPriceText: "Rp 4.000", lineTotalText: "Rp 8.000" },
    { name: "Beras IR64 5kg", qtyText: "1", unitPriceText: "Rp 68.500", lineTotalText: "Rp 68.500" },
    { name: "Gula Pasir 1kg", qtyText: "1", unitPriceText: "Rp 17.500", lineTotalText: "Rp 17.500" },
  ],
  moreLines: 0,
  totalQtyText: "4",
  totalText: "Rp 94.000",
};

const IDLE_PAYLOAD: DisplayPayload = {
  mode: "idle",
  storeName: "Bisa POS",
  headline: "Selamat datang",
  lines: [],
  moreLines: 0,
  totalQtyText: "0",
  totalText: "Rp 0",
};

export default function CustomerDisplayPage() {
  const [inTauri] = useState<boolean>(() => isTauri());
  // Keadaan awal dipilih sinkron saat inisialisasi state:
  // pratinjau di luar Tauri, idle di dalam Tauri (muatan
  // sebenarnya tiba lewat getCustomerDisplay + event).
  const [payload, setPayload] = useState<DisplayPayload>(() =>
    isTauri() ? IDLE_PAYLOAD : PREVIEW_PAYLOAD,
  );

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const current = await getCustomerDisplay();
        if (!cancelled) setPayload(current);
      } catch {
        /* Jendela tetap pada keadaan idle; event berikutnya
           akan memperbaikinya. */
      }
      try {
        unlisten = await onDisplayEvent((next) => {
          if (!cancelled) setPayload(next);
        });
      } catch {
        /* Listen gagal = layar statis pada muatan terakhir. */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [inTauri]);

  return (
    <div className="display-root">
      <header className="display-store">{payload.storeName}</header>

      {payload.mode === "idle" && (
        <div className="display-center">
          <div className="display-headline">{payload.headline}</div>
          <div className="display-sub">Transaksi Anda akan tampil di sini.</div>
        </div>
      )}

      {payload.mode === "thanks" && (
        <div className="display-center">
          <div className="display-headline">{payload.headline}</div>
          <div className="display-paid-total">{payload.totalText}</div>
          <div className="display-sub">Sampai jumpa kembali.</div>
        </div>
      )}

      {payload.mode === "cart" && (
        <>
          <ul className="display-lines">
            {payload.lines.map((line, index) => (
              <li key={`${line.name}-${index}`}>
                <span className="d-name">{line.name}</span>
                <span className="d-qty">
                  {line.qtyText} × {line.unitPriceText}
                </span>
                <span className="d-total">{line.lineTotalText}</span>
              </li>
            ))}
          </ul>
          {payload.moreLines > 0 && (
            <div className="display-more">
              +{payload.moreLines} item lainnya — rincian lengkap ada di struk Anda.
            </div>
          )}
          <footer className="display-total">
            <span className="d-label">Total ({payload.totalQtyText} item)</span>
            <span className="d-value">{payload.totalText}</span>
          </footer>
        </>
      )}

      {!inTauri && <div className="display-preview-note">Pratinjau di luar aplikasi desktop</div>}
    </div>
  );
}
