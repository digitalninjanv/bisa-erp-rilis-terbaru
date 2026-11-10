import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Bisa POS — Desktop",
  description: "Terminal kasir Bisa ERP (Tauri) — Langkah 1–5: snapshot lokal, antrean offline, mesin sinkron Rust, cetak ESC/POS.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
