import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  bankTransfers,
  companySettings,
  customers,
  journalEntries,
  journalLines,
  partyPayments,
  products,
  sales,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { ensureFiscalPeriods } from "@/server/accounting";
import { createReceipt } from "@/server/inventory";
import { createOpeningBalance, payOpeningBalance } from "@/server/opening-balances";
import { payPayableDocument } from "@/server/payables";
import { payReceivable } from "@/server/pos";
import { getJournalDetail } from "@/server/reports";
import {
  payPayableFifo,
  postQuickCashSale,
  receiveReceivableFifo,
} from "@/server/quick-entry";
import { postManualJournalAction } from "@/server/actions/accounting/jurnal";
import { payReceivableAction } from "@/server/actions/pos";
import { postQuickEntryAction } from "@/server/actions/quick-entry";
import { buildQuickEntryPreview } from "@/lib/quick-entry";
import { d } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-21 Tahap R3-D — kelengkapan dokumen input (audit R3):
//   R3-05 penjualan tunai input cepat tanpa diskon & tanpa tag
//         pelanggan — pendapatan hanya bisa dicatat neto dan tidak
//         teratribusi, tidak seperti POS (bruto + contra-revenue
//         sales_discount + pihak tercatat);
//   R3-08 party_payments tanpa kolom referensi sama sekali (migrasi
//         0048) dan transfer input cepat tidak bisa mengisi referensi
//         walau domain transfer mendukungnya;
//   R3-09 baris jurnal manual tidak bisa ditag pihak padahal
//         journal_lines.party_type/party_id ada dan postJournal
//         menerimanya.
// Domain diuji dalam transaksi rollback; aksi ter-commit dengan
// penanda unik per larian — perusahaan fixture khusus berkas ini.

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000a211" },
    user: { id: "user-uji-a21-r3d" },
    role: "owner",
  });
  return {
    requireAuth: requirePermission,
    requirePermission,
    requirePermissionInModule: requirePermission,
  };
});

const ORG = "01900000-0000-7000-8000-00000000a211";
const USER_ID = "user-uji-a21-r3d";
const RUN = `${Date.now()}`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

const acc: Record<string, string> = {};
let warehouseId = "";
let supplierId = "";
let productId = "";
let customerId = "";
let customerBId = "";

async function bootstrap() {
  await withCompany(ORG, async (tx) => {
    await ensureFiscalPeriods(tx, ORG, 2099);
    const [settings] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (!settings) {
      await tx.insert(companySettings).values({ companyId: ORG, legalName: "Uji R3-D", taxRate: "11" });
      const rows = await tx
        .insert(accounts)
        .values([
          { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", cashBankKind: "cash" },
          { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", cashBankKind: "bank" },
          { companyId: ORG, code: "1110", name: "QRIS", type: "asset", normalBalance: "debit", cashBankKind: "clearing" },
          { companyId: ORG, code: "1200", name: "Piutang Usaha", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit" },
          { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "2200", name: "PPN Keluaran", type: "liability", normalBalance: "credit" },
          { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
          { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
          { companyId: ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit" },
          { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
          { companyId: ORG, code: "6060", name: "Biaya Administrasi Bank", type: "expense", normalBalance: "debit" },
          { companyId: ORG, code: "6100", name: "Beban Listrik", type: "expense", normalBalance: "debit" },
        ])
        .returning({ id: accounts.id, code: accounts.code });
      const byCode = new Map(rows.map((row) => [row.code, row.id]));
      await tx.insert(accountMappings).values([
        { companyId: ORG, key: "cash", accountId: byCode.get("1000")! },
        { companyId: ORG, key: "bank", accountId: byCode.get("1100")! },
        { companyId: ORG, key: "qris", accountId: byCode.get("1110")! },
        { companyId: ORG, key: "receivable", accountId: byCode.get("1200")! },
        { companyId: ORG, key: "inventory", accountId: byCode.get("1300")! },
        { companyId: ORG, key: "payable", accountId: byCode.get("2000")! },
        { companyId: ORG, key: "tax_output", accountId: byCode.get("2200")! },
        { companyId: ORG, key: "equity", accountId: byCode.get("3000")! },
        { companyId: ORG, key: "revenue", accountId: byCode.get("4000")! },
        { companyId: ORG, key: "sales_discount", accountId: byCode.get("4010")! },
        { companyId: ORG, key: "cogs", accountId: byCode.get("5000")! },
        { companyId: ORG, key: "bank_fee", accountId: byCode.get("6060")! },
      ]);
      const [warehouse] = await tx
        .insert(warehouses)
        .values({ companyId: ORG, code: "GD-R3D", name: "Gudang Uji R3D", type: "warehouse", isDefault: true })
        .returning({ id: warehouses.id });
      warehouseId = warehouse.id;
      const [supplier] = await tx
        .insert(suppliers)
        .values({ companyId: ORG, code: "SUP-R3D", name: "Pemasok R3D" })
        .returning({ id: suppliers.id });
      supplierId = supplier.id;
      const [product] = await tx
        .insert(products)
        .values({ companyId: ORG, sku: "R3D-P1", name: "Produk R3D", costPrice: "5000", salePrice: "8000" })
        .returning({ id: products.id });
      productId = product.id;
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
    }
    const [customer] = await tx
      .insert(customers)
      .values({ companyId: ORG, code: `CUST-R3D-${RUN}`, name: "Pelanggan R3D" })
      .returning({ id: customers.id });
    customerId = customer.id;
    const [customerB] = await tx
      .insert(customers)
      .values({ companyId: ORG, code: `CUST-R3DB-${RUN}`, name: "Pelanggan R3D B" })
      .returning({ id: customers.id });
    customerBId = customerB.id;
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

/* ------------------------------------------------------------------ */
/* R3-05 — penjualan tunai input cepat: diskon + tag pelanggan         */
/* ------------------------------------------------------------------ */

describe("R3-05 domain penjualan tunai cepat (rollback)", () => {
  it("diskon + PPN + pelanggan: Dr kas neto, Dr diskon 4010, Cr pendapatan BRUTO bertag pelanggan, Cr PPN atas dasar sesudah diskon", async () => {
    await rollbackTransaction(async (tx) => {
      const entry = await postQuickCashSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-02-01",
        amount: "111000",
        accountId: acc["1000"],
        revenueAccountId: acc["4000"],
        taxIncluded: true,
        taxRate: "11",
        discount: "11000",
        customerId,
      });
      const rows = await linesOf(tx, entry.journalId);
      expect(rows).toHaveLength(4);
      const byAccount = new Map(rows.map((row) => [row.accountId, row]));
      expect(d(byAccount.get(acc["1000"])!.debit).toFixed(0)).toBe("100000");
      expect(d(byAccount.get(acc["4010"])!.debit).toFixed(0)).toBe("11000");
      // Pendapatan dikredit bruto: 111.000 − PPN(100.000 × 11/111).
      expect(d(byAccount.get(acc["4000"])!.credit).toFixed(2)).toBe("101090.09");
      expect(d(byAccount.get(acc["2200"])!.credit).toFixed(2)).toBe("9909.91");
      // Tag pihak hanya di baris pendapatan, menunjuk pelanggan terpilih.
      expect(byAccount.get(acc["4000"])!.partyType).toBe("customer");
      expect(byAccount.get(acc["4000"])!.partyId).toBe(customerId);
      expect(byAccount.get(acc["1000"])!.partyType).toBeNull();
      expect(byAccount.get(acc["4010"])!.partyType).toBeNull();

      // Pratinjau == posting menurut konstruksi (invariant D-23):
      // urutan & nominal baris pratinjau persis baris jurnal.
      const preview = buildQuickEntryPreview({
        kind: "cash_sale",
        amount: "111000",
        discount: "11000",
        taxIncluded: true,
        taxRate: "11",
      });
      expect(preview.lines.map((line) => [line.debit, line.credit])).toEqual(
        rows.map((row) => [d(row.debit).toFixed(4), d(row.credit).toFixed(4)]),
      );
    });
  });

  it("diskon tanpa pajak: tiga baris, pendapatan bruto penuh", async () => {
    await rollbackTransaction(async (tx) => {
      const entry = await postQuickCashSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-02-01",
        amount: "100000",
        accountId: acc["1100"],
        revenueAccountId: acc["4000"],
        taxIncluded: false,
        taxRate: "11",
        discount: "10000",
      });
      const rows = await linesOf(tx, entry.journalId);
      expect(rows).toHaveLength(3);
      const byAccount = new Map(rows.map((row) => [row.accountId, row]));
      expect(d(byAccount.get(acc["1100"])!.debit).toFixed(0)).toBe("90000");
      expect(d(byAccount.get(acc["4010"])!.debit).toFixed(0)).toBe("10000");
      expect(d(byAccount.get(acc["4000"])!.credit).toFixed(0)).toBe("100000");
      expect(byAccount.get(acc["4000"])!.partyId).toBeNull();
    });
  });

  it("tanpa diskon & tanpa pelanggan: bentuk jurnal lama persis (regresi)", async () => {
    await rollbackTransaction(async (tx) => {
      const entry = await postQuickCashSale(tx, {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-02-01",
        amount: "111000",
        accountId: acc["1000"],
        revenueAccountId: acc["4000"],
        taxIncluded: true,
        taxRate: "11",
      });
      const rows = await linesOf(tx, entry.journalId);
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.partyType === null && row.partyId === null)).toBe(true);
      const byAccount = new Map(rows.map((row) => [row.accountId, row]));
      expect(d(byAccount.get(acc["1000"])!.debit).toFixed(0)).toBe("111000");
      expect(d(byAccount.get(acc["4000"])!.credit).toFixed(0)).toBe("100000");
    });
  });

  it("diskon tidak sah ditolak: melebihi jumlah, negatif, pelanggan tak dikenal", async () => {
    await rollbackTransaction(async (tx) => {
      const base = {
        companyId: ORG,
        userId: USER_ID,
        date: "2099-02-01",
        amount: "100000",
        accountId: acc["1000"],
        revenueAccountId: acc["4000"],
        taxIncluded: false,
        taxRate: "11",
      };
      await expect(postQuickCashSale(tx, { ...base, discount: "100001" })).rejects.toThrow(/diskon/i);
      await expect(postQuickCashSale(tx, { ...base, discount: "-1" })).rejects.toThrow(/diskon/i);
      await expect(
        postQuickCashSale(tx, { ...base, customerId: "01900000-0000-7000-8000-00000000ffff" }),
      ).rejects.toThrow(/pelanggan tidak ditemukan/i);
    });
  });
});

/* ------------------------------------------------------------------ */
/* R3-08 — referensi pembayaran pihak & transfer cepat                 */
/* ------------------------------------------------------------------ */

describe("R3-08 domain pembayaran pihak (rollback)", () => {
  it("payOpeningBalance menyimpan referensi; tanpa referensi tetap null", async () => {
    await rollbackTransaction(async (tx) => {
      const opening = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerId,
        date: "2099-01-05",
        amount: "80000",
        reference: "OP-R3D-1",
      });
      const paid = await payOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: opening.id,
        date: "2099-02-01",
        amount: "30000",
        accountId: acc["1000"],
        reference: "TRF-BCA-991",
      });
      const [row] = await tx
        .select({ reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.id, paid.paymentId)));
      expect(row.reference).toBe("TRF-BCA-991");

      const opening2 = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerId,
        date: "2099-01-06",
        amount: "20000",
        reference: "OP-R3D-2",
      });
      const paid2 = await payOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        openingId: opening2.id,
        date: "2099-02-01",
        amount: "20000",
        accountId: acc["1000"],
      });
      const [row2] = await tx
        .select({ reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.id, paid2.paymentId)));
      expect(row2.reference).toBeNull();
    });
  });

  it("payPayableDocument menyimpan referensi pada party_payments", async () => {
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
      const paid = await payPayableDocument(tx, {
        companyId: ORG,
        userId: USER_ID,
        receiptId: receipt.id,
        date: "2099-02-01",
        amount: "50000",
        accountId: acc["1100"],
        reference: "CEK-778",
      });
      const rows = await tx
        .select({ reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.receiptId, receipt.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0].reference).toBe("CEK-778");
      expect(paid.number).toBeTruthy();
    });
  });

  it("payReceivable menyimpan referensi pada party_payments", async () => {
    await rollbackTransaction(async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values({
          companyId: ORG,
          warehouseId,
          number: `R3D-AR-${RUN}`,
          date: "2099-01-10",
          cashierId: USER_ID,
          customerId,
          status: "completed",
          subtotal: "75000",
          total: "75000",
          paidTotal: "0",
          paymentStatus: "unpaid",
          createdBy: USER_ID,
        })
        .returning({ id: sales.id });
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_ID,
        saleId: sale.id,
        date: "2099-02-01",
        amount: "75000",
        accountId: acc["1000"],
        reference: "VA-555123",
      });
      const rows = await tx
        .select({ reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0].reference).toBe("VA-555123");
    });
  });

  it("FIFO modal meneruskan satu referensi ke semua pembayaran per dokumen", async () => {
    await rollbackTransaction(async (tx) => {
      const first = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerBId,
        date: "2099-01-05",
        amount: "40000",
        reference: "OP-R3D-F1",
      });
      const second = await createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerBId,
        date: "2099-01-08",
        amount: "30000",
        reference: "OP-R3D-F2",
      });
      await receiveReceivableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        customerId: customerBId,
        date: "2099-02-01",
        amount: "55000",
        accountId: acc["1000"],
        reference: "TRF-FIFO-1",
      });
      const rows = await tx
        .select({ openingId: partyPayments.openingId, reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.partyId, customerBId)));
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.openingId).sort()).toEqual([first.id, second.id].sort());
      expect(rows.every((row) => row.reference === "TRF-FIFO-1")).toBe(true);

      const receipt = await createReceipt(tx, {
        companyId: ORG,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date: "2099-01-03",
        lines: [{ productId, qty: "4", unitCost: "5000" }],
      });
      await payPayableFifo(tx, {
        companyId: ORG,
        userId: USER_ID,
        supplierId,
        date: "2099-02-01",
        amount: "20000",
        accountId: acc["1100"],
        reference: "TRF-FIFO-2",
      });
      const payRows = await tx
        .select({ reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.receiptId, receipt.id)));
      expect(payRows).toHaveLength(1);
      expect(payRows[0].reference).toBe("TRF-FIFO-2");
    });
  });
});

/* ------------------------------------------------------------------ */
/* Aksi (ter-commit di perusahaan fixture, sesi mock)                  */
/* ------------------------------------------------------------------ */

describe("R3-05/R3-08 aksi input cepat (ter-commit)", () => {
  it("posting penjualan tunai dengan diskon & pelanggan lewat aksi: jurnal sesuai domain", async () => {
    const key = `r3d-sale-${RUN}`;
    const result = await postQuickEntryAction({
      payload: {
        kind: "cash_sale",
        date: "2099-02-02",
        amount: "100000",
        accountId: acc["1000"],
        counterAccountId: acc["4000"],
        partyId: customerId,
        discount: "10000",
      },
      idempotencyKey: key,
    });
    expect(result.ok).toBe(true);
    const rows = await withCompanyReadOnly(ORG, async (tx) => {
      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.companyId, ORG), eq(journalEntries.idempotencyKey, `quick_entry:${key}`)),
        )
        .limit(1);
      expect(entry).toBeTruthy();
      return linesOf(tx, entry.id);
    });
    expect(rows).toHaveLength(3);
    const byAccount = new Map(rows.map((row) => [row.accountId, row]));
    expect(d(byAccount.get(acc["1000"])!.debit).toFixed(0)).toBe("90000");
    expect(d(byAccount.get(acc["4010"])!.debit).toFixed(0)).toBe("10000");
    expect(d(byAccount.get(acc["4000"])!.credit).toFixed(0)).toBe("100000");
    expect(byAccount.get(acc["4000"])!.partyId).toBe(customerId);
  });

  it("posting transfer cepat dengan referensi: tersimpan di dokumen transfer", async () => {
    const result = await postQuickEntryAction({
      payload: {
        kind: "transfer",
        date: "2099-02-02",
        amount: "250000",
        fromAccountId: acc["1000"],
        toAccountId: acc["1100"],
        reference: `REF-R3D-${RUN}`,
        notes: "uji r3d transfer",
      },
      idempotencyKey: `r3d-trf-${RUN}`,
    });
    expect(result.ok).toBe(true);
    const rows = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ reference: bankTransfers.reference })
        .from(bankTransfers)
        .where(and(eq(bankTransfers.companyId, ORG), eq(bankTransfers.reference, `REF-R3D-${RUN}`))),
    );
    expect(rows).toHaveLength(1);
  });

  it("posting terima piutang cepat dengan referensi: tersimpan di party_payments", async () => {
    const opening = await withCompany(ORG, (tx) =>
      createOpeningBalance(tx, {
        companyId: ORG,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerBId,
        date: "2099-01-05",
        amount: "45000",
        reference: `OP-R3D-AKSI-${RUN}`,
      }),
    );
    const result = await postQuickEntryAction({
      payload: {
        kind: "receive",
        date: "2099-02-02",
        amount: "45000",
        accountId: acc["1000"],
        partyId: customerBId,
        reference: `TRF-AKSI-${RUN}`,
      },
      idempotencyKey: `r3d-rcv-${RUN}`,
    });
    expect(result.ok).toBe(true);
    const rows = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.openingId, opening.id))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toBe(`TRF-AKSI-${RUN}`);
  });
});

describe("R3-08 aksi pembayaran piutang (ter-commit)", () => {
  it("payReceivableAction meneruskan referensi ke party_payments", async () => {
    const saleId = await withCompany(ORG, async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values({
          companyId: ORG,
          warehouseId,
          number: `R3D-AKSI-AR-${RUN}`,
          date: "2099-01-10",
          cashierId: USER_ID,
          customerId,
          status: "completed",
          subtotal: "60000",
          total: "60000",
          paidTotal: "0",
          paymentStatus: "unpaid",
          createdBy: USER_ID,
        })
        .returning({ id: sales.id });
      return sale.id;
    });
    const result = await payReceivableAction({
      saleId,
      amount: "60000",
      accountId: acc["1000"],
      date: "2099-02-02",
      reference: `VA-AKSI-${RUN}`,
    });
    expect(result.ok).toBe(true);
    const rows = await withCompanyReadOnly(ORG, (tx) =>
      tx
        .select({ reference: partyPayments.reference })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, saleId))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toBe(`VA-AKSI-${RUN}`);
  });
});

/* ------------------------------------------------------------------ */
/* R3-09 — tag pihak baris jurnal manual                               */
/* ------------------------------------------------------------------ */

describe("R3-09 aksi jurnal manual (ter-commit)", () => {
  it("baris bertag pihak tersimpan di journal_lines dan terbaca di detail jurnal beserta nama pihak", async () => {
    const result = await postManualJournalAction({
      date: "2099-02-03",
      description: `Penyesuaian piutang R3D ${RUN}`,
      idempotencyKey: `r3d-journal-${RUN}`,
      lines: [
        {
          accountId: acc["1200"],
          debit: "50000",
          description: "Koreksi piutang pelanggan",
          partyType: "customer",
          partyId: customerId,
        },
        { accountId: acc["4000"], credit: "50000", description: "Koreksi pendapatan" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = await withCompanyReadOnly(ORG, (tx) => linesOf(tx, result.data.id));
    expect(rows).toHaveLength(2);
    const receivableLine = rows.find((row) => row.accountId === acc["1200"])!;
    expect(receivableLine.partyType).toBe("customer");
    expect(receivableLine.partyId).toBe(customerId);
    const revenueLine = rows.find((row) => row.accountId === acc["4000"])!;
    expect(revenueLine.partyId).toBeNull();

    // Tampilan: detail jurnal menyelesaikan nama pihak dari tag-nya.
    const detail = await withCompanyReadOnly(ORG, (tx) => getJournalDetail(tx, ORG, result.data.id));
    const detailLine = detail!.lines.find((line) => line.accountCode === "1200")!;
    expect(detailLine.partyName).toBe("Pelanggan R3D");
  });

  it("tag pihak tidak sah ditolak: pihak tak dikenal & tipe tanpa id", async () => {
    const unknown = await postManualJournalAction({
      date: "2099-02-03",
      description: `Penyesuaian piutang R3D ${RUN}`,
      idempotencyKey: `r3d-journal-bad-${RUN}`,
      lines: [
        {
          accountId: acc["1200"],
          debit: "50000",
          partyType: "customer",
          partyId: "01900000-0000-7000-8000-00000000ffff",
        },
        { accountId: acc["4000"], credit: "50000" },
      ],
    });
    expect(unknown.ok).toBe(false);

    const typeOnly = await postManualJournalAction({
      date: "2099-02-03",
      description: `Penyesuaian piutang R3D ${RUN}`,
      idempotencyKey: `r3d-journal-bad2-${RUN}`,
      lines: [
        { accountId: acc["1200"], debit: "50000", partyType: "customer" },
        { accountId: acc["4000"], credit: "50000" },
      ],
    });
    expect(typeOnly.ok).toBe(false);
  });

  it("jurnal manual tanpa tag: baris tetap tanpa pihak (regresi)", async () => {
    const result = await postManualJournalAction({
      date: "2099-02-03",
      description: `Jurnal biasa R3D ${RUN}`,
      idempotencyKey: `r3d-journal-plain-${RUN}`,
      lines: [
        { accountId: acc["6100"], debit: "25000" },
        { accountId: acc["1000"], credit: "25000" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = await withCompanyReadOnly(ORG, (tx) => linesOf(tx, result.data.id));
    expect(rows.every((row) => row.partyType === null && row.partyId === null)).toBe(true);
  });
});
