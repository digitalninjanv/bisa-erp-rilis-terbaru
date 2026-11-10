import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accountMappings, accounts, paymentMethods } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  makeRollbackTransaction,
  rollbackTransaction,
  type Tx,
} from "../helpers/rollback-transaction";

/**
 * A-27 B1 — fondasi model kas/bank: kolom kelas `cash_bank_kind` +
 * rincian bank di `accounts`, FK `payment_methods.account_id`, dan
 * backfill kelas dari pemetaan yang ditanam migrasi 0055.
 *
 * Test backfill mengeksekusi pernyataan UPDATE persis dari berkas
 * migrasi yang terkirim (bukan salinan SQL di test) atas perusahaan
 * fixture di dalam transaksi rollback — jadi yang diuji adalah artefak
 * migrasinya sendiri: cash→cash, bank→bank, qris→clearing, akun tanpa
 * pemetaan tetap null, dan akun yang (menyimpang) terpetakan ganda
 * bank+qris mengikuti preseden deterministik bank menang.
 */

const DEMO_ID = "01900000-0000-7000-8000-000000000001";
const COMPANY_A = "01900000-0000-7000-8000-00000000b127";
const COMPANY_B = "01900000-0000-7000-8000-00000000b128";

/** Pernyataan UPDATE backfill dari berkas migrasi yang memuatnya. */
function backfillStatements(): string[] {
  const dir = path.resolve(process.cwd(), "src/db/migrations");
  const statements: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const text = readFileSync(path.join(dir, file), "utf8");
    if (!text.includes("cash_bank_kind")) continue;
    for (const part of text.split("--> statement-breakpoint")) {
      // Buang baris komentar SQL di kepala pernyataan (blok penjelasan
      // backfill mendahului UPDATE pertama di berkas migrasi).
      const stmt = part
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      if (stmt.startsWith('UPDATE "accounts"') && stmt.includes("cash_bank_kind")) {
        statements.push(stmt.replace(/;$/, ""));
      }
    }
  }
  return statements;
}

async function insertAccount(tx: Tx, companyId: string, code: string, name: string) {
  const [row] = await tx
    .insert(accounts)
    .values({ companyId, code, name, type: "asset", normalBalance: "debit" })
    .returning();
  expect(row).toBeDefined();
  expect(row.cashBankKind).toBeNull();
  return row;
}

async function kindOf(tx: Tx, companyId: string, accountId: string) {
  const [row] = await tx
    .select({ kind: accounts.cashBankKind })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)));
  return row?.kind ?? null;
}

describe("A-27 B1 — backfill kelas kas/bank dari pemetaan (SQL migrasi)", () => {
  it("pernyataan backfill ditemukan di migrasi terkirim", () => {
    expect(backfillStatements()).toHaveLength(3);
  });

  it("cash→cash, bank→bank, akun ganda bank+qris→bank (preseden), tanpa pemetaan→null", async () => {
    const rollbackA = makeRollbackTransaction(COMPANY_A);
    await rollbackA(async (tx) => {
      const kas = await insertAccount(tx, COMPANY_A, "B1KAS", "Kas Uji B1");
      const dual = await insertAccount(tx, COMPANY_A, "B1DUA", "Bank QRIS Uji B1");
      const lain = await insertAccount(tx, COMPANY_A, "B1LAIN", "Akun Lain B1");
      await tx.insert(accountMappings).values([
        { companyId: COMPANY_A, key: "cash", accountId: kas.id },
        { companyId: COMPANY_A, key: "bank", accountId: dual.id },
        { companyId: COMPANY_A, key: "qris", accountId: dual.id },
      ]);

      for (const stmt of backfillStatements()) await tx.execute(sql.raw(stmt));

      expect(await kindOf(tx, COMPANY_A, kas.id)).toBe("cash");
      // Satu akun tidak bisa dua kelas: preseden tetap migrasi
      // (cash → bank → clearing, yang pertama menang) memberi 'bank'.
      expect(await kindOf(tx, COMPANY_A, dual.id)).toBe("bank");
      // Tidak ditebak dari nama/kode: tanpa pemetaan tetap null.
      expect(await kindOf(tx, COMPANY_A, lain.id)).toBeNull();
    });
  });

  it("qris tunggal→clearing dan bank tunggal→bank", async () => {
    const rollbackB = makeRollbackTransaction(COMPANY_B);
    await rollbackB(async (tx) => {
      const qris = await insertAccount(tx, COMPANY_B, "B1QRS", "QRIS Uji B1");
      const bank = await insertAccount(tx, COMPANY_B, "B1BNK", "Bank Uji B1");
      await tx.insert(accountMappings).values([
        { companyId: COMPANY_B, key: "qris", accountId: qris.id },
        { companyId: COMPANY_B, key: "bank", accountId: bank.id },
      ]);

      for (const stmt of backfillStatements()) await tx.execute(sql.raw(stmt));

      expect(await kindOf(tx, COMPANY_B, qris.id)).toBe("clearing");
      expect(await kindOf(tx, COMPANY_B, bank.id)).toBe("bank");
    });
  });
});

describe("A-27 B1 — FK payment_methods.account_id → accounts.id", () => {
  it("metode dengan account_id yatim ditolak FK; yang sah diterima", async () => {
    const rollbackA = makeRollbackTransaction(COMPANY_A);
    await rollbackA(async (tx) => {
      const kas = await insertAccount(tx, COMPANY_A, "B1KAS", "Kas Uji B1");
      const [method] = await tx
        .insert(paymentMethods)
        .values({
          companyId: COMPANY_A,
          code: "B1CASH",
          name: "Tunai Uji B1",
          type: "cash",
          accountId: kas.id,
        })
        .returning();
      expect(method?.accountId).toBe(kas.id);
    });

    await expect(
      rollbackTransaction(COMPANY_A, async (tx) => {
        await tx.insert(paymentMethods).values({
          companyId: COMPANY_A,
          code: "B1BAD",
          name: "Yatim Uji B1",
          type: "bank",
          accountId: "01900000-0000-7000-8000-00000000ffff",
        });
      }),
    ).rejects.toThrow();
  });
});

describe("A-27 B1 — seed demo berkelas benar", () => {
  // Kode mengikuti bagan referensi: Tunai 110107, Kas Kecil 110101,
  // bank utama 11010201, QRIS clearing 110108, pendapatan 400001.
  it("Tunai/Kas Kecil cash, bank berincian, QRIS clearing; pendapatan tanpa kelas", async () => {
    const rows = await withCompanyReadOnly(DEMO_ID, async (tx) =>
      tx
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.companyId, DEMO_ID),
            inArray(accounts.code, ["110107", "110101", "11010201", "110108", "400001"]),
          ),
        ),
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get("110107")?.cashBankKind).toBe("cash");
    expect(byCode.get("110101")?.cashBankKind).toBe("cash");
    const bank = byCode.get("11010201");
    expect(bank?.cashBankKind).toBe("bank");
    expect(bank?.bankName).toBe("BCA");
    expect(bank?.bankAccountNumber).toBe("8210456789");
    expect(bank?.bankAccountHolder).toBe("Bisa Minimarket");
    expect(bank?.currency).toBe("IDR");
    expect(byCode.get("110108")?.cashBankKind).toBe("clearing");
    expect(byCode.get("400001")?.cashBankKind).toBeNull();
    expect(byCode.get("400001")?.currency).toBe("IDR");
  });
});
