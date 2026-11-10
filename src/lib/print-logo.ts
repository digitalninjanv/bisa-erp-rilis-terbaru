import { z } from "zod";

/**
 * A-28 UI-2 (UX-D02): SATU validator logo cetak untuk semua jalur
 * tulis — pola yang sama dengan gambar QRIS (SEC-06). Logo boleh:
 *  - URL http(s) eksternal (maks 2.000 karakter), atau
 *  - berkas terunggah sebagai data URL raster PNG/JPEG/WebP
 *    (SVG ditolak — dapat membawa skrip; batas panjang sama dengan
 *    QRIS agar berkas ±600KB lolos sesudah pengkodean base64).
 *
 * Sengaja tinggal di lib, BUKAN di berkas aksi: berkas `"use server"`
 * hanya boleh mengekspor fungsi async.
 */
export const PRINT_LOGO_DATA_URL_MAX_LENGTH = 900_000;

export const printLogoDataUrlSchema = z
  .string()
  .max(PRINT_LOGO_DATA_URL_MAX_LENGTH)
  .regex(
    /^data:image\/(png|jpeg|webp);base64,/,
    "Logo harus berupa berkas PNG, JPEG, atau WebP.",
  );

export const printLogoUrlSchema = z
  .string()
  .max(PRINT_LOGO_DATA_URL_MAX_LENGTH)
  .refine(
    (value) =>
      value.startsWith("data:image/")
        ? printLogoDataUrlSchema.safeParse(value).success
        : /^https?:\/\/\S+$/.test(value) && value.length <= 2000,
    "Logo harus berupa URL http(s) atau berkas PNG, JPEG, atau WebP.",
  );
