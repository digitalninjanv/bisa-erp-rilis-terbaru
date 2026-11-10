// A-27 B7: permukaan pemilik alat migrasi bagan akun (RENCANA §6/B7).
// Aksi TERPISAH dari akun-pemetaan.ts: migrasi adalah perintah
// eksplisit satu-kali per perusahaan — tidak ada jalur otomatis,
// terjadwal, atau efek samping dari aksi akun biasa yang memanggil
// modul ini. Izinnya sama dengan pengelolaan bagan akun
// (accounting.manage); eksekusi menuntut konfirmasi eksplisit
// (confirm: true) dari panel dan berjalan dalam SATU transaksi
// withCompany — penolakan bentrok/verifikasi di domain membatalkan
// seluruh perubahan.

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { requirePermissionInModule } from "@/lib/session";
import { executeCoaMigration, previewCoaMigration } from "@/server/coa-migration";

/** Dry-run migrasi bagan akun perusahaan aktif: laporan saja, tanpa satu pun perubahan. */
export async function previewCoaMigrationAction() {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    return withCompanyReadOnly(ctx.company.id, (tx) => previewCoaMigration(tx, ctx.company.id));
  });
}

const executeSchema = z.object({
  // Konfirmasi eksplisit pemilik: panel hanya mengirim true sesudah
  // pengguna membaca hasil dry-run, mencentang pernyataan paham,
  // dan menyetujui dialog konfirmasi.
  confirm: z.literal(true),
});

/** Eksekusi migrasi bagan akun perusahaan aktif (satu transaksi; lihat server/coa-migration.ts). */
export async function executeCoaMigrationAction(input: z.input<typeof executeSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    parseInput(executeSchema, input);
    const result = await withCompany(ctx.company.id, (tx) =>
      executeCoaMigration(tx, ctx.company.id, { userId: ctx.user.id }),
    );
    revalidatePath("/app/akuntansi/migrasi-coa");
    revalidatePath("/app/akuntansi/akun");
    revalidatePath("/app/akuntansi/bank");
    revalidatePath("/app/akuntansi/laporan");
    return result;
  });
}
