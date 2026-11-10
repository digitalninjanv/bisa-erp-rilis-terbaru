import postgres from "postgres";

/**
 * SIM-2 S4 — menghapus perusahaan benchmark yang dibuat generate.ts.
 * Menemukan semua tabel publik berkolom company_id dan menghapus baris
 * milik perusahaan benchmark saja, lalu menghapus organization/member.
 * Teardown memakai session_replication_role='replica' pada koneksi
 * owner: jurnal posted & stock_movements dilindungi trigger append-only
 * yang memang melarang DELETE biasa, dan FK antar-tabel perusahaan
 * membuat urutan hapus tidak bebas. Ini aman di sini karena (1) hanya
 * berjalan dengan kredensial owner atas perusahaan sintetis milik
 * benchmark ini sendiri, (2) filter company_id tetap diterapkan di
 * setiap DELETE. Perusahaan lain tidak disentuh.
 *
 * Jalan:  pnpm tsx --env-file=.env.local scripts/sim2-gen/cleanup.ts --scale=A
 *         pnpm tsx --env-file=.env.local scripts/sim2-gen/cleanup.ts --scale=ALL
 */

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL/DATABASE_URL tidak ter-set");
const sql = postgres(url, { max: 1 });

const COMPANIES: Record<string, string> = {
  A: "01900000-0000-7000-8000-00000000bea1",
  B: "01900000-0000-7000-8000-00000000bea2",
};

async function cleanupCompany(companyId: string) {
  const tables = await sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'company_id'
    group by table_name order by table_name`;
  let total = 0;
  await sql`set session_replication_role = 'replica'`;
  try {
    for (const { table_name } of tables) {
      const res = await sql`
        delete from ${sql(table_name)} where company_id = ${companyId}`;
      if (res.count > 0) {
        total += res.count;
        console.log(`  ${table_name}: ${res.count} baris terhapus`);
      }
    }
    await sql`delete from member where organization_id = ${companyId}`;
    await sql`delete from organization where id = ${companyId}`;
  } finally {
    await sql`set session_replication_role = 'origin'`;
  }
  console.log(`Perusahaan ${companyId}: total ${total} baris perusahaan terhapus.`);
}

async function main() {
  const arg = (process.argv.find((a) => a.startsWith("--scale=")) ?? "--scale=A").split("=")[1];
  const targets = arg === "ALL" ? Object.values(COMPANIES) : [COMPANIES[arg]];
  if (targets.some((t) => !t)) throw new Error(`Skala tidak dikenal: ${arg}`);
  for (const companyId of targets) await cleanupCompany(companyId);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 }).catch(() => undefined);
  process.exit(1);
});
