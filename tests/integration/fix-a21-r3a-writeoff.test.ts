import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  customers,
  expenses,
  journalEntries,
  journalLines,
  partyOpeningBalances,
  partyPayments,
  sales,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { ensureFiscalPeriods, reverseJournalEntry } from "@/server/accounting";
import { createOpeningBalance } from "@/server/opening-balances";
import {
  writeOffExpensePayable,
  writeOffOpeningBalance,
  writeOffPayableReceipt,
  writeOffReceivableSale,
} from "@/server/party-writeoffs";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-21 Tahap R3-A Bagian 3 — write-off sisa pelunasan berizin (R3-07).
// Aksi TERPISAH pada dokumen (bukan di dalam pembayaran): sisa kecil
// yang tidak realistis ditagih/dibayar ditutup dengan alasan wajib,
// dibatasi ambang maksimum per perusahaan (company_settings.
// writeoff_max_amount; bawaan 0 = fitur mati). Implementasinya adalah
// baris party_payments berkunci jurnal pembayaran standar dokumen
// (`ar:`/`ap:`/`ap-expense:`/`ap-opening:` + seri PAYMENT) sehingga
// void yang sudah ada membaliknya persis dan hitung-ulang terbayar
// (Σ amount non-void) memulihkan sisa secara otomatis. Jurnal:
// piutang Dr 6100 Beban Piutang Tak Tertagih / Cr 1200 bertag;
// utang Dr 2000 / Cr pendapatan lain-lain (4030) bertag.

const ORG = "01900000-0000-7000-8000-00000000a219";
const USER_ID = "user-uji-a21-r3a-writeoff";
const RUN = `${Date.now()}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

const acc: Record<string, string> = {};
let warehouseId = "";

async function bootstrap() {
  await withCompany(ORG, async (tx) => {
    await ensureFiscalPeriods(tx, ORG, 2099);
    const [settings] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (!settings) {
      await tx.insert(companySettings).values({
        companyId: ORG,
        legalName: "Uji R3-A Write-Off",
        taxRate: "0",
        taxEnabled: false,
        // writeoffMaxAmount sengaja bawaan 0 — test mengaturnya per kasus.
      });
      const rows = await tx
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: ORG, code: "4030", name: "Pendapatan Lain-lain", type: "revenue", normalBalance: "credit" },
          // Akun 6100 SENGAJA tidak dibuat — ensure domain write-off
          // harus membuatnya malas + memetakannya (receivable_writeoff).
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "receivable", accountId: byCode.get("1200")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: ORG, key: "revenue", accountId: byCode.get("4000")! },
        { companyId: ORG, key: "other_income", accountId: byCode.get("4030")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-R3A3", name: "Gudang Uji R3-A3", type: "warehouse", isDefault: true })
        .returning({ id: warehouses.id });
      warehouseId = warehouse.id;
    }
    const accountRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, ORG));
    for (const row of accountRows) acc[row.code] = row.id;
    if (!warehouseId) {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      warehouseId = warehouse.id;
    }
  });
}

beforeAll(bootstrap);

let seq = 0;
function uniq(prefix: string) {
  seq += 1;
  return `${prefix}-${RUN}-${seq}`;
}

async function setWriteoffMax(tx: Tx, value: string) {
  await tx
    .update(companySettings)
    .set({ writeoffMaxAmount: value })
    .where(eq(companySettings.companyId, ORG));
}

async function makeCustomer(tx: Tx) {
  const [row] = await tx
    .insert(customers)
    .values({ companyId: ORG, code: uniq("CUS"), name: "Pelanggan Uji Write-Off" })
    .returning({ id: customers.id });
  return row;
}

async function makeSupplier(tx: Tx) {
  const [row] = await tx
    .insert(suppliers)
    .values({ companyId: ORG, code: uniq("SUP"), name: "Pemasok Uji Write-Off" })
    .returning({ id: suppliers.id });
  return row;
}

async function makeSale(tx: Tx, customerId: string, total: string, paidTotal: string) {
  const [row] = await tx
    .insert(sales)
    .values({
      companyId: ORG,
      warehouseId,
      number: uniq("INV"),
      date: "2099-01-05",
      cashierId: USER_ID,
      customerId,
      status: "completed",
      total,
      paidTotal,
      paymentStatus: "partial",
    })
    .returning({ id: sales.id, number: sales.number });
  return row;
}

async function makeReceipt(tx: Tx, supplierId: string, total: string, paidAmount: string) {
  const [row] = await tx
    .insert(stockReceipts)
    .values({
      companyId: ORG,
      warehouseId,
      number: uniq("GRN"),
      date: "2099-01-05",
      supplierId,
      source: "purchase",
      status: "posted",
      total,
      paidAmount,
      paymentStatus: "partial",
    })
    .returning({ id: stockReceipts.id, number: stockReceipts.number });
  return row;
}

async function journalByKey(tx: Tx, key: string) {
  const [entry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.idempotencyKey, key)))
    .limit(1);
  if (!entry) return { entry: null, lines: [], byCode: new Map<string, { debit: number; credit: number; partyId: string | null }>() };
  const lines = await tx
    .select({
      accountId: journalLines.accountId,
      code: accounts.code,
      debit: journalLines.debit,
      credit: journalLines.credit,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.entryId, entry.id));
  const byCode = new Map<string, { debit: number; credit: number; partyId: string | null }>();
  for (const line of lines) {
    byCode.set(line.code, {
      debit: Number(line.debit),
      credit: Number(line.credit),
      partyId: line.partyId,
    });
  }
  return { entry, lines, byCode };
}

async function paymentRow(tx: Tx, paymentId: string) {
  const [row] = await tx
    .select()
    .from(partyPayments)
    .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.id, paymentId)))
    .limit(1);
  return row;
}

const REASON = "Sisa selisih pembulatan, tidak realistis ditagih";

describe("R3-A Bagian 3 — write-off sisa pelunasan (R3-07)", () => {
  it("piutang: Dr beban write-off 6100 (dibuat malas) / Cr piutang bertag, dokumen lunas", async () => {
    await rollbackTransaction(async (tx) => {
      await setWriteoffMax(tx, "1000");
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "1000000", "999500");
      const result = await writeOffReceivableSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-20",
        reason: REASON,
      });
      expect(Number(result.amount)).toBe(500);
      const { byCode } = await journalByKey(tx, `ar:${sale.id}:${result.number}`);
      expect(byCode.get("6100")?.debit).toBe(500);
      expect(byCode.get("1200")?.credit).toBe(500);
      expect(byCode.get("1200")?.partyId).toBe(customer.id);
      // Baris pembayaran membawa alasan & akun lawan penyelesaian.
      const payment = await paymentRow(tx, result.paymentId);
      expect(payment.writeoffReason).toBe(REASON);
      expect(Number(payment.amount)).toBe(500);
      const [writeoffAccount] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG), eq(accounts.code, "6100")))
        .limit(1);
      expect(payment.accountId).toBe(writeoffAccount.id);
      // Dokumen lunas.
      const [updated] = await tx.select().from(sales).where(eq(sales.id, sale.id)).limit(1);
      expect(updated.paymentStatus).toBe("paid");
      expect(Number(updated.paidTotal)).toBe(1000000);
    });
  });

  it("utang penerimaan: Dr utang bertag / Cr pendapatan lain-lain, dokumen lunas", async () => {
    await rollbackTransaction(async (tx) => {
      await setWriteoffMax(tx, "1000");
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "500000", "499000");
      const result = await writeOffPayableReceipt(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-20",
        reason: REASON,
      });
      expect(Number(result.amount)).toBe(1000);
      const { byCode } = await journalByKey(tx, `ap:${receipt.id}:${result.number}`);
      expect(byCode.get("2000")?.debit).toBe(1000);
      expect(byCode.get("2000")?.partyId).toBe(supplier.id);
      expect(byCode.get("4030")?.credit).toBe(1000);
      const [updated] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(updated.paymentStatus).toBe("paid");
    });
  });

  it("ambang bawaan 0 = fitur mati: ditolak dan tidak ada jurnal/baris", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "100000", "99500");
      await expect(
        writeOffReceivableSale(tx, {
          companyId: ORG,
          userId: USER_ID,
          saleId: sale.id,
          date: "2099-01-20",
          reason: REASON,
        }),
      ).rejects.toThrow(/belum diaktifkan|ambang/i);
      const rows = await tx
        .select({ id: partyPayments.id })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      expect(rows).toHaveLength(0);
    });
  });

  it("sisa di atas ambang ditolak; alasan kosong/pendek ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      await setWriteoffMax(tx, "1000");
      const supplier = await makeSupplier(tx);
      const receipt = await makeReceipt(tx, supplier.id, "500000", "490000");
      await expect(
        writeOffPayableReceipt(tx, {
          companyId: ORG,
          userId: USER_ID,
          receiptId: receipt.id,
          date: "2099-01-20",
          reason: REASON,
        }),
      ).rejects.toThrow(/melebihi ambang/i);
      await expect(
        writeOffPayableReceipt(tx, {
          companyId: ORG,
          userId: USER_ID,
          receiptId: receipt.id,
          date: "2099-01-20",
          reason: "x",
        }),
      ).rejects.toThrow(/alasan/i);
    });
  });

  it("void membalik persis: jurnal pembalik menolkan akun write-off & piutang", async () => {
    await rollbackTransaction(async (tx) => {
      await setWriteoffMax(tx, "1000");
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "1000000", "999500");
      const result = await writeOffReceivableSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-20",
        reason: REASON,
      });
      const { entry } = await journalByKey(tx, `ar:${sale.id}:${result.number}`);
      await reverseJournalEntry(tx, {
        companyId: ORG,
        entryId: entry!.id,
        date: todayISO(),
        description: "Pembatalan write-off uji",
        createdBy: USER_ID,
      });
      // Neto per akun sesudah jurnal asal + pembalik harus nol.
      const [reversal] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.companyId, ORG), eq(journalEntries.reversalOfId, entry!.id)),
        )
        .limit(1);
      expect(reversal).toBeTruthy();
      const allLines = await tx
        .select({
          code: accounts.code,
          debit: journalLines.debit,
          credit: journalLines.credit,
        })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(
          sql`${journalLines.entryId} in (${entry!.id}, ${reversal.id})`,
        );
      const net = new Map<string, number>();
      for (const line of allLines) {
        net.set(line.code, (net.get(line.code) ?? 0) + Number(line.debit) - Number(line.credit));
      }
      expect(net.get("6100")).toBe(0);
      expect(net.get("1200")).toBe(0);
    });
  });

  it("beban terutang: sisa ditutup ke pendapatan lain-lain, status lunas", async () => {
    await rollbackTransaction(async (tx) => {
      await setWriteoffMax(tx, "1000");
      const supplier = await makeSupplier(tx);
      const [expense] = await tx
        .insert(expenses)
        .values({
          companyId: ORG,
          number: uniq("EXP"),
          date: "2099-01-05",
          description: "Jasa uji write-off",
          expenseAccountId: acc["4000"],
          paymentAccountId: null,
          supplierId: supplier.id,
          amount: "200000",
          paidAmount: "199500",
          paymentStatus: "partial",
          status: "posted",
          createdBy: USER_ID,
        })
        .returning({ id: expenses.id });
      const result = await writeOffExpensePayable(tx, {
        companyId: ORG,
        userId: USER_ID,
        expenseId: expense.id,
        date: "2099-01-20",
        reason: REASON,
      });
      expect(Number(result.amount)).toBe(500);
      const { byCode } = await journalByKey(tx, `ap-expense:${expense.id}:${result.number}`);
      expect(byCode.get("2000")?.debit).toBe(500);
      expect(byCode.get("4030")?.credit).toBe(500);
      const [updated] = await tx.select().from(expenses).where(eq(expenses.id, expense.id)).limit(1);
      expect(updated.paymentStatus).toBe("paid");
    });
  });

  it("saldo awal utang & piutang: write-off menutup dokumen menjadi settled", async () => {
    await rollbackTransaction(async (tx) => {
      await setWriteoffMax(tx, "500000");
      const supplier = await makeSupplier(tx);
      const openingPayable = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: "2099-01-01",
        amount: "300000",
      });
      const resultPayable = await writeOffOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: openingPayable.id,
        date: "2099-01-20",
        reason: REASON,
      });
      expect(Number(resultPayable.amount)).toBe(300000);
      const payableJournal = await journalByKey(tx, `ap-opening:${openingPayable.id}:${resultPayable.number}`);
      expect(payableJournal.byCode.get("2000")?.debit).toBe(300000);
      expect(payableJournal.byCode.get("4030")?.credit).toBe(300000);
      const [updatedPayable] = await tx
        .select()
        .from(partyOpeningBalances)
        .where(eq(partyOpeningBalances.id, openingPayable.id))
        .limit(1);
      expect(updatedPayable.status).toBe("settled");

      const customer = await makeCustomer(tx);
      const openingReceivable = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customer.id,
        date: "2099-01-01",
        amount: "100000",
      });
      const resultReceivable = await writeOffOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: openingReceivable.id,
        date: "2099-01-20",
        reason: REASON,
      });
      const receivableJournal = await journalByKey(tx, `ar-opening:${openingReceivable.id}:${resultReceivable.number}`);
      expect(receivableJournal.byCode.get("6100")?.debit).toBe(100000);
      expect(receivableJournal.byCode.get("1200")?.credit).toBe(100000);
      const [updatedReceivable] = await tx
        .select()
        .from(partyOpeningBalances)
        .where(eq(partyOpeningBalances.id, openingReceivable.id))
        .limit(1);
      expect(updatedReceivable.status).toBe("settled");
    });
  });

  it("dokumen sudah lunas ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      await setWriteoffMax(tx, "1000");
      const customer = await makeCustomer(tx);
      const sale = await makeSale(tx, customer.id, "100000", "100000");
      await tx
        .update(sales)
        .set({ paymentStatus: "paid" })
        .where(eq(sales.id, sale.id));
      await expect(
        writeOffReceivableSale(tx, {
          companyId: ORG,
          userId: USER_ID,
          saleId: sale.id,
          date: "2099-01-20",
          reason: REASON,
        }),
      ).rejects.toThrow(/lunas/i);
    });
  });
});
