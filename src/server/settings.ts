import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { companySettings } from "@/db/schema";

/**
 * A-26 Q4 (P-08, audit sentralisasi §2): kontrak baca settings
 * perusahaan. Tulis settings sudah terpusat di
 * `src/server/actions/settings.ts`; baca kini punya SATU pintu bernama
 * di sini — fungsi ini mengembalikan baris settings utuh perusahaan
 * (atau null bila belum dibuat), dan konsumen mengambil kolom yang
 * dibutuhkannya dari baris itu. Konsumen baru TIDAK memilih
 * `companySettings` langsung: daftar berkas yang masih boleh membaca
 * langsung dibekukan di
 * `tests/unit/architecture-settings-reads.test.ts` dan hanya boleh
 * menyusut. (Sebelumnya: ±26 berkas merangkai proyeksi 1–5 kolomnya
 * sendiri di samping `catalog.getSettings`, yang kini mendelegasikan
 * ke fungsi ini juga.)
 */
export async function getCompanySettingsRow(tx: Tx, companyId: string) {
  const [row] = await tx
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  return row ?? null;
}
