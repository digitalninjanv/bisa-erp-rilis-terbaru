import type { Sql, TransactionSql } from "postgres";

// =====================================================================
// AUD-001 (Program Audit Produksi A4) — pembersihan perusahaan fixture
// SATU transaksi yang TUNTAS, dipakai semua suite integrasi & sim2.
//
// Akar masalah lama: setiap berkas test menyalin daftar tabel tulis
// tangan (`COMPANY_TABLES`) yang membeku pada saat berkas itu ditulis.
// Tabel tenant baru (account_monthly_balances, employee_history,
// product_packagings, pos_terminals, …) tidak pernah masuk daftar
// salinan lama, jadi teardown menghapus organisasi tetapi meninggalkan
// baris datanya — 290.896 baris residu terukur di A0, dan drill
// backup→restore gagal pada FK yatimnya (AUD-002).
//
// Helper ini TIDAK memuat daftar tabel: tabel bertenant dienumerasi
// dari information_schema pada saat jalan (persis pola yang sudah
// terbukti di audit-a2-chains/audit-a3-roles), jadi tabel baru di masa
// depan otomatis ikut terhapus. Seluruh penghapusan berjalan dalam
// SATU transaksi adminSql.begin dengan session_replication_role =
// replica (menonaktifkan trigger FK agar urutan antar-tabel tidak
// relevan — pola yang sama dengan salinan lama).
// =====================================================================

async function deleteCompanyRows(
  tx: TransactionSql,
  orgId: string,
  onlyTables?: readonly string[],
): Promise<void> {
  const tables = await tx.unsafe<{ tablename: string }[]>(
    `SELECT c.table_name AS tablename FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`,
  );
  for (const { tablename } of tables) {
    if (onlyTables && !onlyTables.includes(tablename)) continue;
    await tx.unsafe(`DELETE FROM "${tablename}" WHERE company_id = $1`, [orgId]);
  }
}

/**
 * Hapus baris data perusahaan dalam satu transaksi; organisasi &
 * penggunanya TIDAK disentuh. Untuk reset di tengah test yang
 * me-bootstrap ulang organisasinya.
 *
 * `onlyTables` membatasi ke subset tabel (diiriskan dengan enumerasi
 * information_schema): dipakai berkas yang master datanya sengaja
 * persisten antar-blok (akun & pemetaan dibuat sekali) dan yang
 * direset hanya baris transaksionalnya — pola wipeFixtureRows lama di
 * fix-p1-period-integrity & fix-ars-tahap2-monthly-balances. Tanpa
 * opsi ini, SEMUA tabel ber-company_id dihapus.
 */
export async function wipeCompanyRows(
  adminSql: Sql,
  orgId: string,
  opts?: { onlyTables?: readonly string[] },
): Promise<void> {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    await deleteCompanyRows(tx, orgId, opts?.onlyTables);
  });
}

/**
 * Hapus perusahaan fixture secara TUNTAS dalam SATU transaksi: semua
 * baris ber-company_id, keanggotaan, organisasinya, lalu akun & baris
 * user milik pengguna fixture (bila diberikan). Sesudah fungsi ini
 * selesai, tidak boleh ada sisa satu baris pun yang menunjuk orgId.
 */
export async function wipeCompanyFixture(
  adminSql: Sql,
  orgId: string,
  userIds: readonly string[] = [],
): Promise<void> {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    await deleteCompanyRows(tx, orgId);
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [orgId]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [orgId]);
    for (const id of userIds) {
      await tx.unsafe(`DELETE FROM account WHERE user_id = $1`, [id]);
      await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [id]);
    }
  });
}
