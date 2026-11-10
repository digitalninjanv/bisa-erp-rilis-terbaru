import { describe, expect, it } from "vitest";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  cashMovements,
  cashSessions,
  companySettings,
  customers,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  salePayments,
  sales,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  cashDrawerMovement,
  closeCashSession,
  createSale,
  openCashSession,
  payReceivable,
  quoteCart,
  voidSale,
} from "@/server/pos";
import { getCashSessionSummary } from "@/server/reports";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Matriks Verifikasi Fitur POS (A-5) — test penutup celah integrasi yang
// belum teruji di suite Tahap 3 (P3-1 s.d. P3-3):
//  M-1 split payment campuran: jurnal per akun metode + kembalian tunai.
//  M-2 penjualan kredit (tempo) end-to-end: piutang lahir di jurnal,
//      lalu lunas bertahap lewat payReceivable.
//  M-3 tutup sesi berselisih: jurnal selisih kurang/lebih ke akun yang
//      benar dan sesi terkunci dari mutasi/tutup lanjutan.
//  M-4 void penjualan berpajak & berdiskon: jurnal balik mencerminkan
//      semua kaki (pendapatan, PPN, diskon, kas, HPP, persediaan).
//  M-5 jurnal setor/tarik ke bank (kaki jurnal POS-CASH-01 yang belum
//      pernah ditegaskan test; ringkasannya sudah teruji di P3-2).
// Semua skenario memakai transaksi rollback di perusahaan demo, meniru
// pola tests/integration/pos-returns.test.ts & pos-guards.test.ts.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const OTHER_USER = "01900000-0000-7000-8000-000000000099";
const OVER_USER = "kasir-uji-selisih-lebih";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function stockedProduct(tx: Tx, warehouseId: string, minQty: string) {
  const [row] = await tx
    .select({ productId: stockOnHand.productId, qty: stockOnHand.qty })
    .from(stockOnHand)
    .innerJoin(products, eq(stockOnHand.productId, products.id))
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        gt(stockOnHand.qty, minQty),
        eq(products.trackBatch, false),
      ),
    )
    .orderBy(asc(products.sku))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function methodByType(tx: Tx, type: string) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, type)))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function accountByCode(tx: Tx, code: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  expect(account).toBeDefined();
  return account;
}

async function setSettings(
  tx: Tx,
  patch: Partial<{ roundingMode: string; posDiscountThresholdPercent: string; taxRate: string; taxEnabled: boolean }>,
) {
  await tx.update(companySettings).set(patch).where(eq(companySettings.companyId, ORG_ID));
}

async function setPrice(tx: Tx, productId: string, salePrice: string) {
  await tx.update(products).set({ salePrice }).where(eq(products.id, productId));
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? "0");
}

type JournalLineRow = typeof journalLines.$inferSelect;

/** Jumlah debit/kredit per akun dari sekumpulan baris jurnal. */
function sumsByAccount(lines: JournalLineRow[]) {
  const map = new Map<string, { debit: ReturnType<typeof d>; credit: ReturnType<typeof d> }>();
  for (const line of lines) {
    const current = map.get(line.accountId) ?? { debit: d(0), credit: d(0) };
    current.debit = current.debit.plus(d(line.debit));
    current.credit = current.credit.plus(d(line.credit));
    map.set(line.accountId, current);
  }
  return map;
}

async function journalOf(tx: Tx, sourceType: string, sourceId: string) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
      ),
    );
  expect(entries).toHaveLength(1);
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entries[0].id));
  return { entry: entries[0], lines, sums: sumsByAccount(lines) };
}

/** Saldo debit-normal (debit − kredit) akun dari jurnal terposting. */
async function debitBalance(tx: Tx, accountId: string) {
  const [row] = await tx
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.status, "posted")));
  return d(row?.debit ?? "0").minus(d(row?.credit ?? "0"));
}

/* ------------------------------------------------------------------ */
/* M-1 — split payment campuran                                        */
/* ------------------------------------------------------------------ */

describe("Matriks POS M-1 — split payment tunai + QRIS (rollback)", () => {
  it("jurnal mendebit akun tiap metode sebesar porsinya; kembalian hanya dari kelebihan tunai", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none", taxRate: "0" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const cash = await methodByType(tx, "cash");
      const qris = await methodByType(tx, "qris");
      const revenue = await accountByCode(tx, "400001");
      const cogs = await accountByCode(tx, "5101");
      const inventory = await accountByCode(tx, "110401");

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 1 }],
        payments: [
          { methodId: cash.id, amount: 4000, tendered: 10000 },
          { methodId: qris.id, amount: 6000, tendered: 6000 },
        ],
        idempotencyKey: crypto.randomUUID(),
      });

      const [stored] = await tx
        .select({ costTotal: sales.costTotal })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const payments = await tx
        .select()
        .from(salePayments)
        .where(and(eq(salePayments.companyId, ORG_ID), eq(salePayments.saleId, sale.id)));
      const { sums } = await journalOf(tx, "sale", sale.id);
      const movements = await tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG_ID),
            eq(cashMovements.referenceId, sale.id),
            eq(cashMovements.type, "sale"),
          ),
        );

      const totalDebit = [...sums.values()].reduce((acc, s) => acc.plus(s.debit), d(0));
      const totalCredit = [...sums.values()].reduce((acc, s) => acc.plus(s.credit), d(0));
      return {
        sale,
        costTotal: d(stored.costTotal).toNumber(),
        paymentAmounts: payments
          .map((p) => ({ methodId: p.methodId, amount: d(p.amount).toNumber() }))
          .sort((a, b) => a.amount - b.amount),
        cashMethodId: cash.id,
        qrisMethodId: qris.id,
        debitOf: (accountId: string) => sums.get(accountId)?.debit.toNumber() ?? 0,
        creditOf: (accountId: string) => sums.get(accountId)?.credit.toNumber() ?? 0,
        cashAccountId: cash.accountId,
        qrisAccountId: qris.accountId,
        revenueId: revenue.id,
        cogsId: cogs.id,
        inventoryId: inventory.id,
        balanced: totalDebit.toFixed(4) === totalCredit.toFixed(4),
        movements: movements.map((m) => ({ type: m.type, amount: d(m.amount).toNumber() })),
      };
    });

    expect(outcome.sale.total).toBeCloseTo(10000, 2);
    // Kembalian 6.000 = tendered tunai 10.000 − porsi tunai 4.000;
    // QRIS pas sehingga tidak menyumbang kembalian.
    expect(outcome.sale.change).toBeCloseTo(6000, 2);
    expect(outcome.paymentAmounts).toEqual([
      { methodId: outcome.cashMethodId, amount: 4000 },
      { methodId: outcome.qrisMethodId, amount: 6000 },
    ]);
    // Jurnal: satu kaki debit per akun penampung metode.
    expect(outcome.debitOf(outcome.cashAccountId!)).toBeCloseTo(4000, 2);
    expect(outcome.debitOf(outcome.qrisAccountId!)).toBeCloseTo(6000, 2);
    expect(outcome.creditOf(outcome.revenueId)).toBeCloseTo(10000, 2);
    expect(outcome.debitOf(outcome.cogsId)).toBeCloseTo(outcome.costTotal, 2);
    expect(outcome.creditOf(outcome.inventoryId)).toBeCloseTo(outcome.costTotal, 2);
    expect(outcome.balanced).toBe(true);
    // Hanya porsi tunai yang menjadi mutasi laci.
    expect(outcome.movements).toEqual([{ type: "sale", amount: 4000 }]);
  });
});

/* ------------------------------------------------------------------ */
/* M-2 — penjualan kredit (tempo) end-to-end                           */
/* ------------------------------------------------------------------ */

describe("Matriks POS M-2 — penjualan kredit tempo end-to-end (rollback)", () => {
  it("piutang lahir sebagai debit piutang di jurnal penjualan, lalu lunas bertahap lewat payReceivable", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none", taxRate: "0" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const credit = await methodByType(tx, "credit");
      const cashAccount = await accountByCode(tx, "110107");
      const qrisAccount = await accountByCode(tx, "110108");
      const receivable = await accountByCode(tx, "110301");
      const [customer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.companyId, ORG_ID))
        .limit(1);
      expect(customer).toBeDefined();
      // Limit kredit dibuat deterministik: 0 = tanpa batas (aturan domain).
      await tx
        .update(customers)
        .set({ creditLimit: "0" })
        .where(eq(customers.id, customer.id));

      const balanceBefore = await debitBalance(tx, receivable.id);

      const lines = [{ productId: product.productId, qty: 1 }];
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        customerId: customer.id,
        lines,
      });
      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        customerId: customer.id,
        // POS-1 (D-19): penjualan utang kini wajib membawa jatuh tempo.
        dueDate: todayISO(),
        date: todayISO(),
        lines,
        payments: [{ methodId: credit.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });

      const [stored] = await tx
        .select({ paymentStatus: sales.paymentStatus, paidTotal: sales.paidTotal })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const { sums } = await journalOf(tx, "sale", sale.id);
      const balanceAfterSale = await debitBalance(tx, receivable.id);

      await payReceivable(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        amount: 4000,
        accountId: cashAccount.id,
      });
      const [afterPartial] = await tx
        .select({ paymentStatus: sales.paymentStatus, paidTotal: sales.paidTotal })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));

      await payReceivable(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        date: todayISO(),
        amount: 6000,
        accountId: qrisAccount.id,
      });
      const [afterFull] = await tx
        .select({ paymentStatus: sales.paymentStatus, paidTotal: sales.paidTotal })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const balanceAfterFull = await debitBalance(tx, receivable.id);

      return {
        total: quote.total,
        storedStatus: stored.paymentStatus,
        storedPaid: d(stored.paidTotal).toNumber(),
        receivableDebit: sums.get(receivable.id)?.debit.toNumber() ?? 0,
        cashDebit: sums.get(cashAccount.id)?.debit.toNumber() ?? 0,
        qrisDebit: sums.get(qrisAccount.id)?.debit.toNumber() ?? 0,
        saleDelta: balanceAfterSale.minus(balanceBefore).toNumber(),
        partialStatus: afterPartial.paymentStatus,
        partialPaid: d(afterPartial.paidTotal).toNumber(),
        fullStatus: afterFull.paymentStatus,
        fullPaid: d(afterFull.paidTotal).toNumber(),
        netDelta: balanceAfterFull.minus(balanceBefore).toNumber(),
      };
    });

    expect(outcome.total).toBeCloseTo(10000, 2);
    expect(outcome.storedStatus).toBe("unpaid");
    expect(outcome.storedPaid).toBe(0);
    // Piutang lahir di jurnal penjualan; tidak ada debit ke akun kas/QRIS.
    expect(outcome.receivableDebit).toBeCloseTo(10000, 2);
    expect(outcome.cashDebit).toBe(0);
    expect(outcome.qrisDebit).toBe(0);
    expect(outcome.saleDelta).toBeCloseTo(10000, 2);
    // Pelunasan bertahap: sebagian lalu lunas, saldo piutang kembali nol.
    expect(outcome.partialStatus).toBe("partial");
    expect(outcome.partialPaid).toBeCloseTo(4000, 2);
    expect(outcome.fullStatus).toBe("paid");
    expect(outcome.fullPaid).toBeCloseTo(10000, 2);
    expect(outcome.netDelta).toBeCloseTo(0, 2);
  });
});

/* ------------------------------------------------------------------ */
/* M-3 — tutup sesi dengan selisih                                     */
/* ------------------------------------------------------------------ */

describe("Matriks POS M-3 — tutup sesi berselisih (rollback)", () => {
  it("selisih kurang: jurnal Dr Selisih Kas Kurang / Cr Kas, sesi terkunci dari mutasi & tutup ulang", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none", taxRate: "0" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const cash = await methodByType(tx, "cash");
      const shortAccount = await accountByCode(tx, "720017");
      const cashAccount = await accountByCode(tx, "110107");

      const session = await openCashSession(tx, {
        companyId: ORG_ID,
        userId: OTHER_USER,
        openingCash: "50000",
      });
      const beforeSale = await getCashSessionSummary(tx, ORG_ID, session.id);
      expect(beforeSale).not.toBeNull();

      await createSale(tx, {
        companyId: ORG_ID,
        userId: OTHER_USER,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: product.productId, qty: 1 }],
        payments: [{ methodId: cash.id, amount: 10000, tendered: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      });

      const beforeClose = await getCashSessionSummary(tx, ORG_ID, session.id);
      expect(beforeClose).not.toBeNull();
      const expected = beforeClose!.expected;
      const counted = expected - 5000;

      const result = await closeCashSession(tx, {
        companyId: ORG_ID,
        userId: OTHER_USER,
        sessionId: session.id,
        countedCash: String(counted),
        // A-28 Tahap 1 (H-POS-02): selisih −5.000 melewati toleransi
        // bawaan Rp0 — alasan kini wajib di server.
        differenceReason: "Kembalian kurang saat jam ramai",
      });

      const [stored] = await tx
        .select({ status: cashSessions.status, difference: cashSessions.difference })
        .from(cashSessions)
        .where(and(eq(cashSessions.companyId, ORG_ID), eq(cashSessions.id, session.id)));
      const { sums } = await journalOf(tx, "cash_session", session.id);

      let movementError: unknown;
      try {
        await cashDrawerMovement(tx, {
          companyId: ORG_ID,
          userId: OTHER_USER,
          sessionId: session.id,
          type: "withdrawal",
          amount: 1000,
        });
      } catch (caught) {
        movementError = caught;
      }
      let closeError: unknown;
      try {
        await closeCashSession(tx, {
          companyId: ORG_ID,
          userId: OTHER_USER,
          sessionId: session.id,
          countedCash: String(counted),
        });
      } catch (caught) {
        closeError = caught;
      }

      return {
        openingExpected: beforeSale!.expected,
        expected,
        result,
        storedStatus: stored.status,
        storedDifference: d(stored.difference).toNumber(),
        shortDebit: sums.get(shortAccount.id)?.debit.toNumber() ?? 0,
        cashCredit: sums.get(cashAccount.id)?.credit.toNumber() ?? 0,
        cashDebit: sums.get(cashAccount.id)?.debit.toNumber() ?? 0,
        movementError,
        closeError,
      };
    });

    // expected versi ringkasan = modal awal + penjualan tunai sesi itu.
    expect(outcome.expected).toBeCloseTo(outcome.openingExpected + 10000, 2);
    expect(outcome.result.expected).toBeCloseTo(outcome.expected, 2);
    expect(outcome.result.difference).toBeCloseTo(-5000, 2);
    expect(outcome.storedStatus).toBe("closed");
    expect(outcome.storedDifference).toBeCloseTo(-5000, 2);
    // Jurnal selisih kurang: Dr 8000 Selisih Kas Kurang / Cr 1000 Kas.
    expect(outcome.shortDebit).toBeCloseTo(5000, 2);
    expect(outcome.cashCredit).toBeCloseTo(5000, 2);
    expect(outcome.cashDebit).toBe(0);
    // Sesi tertutup terkunci: mutasi laci dan tutup ulang sama-sama ditolak.
    expect(outcome.movementError).toMatchObject({ code: "INVALID_STATE" });
    expect(outcome.closeError).toMatchObject({ code: "INVALID_STATE" });
    expect((outcome.closeError as Error).message).toMatch(/sudah ditutup/);
  });

  it("selisih lebih: jurnal Dr Kas / Cr Selisih Kas Lebih", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const cashAccount = await accountByCode(tx, "110107");
      const overAccount = await accountByCode(tx, "710015");

      const session = await openCashSession(tx, {
        companyId: ORG_ID,
        userId: OVER_USER,
        openingCash: "0",
      });
      const summary = await getCashSessionSummary(tx, ORG_ID, session.id);
      expect(summary).not.toBeNull();
      const counted = summary!.expected + 3000;

      const result = await closeCashSession(tx, {
        companyId: ORG_ID,
        userId: OVER_USER,
        sessionId: session.id,
        countedCash: String(counted),
        differenceReason: "Kelebihan uang pelanggan belum dikembalikan",
      });
      const { sums } = await journalOf(tx, "cash_session", session.id);
      return {
        result,
        cashDebit: sums.get(cashAccount.id)?.debit.toNumber() ?? 0,
        overCredit: sums.get(overAccount.id)?.credit.toNumber() ?? 0,
        overDebit: sums.get(overAccount.id)?.debit.toNumber() ?? 0,
      };
    });

    expect(outcome.result.difference).toBeCloseTo(3000, 2);
    expect(outcome.cashDebit).toBeCloseTo(3000, 2);
    expect(outcome.overCredit).toBeCloseTo(3000, 2);
    expect(outcome.overDebit).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* M-5 — jurnal setor/tarik ke bank                                    */
/* ------------------------------------------------------------------ */

describe("Matriks POS M-5 — jurnal setoran & penarikan kas (rollback)", () => {
  it("setor: Dr Bank / Cr Kas; tarik: Dr Kas / Cr Bank — sesuai semantik D-9", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const bankAccount = await accountByCode(tx, "11010201");
      const cashAccount = await accountByCode(tx, "110107");

      // FIX-POS Tahap 1 (POS1-03): fixture disesuaikan — sesi kini
      // dibuka dengan modal Rp100.000 agar setoran Rp100.000 di bawah
      // FISIK mungkin. Bentuk lama (modal 0 lalu setor 100.000)
      // mengkode persis perilaku yang kini dilarang: setoran melebihi
      // isi laci menciptakan saldo bank & pendapatan fiktif. Maksud
      // test ini — arah jurnal D-9 — tidak berubah dan seluruh assert
      // jurnalnya sama.
      const session = await openCashSession(tx, {
        companyId: ORG_ID,
        userId: "kasir-uji-setor-tarik",
        openingCash: "100000",
      });
      await cashDrawerMovement(tx, {
        companyId: ORG_ID,
        userId: "kasir-uji-setor-tarik",
        sessionId: session.id,
        type: "deposit",
        amount: 100000,
      });
      await cashDrawerMovement(tx, {
        companyId: ORG_ID,
        userId: "kasir-uji-setor-tarik",
        sessionId: session.id,
        type: "withdrawal",
        amount: 40000,
      });

      const entries = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "cash_movement"),
            eq(journalEntries.sourceId, session.id),
          ),
        );
      expect(entries).toHaveLength(2);
      const byDescription = new Map<string, Map<string, { debit: number; credit: number }>>();
      for (const entry of entries) {
        const lines = await tx
          .select()
          .from(journalLines)
          .where(eq(journalLines.entryId, entry.id));
        const sums = sumsByAccount(lines);
        byDescription.set(
          entry.description,
          new Map(
            [...sums.entries()].map(([accountId, s]) => [
              accountId,
              { debit: s.debit.toNumber(), credit: s.credit.toNumber() },
            ]),
          ),
        );
      }
      return {
        deposit: byDescription.get("Setoran kas ke bank"),
        withdrawal: byDescription.get("Penarikan kas dari bank"),
        bankId: bankAccount.id,
        cashId: cashAccount.id,
      };
    });

    expect(outcome.deposit).toBeDefined();
    expect(outcome.deposit!.get(outcome.bankId)?.debit).toBeCloseTo(100000, 2);
    expect(outcome.deposit!.get(outcome.cashId)?.credit).toBeCloseTo(100000, 2);
    expect(outcome.withdrawal).toBeDefined();
    expect(outcome.withdrawal!.get(outcome.cashId)?.debit).toBeCloseTo(40000, 2);
    expect(outcome.withdrawal!.get(outcome.bankId)?.credit).toBeCloseTo(40000, 2);
  });
});

/* ------------------------------------------------------------------ */
/* M-4 — void penjualan berpajak & berdiskon                           */
/* ------------------------------------------------------------------ */

describe("Matriks POS M-4 — void penjualan berpajak & berdiskon (rollback)", () => {
  it("jurnal balik mencerminkan semua kaki penjualan; stok & kas sesi kembali seperti semula", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, {
        roundingMode: "none",
        taxRate: "11",
        // SIM-2 S2: penjualan berpajak mensyaratkan saklar PPN aktif.
        taxEnabled: true,
        posDiscountThresholdPercent: "50",
      });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "10000");
      const cash = await methodByType(tx, "cash");
      const cashAccount = await accountByCode(tx, "110107");
      const revenueAccount = await accountByCode(tx, "400001");
      const discountAccount = await accountByCode(tx, "440101");
      const taxAccount = await accountByCode(tx, "210201");
      const stockBefore = await stockQty(tx, warehouse.id, product.productId);

      const lines = [
        { productId: product.productId, qty: 2, discountType: "percent" as const, discountValue: 10 },
      ];
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines,
        asOfDate: todayISO(),
      });
      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines,
        payments: [{ methodId: cash.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });
      const stockAfterSale = await stockQty(tx, warehouse.id, product.productId);
      const original = await journalOf(tx, "sale", sale.id);

      await voidSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        reason: "Uji matriks void berpajak berdiskon",
      });

      const [stored] = await tx
        .select({ status: sales.status })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      const reversal = await journalOf(tx, "sale_reversal", sale.id);
      const stockAfterVoid = await stockQty(tx, warehouse.id, product.productId);
      const refunds = await tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG_ID),
            eq(cashMovements.referenceId, sale.id),
            eq(cashMovements.referenceType, "sale_void"),
          ),
        );

      // Cermin persis: untuk setiap akun, debit jurnal balik = kredit
      // jurnal asal dan sebaliknya, sehingga efek neto keduanya nol.
      const accountIds = new Set([...original.sums.keys(), ...reversal.sums.keys()]);
      const mirror: Record<string, { origDebit: number; origCredit: number; revDebit: number; revCredit: number }> = {};
      for (const accountId of accountIds) {
        mirror[accountId] = {
          origDebit: original.sums.get(accountId)?.debit.toNumber() ?? 0,
          origCredit: original.sums.get(accountId)?.credit.toNumber() ?? 0,
          revDebit: reversal.sums.get(accountId)?.debit.toNumber() ?? 0,
          revCredit: reversal.sums.get(accountId)?.credit.toNumber() ?? 0,
        };
      }

      return {
        quote: {
          subtotal: quote.subtotal,
          discountTotal: quote.discountTotal,
          taxTotal: quote.taxTotal,
          total: quote.total,
        },
        saleTotal: sale.total,
        status: stored.status,
        stockBefore,
        stockAfterSale,
        stockAfterVoid,
        mirror,
        discountDebit: original.sums.get(discountAccount.id)?.debit.toNumber() ?? 0,
        taxCredit: original.sums.get(taxAccount.id)?.credit.toNumber() ?? 0,
        cashDebit: original.sums.get(cashAccount.id)?.debit.toNumber() ?? 0,
        revenueCredit: original.sums.get(revenueAccount.id)?.credit.toNumber() ?? 0,
        refunds: refunds.map((m) => ({ type: m.type, amount: d(m.amount).toNumber() })),
      };
    });

    // Penjualan asal benar-benar berpajak & berdiskon (bukan nol semua):
    // bruto 20.000, diskon 10% = 2.000, total 18.000 termasuk PPN 11%.
    expect(outcome.quote.discountTotal).toBeCloseTo(2000, 2);
    expect(outcome.quote.taxTotal).toBeGreaterThan(0);
    expect(outcome.saleTotal).toBeCloseTo(18000, 2);
    expect(outcome.discountDebit).toBeCloseTo(2000, 2);
    expect(outcome.taxCredit).toBeCloseTo(outcome.quote.taxTotal, 2);
    expect(outcome.cashDebit).toBeCloseTo(18000, 2);
    // Pendapatan dikredit BRUTO (aturan proyek): subtotal sebelum diskon
    // dikurangi pajak inklusifnya; diskon berdiri sendiri sebagai debit
    // contra-revenue 4010 — bukan pengurang kaki pendapatan.
    expect(outcome.revenueCredit).toBeCloseTo(
      outcome.quote.subtotal - outcome.quote.taxTotal,
      2,
    );

    expect(outcome.status).toBe("void");
    for (const [accountId, sums] of Object.entries(outcome.mirror)) {
      expect(sums.revDebit, `akun ${accountId}: debit balik = kredit asal`).toBeCloseTo(sums.origCredit, 4);
      expect(sums.revCredit, `akun ${accountId}: kredit balik = debit asal`).toBeCloseTo(sums.origDebit, 4);
    }
    expect(outcome.stockAfterSale.toFixed(4)).toBe(outcome.stockBefore.minus(2).toFixed(4));
    expect(outcome.stockAfterVoid.toFixed(4)).toBe(outcome.stockBefore.toFixed(4));
    // Kas sesi dinetralkan oleh satu mutasi refund sebesar total tunai.
    expect(outcome.refunds).toEqual([{ type: "refund", amount: -18000 }]);
  });
});
