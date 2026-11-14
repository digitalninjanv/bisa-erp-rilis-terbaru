import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, like } from "drizzle-orm";
import { configureVitestDatabase } from "../tests/vitest-db-guard.mjs";

// Run with BISA_TEST_DATABASE_URL, BISA_TEST_DIRECT_URL and
// BISA_TEST_COMPANY_ID set. Dry-run is the default; pass --apply to delete.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
configureVitestDatabase(["tests/integration/clean-test-fixtures"], process.env, root);

const companyId = process.env.BISA_TEST_COMPANY_ID?.trim();
if (typeof companyId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
  throw new Error("BISA_TEST_COMPANY_ID wajib berupa UUID perusahaan sintetis yang akan dibersihkan.");
}
const targetCompanyId = companyId as string;

const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unknownArgs.length > 0) {
  throw new Error(`Argumen tidak dikenal: ${unknownArgs.join(" ")}. Gunakan hanya --apply untuk menghapus data.`);
}
const apply = process.argv.includes("--apply");

const target = new URL(process.env.BISA_TEST_DATABASE_URL!);
console.log(`Target test DB: ${target.hostname}/${decodeURIComponent(target.pathname.slice(1))}`);
console.log(`Perusahaan target: ${targetCompanyId}`);
if (!apply) console.log("MODE DRY-RUN: tidak ada baris yang akan dihapus. Tambahkan --apply untuk menerapkan.");

async function cleanTestFixtures() {
  // Connection modules must be loaded only after the test-DB guard has forced
  // DATABASE_URL and DIRECT_URL away from any .env.local application DB.
  const [{ db, sqlClient }, { products, journalEntries, journalLines, stockMovements }] = await Promise.all([
    import("../src/db"),
    import("../src/db/schema"),
  ]);

  try {
    const result = await db.transaction(async (tx) => {
      const testJournals = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, targetCompanyId), like(journalEntries.description, "Uji %")));

      const testProducts = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.companyId, targetCompanyId), like(products.sku, "%-TERHAPUS-%")));

      if (apply) {
        const journalIds = testJournals.map(({ id }) => id);
        if (journalIds.length > 0) {
          await tx.delete(journalLines).where(
            and(eq(journalLines.companyId, targetCompanyId), inArray(journalLines.entryId, journalIds)),
          );
          await tx.delete(journalEntries).where(
            and(eq(journalEntries.companyId, targetCompanyId), inArray(journalEntries.id, journalIds)),
          );
        }

        const productIds = testProducts.map(({ id }) => id);
        if (productIds.length > 0) {
          await tx.delete(stockMovements).where(
            and(eq(stockMovements.companyId, targetCompanyId), inArray(stockMovements.productId, productIds)),
          );
          await tx.delete(products).where(
            and(eq(products.companyId, targetCompanyId), inArray(products.id, productIds)),
          );
        }
      }

      return { journals: testJournals.length, products: testProducts.length };
    });

    const action = apply ? "Dihapus" : "Kandidat";
    console.log(`${action}: ${result.journals} jurnal uji dan ${result.products} produk uji.`);
    if (apply) console.log("Pembersihan selesai; seluruh perubahan dikomit dalam satu transaksi.");
  } finally {
    await sqlClient.end();
  }
}

cleanTestFixtures().catch((error: unknown) => {
  console.error("Pembersihan fixture gagal; transaksi dibatalkan:", error);
  process.exitCode = 1;
});
