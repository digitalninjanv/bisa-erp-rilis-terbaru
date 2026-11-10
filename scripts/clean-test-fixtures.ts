import { eq, like } from "drizzle-orm";
import { db, sqlClient } from "../src/db";
import { products, journalEntries, journalLines, stockMovements } from "../src/db/schema";

async function cleanTestFixtures() {
  console.log("Cleaning test fixtures from database...");

  // Remove test journals starting with 'Uji %'
  const testJournals = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(like(journalEntries.description, "Uji %"));

  if (testJournals.length > 0) {
    for (const j of testJournals) {
      await db.delete(journalLines).where(eq(journalLines.entryId, j.id));
      await db.delete(journalEntries).where(eq(journalEntries.id, j.id));
    }
    console.log(`Deleted ${testJournals.length} test journals.`);
  }

  // Remove contaminated soft-deleted products with suffix TERHAPUS
  const testProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(like(products.sku, "%-TERHAPUS-%"));

  if (testProducts.length > 0) {
    for (const p of testProducts) {
      await db.delete(stockMovements).where(eq(stockMovements.productId, p.id));
      await db.delete(products).where(eq(products.id, p.id));
    }
    console.log(`Deleted ${testProducts.length} contaminated test products.`);
  }

  console.log("Test fixture cleanup completed.");
}

cleanTestFixtures()
  .catch((err) => {
    console.error("Cleanup error:", err);
  })
  .finally(async () => {
    await sqlClient.end();
  });
