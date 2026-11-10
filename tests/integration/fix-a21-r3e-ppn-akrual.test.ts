import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  bankStatementLines,
  companySettings,
  employees,
  expenses,
  journalEntries,
  journalLines,
  partyPayments,
  products,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { ensureFiscalPeriods } from "@/server/accounting";
import { createJournalFromLine, importStatement } from "@/server/bank-reconciliation";
import { createExpense } from "@/server/expenses";
import { createReceipt } from "@/server/inventory";
import * as payablesModule from "@/server/payables";
import { payPayableFifo } from "@/server/quick-entry";
import {
  decideReimbursementClaim,
  payReimbursementClaim,
  submitReimbursementClaim,
} from "@/server/reimbursements";
import { listPayables } from "@/server/reports";
import { voidExpenseAction } from "@/server/actions/accounting/beban-transfer";
import { voidPayablePaymentAction } from "@/server/actions/accounting/pembayaran";
import { postQuickEntryAction } from "@/server/actions/quick-entry";
import { d } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-21 Tahap R3-E — PPN & akrual pinggiran (audit R3):
//   R3-10 klaim reimbursement tidak bisa memisahkan PPN Masukan
//         padahal createExpense sudah bisa sejak FIX-P1 Tahap 4 —
//         klaim atas pembelian berfaktur pajak kehilangan kredit
//         PPN-nya dan membebankan pajak sebagai beban;
//   R3-11 beban selalu tunai: tidak ada mode terutang, jadi beban
//         yang jasanya sudah diterima tetapi dibayar belakangan
//         tidak bisa dicatat sebagai beban + utang yang tampil di
//         daftar utang dan dilunasi lewat jalur pembayaran yang ada;
//   R3-12 buat-jurnal-dari-mutasi rekonsiliasi hanya menerima satu
//         akun lawan, sehingga mutasi neto (bunga bruto dipotong
//         PPh final oleh bank) tidak bisa dicatat utuh dalam satu
//         langkah dari rekonsiliasi.
// Domain diuji dalam transaksi rollback; aksi ter-commit dengan
// penanda unik per larian — perusahaan fixture khusus berkas ini.

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000a212" },
    user: { id: "user-uji-a21-r3e" },
    role: "owner",
  });
  return {
    requireAuth: requirePermission,
    requirePermission,
    requirePermissionInModule: requirePermission,
  };
});

const ORG = "01900000-0000-7000-8000-00000000a212";
const USER_ID = "user-uji-a21-r3e";
const BOSS_ID = "user-atasan-a21-r3e";
const RUN = `${Date.now()}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

const acc: Record<string, string> = {};
let warehouseId = "";
let supplierId = "";
let productId = "";
let employeeId = "";

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
        legalName: "Uji R3-E",
        taxRate: "11",
        taxEnabled: true,
      });
      const rows = await tx
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
          { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", cashBankKind: "bank" },
          { companyId: ORG, code: "1110", name: "QRIS", type: "asset", normalBalance: "debit", cashBankKind: "clearing" },
          { companyId: ORG, code: "1180", name: "PPN Masukan", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "2150", name: "Utang PPh", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "2200", name: "PPN Keluaran", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: ORG, code: "4300", name: "Pendapatan Bunga", type: "revenue", normalBalance: "credit" },
          { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
          { companyId: ORG, code: "6060", name: "Biaya Administrasi Bank", type: "expense", normalBalance: "debit" },
          { companyId: ORG, code: "6100", name: "Beban Listrik", type: "expense", normalBalance: "debit" },
          { companyId: ORG, code: "6210", name: "Beban PPh Final", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "qris", accountId: byCode.get("1110")! },
        { companyId: ORG, key: "tax_input", accountId: byCode.get("1180")! },
        { companyId: ORG, key: "receivable", accountId: byCode.get("1200")! },
        { companyId: ORG, key: "supplier_credit", accountId: byCode.get("1210")! },
        { companyId: ORG, key: "inventory", accountId: byCode.get("1300")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "tax_output", accountId: byCode.get("2200")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: ORG, key: "revenue", accountId: byCode.get("4000")! },
        { companyId: ORG, key: "cogs", accountId: byCode.get("5000")! },
        { companyId: ORG, key: "bank_fee", accountId: byCode.get("6060")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-R3E", name: "Gudang Uji R3E", type: "warehouse", isDefault: true })
        .returning({ id: warehouses.id });
      warehouseId = warehouse.id;
      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId: ORG, code: "SUP-R3E", name: "Pemasok R3E", paymentTermDays: 14 })
        .returning({ id: suppliers.id });
      supplierId = supplier.id;
      const [product] = await tx
        .insert(products)
        .values({ companyId: ORG, sku: "R3E-P1", name: "Produk R3E", costPrice: "5000", salePrice: "8000" })
        .returning({ id: products.id });
      productId = product.id;
      const [person] = await tx
        .insert(employees)
        .values({ companyId: ORG, code: "KRY-R3E", name: "Karyawan R3E" })
        .returning({ id: employees.id });
      employeeId = person.id;
    }
    const accountRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, ORG));
    for (const row of accountRows) acc[row.code] = row.id;
    // A-21 (R3-02): perusahaan fixture yang sudah terlanjur dibuat
    // sebelum tahap ini belum punya akun kredit pemasok — lengkapi
    // secara idempoten (di basis data segar akunnya lahir dari
    // daftar bootstrap di atas).
    if (!acc["1210"]) {
      const [created] = await tx
        .insert(accounts)
        .values({ companyId: ORG, code: "1210", name: "Kredit Pemasok", type: "asset", normalBalance: "debit" })
        .returning({ id: accounts.id });
      await tx
        .insert(accountMappings)
        .values({ companyId: ORG, key: "supplier_credit", accountId: created.id });
      acc["1210"] = created.id;
    }
    if (!warehouseId) {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      warehouseId = warehouse.id;
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG))
        .limit(1);
      supplierId = supplier.id;
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, ORG))
        .limit(1);
      productId = product.id;
      const [person] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.companyId, ORG))
        .limit(1);
      employeeId = person.id;
    }
  });
}

beforeAll(bootstrap);
// Baris ter-commit dari uji aksi dibiarkan di perusahaan fixture
// khusus berkas ini (pola berkas A-21 lain) — tidak menyentuh
// perusahaan demo.

type JournalLineRow = {
  accountId: string;
  debit: string;
  credit: string;
  partyType: string | null;
  partyId: string | null;
};

async function linesOf(tx: Tx, entryId: string): Promise<JournalLineRow[]> {
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

function expectLine(
  lines: JournalLineRow[],
  accountId: string,
  side: "debit" | "credit",
  amount: string,
) {
  const line = lines.find((row) => row.accountId === accountId);
  expect(line, `baris jurnal untuk akun ${accountId}`).toBeTruthy();
  expect(d(line![side]).eq(d(amount)), `${side} akun ${accountId}`).toBe(true);
  const other = side === "debit" ? "credit" : "debit";
  expect(d(line![other]).eq(0)).toBe(true);
  return line!;
}

/* ------------------------------------------------------------------ */
/* R3-10 — reimbursement memisahkan PPN Masukan (pola createExpense)   */
/* ------------------------------------------------------------------ */

describe("R3-10 domain reimbursement + PPN (rollback)", () => {
  it("klaim termasuk PPN: tarif dibekukan di klaim, pembayaran menjurnal 3 baris (DPP + 1180 + kas bruto)", async () => {
    await rollbackTransaction(async (tx) => {
      const claim = await submitReimbursementClaim(tx, {
        companyId: ORG,
        userId: USER_ID,
        employeeId,
        date: "2099-03-02",
        expenseAccountId: acc["6100"],
        amount: "1110000",
        description: `Bahan berfaktur pajak ${RUN}-1`,
        taxIncluded: true,
        taxRate: "11",
      });
      expect(d(claim.taxRate).eq(11)).toBe(true);

      await decideReimbursementClaim(tx, {
        companyId: ORG,
        claimId: claim.id,
        decidedBy: BOSS_ID,
        approve: true,
      });
      const paid = await payReimbursementClaim(tx, {
        companyId: ORG,
        userId: BOSS_ID,
        claimId: claim.id,
        paymentAccountId: acc["1000"],
        date: "2099-03-05",
      });
      expect(paid.journalId).toBeTruthy();
      const lines = await linesOf(tx, paid.journalId!);
      expect(lines).toHaveLength(3);
      const expenseLine = expectLine(lines, acc["6100"], "debit", "1000000");
      expect(expenseLine.partyType).toBe("employee");
      expect(expenseLine.partyId).toBe(employeeId);
      expectLine(lines, acc["1180"], "debit", "110000");
      expectLine(lines, acc["1000"], "credit", "1110000");
    });
  });

  it("klaim tanpa PPN identik dengan perilaku lama: 2 baris, beban sebesar bruto", async () => {
    await rollbackTransaction(async (tx) => {
      const claim = await submitReimbursementClaim(tx, {
        companyId: ORG,
        userId: USER_ID,
        employeeId,
        date: "2099-03-03",
        expenseAccountId: acc["6100"],
        amount: "250000",
        description: `Klaim tanpa pajak ${RUN}-2`,
      });
      expect(d(claim.taxRate).eq(0)).toBe(true);
      await decideReimbursementClaim(tx, {
        companyId: ORG,
        claimId: claim.id,
        decidedBy: BOSS_ID,
        approve: true,
      });
      const paid = await payReimbursementClaim(tx, {
        companyId: ORG,
        userId: BOSS_ID,
        claimId: claim.id,
        paymentAccountId: acc["1000"],
        date: "2099-03-06",
      });
      const lines = await linesOf(tx, paid.journalId!);
      expect(lines).toHaveLength(2);
      expectLine(lines, acc["6100"], "debit", "250000");
      expectLine(lines, acc["1000"], "credit", "250000");
    });
  });

  it("opsi termasuk PPN dengan tarif efektif 0 ditolak (pola createExpense, D-25)", async () => {
    await rollbackTransaction(async (tx) => {
      await expect(
        submitReimbursementClaim(tx, {
          companyId: ORG,
          userId: USER_ID,
          employeeId,
          date: "2099-03-04",
          expenseAccountId: acc["6100"],
          amount: "111000",
          description: `Klaim PPN nonaktif ${RUN}-3`,
          taxIncluded: true,
          taxRate: "0",
        }),
      ).rejects.toThrow(/PPN/);
    });
  });

  it("nominal disahkan lebih kecil: PPN dihitung ulang proporsional dari tarif beku atas nominal disahkan", async () => {
    await rollbackTransaction(async (tx) => {
      const claim = await submitReimbursementClaim(tx, {
        companyId: ORG,
        userId: USER_ID,
        employeeId,
        date: "2099-03-07",
        expenseAccountId: acc["6100"],
        amount: "1110000",
        description: `Klaim disahkan sebagian ${RUN}-4`,
        taxIncluded: true,
        taxRate: "11",
      });
      await decideReimbursementClaim(tx, {
        companyId: ORG,
        claimId: claim.id,
        decidedBy: BOSS_ID,
        approve: true,
        approvedAmount: "555000",
      });
      const paid = await payReimbursementClaim(tx, {
        companyId: ORG,
        userId: BOSS_ID,
        claimId: claim.id,
        paymentAccountId: acc["1000"],
        date: "2099-03-08",
      });
      const lines = await linesOf(tx, paid.journalId!);
      expect(lines).toHaveLength(3);
      expectLine(lines, acc["6100"], "debit", "500000");
      expectLine(lines, acc["1180"], "debit", "55000");
      expectLine(lines, acc["1000"], "credit", "555000");
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3-11 — beban terutang (akrual) sebagai dokumen utang               */
/* ------------------------------------------------------------------ */

describe("R3-11 domain beban terutang (rollback)", () => {
  it("beban tunai tidak berubah: lahir terbayar, jurnal Dr beban / Cr kas", async () => {
    await rollbackTransaction(async (tx) => {
      const expense = await createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-04-01",
        expenseAccountId: acc["6100"],
        paymentAccountId: acc["1000"],
        amount: "175000",
        description: `Listrik tunai ${RUN}`,
      });
      const [row] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expense.id)))
        .limit(1);
      expect(row.supplierId).toBeNull();
      expect(row.paymentStatus).toBe("paid");
      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "expense"),
            eq(journalEntries.sourceId, expense.id),
          ),
        )
        .limit(1);
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(2);
      expectLine(lines, acc["6100"], "debit", "175000");
      expectLine(lines, acc["1000"], "credit", "175000");
    });
  });

  it("beban terutang: jurnal akrual Dr beban / Cr utang bertag pemasok; tampil di daftar utang sebagai sumber expense", async () => {
    await rollbackTransaction(async (tx) => {
      const expense = await createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-04-02",
        expenseAccountId: acc["6100"],
        supplierId,
        amount: "500000",
        description: `Jasa profesional terutang ${RUN}`,
      });
      const [row] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expense.id)))
        .limit(1);
      expect(row.paymentAccountId).toBeNull();
      expect(row.supplierId).toBe(supplierId);
      expect(row.paymentStatus).toBe("unpaid");
      expect(d(row.paidAmount).eq(0)).toBe(true);

      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "expense"),
            eq(journalEntries.sourceId, expense.id),
          ),
        )
        .limit(1);
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(2);
      expectLine(lines, acc["6100"], "debit", "500000");
      const payableLine = expectLine(lines, acc["2000"], "credit", "500000");
      expect(payableLine.partyType).toBe("supplier");
      expect(payableLine.partyId).toBe(supplierId);

      const payables = await listPayables(tx, ORG);
      const listed = payables.find((row) => row.id === expense.id);
      expect(listed, "beban terutang tampil di listPayables").toBeTruthy();
      expect(listed!.source).toBe("expense");
      expect(listed!.outstanding).toBe(500000);
      // Jatuh tempo = tanggal beban + termin pemasok (14 hari).
      expect(listed!.dueDate).toBe("2099-04-16");
    });
  });

  it("beban terutang termasuk PPN: Dr beban (DPP) + Dr 1180 / Cr utang bruto", async () => {
    await rollbackTransaction(async (tx) => {
      const expense = await createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-04-03",
        expenseAccountId: acc["6100"],
        supplierId,
        amount: "1110000",
        description: `Langganan terutang ber-PPN ${RUN}`,
        taxIncluded: true,
        taxRate: "11",
      });
      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "expense"),
            eq(journalEntries.sourceId, expense.id),
          ),
        )
        .limit(1);
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(3);
      expectLine(lines, acc["6100"], "debit", "1000000");
      expectLine(lines, acc["1180"], "debit", "110000");
      expectLine(lines, acc["2000"], "credit", "1110000");
      const [row] = await tx
        .select({ taxAmount: expenses.taxAmount })
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expense.id)))
        .limit(1);
      expect(d(row.taxAmount).eq(110000)).toBe(true);
    });
  });

  it("mode ganda (akun pembayaran + pemasok) dan pemasok asing ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      await expect(
        createExpense(tx, {
          companyId: ORG,
          userId: USER_ID,
          date: "2099-04-04",
          expenseAccountId: acc["6100"],
          paymentAccountId: acc["1000"],
          supplierId,
          amount: "10000",
          description: `Mode ganda ${RUN}`,
        }),
      ).rejects.toThrow();
      await expect(
        createExpense(tx, {
          companyId: ORG,
          userId: USER_ID,
          date: "2099-04-04",
          expenseAccountId: acc["6100"],
          supplierId: "01900000-0000-7000-8000-00000000ffff",
          amount: "10000",
          description: `Pemasok asing ${RUN}`,
        }),
      ).rejects.toThrow(/Pemasok tidak ditemukan/);
    });
  });

  it("pelunasan lewat payExpensePayable: sebagian lalu lunas; party_payments tertaut expense; daftar utang terbarui", async () => {
    await rollbackTransaction(async (tx) => {
      const payExpensePayable = payablesModule.payExpensePayable;
      expect(typeof payExpensePayable).toBe("function");
      const expense = await createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-04-05",
        expenseAccountId: acc["6100"],
        supplierId,
        amount: "500000",
        description: `Sewa terutang ${RUN}`,
      });

      // Penjaga: tanggal pembayaran sebelum tanggal beban ditolak.
      await expect(
        payExpensePayable(tx, {
          companyId: ORG,
          userId: USER_ID,
          expenseId: expense.id,
          date: "2099-04-04",
          amount: "1000",
          accountId: acc["1000"],
        }),
      ).rejects.toThrow();
      // A-21 (R3-02): kelebihan bayar TIDAK lagi ditolak — diuji di
      // dokumen terpisah agar alur pelunasan bertahap di bawah utuh:
      // bayar 1001 atas beban 1000 melunasi dokumen + kredit 1.
      const small = await createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-04-05",
        expenseAccountId: acc["6100"],
        supplierId,
        amount: "1000",
        description: `Beban kecil lebih bayar ${RUN}`,
      });
      const overpaidSmall = await payExpensePayable(tx, {
        companyId: ORG,
        userId: USER_ID,
        expenseId: small.id,
        date: "2099-04-06",
        amount: "1001",
        accountId: acc["1000"],
      });
      expect(d(overpaidSmall.creditAmount ?? "0").eq(1)).toBe(true);

      const first = await payExpensePayable(tx, {
        companyId: ORG,
        userId: USER_ID,
        expenseId: expense.id,
        date: "2099-04-06",
        amount: "200000",
        accountId: acc["1000"],
        reference: `TRF-${RUN}`,
      });
      expect(first.number).toBeTruthy();
      const [payment] = await tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.expenseId, expense.id)))
        .limit(1);
      expect(payment).toBeTruthy();
      expect(payment.type).toBe("payable");
      expect(payment.partyId).toBe(supplierId);
      expect(payment.receiptId).toBeNull();
      expect(payment.reference).toBe(`TRF-${RUN}`);

      // Jurnal pembayaran: Dr utang bertag pemasok / Cr kas.
      const [payEntry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "payment"),
            eq(journalEntries.sourceId, expense.id),
          ),
        )
        .limit(1);
      const payLines = await linesOf(tx, payEntry.id);
      expect(payLines).toHaveLength(2);
      const drLine = expectLine(payLines, acc["2000"], "debit", "200000");
      expect(drLine.partyId).toBe(supplierId);
      expectLine(payLines, acc["1000"], "credit", "200000");

      let [row] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expense.id)))
        .limit(1);
      expect(d(row.paidAmount).eq(200000)).toBe(true);
      expect(row.paymentStatus).toBe("partial");
      let payables = await listPayables(tx, ORG);
      expect(payables.find((item) => item.id === expense.id)?.outstanding).toBe(300000);

      await payExpensePayable(tx, {
        companyId: ORG,
        userId: USER_ID,
        expenseId: expense.id,
        date: "2099-04-07",
        amount: "300000",
        accountId: acc["1100"],
      });
      [row] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expense.id)))
        .limit(1);
      expect(row.paymentStatus).toBe("paid");
      payables = await listPayables(tx, ORG);
      expect(payables.find((item) => item.id === expense.id)).toBeUndefined();
    });
  });

  it("FIFO bayar utang melunasi penerimaan tertua lalu beban terutang pemasok yang sama", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await createReceipt(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date: "2099-01-03",
        lines: [{ productId, qty: "10", unitCost: "5000" }],
      });
      const expense = await createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-01-05",
        expenseAccountId: acc["6100"],
        supplierId,
        amount: "30000",
        description: `Jasa angkut terutang ${RUN}`,
      });
      const result = await payPayableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId,
        date: "2099-02-01",
        amount: "65000",
        accountId: acc["1100"],
      });
      expect(result.allocations).toHaveLength(2);
      expect(result.allocations[0].number).toBe(receipt.number);
      expect(d(result.allocations[0].amount).eq(50000)).toBe(true);
      expect(result.allocations[1].number).toBe(expense.number);
      expect(d(result.allocations[1].amount).eq(15000)).toBe(true);
      const [row] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expense.id)))
        .limit(1);
      expect(d(row.paidAmount).eq(15000)).toBe(true);
      expect(row.paymentStatus).toBe("partial");
    });
  });
});

describe("R3-11 aksi beban terutang (ter-commit, fixture a212)", () => {
  it("void beban terutang tanpa pembayaran membalik jurnal akrual; sesudah ada pembayaran void ditolak sampai pembayaran dibatalkan", async () => {
    const payExpensePayable = payablesModule.payExpensePayable;
    expect(typeof payExpensePayable).toBe("function");

    // Beban terutang A: langsung di-void tanpa pembayaran.
    const expenseA = await withCompany(ORG, (tx) =>
      createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-05-02",
        expenseAccountId: acc["6100"],
        supplierId,
        amount: "120000",
        description: `Terutang void langsung ${RUN}`,
      }),
    );
    const voidA = await voidExpenseAction({ id: expenseA.id, reason: "Salah input uji R3-E" });
    expect(voidA.ok).toBe(true);
    await withCompany(ORG, async (tx) => {
      const [row] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expenseA.id)))
        .limit(1);
      expect(row.status).toBe("void");
      // Jurnal asal (expense) + pembalik (expense_reversal): neto
      // baris utang atas kedua entri = 0.
      const entries = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceId, expenseA.id),
            sql`${journalEntries.sourceType} in ('expense', 'expense_reversal')`,
          ),
        );
      expect(entries.length).toBe(2);
      const [sumRow] = await tx
        .select({
          net: sql<string>`coalesce(sum(${journalLines.credit}) - sum(${journalLines.debit}), 0)`,
        })
        .from(journalLines)
        .where(
          and(
            eq(journalLines.companyId, ORG),
            eq(journalLines.accountId, acc["2000"]),
            sql`${journalLines.entryId} in (select id from journal_entries where company_id = ${ORG} and source_type in ('expense', 'expense_reversal') and source_id = ${expenseA.id})`,
          ),
        );
      expect(d(sumRow.net).eq(0)).toBe(true);
    });

    // Beban terutang B: dibayar sebagian → void beban ditolak;
    // batalkan pembayaran → sisa kembali penuh → void beban berhasil.
    const expenseB = await withCompany(ORG, (tx) =>
      createExpense(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-05-03",
        expenseAccountId: acc["6100"],
        supplierId,
        amount: "90000",
        description: `Terutang void sesudah bayar ${RUN}`,
      }),
    );
    await withCompany(ORG, (tx) =>
      payExpensePayable(tx, {
        companyId: ORG,
        userId: USER_ID,
        expenseId: expenseB.id,
        date: "2099-05-04",
        amount: "40000",
        accountId: acc["1000"],
      }),
    );
    const blocked = await voidExpenseAction({ id: expenseB.id, reason: "Uji penjaga void R3-E" });
    expect(blocked.ok).toBe(false);

    const [payment] = await withCompany(ORG, async (tx) =>
      tx
        .select()
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.expenseId, expenseB.id)))
        .limit(1),
    );
    expect(payment).toBeTruthy();
    const voidPayment = await voidPayablePaymentAction({
      paymentId: payment.id,
      reason: "Salah input uji R3-E",
    });
    expect(voidPayment.ok).toBe(true);
    await withCompany(ORG, async (tx) => {
      const [row] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.companyId, ORG), eq(expenses.id, expenseB.id)))
        .limit(1);
      expect(d(row.paidAmount).eq(0)).toBe(true);
      expect(row.paymentStatus).toBe("unpaid");
      const [payRow] = await tx
        .select()
        .from(partyPayments)
        .where(eq(partyPayments.id, payment.id))
        .limit(1);
      expect(payRow.status).toBe("void");
    });
    const voidB = await voidExpenseAction({ id: expenseB.id, reason: "Uji void R3-E tuntas" });
    expect(voidB.ok).toBe(true);
  });

  it("modal Catat Transaksi: beban jenis expense dengan pemasok menjadi beban terutang", async () => {
    const result = await postQuickEntryAction({
      payload: {
        kind: "expense",
        date: "2099-05-10",
        amount: "77000",
        counterAccountId: acc["6100"],
        expenseSupplierId: supplierId,
        notes: `Beban modal terutang ${RUN}`,
      },
      idempotencyKey: `r3e-${RUN}-expense-accrual`,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.numbers).toHaveLength(1);
      const number = result.data.numbers[0];
      await withCompany(ORG, async (tx) => {
        const [row] = await tx
          .select()
          .from(expenses)
          .where(and(eq(expenses.companyId, ORG), eq(expenses.number, number)))
          .limit(1);
        expect(row).toBeTruthy();
        expect(row.supplierId).toBe(supplierId);
        expect(row.paymentAccountId).toBeNull();
        expect(row.paymentStatus).toBe("unpaid");
      });
    }
  });
});

/* ------------------------------------------------------------------ */
/* R3-12 — jurnal dari mutasi rekonsiliasi multi-baris                 */
/* ------------------------------------------------------------------ */

describe("R3-12 domain rekonsiliasi multi-baris (rollback)", () => {
  async function importOne(
    tx: Tx,
    description: string,
    debit: string,
    credit: string,
  ): Promise<string> {
    const csv = [
      "Tanggal;Keterangan;Debit;Kredit",
      `10/02/2099;${description};${debit};${credit}`,
    ].join("\n");
    await importStatement(tx, {
      companyId: ORG,
      userId: USER_ID,
      accountId: acc["1100"],
      fileName: `mutasi-r3e-${RUN}.csv`,
      csvText: csv,
    });
    const [line] = await tx
      .select()
      .from(bankStatementLines)
      .where(
        and(eq(bankStatementLines.companyId, ORG), eq(bankStatementLines.description, description)),
      )
      .limit(1);
    return line.id;
  }

  it("mutasi masuk neto + potongan: jurnal 3 baris — Dr bank (neto mutasi) + Dr potongan / Cr lawan bruto; bank tertaut", async () => {
    await rollbackTransaction(async (tx) => {
      const lineId = await importOne(tx, `Bunga bruto dipotong PPh ${RUN}`, "800.000", "");
      const entry = await createJournalFromLine(tx, {
        companyId: ORG,
        userId: USER_ID,
        statementLineId: lineId,
        contraAccountId: acc["4300"],
        secondContra: { accountId: acc["6210"], amount: "200000" },
      });
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(3);
      expectLine(lines, acc["1100"], "debit", "800000");
      expectLine(lines, acc["6210"], "debit", "200000");
      expectLine(lines, acc["4300"], "credit", "1000000");
      const [statement] = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.id, lineId))
        .limit(1);
      expect(statement.matchedJournalLineId).toBeTruthy();
      const [bankLeg] = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.id, statement.matchedJournalLineId!))
        .limit(1);
      expect(bankLeg.accountId).toBe(acc["1100"]);
      expect(d(bankLeg.debit).eq(800000)).toBe(true);
    });
  });

  it("mutasi keluar neto + potongan: Dr lawan bruto / Cr potongan + Cr bank (neto mutasi)", async () => {
    await rollbackTransaction(async (tx) => {
      const lineId = await importOne(tx, `Pembayaran dipotong bank ${RUN}`, "", "500.000");
      const entry = await createJournalFromLine(tx, {
        companyId: ORG,
        userId: USER_ID,
        statementLineId: lineId,
        contraAccountId: acc["6060"],
        secondContra: { accountId: acc["2150"], amount: "50000" },
      });
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(3);
      expectLine(lines, acc["6060"], "debit", "550000");
      expectLine(lines, acc["2150"], "credit", "50000");
      expectLine(lines, acc["1100"], "credit", "500000");
    });
  });

  it("tanpa baris kedua perilaku lama persis: jurnal 2 baris", async () => {
    await rollbackTransaction(async (tx) => {
      const lineId = await importOne(tx, `Biaya admin biasa ${RUN}`, "", "25.000");
      const entry = await createJournalFromLine(tx, {
        companyId: ORG,
        userId: USER_ID,
        statementLineId: lineId,
        contraAccountId: acc["6060"],
      });
      const lines = await linesOf(tx, entry.id);
      expect(lines).toHaveLength(2);
      expectLine(lines, acc["6060"], "debit", "25000");
      expectLine(lines, acc["1100"], "credit", "25000");
    });
  });

  it("baris kedua tidak sah ditolak: nominal nol/negatif, akun sama dengan bank, akun sama dengan lawan utama", async () => {
    await rollbackTransaction(async (tx) => {
      const lineId = await importOne(tx, `Mutasi penjaga ${RUN}`, "100.000", "");
      const base = {
        companyId: ORG,
        userId: USER_ID,
        statementLineId: lineId,
        contraAccountId: acc["4300"],
      };
      await expect(
        createJournalFromLine(tx, { ...base, secondContra: { accountId: acc["6210"], amount: "0" } }),
      ).rejects.toThrow();
      await expect(
        createJournalFromLine(tx, { ...base, secondContra: { accountId: acc["6210"], amount: "-5" } }),
      ).rejects.toThrow();
      await expect(
        createJournalFromLine(tx, { ...base, secondContra: { accountId: acc["1100"], amount: "1000" } }),
      ).rejects.toThrow();
      await expect(
        createJournalFromLine(tx, { ...base, secondContra: { accountId: acc["4300"], amount: "1000" } }),
      ).rejects.toThrow();
    });
  });
});
