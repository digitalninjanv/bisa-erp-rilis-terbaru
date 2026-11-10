import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  cashMovements,
  cashSessions,
  companySettings,
  customerGroupPrices,
  customerGroups,
  customers,
  journalEntries,
  journalLines,
  partyPayments,
  paymentMethods,
  products,
  saleReturnLines,
  saleReturns,
  sales,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  cashDrawerMovement,
  closeCashSession,
  createSale,
  createSaleReturn,
  getReturnCredit,
  openCashSession,
  payReceivable,
  quoteCart,
} from "@/server/pos";
import { applyStockMovement } from "@/server/inventory";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";

// =====================================================================
// FIX-POS TAHAP 1 — regresi permanen domain & uang POS (POS1-01,
// POS1-02, POS1-03, POS1-05, POS1-06, POS1-07, POS1-09, POS1-10,
// POS1-13). Probe audit tetap di pos1-audit-probe.test.ts; berkas ini
// memuat penguat yang tidak ada di probe: jalur SAH yang tidak boleh
// ikut tertahan oleh penjaga baru, dan angka rinci penyelesaian retur.
// Perusahaan fixture khusus audit POS: 01900000-…-d501 (sama dengan
// probe; fixture menyembuhkan diri di beforeAll). Demo tidak disentuh.
// =====================================================================

const ORG = "01900000-0000-7000-8000-00000000d501";
const USER_A = "user-probe-pos1-a";

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function rb<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let value: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG}, true)`);
      value = await fn(tx);
      throw new Rollback("rollback fix-pos-t1");
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return value as T;
}

async function commitTx<T>(org: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${org}, true)`);
    return fn(tx);
  });
}

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1100", "Bank BCA", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["2100", "Utang Gaji", "liability", "credit"],
  ["2200", "PPN Keluaran", "liability", "credit"],
  ["2300", "Kredit Pelanggan", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4010", "Diskon Penjualan", "revenue", "debit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["5010", "Selisih Persediaan", "cogs", "debit"],
  ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
  ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ["6060", "Beban Administrasi Bank", "expense", "debit"],
  ["8000", "Selisih Kas Kurang", "expense", "debit"],
  ["8001", "Selisih Kas Lebih", "revenue", "credit"],
  ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
  ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
];

async function ensureCompany(org: string, legalName: string) {
  await commitTx(org, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, org))
      .limit(1);
    if (existing) {
      await tx
        .update(companySettings)
        .set({ taxEnabled: true, taxRate: "11", roundingMode: "none", posOfflineEnabled: true })
        .where(eq(companySettings.companyId, org));
      return;
    }
    await tx.insert(companySettings).values({
      companyId: org,
      legalName,
      taxRate: "11",
      taxEnabled: true,
      roundingMode: "none",
      posOfflineEnabled: true,
    });
    const accountRows = await tx
      .insert(accounts)
      .values(
        ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
          companyId: org,
          code,
          name,
          type,
          normalBalance,
        })),
      )
      .returning();
    const acc = new Map(accountRows.map((a) => [a.code, a.id]));
    const mapping: Record<string, string> = {
      cash: acc.get("1000")!,
      bank: acc.get("1100")!,
      qris: acc.get("1110")!,
      receivable: acc.get("1200")!,
      inventory: acc.get("1300")!,
      payable: acc.get("2000")!,
      revenue: acc.get("4000")!,
      sales_discount: acc.get("4010")!,
      sales_return: acc.get("4020")!,
      cogs: acc.get("5000")!,
      inventory_shrink: acc.get("5010")!,
      damaged: acc.get("5020")!,
      tax_output: acc.get("2200")!,
      rounding_gain: acc.get("9000")!,
      rounding_loss: acc.get("9001")!,
      cash_short: acc.get("8000")!,
      cash_over: acc.get("8001")!,
      salary_expense: acc.get("6000")!,
      salary_payable: acc.get("2100")!,
      bank_fee: acc.get("6060")!,
      equity: acc.get("3000")!,
      customer_credit: acc.get("2300")!,
    };
    await tx.insert(accountMappings).values(
      Object.entries(mapping).map(([key, accountId]) => ({ companyId: org, key, accountId })),
    );
    await tx.insert(warehouses).values({
      companyId: org,
      code: "GD-P1",
      name: "Gudang Probe",
      type: "warehouse",
      isDefault: true,
    });
    await tx.insert(paymentMethods).values([
      { companyId: org, code: "CASH", name: "Tunai", type: "cash", accountId: acc.get("1000")!, sortOrder: 1 },
      { companyId: org, code: "QRIS", name: "QRIS", type: "qris", accountId: acc.get("1110")!, sortOrder: 2 },
      { companyId: org, code: "CREDIT", name: "Utang", type: "credit", accountId: acc.get("1200")!, sortOrder: 3 },
      { companyId: org, code: "CCUST", name: "Kredit Pelanggan", type: "customer_credit", accountId: acc.get("2300")!, sortOrder: 4 },
    ]);
    await tx.insert(cashSessions).values({
      companyId: org,
      userId: USER_A,
      openingCash: "0",
      status: "open",
    });
  });
}

beforeAll(async () => {
  await ensureCompany(ORG, "Probe POS1 Utama");
});

async function warehouseId(tx: Tx) {
  const [w] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  return w.id;
}

async function methodId(tx: Tx, code: string) {
  const [m] = await tx
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG), eq(paymentMethods.code, code)))
    .limit(1);
  return m.id;
}

async function accountId(tx: Tx, code: string) {
  const [a] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  return a.id;
}

let skuCounter = 0;
async function makeProduct(
  tx: Tx,
  input: { price: string; cost: string; stock?: number },
) {
  skuCounter += 1;
  const [p] = await tx
    .insert(products)
    .values({
      companyId: ORG,
      sku: `FXT1-${Date.now()}-${skuCounter}`,
      name: `Produk Fix T1 ${skuCounter}`,
      salePrice: input.price,
      costPrice: input.cost,
      trackStock: true,
    })
    .returning({ id: products.id });
  if ((input.stock ?? 0) > 0) {
    await applyStockMovement(tx, {
      companyId: ORG,
      warehouseId: await warehouseId(tx),
      productId: p.id,
      delta: input.stock!,
      unitCost: input.cost,
      movementType: "adjustment",
      referenceType: "probe",
      userId: USER_A,
    });
  }
  return p.id;
}

async function makeCustomer(tx: Tx, input: { name: string; creditLimit?: string; isActive?: boolean }) {
  const [c] = await tx
    .insert(customers)
    .values({
      companyId: ORG,
      code: `C-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: input.name,
      creditLimit: input.creditLimit ?? "0",
      isActive: input.isActive ?? true,
    })
    .returning({ id: customers.id });
  return c.id;
}

async function stockQty(tx: Tx, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG),
        eq(stockOnHand.warehouseId, await warehouseId(tx)),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? "0").toNumber();
}

async function setTax(tx: Tx, enabled: boolean) {
  await tx
    .update(companySettings)
    .set({ taxEnabled: enabled })
    .where(eq(companySettings.companyId, ORG));
}

const TODAY = todayISO();

// =====================================================================
// POS1-01 — jalur sah agregasi: baris duplikat yang MUAT tetap jalan
// =====================================================================
describe("FIX-POS-T1 POS1-01 agregasi baris retur", () => {
  it("retur [{2},{3}] atas penjualan 5 diterima sebagai SATU baris retur qty 5, refund penuh 50.000", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 5 });
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 5 }],
        payments: [{ methodId: cash, amount: 50000, tendered: 50000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      const ret = await createSaleReturn(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        reason: "fix t1 agregasi sah",
        refundMethod: "cash",
        type: "return",
        lines: [
          { productId, qty: 2 },
          { productId, qty: 3 },
        ],
      });
      expect(ret.total).toBe(50000);
      const lines = await tx
        .select({ qty: saleReturnLines.qty })
        .from(saleReturnLines)
        .where(eq(saleReturnLines.returnId, ret.id));
      expect(lines).toHaveLength(1);
      expect(d(lines[0].qty).toNumber()).toBe(5);
      expect(await stockQty(tx, productId)).toBe(5);
    });
  });
});

// =====================================================================
// POS1-03 — jalur sah setoran: sebesar saldo persis lolos; penarikan
// (uang masuk) tidak dibatasi isi laci; tutup sesi sesudahnya bersih
// =====================================================================
describe("FIX-POS-T1 POS1-03 setoran dalam batas laci", () => {
  it("setor = saldo laci lolos, setor saldo+1 ditolak, tarik bebas, tutup sesi difference 0", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const user = `user-fixt1-laci-${Date.now()}`;
      const session = await openCashSession(tx, {
        companyId: ORG,
        userId: user,
        openingCash: 50000,
      });
      let overRejected = false;
      try {
        await cashDrawerMovement(tx, {
          companyId: ORG,
          userId: user,
          sessionId: session.id,
          type: "deposit",
          amount: 50001,
        });
      } catch {
        overRejected = true;
      }
      expect(overRejected).toBe(true);

      await cashDrawerMovement(tx, {
        companyId: ORG,
        userId: user,
        sessionId: session.id,
        type: "deposit",
        amount: 50000,
      });
      // Penarikan = uang masuk dari bank; tidak dibatasi isi laci.
      await cashDrawerMovement(tx, {
        companyId: ORG,
        userId: user,
        sessionId: session.id,
        type: "withdrawal",
        amount: 200000,
      });
      const closed = await closeCashSession(tx, {
        companyId: ORG,
        userId: user,
        sessionId: session.id,
        countedCash: 200000,
      });
      expect(closed.expected).toBe(200000);
      expect(closed.difference).toBe(0);
    });
  });
});

// =====================================================================
// POS1-05 — kunci idempotensi: replay berkunci mengembalikan hasil
// pertama; kunci berbeda = pembayaran kedua yang sah; pembayaran
// identik DI LUAR jendela dedupe tetap tercatat
// =====================================================================
describe("FIX-POS-T1 POS1-05 idempotensi pembayaran piutang", () => {
  async function creditSale(tx: Tx, amount: number) {
    const wh = await warehouseId(tx);
    const credit = await methodId(tx, "CREDIT");
    const productId = await makeProduct(tx, { price: String(amount), cost: "6000", stock: 3 });
    const customerId = await makeCustomer(tx, { name: "Fix T1 Idempoten" });
    return createSale(tx, {
      companyId: ORG,
      userId: USER_A,
      warehouseId: wh,
      customerId,
      dueDate: TODAY,
      date: TODAY,
      lines: [{ productId, qty: 1 }],
      payments: [{ methodId: credit, amount }],
      idempotencyKey: crypto.randomUUID(),
    });
  }

  it("replay dengan kunci sama: nomor sama, satu baris pembayaran; kunci berbeda tercatat sebagai pembayaran kedua", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const kas = await accountId(tx, "1000");
      const sale = await creditSale(tx, 100000);
      const key = crypto.randomUUID();
      const first = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
        idempotencyKey: key,
      });
      const replay = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
        idempotencyKey: key,
      });
      expect(replay.number).toBe(first.number);
      // Kunci berbeda = permintaan yang memang berbeda: tercatat.
      const second = await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(second.number).not.toBe(first.number);
      const payments = await tx
        .select({ id: partyPayments.id })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      expect(payments).toHaveLength(2);
      const [saleRow] = await tx
        .select({ paidTotal: sales.paidTotal })
        .from(sales)
        .where(eq(sales.id, sale.id));
      expect(d(saleRow.paidTotal).toNumber()).toBe(80000);
    });
  });

  it("pembayaran identik tanpa kunci SESUDAH jendela 60 detik tercatat sebagai pembayaran kedua", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const kas = await accountId(tx, "1000");
      const sale = await creditSale(tx, 100000);
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
      });
      // Mundurkan usia baris pertama keluar jendela dedupe — pembayaran
      // berikutnya yang identik adalah penerimaan yang sungguh baru.
      await tx.execute(
        sql`update party_payments set created_at = now() - interval '5 minutes' where company_id = ${ORG} and sale_id = ${sale.id}`,
      );
      await payReceivable(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        amount: 40000,
        accountId: kas,
      });
      const payments = await tx
        .select({ id: partyPayments.id })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ORG), eq(partyPayments.saleId, sale.id)));
      expect(payments).toHaveLength(2);
    });
  });
});

// =====================================================================
// POS1-06 — angka rinci: tender campuran & pemulihan kredit asal
// =====================================================================
describe("FIX-POS-T1 POS1-06 penyelesaian retur mengikuti tender asal", () => {
  it("penjualan tunai 30rb + QRIS 70rb diretur tunai: laci hanya keluar 30rb, QRIS dikredit kembali 70rb", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const qris = await methodId(tx, "QRIS");
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 3 });
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [
          { methodId: cash, amount: 30000, tendered: 30000 },
          { methodId: qris, amount: 70000 },
        ],
        idempotencyKey: crypto.randomUUID(),
      });
      const ret = await createSaleReturn(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: sale.id,
        date: TODAY,
        reason: "fix t1 tender campuran",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId, qty: 1 }],
      });
      expect(ret.total).toBe(100000);

      const refundMoves = await tx
        .select({ amount: cashMovements.amount })
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG),
            eq(cashMovements.type, "refund"),
            eq(cashMovements.referenceId, ret.id),
          ),
        );
      expect(refundMoves.map((m) => d(m.amount).toNumber())).toEqual([-30000]);

      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "sale_return"),
            eq(journalEntries.sourceId, ret.id),
          ),
        );
      const lines = await tx
        .select({ accountId: journalLines.accountId, credit: journalLines.credit })
        .from(journalLines)
        .where(eq(journalLines.entryId, entry.id));
      const creditOf = async (code: string) => {
        const id = await accountId(tx, code);
        return lines
          .filter((l) => l.accountId === id)
          .reduce((acc, l) => acc + d(l.credit).toNumber(), 0);
      };
      expect(await creditOf("1000")).toBe(30000); // Kas — hanya porsi tunai
      expect(await creditOf("1110")).toBe(70000); // QRIS — kembali ke akun asal
      expect(await creditOf("2300")).toBe(0); // tidak ada kredit baru
    });
  });

  it("retur atas penjualan berbayar kredit retur memulihkan kredit dokumen asal sampai penuh", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const ccust = await methodId(tx, "CCUST");
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 5 });

      const saleA = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: cash, amount: 100000, tendered: 100000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      const retA = await createSaleReturn(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: saleA.id,
        date: TODAY,
        reason: "fix t1 kredit asal",
        refundMethod: "store_credit",
        type: "return",
        lines: [{ productId, qty: 1 }],
      });
      const [retRow] = await tx
        .select({ number: saleReturns.number })
        .from(saleReturns)
        .where(eq(saleReturns.id, retA.id));

      const saleB = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: ccust, amount: 100000, reference: retRow.number }],
        idempotencyKey: crypto.randomUUID(),
      });
      expect((await getReturnCredit(tx, ORG, retRow.number))!.available).toBe(0);

      await createSaleReturn(tx, {
        companyId: ORG,
        userId: USER_A,
        saleId: saleB.id,
        date: TODAY,
        reason: "fix t1 pulihkan kredit",
        refundMethod: "cash",
        type: "return",
        lines: [{ productId, qty: 1 }],
      });
      // Kredit A pulih penuh dan dapat ditebus kembali.
      const credit = await getReturnCredit(tx, ORG, retRow.number);
      expect(credit).not.toBeNull();
      expect(credit!.available).toBe(100000);
    });
  });
});

// =====================================================================
// POS1-07 — pelanggan nonaktif ditolak juga pada penjualan lunas
// =====================================================================
describe("FIX-POS-T1 POS1-07 pelanggan nonaktif", () => {
  it("penjualan lunas dengan pelanggan nonaktif ditolak", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 2 });
      const customerId = await makeCustomer(tx, { name: "Fix T1 Nonaktif", isActive: false });
      let rejected = false;
      try {
        await createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: wh,
          customerId,
          date: TODAY,
          lines: [{ productId, qty: 1 }],
          payments: [{ methodId: cash, amount: 10000, tendered: 10000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });
  });
});

// =====================================================================
// POS1-02 — jalur sekuensial: limit menegakkan tanpa over-blocking
// =====================================================================
describe("FIX-POS-T1 POS1-02 limit kredit sekuensial", () => {
  it("penjualan utang pertama 100rb pada limit 150rb lolos; yang kedua ditolak", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const credit = await methodId(tx, "CREDIT");
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 5 });
      const customerId = await makeCustomer(tx, { name: "Fix T1 Limit", creditLimit: "150000" });
      await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        customerId,
        dueDate: TODAY,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [{ methodId: credit, amount: 100000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      let rejected = false;
      try {
        await createSale(tx, {
          companyId: ORG,
          userId: USER_A,
          warehouseId: wh,
          customerId,
          dueDate: TODAY,
          date: TODAY,
          lines: [{ productId, qty: 1 }],
          payments: [{ methodId: credit, amount: 100000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });
  });
});

// =====================================================================
// POS1-09 — produk harga 0 BERBIAYA tetap menjurnal HPP
// =====================================================================
describe("FIX-POS-T1 POS1-09 penjualan harga nol berbiaya", () => {
  it("produk salePrice=0 cost=5.000: checkout sukses, stok bergerak, jurnal HPP terbit", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const productId = await makeProduct(tx, { price: "0", cost: "5000", stock: 3 });
      const sale = await createSale(tx, {
        companyId: ORG,
        userId: USER_A,
        warehouseId: wh,
        date: TODAY,
        lines: [{ productId, qty: 1 }],
        payments: [],
        idempotencyKey: crypto.randomUUID(),
      });
      expect(await stockQty(tx, productId)).toBe(2);
      const entries = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "sale"),
            eq(journalEntries.sourceId, sale.id),
          ),
        );
      expect(entries).toHaveLength(1);
      const lines = await tx
        .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .where(eq(journalLines.entryId, entries[0].id));
      const cogsId = await accountId(tx, "5000");
      const invId = await accountId(tx, "1300");
      expect(lines.some((l) => l.accountId === cogsId && d(l.debit).toNumber() === 5000)).toBe(true);
      expect(lines.some((l) => l.accountId === invId && d(l.credit).toNumber() === 5000)).toBe(true);
    });
  });
});

// =====================================================================
// POS1-10 — info bruto audit: override mencatat persen harga kelompok
// (basis ambang) DAN persen bruto sebagai informasi tambahan
// =====================================================================
describe("FIX-POS-T1 POS1-10 basis ambang diskon", () => {
  it("override mencatat maxPercent 100 (harga kelompok) dan maxGrossPercent 0.5 (bruto)", async () => {
    await rb(async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const productId = await makeProduct(tx, { price: "100000", cost: "60000", stock: 2 });
      const [group] = await tx
        .insert(customerGroups)
        .values({ companyId: ORG, name: `Grup Fix T1 ${Date.now()}`, roundingStep: 1, roundingDirection: "nearest", roundCashTotal: false })
        .returning({ id: customerGroups.id });
      await tx.insert(customerGroupPrices).values({
        companyId: ORG,
        groupId: group.id,
        productId,
        ruleType: "fixed",
        value: "500",
      });
      const quote = await quoteCart(tx, {
        companyId: ORG,
        warehouseId: wh,
        groupId: group.id,
        lines: [{ productId, qty: 1, discountType: "percent", discountValue: 100 }],
        canDiscount: true,
      });
      expect(quote.manualDiscountOverride).not.toBeNull();
      expect(quote.manualDiscountOverride!.maxPercent).toBe(100);
      expect(quote.manualDiscountOverride!.maxGrossPercent).toBeCloseTo(0.5, 4);
    });
  });
});

// =====================================================================
// POS1-13 — balapan tutup sesi vs checkout (commit, deterministik):
// transaksi penutup memegang kunci baris sesi; checkout harus MENUNGGU
// (bukan membaca status lama) dan akhirnya ditolak sesudah tutup
// commit — tanpa kunci FOR UPDATE di createSale, checkout lama akan
// selesai lebih dulu dengan penjualan yang masuk ke sesi tertutup.
// =====================================================================
describe("FIX-POS-T1 POS1-13 kunci sesi checkout (commit)", () => {
  it("checkout terserialisasi terhadap penutupan sesi yang sedang berjalan", async () => {
    const user = `user-fixt1-race-${Date.now()}`;
    const setup = await commitTx(ORG, async (tx) => {
      await setTax(tx, false);
      const wh = await warehouseId(tx);
      const cash = await methodId(tx, "CASH");
      const productId = await makeProduct(tx, { price: "10000", cost: "6000", stock: 5 });
      const session = await openCashSession(tx, {
        companyId: ORG,
        userId: user,
        openingCash: 0,
      });
      return { wh, cash, productId, sessionId: session.id };
    });

    // Transaksi A: kunci baris sesi + ubah status menjadi closed,
    // tahan commit sampai gerbang dibuka.
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let signalLocked!: () => void;
    const lockedP = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const txA = db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG}, true)`);
      await tx
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(eq(cashSessions.id, setup.sessionId))
        .for("update");
      await tx
        .update(cashSessions)
        .set({ status: "closed", closedAt: new Date() })
        .where(eq(cashSessions.id, setup.sessionId));
      signalLocked();
      await gateA;
    });

    await lockedP;
    let bSettled = false;
    let bError: unknown = null;
    const txB = commitTx(ORG, (tx) =>
      createSale(tx, {
        companyId: ORG,
        userId: user,
        warehouseId: setup.wh,
        date: TODAY,
        lines: [{ productId: setup.productId, qty: 1 }],
        payments: [{ methodId: setup.cash, amount: 10000, tendered: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      }),
    ).then(
      () => {
        bSettled = true;
      },
      (error) => {
        bSettled = true;
        bError = error;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 400));
    const settledBeforeRelease = bSettled;
    releaseA();
    await txA;
    await txB;

    // Checkout menunggu kunci sesi (tidak menyelesaikan lebih dulu)…
    expect(settledBeforeRelease).toBe(false);
    // …dan sesudah penutupan commit, checkout ditolak — tidak ada
    // penjualan yang menulis ke sesi tertutup.
    expect(bError).not.toBeNull();
    const soldRows = await commitTx(ORG, async (tx) =>
      tx
        .select({ id: sales.id })
        .from(sales)
        .where(and(eq(sales.companyId, ORG), eq(sales.sessionId, setup.sessionId))),
    );
    expect(soldRows).toHaveLength(0);
  });
});
