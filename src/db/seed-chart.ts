import { eq } from "drizzle-orm";
import type { adminDb } from "./admin";
import { accounts } from "./schema";
import { seedChartOfAccounts } from "../server/accounting";

/**
 * Adapter seed demo ke penanam templat bersama (A-27 B6).
 *
 * Sebelum B6 berkas ini memuat daftar bagan 4 digitnya sendiri;
 * sekarang bagan demo ditanam dari templat 5 digit yang SAMA dengan
 * perusahaan baru (lib/akuntansi/chart-template.ts lewat
 * seedChartOfAccounts) — satu sumber, tanpa salinan kedua. Yang
 * tinggal di sini hanya kekhususan demo: rincian rekening bank
 * contoh (11011 Bank BCA) yang memang data etalase, bukan templat.
 * Mengembalikan record pemetaan kunci → id akun yang dipakai sisa
 * seed (metode pembayaran, saldo awal, dst.).
 */
export async function seedDemoChart(db: typeof adminDb, orgId: string) {
  console.log("Membuat bagan akun...");
  const mapping = await db.transaction(async (tx) => seedChartOfAccounts(tx, orgId));
  // Rincian bank demo (etalase): nomor rekening contoh Bank BCA —
  // perusahaan baru menanam akun bank contoh yang sama TANPA rincian
  // ini; pemilik mengisinya lewat formulir akun (B3).
  await db
    .update(accounts)
    .set({
      bankName: "BCA",
      bankAccountNumber: "8210456789",
      bankBranch: "KCP Melati",
      bankAccountHolder: "Bisa Minimarket",
    })
    .where(eq(accounts.id, mapping.bank));
  return { mapping };
}
