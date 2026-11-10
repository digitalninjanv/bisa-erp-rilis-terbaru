"use client";

import type { ReactNode } from "react";
import { SettingsLayout } from "@/components/blocks/settings-layout";

/**
 * A-25 U6 — bingkai halaman Pengaturan di atas SettingsLayout (U2).
 *
 * Validasi 2 (V-02): daftar navigasi di dalam konten DIBUANG.
 * Sebelumnya bingkai ini merender daftar seksi dari SETTINGS_NAV —
 * daftar yang sama persis dengan sidebar cangkang Pengaturan —
 * sehingga setiap label muncul dua kali dan konten kehilangan
 * ±220px lagi. Kini navigasi pengaturan TUNGGAL di sidebar cangkang
 * (desktop) & drawer (mobile); bingkai ini hanya menyediakan
 * kontrak seksi + bilah simpan terpaku SettingsLayout pada lebar
 * penuh. Pemetaan item: seluruh 12 item SETTINGS_NAV (Umum,
 * Pengguna & peran, Payroll Indonesia, Cetak, Penomoran, Metode
 * pembayaran, Kelompok harga, Gudang & cabang, Pemetaan akun,
 * Modul, Kolom kustom, Status sistem) tetap terjangkau dari daftar
 * tunggal itu; href & ?tab= tidak berubah.
 *
 * Seksi-seksi di dalam `children` mendaftar lewat useSettingsSection
 * dari blocks/settings-layout; bilah simpan terpaku milik layout
 * menjadi satu-satunya mekanisme simpan halaman (POLA-05).
 */
export function SettingsPageFrame({
  saveLabel,
  children,
}: {
  saveLabel?: string;
  children: ReactNode;
}) {
  return <SettingsLayout saveLabel={saveLabel}>{children}</SettingsLayout>;
}
