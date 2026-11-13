import type { MetadataRoute } from "next";

// A-24 T6B — Web App Manifest terminal POS (konvensi file App Router:
// berkas ini dilayani Next sebagai /manifest.webmanifest dan tertaut
// otomatis ke setiap halaman). Cakupannya SENGAJA hanya terminal:
// start_url & scope /app/pos — aplikasi dipasang sebagai terminal
// kasir, bukan sebagai ERP utuh. Temanya mengikuti warna primer
// aplikasi (globals.css --primary & --background).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bisa ERP — Terminal POS",
    short_name: "Bisa POS",
    description:
      "Terminal kasir Bisa ERP. Dengan mode offline POS aktif, terminal tetap bisa dibuka saat server tak terjangkau dan penjualan mengantre untuk disinkronkan.",
    start_url: "/app/pos",
    scope: "/app/pos/",
    display: "standalone",
    background_color: "#f7f5f2",
    theme_color: "#714b67",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "Transaksi baru",
        short_name: "Kasir",
        description: "Buka terminal kasir",
        url: "/app/pos",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Sesi kas",
        short_name: "Sesi",
        description: "Buka atau tutup sesi kas",
        url: "/app/pos/sesi",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Piutang pelanggan",
        short_name: "Piutang",
        description: "Tagihan tempo pelanggan",
        url: "/app/pos/piutang",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Riwayat sesi",
        short_name: "Riwayat",
        description: "Rekonsiliasi sesi kas",
        url: "/app/pos/sesi/riwayat",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
