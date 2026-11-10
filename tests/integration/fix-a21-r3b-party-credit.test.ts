import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  customers,
  expenses,
  journalEntries,
  journalLines,
  partyCredits,
  partyOpeningBalances,
  partyPayments,
  sales,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { ensureFiscalPeriods } from "@/server/accounting";
import {
  createOpeningBalance,
  payOpeningBalance,
  voidOpeningPayment,
} from "@/server/opening-balances";
import { payExpensePayable, payPayableDocument } from "@/server/payables";
import {
  getPartyCreditAvailable,
  listPartyCredits,
} from "@/server/party-credits";
import { payReceivable } from "@/server/pos/receivables";
import { payPayableFifo, receiveReceivableFifo } from "@/server/quick-entry";
import { listReceivables } from "@/server/reports";
import { payReceivableAction, voidReceivablePaymentAction } from "@/server/actions/pos";
import { d } from "@/lib/money";
import { makeFlexibleRollbackTransaction } from "../helpers/rollback-transaction";

// A-21 Tahap R3-B — kelebihan bayar & dokumen kredit pihak (R3-02,
// sisa AK3-05): pembayaran yang melebihi sisa tagihan tidak lagi
// ditolak; kelebihannya menjadi dokumen kredit pihak bernomor
// (seri PARTY_CREDIT) yang tampil sebagai kredit tersedia per pihak
// dan dapat dipakai melunasi dokumen berikutnya lewat jalur
// pembayaran yang ada sebagai sumber dana "kredit" (tanpa jurnal
// kas). Preseden yang digeneralisasi: klaim retur pemasok A-9
// (akun 1210, pemetaan supplier_credit) dan kredit retur pelanggan
// POS (akun 2300, pemetaan customer_credit) — keduanya dokumen asal
// yang memegang klaim + counter terpakai; di sini dokumen asal
// kelebihan bayar adalah pembayaran itu sendiri, jadi klaimnya
// mendapat dokumennya sendiri.
// Domain diuji dalam transaksi rollback; rantai void aksi
// ter-commit dengan penanda unik per larian — perusahaan fixture
// khusus berkas ini.

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000a213" },
    user: { id: "user-uji-a21-r3b" },
    role: "owner",
  });
  return {
    requireAuth: requirePermission,
    requirePermission,
    requirePermissionInModule: requirePermission,
  };
});

const ORG = "01900000-0000-7000-8000-00000000a213";
const DEMO_ORG = "01900000-0000-7000-8000-000000000001";
const USER_ID = "user-uji-a21-r3b";
const RUN = `${Date.now()}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeFlexibleRollbackTransaction(ORG);

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
        legalName: "Uji R3-B",
        taxRate: "0",
        taxEnabled: false,
      });
      const rows = await tx
        // AUD-001/A-27: cashBankKind diisi eksplisit — sejak A-27 validator
        // kas/bank membaca kolom ini; fixture tidak boleh bergantung pada
        // residu lama yang dulu ter-backfill (residu itu kini dibersihkan).
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
          { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", cashBankKind: "bank" },
          { companyId: ORG, code: "1110", name: "QRIS", type: "asset", normalBalance: "debit", cashBankKind: "clearing" },
          { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "2300", name: "Kredit Pelanggan", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "6100", name: "Beban Listrik", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "qris", accountId: byCode.get("1110")! },
        { companyId: ORG, key: "receivable", accountId: byCode.get("1200")! },
        { companyId: ORG, key: "supplier_credit", accountId: byCode.get("1210")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "customer_credit", accountId: byCode.get("2300")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-R3B", name: "Gudang Uji R3B", type: "warehouse", isDefault: true })
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

async function makeCustomer(tx: Tx, name: string) {
  const [row] = await tx
    .insert(customers)
    .values({ companyId: ORG, code: uniq("CST-R3B"), name })
    .returning({ id: customers.id });
  return row;
}

async function makeSupplier(tx: Tx, name: string) {
  const [row] = await tx
    .insert(suppliers)
    .values({ companyId: ORG, code: uniq("SUP-R3B"), name })
    .returning({ id: suppliers.id });
  return row;
}

async function makeSale(
  tx: Tx,
  input: { customerId: string; total: string; paidTotal?: string; date?: string },
) {
  const paidTotal = input.paidTotal ?? "0";
  const [row] = await tx
    .insert(sales)
    .values({
      companyId: ORG,
      warehouseId,
      number: uniq("INV-R3B"),
      date: input.date ?? "2099-01-05",
      cashierId: USER_ID,
      customerId: input.customerId,
      status: "completed",
      total: input.total,
      paidTotal,
      paymentStatus: d(paidTotal).gte(d(input.total)) ? "paid" : d(paidTotal).gt(0) ? "partial" : "unpaid",
    })
    .returning({ id: sales.id, number: sales.number });
  return row;
}

async function makeReceipt(
  tx: Tx,
  input: { supplierId: string; total: string; date?: string },
) {
  const [row] = await tx
    .insert(stockReceipts)
    .values({
      companyId: ORG,
      warehouseId,
      supplierId: input.supplierId,
      source: "purchase",
      number: uniq("RCV-R3B"),
      date: input.date ?? "2099-01-05",
      status: "posted",
      total: input.total,
      paidAmount: "0",
      paymentStatus: "unpaid",
    })
    .returning({ id: stockReceipts.id, number: stockReceipts.number });
  return row;
}

async function makeExpensePayable(
  tx: Tx,
  input: { supplierId: string; amount: string; date?: string },
) {
  const [row] = await tx
    .insert(expenses)
    .values({
      companyId: ORG,
      number: uniq("EXP-R3B"),
      date: input.date ?? "2099-01-05",
      description: `Beban terutang ${uniq("R3B")}`,
      expenseAccountId: acc["6100"],
      paymentAccountId: null,
      supplierId: input.supplierId,
      amount: input.amount,
      paidAmount: "0",
      paymentStatus: "unpaid",
      status: "posted",
    })
    .returning({ id: expenses.id, number: expenses.number });
  return row;
}

type LineRow = {
  accountId: string;
  debit: string;
  credit: string;
  partyType: string | null;
  partyId: string | null;
};

async function linesOf(tx: Tx, entryId: string): Promise<LineRow[]> {
  return tx
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
    })
    .from(journalLines)
    .where(and(eq(journalLines.companyId, ORG), eq(journalLines.entryId, entryId)))
    .orderBy(journalLines.lineNo);
}

async function entryByKey(tx: Tx, key: string) {
  const [entry] = await tx
    .select({ id: journalEntries.id, number: journalEntries.number })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.idempotencyKey, key)))
    .limit(1);
  return entry;
}

function expectLine(
  lines: LineRow[],
  accountId: string,
  side: "debit" | "credit",
  amount: string,
  partyId?: string,
) {
  const line = lines.find((row) => row.accountId === accountId);
  expect(line, `baris jurnal untuk akun ${accountId}`).toBeTruthy();
  expect(d(line![side]).eq(d(amount)), `${side} akun ${accountId}`).toBe(true);
  const other = side === "debit" ? "credit" : "debit";
  expect(d(line![other]).eq(0)).toBe(true);
  if (partyId) expect(line!.partyId).toBe(partyId);
  return line!;
}

async function creditsOf(tx: Tx, partyId: string) {
  return tx
    .select()
    .from(partyCredits)
    .where(and(eq(partyCredits.companyId, ORG), eq(partyCredits.partyId, partyId)))
    .orderBy(partyCredits.createdAt);
}

/* ------------------------------------------------------------------ */
/* Piutang — kelebihan bayar per dokumen melahirkan kredit pelanggan   */
/* ------------------------------------------------------------------ */

describe("R3-02 piutang per dokumen (rollback)", () => {
  it("bayar melebihi sisa: jurnal Dr kas penuh / Cr piutang sebesar sisa / Cr kredit pelanggan sebesar kelebihan; baris pembayaran = porsi teralokasi; dokumen kredit bernomor terbit", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, "Pelanggan Lebih Bayar");
      const sale = await makeSale(tx, { customerId: customer.id, total: "100000" });

      const result = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-10",
        amount: "150000",
        accountId: acc["1100"],
      });
      expect(result.number).toBeTruthy();
      expect(result.creditNumber).toBeTruthy();
      expect(d(result.creditAmount ?? "0").eq(50000)).toBe(true);

      const entry = await entryByKey(tx, `ar:${sale.id}:${result.number}`);
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(3);
      expectLine(lines, acc["1100"], "debit", "150000");
      expectLine(lines, acc["1200"], "credit", "100000", customer.id);
      expectLine(lines, acc["2300"], "credit", "50000", customer.id);

      const [saleAfter] = await tx
        .select({ paidTotal: sales.paidTotal, paymentStatus: sales.paymentStatus })
        .from(sales)
        .where(eq(sales.id, sale.id));
      expect(d(saleAfter.paidTotal).eq(100000)).toBe(true);
      expect(saleAfter.paymentStatus).toBe("paid");

      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      // Invariant void: Σ pembayaran per dokumen == terbayar dokumen.
      expect(d(payment.amount).eq(100000)).toBe(true);
      expect(payment.creditId).toBeNull();

      const credits = await creditsOf(tx, customer.id);
      expect(credits).toHaveLength(1);
      expect(credits[0].number).toBe(result.creditNumber);
      expect(credits[0].partyType).toBe("customer");
      expect(d(credits[0].amount).eq(50000)).toBe(true);
      expect(d(credits[0].usedAmount).eq(0)).toBe(true);
      expect(credits[0].status).toBe("open");
      expect(credits[0].originPaymentId).toBe(payment.id);

      const available = await getPartyCreditAvailable(tx, ORG, "customer", customer.id);
      expect(available.eq(50000)).toBe(true);
    });
  });

  it("kredit dipakai sebagian lalu habis ke penjualan berikutnya (tanpa jurnal kas); melebihi saldo & melebihi sisa tagihan ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, "Pelanggan Pakai Kredit");
      const first = await makeSale(tx, { customerId: customer.id, total: "100000" });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: first.id,
        date: "2099-01-10",
        amount: "150000",
        accountId: acc["1000"],
      });
      const [credit] = await creditsOf(tx, customer.id);

      const second = await makeSale(tx, { customerId: customer.id, total: "80000", date: "2099-01-12" });
      const used = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: second.id,
        date: "2099-01-15",
        amount: "30000",
        creditId: credit.id,
      });
      const entry = await entryByKey(tx, `ar:${second.id}:${used.number}`);
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(2);
      expectLine(lines, acc["2300"], "debit", "30000", customer.id);
      expectLine(lines, acc["1200"], "credit", "30000", customer.id);
      // Tanpa jurnal kas: tidak ada baris akun kas/bank sama sekali.
      expect(lines.some((line) => line.accountId === acc["1000"] || line.accountId === acc["1100"])).toBe(false);

      const [usagePayment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, second.id)));
      expect(usagePayment.creditId).toBe(credit.id);
      expect(usagePayment.accountId).toBe(acc["2300"]);

      const [creditMid] = await creditsOf(tx, customer.id);
      expect(d(creditMid.usedAmount).eq(30000)).toBe(true);
      expect(creditMid.status).toBe("open");

      // Melebihi sisa kredit (sisa 20000) → ditolak.
      await expect(
        payReceivable(tx, {
          companyId: ORG,
          userId: USER_ID,
          saleId: second.id,
          date: "2099-01-16",
          amount: "20001",
            creditId: credit.id,
        }),
      ).rejects.toThrow(/melebihi sisa kredit/);

      // Persis sisa kredit → kredit lunas (settled), penjualan tersisa 30000.
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: second.id,
        date: "2099-01-16",
        amount: "20000",
        creditId: credit.id,
      });
      const [creditEnd] = await creditsOf(tx, customer.id);
      expect(d(creditEnd.usedAmount).eq(50000)).toBe(true);
      expect(creditEnd.status).toBe("settled");
      const available = await getPartyCreditAvailable(tx, ORG, "customer", customer.id);
      expect(available.eq(0)).toBe(true);

      // Kredit lunas tidak bisa dipakai lagi.
      await expect(
        payReceivable(tx, {
          companyId: ORG,
          userId: USER_ID,
          saleId: second.id,
          date: "2099-01-17",
          amount: "1",
            creditId: credit.id,
        }),
      ).rejects.toThrow(/sudah lunas|tidak tersedia/);

      // Sumber kredit tidak bisa membebani melebihi sisa tagihan dokumen.
      const third = await makeSale(tx, { customerId: customer.id, total: "5000", date: "2099-01-18" });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: third.id,
        date: "2099-01-18",
        amount: "9000",
        accountId: acc["1000"],
      });
      const credit2 = (await creditsOf(tx, customer.id)).find((row) => d(row.amount).eq(4000))!;
      const fourth = await makeSale(tx, { customerId: customer.id, total: "3000", date: "2099-01-19" });
      await expect(
        payReceivable(tx, {
          companyId: ORG,
          userId: USER_ID,
          saleId: fourth.id,
          date: "2099-01-20",
          amount: "3500",
            creditId: credit2.id,
        }),
      ).rejects.toThrow(/melebihi sisa piutang/);
    });
  });

  it("penjaga pihak & tenant: kredit pelanggan lain ditolak, kredit lintas perusahaan tidak ditemukan", async () => {
    await rollbackTransaction(async (tx) => {
      const alice = await makeCustomer(tx, "Pelanggan A");
      const budi = await makeCustomer(tx, "Pelanggan B");
      const saleA = await makeSale(tx, { customerId: alice.id, total: "10000" });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: saleA.id,
        date: "2099-01-10",
        amount: "14000",
        accountId: acc["1000"],
      });
      const [creditA] = await creditsOf(tx, alice.id);
      const saleB = await makeSale(tx, { customerId: budi.id, total: "9000" });
      await expect(
        payReceivable(tx, {
          companyId: ORG,
          userId: USER_ID,
          saleId: saleB.id,
          date: "2099-01-11",
          amount: "4000",
            creditId: creditA.id,
        }),
      ).rejects.toThrow(/bukan milik/);
    });

    // Lintas tenant: kredit ter-commit di perusahaan fixture dipakai
    // atas nama perusahaan demo — barisnya tidak terlihat (RLS +
    // filter company_id), jadi domain menolaknya sebagai tidak
    // ditemukan.
    const seeded = await withCompany(ORG, async (tx) => {
      const customer = await makeCustomer(tx, `Pelanggan Tenant ${RUN}`);
      const sale = await makeSale(tx, { customerId: customer.id, total: "10000" });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-10",
        amount: "12000",
        accountId: acc["1000"],
      });
      const [credit] = await creditsOf(tx, customer.id);
      return { creditId: credit.id };
    });
    await rollbackTransaction(async (tx) => {
      const [demoCustomer] = await tx
        .insert(customers)
        .values({ companyId: DEMO_ORG, code: uniq("CST-DEMO"), name: "Pelanggan Demo Uji" })
        .returning({ id: customers.id });
      const [demoSale] = await tx
        .insert(sales)
        .values({
          companyId: DEMO_ORG,
          warehouseId: "01900000-0000-7000-8000-0000000000ff",
          number: uniq("INV-DEMO"),
          date: "2099-01-05",
          cashierId: USER_ID,
          customerId: demoCustomer.id,
          status: "completed",
          total: "5000",
          paidTotal: "0",
          paymentStatus: "unpaid",
        })
        .returning({ id: sales.id });
      await expect(
        payReceivable(tx, {
          companyId: DEMO_ORG,
          userId: USER_ID,
          saleId: demoSale.id,
          date: "2099-01-11",
          amount: "1000",
          creditId: seeded.creditId,
        }),
      ).rejects.toThrow(/tidak ditemukan/);
    }, DEMO_ORG);
  });

  it("idempotensi: pengiriman ulang kunci yang sama tidak menggandakan pembayaran maupun kredit", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, "Pelanggan Idempoten");
      const sale = await makeSale(tx, { customerId: customer.id, total: "40000" });
      const key = uniq("idem-r3b");
      const first = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-10",
        amount: "55000",
        accountId: acc["1000"],
        idempotencyKey: key,
      });
      const second = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-10",
        amount: "55000",
        accountId: acc["1000"],
        idempotencyKey: key,
      });
      expect(second.number).toBe(first.number);
      const payments = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      expect(payments).toHaveLength(1);
      const credits = await creditsOf(tx, customer.id);
      expect(credits).toHaveLength(1);
      expect(d(credits[0].amount).eq(15000)).toBe(true);
    });
  });

  it("tampilan: kredit tampil sebagai kredit tersedia per pihak dan TIDAK mengaburkan aging — sisa tagihan dokumen tidak pernah negatif/neto oleh kredit", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, "Pelanggan Tampil");
      const sale = await makeSale(tx, { customerId: customer.id, total: "100000" });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-01-10",
        amount: "130000",
        accountId: acc["1000"],
      });
      const open = await makeSale(tx, { customerId: customer.id, total: "45000", date: "2099-01-12" });

      const listed = await listPartyCredits(tx, ORG, { partyType: "customer" });
      const mine = listed.filter((row) => row.partyId === customer.id);
      expect(mine).toHaveLength(1);
      expect(d(mine[0].remaining).eq(30000)).toBe(true);
      expect(mine[0].partyName).toBe("Pelanggan Tampil");

      // Dokumen terbuka tetap tampil sebesar sisa aslinya — kredit
      // tidak dikurangkan dari tagihan (bukan tagihan negatif).
      const receivables = await listReceivables(tx, ORG);
      const openRow = receivables.find((row) => row.id === open.id);
      expect(openRow).toBeTruthy();
      expect(openRow!.outstanding).toBe(45000);
      expect(receivables.some((row) => row.outstanding < 0)).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Utang — kelebihan bayar per dokumen melahirkan kredit pemasok       */
/* ------------------------------------------------------------------ */

describe("R3-02 utang per dokumen (rollback)", () => {
  it("bayar penerimaan melebihi sisa: Dr utang sebesar sisa / Dr kredit pemasok sebesar kelebihan / Cr bank penuh; kredit dipakai ke penerimaan berikutnya", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx, "Pemasok Lebih Bayar");
      const receipt = await makeReceipt(tx, { supplierId: supplier.id, total: "200000" });

      const result = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-10",
        amount: "260000",
        accountId: acc["1100"],
      });
      expect(result.creditNumber).toBeTruthy();
      expect(d(result.creditAmount ?? "0").eq(60000)).toBe(true);

      const entry = await entryByKey(tx, `ap:${receipt.id}:${result.number}`);
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(3);
      expectLine(lines, acc["2000"], "debit", "200000", supplier.id);
      expectLine(lines, acc["1210"], "debit", "60000", supplier.id);
      expectLine(lines, acc["1100"], "credit", "260000");

      const [receiptAfter] = await tx
        .select({ paidAmount: stockReceipts.paidAmount, paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(d(receiptAfter.paidAmount).eq(200000)).toBe(true);
      expect(receiptAfter.paymentStatus).toBe("paid");

      const credits = await creditsOf(tx, supplier.id);
      expect(credits).toHaveLength(1);
      expect(credits[0].partyType).toBe("supplier");

      const next = await makeReceipt(tx, { supplierId: supplier.id, total: "90000", date: "2099-01-12" });
      const used = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: next.id,
        date: "2099-01-15",
        amount: "60000",
        creditId: credits[0].id,
      });
      const usedEntry = await entryByKey(tx, `ap:${next.id}:${used.number}`);
      const usedLines = await linesOf(tx, usedEntry.id);
      expect(usedLines).toHaveLength(2);
      expectLine(usedLines, acc["2000"], "debit", "60000", supplier.id);
      expectLine(usedLines, acc["1210"], "credit", "60000", supplier.id);
      const [creditEnd] = await creditsOf(tx, supplier.id);
      expect(creditEnd.status).toBe("settled");
    });
  });

  it("beban terutang dibayar lebih: kelebihannya menjadi kredit pemasok yang sama dan bisa melunasi penerimaan", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx, "Pemasok Beban");
      const expense = await makeExpensePayable(tx, { supplierId: supplier.id, amount: "50000" });
      const paid = await payExpensePayable(tx, {
        companyId: ORG,
        userId: USER_ID,
        expenseId: expense.id,
        date: "2099-01-10",
        amount: "70000",
        accountId: acc["1000"],
      });
      expect(d(paid.creditAmount ?? "0").eq(20000)).toBe(true);
      const entry = await entryByKey(tx, `ap-expense:${expense.id}:${paid.number}`);
      const lines = await linesOf(tx, entry.id);
      expectLine(lines, acc["2000"], "debit", "50000", supplier.id);
      expectLine(lines, acc["1210"], "debit", "20000", supplier.id);
      expectLine(lines, acc["1000"], "credit", "70000");

      const receipt = await makeReceipt(tx, { supplierId: supplier.id, total: "20000", date: "2099-01-11" });
      const [credit] = await creditsOf(tx, supplier.id);
      await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-01-12",
        amount: "20000",
        creditId: credit.id,
      });
      const [receiptAfter] = await tx
        .select({ paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(receiptAfter.paymentStatus).toBe("paid");
    });
  });
});

/* ------------------------------------------------------------------ */
/* Saldo awal — kelebihan bayar dua arah + rantai void domain          */
/* ------------------------------------------------------------------ */

describe("R3-02 saldo awal & rantai void (rollback)", () => {
  it("saldo awal piutang dibayar lebih → kredit pelanggan; saldo awal utang dibayar lebih → kredit pemasok", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, "Pelanggan Saldo Awal");
      const opening = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customer.id,
        date: "2099-01-02",
        amount: "80000",
      });
      const paid = await payOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: opening.id,
        date: "2099-01-10",
        amount: "100000",
        accountId: acc["1000"],
      });
      expect(d(paid.creditAmount ?? "0").eq(20000)).toBe(true);
      const lines = await linesOf(tx, paid.journalId);
      expectLine(lines, acc["1000"], "debit", "100000");
      expectLine(lines, acc["1200"], "credit", "80000", customer.id);
      expectLine(lines, acc["2300"], "credit", "20000", customer.id);
      const [docAfter] = await tx
        .select()
        .from(partyOpeningBalances)
        .where(eq(partyOpeningBalances.id, opening.id));
      expect(d(docAfter.paidAmount).eq(80000)).toBe(true);
      expect(docAfter.status).toBe("settled");

      const supplier = await makeSupplier(tx, "Pemasok Saldo Awal");
      const openingAp = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: "2099-01-02",
        amount: "60000",
      });
      const paidAp = await payOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: openingAp.id,
        date: "2099-01-10",
        amount: "85000",
        accountId: acc["1100"],
      });
      expect(d(paidAp.creditAmount ?? "0").eq(25000)).toBe(true);
      const apLines = await linesOf(tx, paidAp.journalId);
      expectLine(apLines, acc["2000"], "debit", "60000", supplier.id);
      expectLine(apLines, acc["1210"], "debit", "25000", supplier.id);
      expectLine(apLines, acc["1100"], "credit", "85000");
    });
  });

  it("rantai void: void pembayaran asal membatalkan kredit yang belum terpakai; kredit yang sudah terpakai menghalangi void sampai pembayaran pemakai dibatalkan (yang memulihkan kredit)", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, "Pelanggan Rantai Void");
      const origin = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customer.id,
        date: "2099-01-02",
        amount: "50000",
      });
      const originPayment = await payOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: origin.id,
        date: "2099-01-10",
        amount: "90000",
        accountId: acc["1000"],
      });
      const [credit] = await creditsOf(tx, customer.id);
      expect(d(credit.amount).eq(40000)).toBe(true);

      // Pakai sebagian kredit ke saldo awal lain milik pelanggan sama.
      const second = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customer.id,
        date: "2099-01-03",
        amount: "30000",
      });
      const usagePayment = await payOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: second.id,
        date: "2099-01-12",
        amount: "25000",
        creditId: credit.id,
      });
      const usageLines = await linesOf(tx, usagePayment.journalId);
      expectLine(usageLines, acc["2300"], "debit", "25000", customer.id);
      expectLine(usageLines, acc["1200"], "credit", "25000", customer.id);

      // Void pembayaran asal sekarang DITOLAK: kreditnya sudah terpakai.
      await expect(
        voidOpeningPayment(tx, {
          companyId: ORG,
          userId: USER_ID,
          paymentId: originPayment.paymentId,
          reason: "Uji rantai void",
          date: "2099-01-20",
        }),
      ).rejects.toThrow(/sudah terpakai/);

      // Batalkan pembayaran pemakai → kredit pulih penuh & terbuka lagi.
      await voidOpeningPayment(tx, {
        companyId: ORG,
        userId: USER_ID,
        paymentId: usagePayment.paymentId,
        reason: "Uji pulih kredit",
        date: "2099-01-20",
      });
      const [creditRestored] = await creditsOf(tx, customer.id);
      expect(d(creditRestored.usedAmount).eq(0)).toBe(true);
      expect(creditRestored.status).toBe("open");

      // Kini void pembayaran asal lolos dan kreditnya ikut batal.
      await voidOpeningPayment(tx, {
        companyId: ORG,
        userId: USER_ID,
        paymentId: originPayment.paymentId,
        reason: "Uji rantai void",
        date: "2099-01-21",
      });
      const [creditVoided] = await creditsOf(tx, customer.id);
      expect(creditVoided.status).toBe("void");
      const available = await getPartyCreditAvailable(tx, ORG, "customer", customer.id);
      expect(available.eq(0)).toBe(true);
      const [originAfter] = await tx
        .select()
        .from(partyOpeningBalances)
        .where(eq(partyOpeningBalances.id, origin.id));
      expect(d(originAfter.paidAmount).eq(0)).toBe(true);
      expect(originAfter.status).toBe("open");
    });
  });
});

/* ------------------------------------------------------------------ */
/* FIFO modal — sisa sesudah semua dokumen lunas menjadi kredit (DP)   */
/* ------------------------------------------------------------------ */

describe("R3-02 FIFO terima & bayar (rollback)", () => {
  it("terima FIFO melebihi total piutang: alokasi penuh + sisa menjadi kredit pelanggan dengan jurnal tersendiri; pelanggan tanpa dokumen = DP penuh menjadi kredit", async () => {
    await rollbackTransaction(async (tx) => {
      const customer = await makeCustomer(tx, "Pelanggan FIFO");
      await makeSale(tx, { customerId: customer.id, total: "60000", date: "2099-01-05" });
      await makeSale(tx, { customerId: customer.id, total: "40000", date: "2099-01-06" });

      const result = await receiveReceivableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        customerId: customer.id,
        date: "2099-01-10",
        amount: "150000",
        accountId: acc["1100"],
      });
      expect(result.numbers).toHaveLength(2);
      expect(result.allocations.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(100000);
      expect(result.creditNumber).toBeTruthy();
      expect(d(result.creditAmount ?? "0").eq(50000)).toBe(true);

      const [credit] = await creditsOf(tx, customer.id);
      expect(credit.originPaymentId).toBeNull();
      const [creditEntry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "party_credit"),
            eq(journalEntries.sourceId, credit.id),
          ),
        );
      const lines = await linesOf(tx, creditEntry.id);
      expect(lines).toHaveLength(2);
      expectLine(lines, acc["1100"], "debit", "50000");
      expectLine(lines, acc["2300"], "credit", "50000", customer.id);

      // DP murni: pelanggan tanpa satu pun dokumen terbuka.
      const dpCustomer = await makeCustomer(tx, "Pelanggan DP");
      const dp = await receiveReceivableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        customerId: dpCustomer.id,
        date: "2099-01-10",
        amount: "75000",
        accountId: acc["1000"],
      });
      expect(dp.numbers).toHaveLength(0);
      expect(d(dp.creditAmount ?? "0").eq(75000)).toBe(true);
      const available = await getPartyCreditAvailable(tx, ORG, "customer", dpCustomer.id);
      expect(available.eq(75000)).toBe(true);
    });
  });

  it("bayar FIFO melebihi total utang: sisa menjadi kredit pemasok", async () => {
    await rollbackTransaction(async (tx) => {
      const supplier = await makeSupplier(tx, "Pemasok FIFO");
      await makeReceipt(tx, { supplierId: supplier.id, total: "80000" });
      const opening = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "payable",
        partyId: supplier.id,
        date: "2099-01-02",
        amount: "20000",
      });
      expect(opening.id).toBeTruthy();

      const result = await payPayableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId: supplier.id,
        date: "2099-01-10",
        amount: "130000",
        accountId: acc["1100"],
      });
      expect(result.allocations.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(100000);
      expect(d(result.creditAmount ?? "0").eq(30000)).toBe(true);
      const available = await getPartyCreditAvailable(tx, ORG, "supplier", supplier.id);
      expect(available.eq(30000)).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Aksi — rantai void penerimaan piutang POS/akuntansi (ter-commit)    */
/* ------------------------------------------------------------------ */

describe("R3-02 rantai void lewat aksi (ter-commit, perusahaan fixture)", () => {
  it("void penerimaan asal ditolak selama kreditnya terpakai; sesudah pembayaran pemakai dibatalkan, void lolos dan kredit batal", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const customer = await makeCustomer(tx, `Pelanggan Aksi ${RUN}`);
      const first = await makeSale(tx, { customerId: customer.id, total: "50000", date: "2026-10-01" });
      const second = await makeSale(tx, { customerId: customer.id, total: "30000", date: "2026-10-02" });
      return { customerId: customer.id, firstId: first.id, secondId: second.id };
    });

    const paid = await payReceivableAction({
      saleId: outcome.firstId,
      amount: "80000",
      accountId: acc["1000"],
      date: "2026-10-05",
    });
    expect(paid.ok).toBe(true);

    const state = await withCompany(ORG, async (tx) => {
      const credits = await creditsOf(tx, outcome.customerId);
      const [originPayment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, outcome.firstId)));
      return { credit: credits[0], originPaymentId: originPayment.id };
    });
    expect(state.credit).toBeTruthy();
    expect(d(state.credit.amount).eq(30000)).toBe(true);

    const used = await payReceivableAction({
      saleId: outcome.secondId,
      amount: "20000",
      creditId: state.credit.id,
      date: "2026-10-06",
    });
    expect(used.ok).toBe(true);

    const blocked = await voidReceivablePaymentAction({
      paymentId: state.originPaymentId,
      reason: "Uji rantai void aksi",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/sudah terpakai/);

    const usage = await withCompany(ORG, async (tx) => {
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, outcome.secondId)));
      return payment;
    });
    const restored = await voidReceivablePaymentAction({
      paymentId: usage.id,
      reason: "Uji pulih kredit aksi",
    });
    expect(restored.ok).toBe(true);

    const afterRestore = await withCompany(ORG, async (tx) => {
      const [credit] = await creditsOf(tx, outcome.customerId);
      return credit;
    });
    expect(d(afterRestore.usedAmount).eq(0)).toBe(true);
    expect(afterRestore.status).toBe("open");

    const voided = await voidReceivablePaymentAction({
      paymentId: state.originPaymentId,
      reason: "Uji rantai void aksi",
    });
    expect(voided.ok).toBe(true);
    const afterVoid = await withCompany(ORG, async (tx) => {
      const [credit] = await creditsOf(tx, outcome.customerId);
      return credit;
    });
    expect(afterVoid.status).toBe("void");
  });
});
