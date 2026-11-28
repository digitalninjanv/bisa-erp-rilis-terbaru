/**
 * Bootstrap perusahaan pertama untuk instalasi produksi yang masih
 * kosong. Jalankan SETELAH `pnpm db:migrate`:
 *
 *   BISA_BOOTSTRAP_COMPANY="Toko Maju" \
 *   BISA_BOOTSTRAP_OWNER_NAME="Nadia" \
 *   BISA_BOOTSTRAP_OWNER_EMAIL="owner@tokomaju.id" \
 *   BISA_BOOTSTRAP_OWNER_PASSWORD="..." \
 *   pnpm bootstrap
 *
 * Perintah ini tidak pernah mencetak kata sandi dan menolak database
 * yang sudah berisi organisasi.
 */
import { sql } from "drizzle-orm";
import { adminDb, adminSql } from "../src/db/admin";
import { assertDatabaseEmpty, bootstrapCompany } from "../src/server/bootstrap";

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} wajib diisi.`);
  return value;
}

async function main() {
  const input = {
    companyName: required("BISA_BOOTSTRAP_COMPANY"),
    ownerName: required("BISA_BOOTSTRAP_OWNER_NAME"),
    ownerEmail: required("BISA_BOOTSTRAP_OWNER_EMAIL"),
    ownerPassword: required("BISA_BOOTSTRAP_OWNER_PASSWORD"),
    branchName: process.env.BISA_BOOTSTRAP_BRANCH?.trim() || undefined,
    warehouseName: process.env.BISA_BOOTSTRAP_WAREHOUSE?.trim() || undefined,
    address: process.env.BISA_BOOTSTRAP_ADDRESS?.trim() || undefined,
    phone: process.env.BISA_BOOTSTRAP_PHONE?.trim() || undefined,
  };

  const result = await adminDb.transaction(async (tx) => {
    // Cegah dua operator menjalankan bootstrap bersamaan.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('bisa.bootstrap', 0))`);
    await assertDatabaseEmpty(tx);
    return bootstrapCompany(tx, input);
  });

  console.log("Bootstrap selesai.");
  console.log(`Perusahaan : ${input.companyName} (${result.companyId})`);
  console.log(`Owner      : ${input.ownerEmail}`);
  console.log(`Gudang     : ${result.warehouseId}`);
  console.log("Kata sandi tidak dicetak. Segera masuk dan rotasi bila perlu.");
  console.log("Langkah berikutnya: impor produk/pemasok/pelanggan, lalu buka sesi kasir.");
}

main()
  .catch((error) => {
    console.error(`Bootstrap gagal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await adminSql.end();
  });
