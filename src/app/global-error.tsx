"use client";

import "./globals.css";

/**
 * R3 K-6 (Program Rekayasa): batas kesalahan TERAKHIR — menggantikan
 * layout root saat layout itu sendiri yang gagal, sehingga wajib
 * mendefinisikan <html>/<body> sendiri dan mengimpor gaya globalnya
 * sendiri (dokumentasi Next 16: global-error tidak mewarisi layout
 * root maupun gayanya). Tanpa dependensi pada provider/komponen
 * bersama yang bisa ikut gagal; teks produk yang sama dengan
 * error.tsx root & app/error.tsx. Tombolnya tautan navigasi penuh
 * (bukan handler klien) agar tetap berfungsi saat hidrasi rusak.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const denied = error.message.includes("Tidak punya akses");
  return (
    <html lang="id">
      <body>
        <div className="grid min-h-screen place-items-center px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
            <h1 className="text-[16px] font-semibold">{denied ? "Akses ditolak" : "Terjadi kesalahan"}</h1>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {denied
                ? error.message
                : "Halaman gagal dimuat. Coba lagi atau hubungi admin jika masalah berlanjut."}
            </p>
            <a
              href="/app"
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Kembali ke beranda
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
