import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { configureVitestDatabase } from "../../tests/vitest-db-guard.mjs";

/**
 * SIM-2 S4 — cleanup perusahaan sintetis benchmark.
 * Wajib memakai BISA_TEST_DATABASE_URL / BISA_TEST_DIRECT_URL.
 * Default hanya menghitung kandidat; --apply menghapus secara atomik.
 * Contoh: pnpm exec tsx scripts/sim2-gen/cleanup.ts --scale=A --apply
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
configureVitestDatabase(["tests/integration/sim2-cleanup"], process.env, root);

const directUrl = process.env.BISA_TEST_DIRECT_URL;
if (!directUrl) throw new Error("BISA_TEST_DIRECT_URL wajib menunjuk database sintetis khusus.");

const COMPANIES: Record<string, string> = {
  A: "01900000-0000-7000-8000-00000000bea1",
  B: "01900000-0000-7000-8000-00000000bea2",
};
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const scaleArgs = args.filter((arg) => arg.startsWith("--scale="));
const unknownArgs = args.filter((arg) => arg !== "--apply" && !arg.startsWith("--scale="));
if (unknownArgs.length > 0 || scaleArgs.length > 1) {
  throw new Error("Argumen valid: --scale=A|B|ALL dan --apply (opsional; default dry-run).");
}
const scale = scaleArgs[0]?.slice("--scale=".length) ?? "A";
const targets = scale === "ALL" ? Object.values(COMPANIES) : [COMPANIES[scale]];
if (targets.some((companyId) => !companyId)) {
  throw new Error(`Skala tidak dikenal: ${scale}. Pilih A, B, atau ALL.`);
}

const target = new URL(directUrl);
console.log(`Target test DB: ${target.hostname}/${decodeURIComponent(target.pathname.slice(1))}`);
console.log(`Perusahaan benchmark: ${scale}`);
if (!apply) console.log("MODE DRY-RUN: tidak ada baris yang akan dihapus. Tambahkan --apply untuk menerapkan.");

const sql = postgres(directUrl, { max: 1 });

async function cleanupCompany(companyId: string) {
  await sql.begin(async (tx) => {
    const tables = await tx`
      select t.table_name
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and exists (
          select 1 from information_schema.columns c
          where c.table_schema = t.table_schema
            and c.table_name = t.table_name and c.column_name = 'company_id'
        )
      order by t.table_name`;

    if (apply) await tx`set local session_replication_role = 'replica'`;
    let total = 0;
    for (const { table_name } of tables) {
      const [count] = await tx`
        select count(*)::int as count from ${tx(table_name)} where company_id = ${companyId}`;
      const rows = Number(count.count);
      if (rows > 0) {
        total += rows;
        if (apply) {
          const deleted = await tx`
            delete from ${tx(table_name)} where company_id = ${companyId}`;
          console.log(`  ${table_name}: ${deleted.count} baris dihapus`);
        } else {
          console.log(`  ${table_name}: ${rows} kandidat`);
        }
      }
    }

    const [memberCount] = await tx`select count(*)::int as count from member where organization_id = ${companyId}`;
    const [organizationCount] = await tx`select count(*)::int as count from organization where id = ${companyId}`;
    total += Number(memberCount.count) + Number(organizationCount.count);
    if (apply) {
      await tx`delete from member where organization_id = ${companyId}`;
      await tx`delete from organization where id = ${companyId}`;
    } else {
      if (Number(memberCount.count) > 0) console.log(`  member: ${memberCount.count} kandidat`);
      if (Number(organizationCount.count) > 0) console.log(`  organization: ${organizationCount.count} kandidat`);
    }
    console.log(`Perusahaan ${companyId}: ${apply ? "terhapus" : "kandidat"} ${total} baris.`);
  });
}

async function main() {
  for (const companyId of targets) await cleanupCompany(companyId);
}

main()
  .catch((error: unknown) => {
    console.error("Cleanup benchmark gagal; transaksi perusahaan yang sedang diproses dibatalkan:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 1 });
  });
