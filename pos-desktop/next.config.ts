import type { NextConfig } from "next";

/**
 * POS Native Langkah 1 (RENCANA-TAURI D1/D2): target ekspor statis
 * POS-ONLY untuk dibundel Tauri sebagai `frontendDist`.
 *
 * Ini konfigurasi TERPISAH dari aplikasi web (next.config.ts repo
 * tetap `output: "standalone"` dan tidak berubah perilaku). Ekspor
 * statis berarti tanpa Server Actions/route handler dinamis di sisi
 * desktop: semua data datang dari (a) database lokal Rust lewat
 * invoke, dan (b) endpoint hosted `/api/pos/*` ber-token perangkat.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Tauri menyajikan aset dari skema tauri:// — path absolut bawaan
  // ekspor Next sudah sesuai; trailingSlash membuat setiap rute
  // berupa folder index.html yang aman disajikan statis.
  trailingSlash: true,
};

export default nextConfig;
