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
  };
}
