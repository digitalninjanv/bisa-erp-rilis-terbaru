import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  branches,
  cashMovements,
  companySettings,
  sales,
  user,
  warehouses,
} from "@/db/schema";
import { cashDrawerMovement, closeCashSession, openCashSession } from "@/server/pos";
import {
  getCashSessionHistoryDetail,
  listCashSessionCashiers,
  listCashSessionHistory,
} from "@/server/reports";
import { d } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-8.3: riwayat sesi kasir sebagai bagian tersendiri. Fungsi daftar &
// rincian baru di reports.ts harus mengagregasi cash_movements secara
// benar (bukan hitungan tampilan): masuk = penjualan tunai + tarik dari
// bank; keluar = refund + setor ke bank (semantik D-9: setor ke bank
// mengurangi kas laci, tarik dari bank menambah). Pola transaksi
// rollback di perusahaan uji tersendiri (aa51).
const ORG = "01900000-0000-7000-8000-00000000aa51";
const KASIR_A = "user-uji-riwayat-a";
const KASIR_B = "user-uji-riwayat-b";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

async function ensureCompany(tx: Tx) {
  const [settings] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, ORG))
    .limit(1);
  if (settings) return;

  await tx.insert(user).values([
    { id: KASIR_A, name: "Rani Kasir", email: "rani.kasir@uji.local" },
    { id: KASIR_B, name: "Bima Kasir", email: "bima.kasir@uji.local" },
  ]);
  await tx.insert(companySettings).values({ companyId: ORG, legalName: "Uji Riwayat Sesi" });

  const accountRows = await tx
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "8000", name: "Selisih Kas Kurang", type: "expense", normalBalance: "debit" },
      { companyId: ORG, code: "8001", name: "Selisih Kas Lebih", type: "income", normalBalance: "credit" },
    ])
    .returning();
  const acc = new Map(accountRows.map((row) => [row.code, row.id]));
  await tx.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc.get("1000")! },
    { companyId: ORG, key: "bank", accountId: acc.get("1100")! },
    { companyId: ORG, key: "cash_short", accountId: acc.get("8000")! },
    { companyId: ORG, key: "cash_over", accountId: acc.get("8001")! },
  ]);
  await tx.insert(branches).values({ companyId: ORG, code: "PST", name: "Cabang Pusat", isDefault: true });
  await tx.insert(warehouses).values({
    companyId: ORG,
    code: "GD-UJI",
    name: "Gudang Uji",
    type: "warehouse",
    isDefault: true,
  });
}

async function fixtureIds(tx: Tx) {
  const [branch] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.companyId, ORG), eq(branches.code, "PST")))
    .limit(1);
  const [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  return { branchId: branch.id, warehouseId: warehouse.id };
}

/**
 * Sesi kasir A yang lengkap: modal 100.000, penjualan tunai 200.000,
 * refund 20.000, tarik dari bank 50.000, setor ke bank 30.000 →
 * seharusnya 300.000; 2 penjualan completed + 1 void; ditutup dengan
 * hitungan 295.000 (selisih kurang 5.000).
 */
async function buildClosedSession(tx: Tx) {
  await ensureCompany(tx);
  const { branchId, warehouseId } = await fixtureIds(tx);
  const session = await openCashSession(tx, {
    companyId: ORG,
    userId: KASIR_A,
    branchId,
    openingCash: 100_000,
  });
  await tx.insert(cashMovements).values([
    {
      companyId: ORG,
      sessionId: session.id,
      type: "sale",
      amount: "200000",
      referenceType: "sale",
      createdBy: KASIR_A,
    },
    {
      companyId: ORG,
      sessionId: session.id,
      type: "refund",
      amount: "-20000",
      referenceType: "sale_void",
      createdBy: KASIR_A,
    },
  ]);
  await cashDrawerMovement(tx, {
    companyId: ORG,
    userId: KASIR_A,
    sessionId: session.id,
    type: "withdrawal",
    amount: 50_000,
    notes: "Tarik modal tambahan",
  });
  await cashDrawerMovement(tx, {
    companyId: ORG,
    userId: KASIR_A,
    sessionId: session.id,
    type: "deposit",
    amount: 30_000,
    notes: "Setor tunai ke bank",
  });
  await tx.insert(sales).values([
    {
      companyId: ORG,
      warehouseId,
      number: "INV-UJI-RWH-001",
      date: "2026-11-04",
      cashierId: KASIR_A,
      sessionId: session.id,
      status: "completed",
      total: "120000",
    },
    {
      companyId: ORG,
      warehouseId,
      number: "INV-UJI-RWH-002",
      date: "2026-11-04",
      cashierId: KASIR_A,
      sessionId: session.id,
      status: "completed",
      total: "80000",
    },
    {
      companyId: ORG,
      warehouseId,
      number: "INV-UJI-RWH-003",
      date: "2026-11-04",
      cashierId: KASIR_A,
      sessionId: session.id,
      status: "void",
      total: "20000",
    },
  ]);
  const closed = await closeCashSession(tx, {
    companyId: ORG,
    userId: KASIR_A,
    sessionId: session.id,
    countedCash: 295_000,
    // A-28 Tahap 1 (H-POS-02): selisih −5.000 wajib alasan (toleransi
    // bawaan Rp0).
    differenceReason: "Selisih kembalian",
  });
  return { sessionId: session.id, closed };
}

/** Sesi kasir B yang masih terbuka: modal 50.000 + penjualan 25.000. */
async function buildOpenSession(tx: Tx) {
  await ensureCompany(tx);
  const { branchId } = await fixtureIds(tx);
  const session = await openCashSession(tx, {
    companyId: ORG,
    userId: KASIR_B,
    branchId,
    openingCash: 50_000,
  });
  await tx.insert(cashMovements).values({
    companyId: ORG,
    sessionId: session.id,
    type: "sale",
    amount: "25000",
    referenceType: "sale",
    createdBy: KASIR_B,
  });
  return session.id;
}

describe("A-8.3 riwayat sesi kasir — agregasi sesi tertutup", () => {
  it("daftar riwayat melaporkan modal, masuk, keluar, seharusnya, dihitung, selisih yang benar", async () => {
    await rollbackTransaction(async (tx) => {
      const { sessionId, closed } = await buildClosedSession(tx);
      expect(closed.expected).toBe(300_000);
      expect(closed.difference).toBe(-5_000);

      const history = await listCashSessionHistory(tx, ORG, {});
      expect(history.total).toBe(1);
      const row = history.rows[0];
      expect(row.id).toBe(sessionId);
      expect(row.userName).toBe("Rani Kasir");
      expect(row.branchName).toBe("Cabang Pusat");
      expect(row.status).toBe("closed");
      expect(row.closedAt).not.toBeNull();
      expect(d(row.openingCash).toNumber()).toBe(100_000);
      expect(d(row.salesTotal).toNumber()).toBe(200_000);
      expect(d(row.refundsTotal).toNumber()).toBe(20_000);
      expect(d(row.depositsTotal).toNumber()).toBe(30_000);
      expect(d(row.withdrawalsTotal).toNumber()).toBe(50_000);
      // Masuk = penjualan + tarik dari bank; keluar = refund + setor ke bank.
      expect(d(row.totalIn).toNumber()).toBe(250_000);
      expect(d(row.totalOut).toNumber()).toBe(50_000);
      expect(d(row.expectedCash).toNumber()).toBe(300_000);
      expect(d(row.countedCash ?? "0").toNumber()).toBe(295_000);
      expect(d(row.difference ?? "0").toNumber()).toBe(-5_000);
      // Hanya penjualan completed yang dihitung (baris void tidak).
      expect(row.transactionCount).toBe(2);
    });
  });

  it("rincian sesi memuat mutasi kronologis dengan nama pelaku dan ringkasan yang sama", async () => {
    await rollbackTransaction(async (tx) => {
      const { sessionId } = await buildClosedSession(tx);
      const detail = await getCashSessionHistoryDetail(tx, ORG, sessionId);
      expect(detail).not.toBeNull();
      expect(detail!.session.userName).toBe("Rani Kasir");
      expect(detail!.session.branchName).toBe("Cabang Pusat");
      expect(detail!.session.notes).toBeNull();
      expect(d(detail!.totals.expectedCash).toNumber()).toBe(300_000);
      expect(d(detail!.totals.totalIn).toNumber()).toBe(250_000);
      expect(d(detail!.totals.totalOut).toNumber()).toBe(50_000);
      expect(detail!.transactionCount).toBe(2);

      // opening, sale, refund, withdrawal (tarik), deposit (setor).
      expect(detail!.movements).toHaveLength(5);
      expect(detail!.movements[0].type).toBe("opening");
      expect(detail!.movements.map((row) => row.type)).toEqual(
        expect.arrayContaining(["opening", "sale", "refund", "withdrawal", "deposit"]),
      );
      const deposit = detail!.movements.find((row) => row.type === "deposit");
      expect(d(deposit!.amount).toNumber()).toBe(-30_000);
      expect(deposit!.notes).toBe("Setor tunai ke bank");
      for (const movement of detail!.movements) {
        expect(movement.createdByName).toBe("Rani Kasir");
      }
      // Kronologis menaik.
      const stamps = detail!.movements.map((row) => row.createdAt.getTime());
      expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    });
  });
});

describe("A-8.3 riwayat sesi kasir — sesi terbuka, saringan, pagination", () => {
  it("sesi terbuka tanpa angka tutup; saringan status/kasir dan pagination bekerja", async () => {
    await rollbackTransaction(async (tx) => {
      const { sessionId: closedId } = await buildClosedSession(tx);
      const openId = await buildOpenSession(tx);

      const all = await listCashSessionHistory(tx, ORG, {});
      expect(all.total).toBe(2);
      // Terbaru dulu: sesi B dibuka sesudah sesi A.
      expect(all.rows[0].id).toBe(openId);
      const openRow = all.rows[0];
      expect(openRow.status).toBe("open");
      expect(openRow.closedAt).toBeNull();
      expect(openRow.countedCash).toBeNull();
      expect(openRow.difference).toBeNull();
      expect(d(openRow.expectedCash).toNumber()).toBe(75_000);
      expect(openRow.transactionCount).toBe(0);

      const onlyOpen = await listCashSessionHistory(tx, ORG, { status: "open" });
      expect(onlyOpen.total).toBe(1);
      expect(onlyOpen.rows[0].id).toBe(openId);

      const onlyClosed = await listCashSessionHistory(tx, ORG, { status: "closed" });
      expect(onlyClosed.total).toBe(1);
      expect(onlyClosed.rows[0].id).toBe(closedId);

      const byCashier = await listCashSessionHistory(tx, ORG, { userId: KASIR_A });
      expect(byCashier.total).toBe(1);
      expect(byCashier.rows[0].userId).toBe(KASIR_A);

      const page1 = await listCashSessionHistory(tx, ORG, { page: 1, pageSize: 1 });
      expect(page1.rows).toHaveLength(1);
      expect(page1.total).toBe(2);
      const page2 = await listCashSessionHistory(tx, ORG, { page: 2, pageSize: 1 });
      expect(page2.rows).toHaveLength(1);
      expect(page2.rows[0].id).toBe(closedId);

      const cashiers = await listCashSessionCashiers(tx, ORG);
      expect(cashiers).toEqual(
        expect.arrayContaining([
          { userId: KASIR_A, userName: "Rani Kasir" },
          { userId: KASIR_B, userName: "Bima Kasir" },
        ]),
      );

      const missing = await getCashSessionHistoryDetail(
        tx,
        ORG,
        "01900000-0000-7000-8000-000000000000",
      );
      expect(missing).toBeNull();
    });
  });
});
