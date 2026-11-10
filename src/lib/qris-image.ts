import { z } from "zod";

/**
 * SIM-2 S6 (SEC-06): SATU validator gambar QRIS untuk semua jalur
 * tulis. Sebelumnya skema pengaturan umum hanya membatasi panjang
 * (nilai apa pun ±900KB lolos), sedangkan aksi unggah khusus hanya
 * mewajibkan awalan `data:image/` — subtipe SVG pun lolos kedua jalur.
 * Kini: data URL raster PNG/JPEG/WebP saja, batas panjang sama.
 *
 * Sengaja tinggal di lib, BUKAN di berkas aksi: berkas `"use server"`
 * hanya boleh mengekspor fungsi async, jadi mengekspor skema dari
 * `src/server/actions/settings.ts` menggagalkan build produksi.
 */
export const QRIS_IMAGE_MAX_LENGTH = 900_000;

export const qrisImageSchema = z
  .string()
  .max(QRIS_IMAGE_MAX_LENGTH)
  .regex(
    /^data:image\/(png|jpeg|webp);base64,/,
    "Gambar QRIS harus berupa berkas PNG, JPEG, atau WebP.",
  );
