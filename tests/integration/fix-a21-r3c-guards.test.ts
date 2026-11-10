import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  accountMappings,
  accounts,
  bankTransfers,
  companySettings,
  expenses,
  journalEntries,
  partyPayments,
  products,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { createBankTransfer } from "@/server/bank-transfers";
import { createExpense } from "@/server/expenses";
import { createReceipt } from "@/server/inventory";
import { payPayableDocument } from "@/server/payables";
import { payPayableFifo } from "@/server/quick-entry";
import {
  createBankTransferAction,
  createExpenseAction,
} from "@/server/actions/accounting/beban-transfer";
import { getQuickEntryBootstrapAction } from "@/server/actions/quick-entry";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-21 Tahap R3-C — seragamkan penjaga domain & idempotensi (audit R3):
//   R3-03 validasi akun saluran (assertCashLikeAccount) + tipe akun beban
//         belum ditegakkan di domain payPayableDocument, createExpense,
//         createBankTransfer — jalur tetangga sudah menegakkannya;
//   R3-04 form khusus Beban & Transfer tidak mengirim kunci idempotensi
//         klien (pola AK-P3-02) sehingga kirim ulang membuat dokumen
//         ganda;
//   R3-15 penjaga tanggal pembayaran mendahului dokumen hanya ada di
//         sisi piutang (POS1-12); daftar akun beban bootstrap input
//         cepat memuat cogs sementara halaman Beban khusus hanya
//         expense.
// Semua skenario domain berjalan di perusahaan fixture KHUSUS berkas
// ini (a210) dalam transaksi rollback; uji aksi berjalan ter-commit
// dengan penanda unik per larian.

const ORG_ID = "01900000-0000-7000-8000-00000000a210";
const USER_ID = "user-uji-a21-r3c";
const TODAY = todayISO();
const YESTERDAY = (() => {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
})();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: ORG_ID },
    user: { id: USER_ID },
    role: "owner",
  });
  return {
    requireAuth: requirePermission,
    requirePermission,
    requirePermissionInModule: requirePermission,
  };
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1100", "Bank BCA", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["6010", "Beban Sewa", "expense", "debit"],
  ["6060", "Beban Administrasi Bank", "expense", "debit"],
];

const MAPPING_SEEDS: Record<string, string> = {
  cash: "1000",
  bank: "1100",
  qris: "1110",
  receivable: "1200",
  inventory: "1300",
  payable: "2000",
  equity: "3000",
  revenue: "4000",
  cogs: "5000",
  bank_fee: "6060",
};

let warehouseId = "";
let supplierId = "";
let productId = "";

async function ensureFixtureCompany() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
    // A-27 B2: perusahaan fixture yang lahir sebelum B1 belum punya
    // kelas kas/bank — samakan dengan hasil migrasi 0055 (backfill
    // dari pemetaan, preseden cash→bank→clearing) secara idempoten.
    for (const [key, kind] of [["cash", "cash"], ["bank", "bank"], ["qris", "clearing"]] as const) {
      await tx.execute(
        sql`update "accounts" set "cash_bank_kind" = ${kind} where "company_id" = ${ORG_ID} and "cash_bank_kind" is null and "id" in (select "account_id" from "account_mappings" where "company_id" = ${ORG_ID} and "key" = ${key})`,
      );
    }
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG_ID))
      .limit(1);
    if (existing) return;

    await tx.insert(companySettings).values({
      companyId: ORG_ID,
      legalName: "Uji A-21 R3-C",
      roundingMode: "none",
      taxRate: "0",
      taxEnabled: false,
    });

    const accountRows = await tx
      .insert(accounts)
      .values(
        ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
          companyId: ORG_ID,
          code,
          name,
          type,
          normalBalance,
          // A-27 B1/B2: akun terpetakan cash/bank/qris berkelas —
          // kelas diturunkan dari MAPPING_SEEDS, meniru backfill
          // migrasi 0055.
          cashBankKind:
            MAPPING_SEEDS.cash === code
              ? "cash"
              : MAPPING_SEEDS.bank === code
                ? "bank"
                : MAPPING_SEEDS.qris === code
                  ? "clearing"
                  : null,
        })),
      )
      .returning();
    const acc = new Map(accountRows.map((row) => [row.code, row.id]));
    await tx.insert(accountMappings).values(
      Object.entries(MAPPING_SEEDS).map(([key, code]) => ({
        companyId: ORG_ID,
        key,
        accountId: acc.get(code)!,
      })),
    );

    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId: ORG_ID, name: "Gudang Uji R3C", code: "GD-R3C" })
      .returning();
    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId: ORG_ID, code: "SUP-R3C", name: "PT Pemasok Uji R3C" })
      .returning();
    const [product] = await tx
      .insert(products)
      .values({
        companyId: ORG_ID,
        sku: "R3C-001",
        name: "Produk Uji R3C",
        costPrice: "0",
        salePrice: "150000",
      })
      .returning();
    warehouseId = warehouse.id;
    supplierId = supplier.id;
    productId = product.id;
  });

  if (!warehouseId) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG_ID))
        .limit(1);
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_ID))
        .limit(1);
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, ORG_ID))
        .limit(1);
      warehouseId = warehouse.id;
      supplierId = supplier.id;
      productId = product.id;
    });
  }
}

beforeAll(ensureFixtureCompany);

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

async function accountIdByCode(tx: Tx, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  if (!row) throw new Error(`Akun ${code} tidak ada di fixture`);
  return row.id;
}

async function createCreditReceipt(tx: Tx, date: string) {
  return createReceipt(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    supplierId,
    source: "purchase",
    date,
    lines: [{ productId, qty: "2", unitCost: "500000" }],
  });
}

async function expectValidation(promise: Promise<unknown>, messagePart: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe("VALIDATION");
  expect((caught as AppError).message).toContain(messagePart);
}

/* ------------------------------------------------------------------ */
/* R3-03 — payPayableDocument memvalidasi akun saluran                 */
/* ------------------------------------------------------------------ */

describe("R3-03 pembayaran utang: akun saluran divalidasi domain", () => {
  it("akun persediaan sebagai saluran pembayaran DITOLAK; tidak ada pembayaran tercatat", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await createCreditReceipt(tx, TODAY);
      const inventoryId = await accountIdByCode(tx, "1300");
      await expectValidation(
        payPayableDocument(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          receiptId: receipt.id,
          date: TODAY,
          amount: "400000",
          accountId: inventoryId,
        }),
        "bukan akun berkelas kas, bank, atau kliring",
      );
      const payments = await tx
        .select({ id: partyPayments.id })
        .from(partyPayments)
        .where(eq(partyPayments.companyId, ORG_ID));
      expect(payments).toHaveLength(0);
      const [row] = await tx
        .select({ paidAmount: stockReceipts.paidAmount })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(d(row.paidAmount).toFixed(0)).toBe("0");
    });
  });

  it("akun bank yang sah tetap lolos (perilaku lama tidak berubah)", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await createCreditReceipt(tx, TODAY);
      const bankId = await accountIdByCode(tx, "1100");
      const result = await payPayableDocument(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: receipt.id,
        date: TODAY,
        amount: "400000",
        accountId: bankId,
      });
      expect(result.number).toBeTruthy();
      const [row] = await tx
        .select({ paidAmount: stockReceipts.paidAmount })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(d(row.paidAmount).toFixed(0)).toBe("400000");
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3-15 — penjaga tanggal pembayaran utang (simetris POS1-12)         */
/* ------------------------------------------------------------------ */

describe("R3-15 pembayaran utang: tanggal tidak boleh mendahului penerimaan", () => {
  it("pembayaran dokumen bertanggal sebelum penerimaan DITOLAK", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await createCreditReceipt(tx, TODAY);
      const bankId = await accountIdByCode(tx, "1100");
      await expectValidation(
        payPayableDocument(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          receiptId: receipt.id,
          date: YESTERDAY,
          amount: "400000",
          accountId: bankId,
        }),
        "lebih awal dari tanggal penerimaan",
      );
    });
  });

  it("pembayaran FIFO bertanggal sebelum penerimaan DITOLAK", async () => {
    await rollbackTransaction(async (tx) => {
      await createCreditReceipt(tx, TODAY);
      const bankId = await accountIdByCode(tx, "1100");
      await expectValidation(
        payPayableFifo(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          supplierId,
          date: YESTERDAY,
          amount: "400000",
          accountId: bankId,
        }),
        "lebih awal dari tanggal penerimaan",
      );
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3-03 — createExpense memvalidasi akun pembayaran & tipe akun beban */
/* ------------------------------------------------------------------ */

describe("R3-03 beban: akun pembayaran & akun beban divalidasi domain", () => {
  it("akun utang sebagai akun pembayaran DITOLAK", async () => {
    await rollbackTransaction(async (tx) => {
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const payableId = await accountIdByCode(tx, "2000");
      await expectValidation(
        createExpense(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          date: TODAY,
          expenseAccountId,
          paymentAccountId: payableId,
          amount: "250000",
          description: "Beban dibayar dari akun utang",
        }),
        "bukan akun berkelas kas, bank, atau kliring",
      );
    });
  });

  it("akun HPP (cogs) sebagai akun beban DITOLAK", async () => {
    await rollbackTransaction(async (tx) => {
      const cogsId = await accountIdByCode(tx, "5000");
      const cashId = await accountIdByCode(tx, "1000");
      await expectValidation(
        createExpense(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          date: TODAY,
          expenseAccountId: cogsId,
          paymentAccountId: cashId,
          amount: "250000",
          description: "Beban berkedok HPP",
        }),
        "5000",
      );
    });
  });

  it("akun pendapatan sebagai akun beban DITOLAK", async () => {
    await rollbackTransaction(async (tx) => {
      const revenueId = await accountIdByCode(tx, "4000");
      const cashId = await accountIdByCode(tx, "1000");
      await expectValidation(
        createExpense(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          date: TODAY,
          expenseAccountId: revenueId,
          paymentAccountId: cashId,
          amount: "250000",
          description: "Beban berkedok pendapatan",
        }),
        "4000",
      );
    });
  });

  it("kombinasi sah (beban expense + kas) tetap lolos", async () => {
    await rollbackTransaction(async (tx) => {
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const cashId = await accountIdByCode(tx, "1000");
      const result = await createExpense(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId,
        paymentAccountId: cashId,
        amount: "250000",
        description: "Sewa toko uji R3C",
      });
      expect(result.number).toBeTruthy();
      const journals = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "expense"),
            eq(journalEntries.sourceId, result.id),
          ),
        );
      expect(journals).toHaveLength(1);
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3-03 — createBankTransfer memvalidasi kedua rekening               */
/* ------------------------------------------------------------------ */

describe("R3-03 transfer bank: kedua rekening divalidasi domain", () => {
  it("rekening asal persediaan DITOLAK", async () => {
    await rollbackTransaction(async (tx) => {
      const inventoryId = await accountIdByCode(tx, "1300");
      const bankId = await accountIdByCode(tx, "1100");
      await expectValidation(
        createBankTransfer(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          date: TODAY,
          fromAccountId: inventoryId,
          toAccountId: bankId,
          amount: "100000",
        }),
        "bukan akun berkelas kas, bank, atau kliring",
      );
    });
  });

  it("rekening tujuan pendapatan DITOLAK", async () => {
    await rollbackTransaction(async (tx) => {
      const cashId = await accountIdByCode(tx, "1000");
      const revenueId = await accountIdByCode(tx, "4000");
      await expectValidation(
        createBankTransfer(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          date: TODAY,
          fromAccountId: cashId,
          toAccountId: revenueId,
          amount: "100000",
        }),
        "bukan akun berkelas kas, bank, atau kliring",
      );
    });
  });

  it("transfer kas ke bank yang sah tetap lolos", async () => {
    await rollbackTransaction(async (tx) => {
      const cashId = await accountIdByCode(tx, "1000");
      const bankId = await accountIdByCode(tx, "1100");
      const result = await createBankTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        fromAccountId: cashId,
        toAccountId: bankId,
        amount: "100000",
      });
      expect(result.number).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3-04 — idempotensi klien di domain beban & transfer                */
/* ------------------------------------------------------------------ */

describe("R3-04 beban: kunci idempotensi klien mencegah dokumen ganda", () => {
  it("dua panggilan berkunci sama menghasilkan SATU beban dan SATU jurnal", async () => {
    await rollbackTransaction(async (tx) => {
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const cashId = await accountIdByCode(tx, "1000");
      const key = "uji-r3c-expense-samekunci";
      const input = {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId,
        paymentAccountId: cashId,
        amount: "250000",
        description: "Beban idempoten uji R3C",
        idempotencyKey: key,
      };
      const first = await createExpense(tx, input);
      const second = await createExpense(tx, input);
      expect(second.id).toBe(first.id);
      expect(second.number).toBe(first.number);
      // Hitungan di-scope ke kunci ini: perusahaan fixture juga memuat
      // dokumen ter-commit dari uji aksi di berkas yang sama.
      const docs = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG_ID), eq(expenses.idempotencyKey, key)));
      expect(docs).toHaveLength(1);
      const journals = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "expense"),
            eq(journalEntries.sourceId, first.id),
          ),
        );
      expect(journals).toHaveLength(1);
    });
  });

  it("kunci berbeda menghasilkan dua beban yang sah", async () => {
    await rollbackTransaction(async (tx) => {
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const cashId = await accountIdByCode(tx, "1000");
      const base = {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId,
        paymentAccountId: cashId,
        amount: "250000",
        description: "Beban dua kunci uji R3C",
      };
      const first = await createExpense(tx, { ...base, idempotencyKey: "uji-r3c-expense-kunci-a" });
      const second = await createExpense(tx, { ...base, idempotencyKey: "uji-r3c-expense-kunci-b" });
      expect(second.id).not.toBe(first.id);
      const docs = await tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(
          and(
            eq(expenses.companyId, ORG_ID),
            inArray(expenses.id, [first.id, second.id]),
          ),
        );
      expect(docs).toHaveLength(2);
    });
  });
});

describe("R3-04 transfer: kunci idempotensi klien mencegah dokumen ganda", () => {
  it("dua panggilan berkunci sama menghasilkan SATU transfer dan SATU jurnal", async () => {
    await rollbackTransaction(async (tx) => {
      const cashId = await accountIdByCode(tx, "1000");
      const bankId = await accountIdByCode(tx, "1100");
      const input = {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        fromAccountId: cashId,
        toAccountId: bankId,
        amount: "100000",
        idempotencyKey: "uji-r3c-transfer-samekunci",
      };
      const first = await createBankTransfer(tx, input);
      const second = await createBankTransfer(tx, input);
      expect(second.id).toBe(first.id);
      expect(second.number).toBe(first.number);
      const docs = await tx
        .select({ id: bankTransfers.id })
        .from(bankTransfers)
        .where(
          and(
            eq(bankTransfers.companyId, ORG_ID),
            eq(bankTransfers.idempotencyKey, "uji-r3c-transfer-samekunci"),
          ),
        );
      expect(docs).toHaveLength(1);
      const journals = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "bank_transfer"),
            eq(journalEntries.sourceId, first.id),
          ),
        );
      expect(journals).toHaveLength(1);
    });
  });

  it("kunci berbeda menghasilkan dua transfer yang sah", async () => {
    await rollbackTransaction(async (tx) => {
      const cashId = await accountIdByCode(tx, "1000");
      const bankId = await accountIdByCode(tx, "1100");
      const base = {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        fromAccountId: cashId,
        toAccountId: bankId,
        amount: "100000",
      };
      const first = await createBankTransfer(tx, { ...base, idempotencyKey: "uji-r3c-transfer-kunci-a" });
      const second = await createBankTransfer(tx, { ...base, idempotencyKey: "uji-r3c-transfer-kunci-b" });
      expect(second.id).not.toBe(first.id);
      const docs = await tx
        .select({ id: bankTransfers.id })
        .from(bankTransfers)
        .where(
          and(
            eq(bankTransfers.companyId, ORG_ID),
            inArray(bankTransfers.id, [first.id, second.id]),
          ),
        );
      expect(docs).toHaveLength(2);
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3-04 — jalur aksi: submit ulang dari form tidak menggandakan       */
/* ------------------------------------------------------------------ */

describe("R3-04 aksi beban & transfer: kunci dari klien diteruskan", () => {
  it("createExpenseAction dua kali berkunci sama → satu dokumen beban", async () => {
    const runId = crypto.randomUUID().slice(0, 8);
    const marker = `Uji idempotensi aksi R3C ${runId}`;
    const key = `uji-r3c-aksi-expense-${runId}`;
    const { expenseAccount, cashAccount } = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [expenseRow] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "6010")))
        .limit(1);
      const [cashRow] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "1000")))
        .limit(1);
      return { expenseAccount: expenseRow, cashAccount: cashRow };
    });
    const payload = {
      date: TODAY,
      expenseAccountId: expenseAccount.id,
      paymentAccountId: cashAccount.id,
      amount: "125000",
      description: marker,
      idempotencyKey: key,
    };
    const first = await createExpenseAction(payload);
    const second = await createExpenseAction(payload);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.number).toBe(first.data.number);
    }
    const docs = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG_ID), eq(expenses.description, marker))),
    );
    expect(docs).toHaveLength(1);
  });

  it("createBankTransferAction dua kali berkunci sama → satu dokumen transfer", async () => {
    const runId = crypto.randomUUID().slice(0, 8);
    const marker = `Uji idempotensi aksi R3C ${runId}`;
    const key = `uji-r3c-aksi-transfer-${runId}`;
    const { cashAccount, bankAccount } = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [cashRow] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "1000")))
        .limit(1);
      const [bankRow] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "1100")))
        .limit(1);
      return { cashAccount: cashRow, bankAccount: bankRow };
    });
    const payload = {
      date: TODAY,
      fromAccountId: cashAccount.id,
      toAccountId: bankAccount.id,
      amount: "75000",
      reference: marker,
      idempotencyKey: key,
    };
    const first = await createBankTransferAction(payload);
    const second = await createBankTransferAction(payload);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.number).toBe(first.data.number);
    }
    const docs = await withCompanyReadOnly(ORG_ID, (tx) =>
      tx
        .select({ id: bankTransfers.id })
        .from(bankTransfers)
        .where(and(eq(bankTransfers.companyId, ORG_ID), eq(bankTransfers.reference, marker))),
    );
    expect(docs).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* R3-15 — bootstrap input cepat: daftar akun beban = halaman khusus   */
/* ------------------------------------------------------------------ */

describe("R3-15 bootstrap Catat Transaksi: akun beban hanya tipe expense", () => {
  it("expenseAccounts tidak memuat cogs dan memuat akun beban fixture", async () => {
    const result = await getQuickEntryBootstrapAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codes = result.data.expenseAccounts.map((row) => row.code);
    expect(codes).toContain("6010");
    expect(codes).not.toContain("5000");
    expect(result.data.expenseAccounts.every((row) => row.type === "expense")).toBe(true);
  });
});
