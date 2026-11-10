import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  products,
  stockOnHand,
  suppliers,
  user,
  warehouses,
} from "@/db/schema";
import {
  createOpname,
  createOpnameTask,
  cancelOpnameTask,
  completeOpnameTask,
  getOperationQueue,
  listOpnameAssigneeOptions,
  listOpnameTasks,
} from "@/server/inventory";
import { createPurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// A-24 T3 (pola G3 + G1): tugas opname sebagai lapisan penugasan di
// atas domain opname, dan model baca antrean Mode Operasi.
// Semua skenario berjalan dalam transaksi rollback di perusahaan
// demo; anggota penanggung jawab dibuat di dalam transaksi yang sama.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const OWNER = "01900000-0000-7000-8000-000000000010";
const suffix = crypto.randomUUID().slice(0, 8);
const ASSIGNEE = crypto.randomUUID();
const today = todayISO();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function seedAssignee(tx: Tx) {
  await tx.insert(user).values({
    id: ASSIGNEE,
    name: `Petugas T3 ${suffix}`,
    email: `t3.petugas.${suffix}@bisa.id`,
    emailVerified: true,
  });
  await tx.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: ORG_ID,
    userId: ASSIGNEE,
    role: "warehouse",
  });
}

async function defaultWarehouseId(tx: Tx) {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  return row.id;
}

describe("tugas opname (G3)", () => {
  it("buat → terdaftar terbuka dengan nama gudang & penanggung jawab; opsi penanggung jawab memuat anggota gudang", async () => {
    await rollbackTransaction(async (tx) => {
      await seedAssignee(tx);
      const warehouseId = await defaultWarehouseId(tx);
      const task = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        assigneeId: ASSIGNEE,
        dueDate: today,
        notes: "Hitung rak minuman",
      });
      const open = await listOpnameTasks(tx, ORG_ID, { status: "open" });
      const mine = open.find((row) => row.id === task.id);
      expect(mine).toBeTruthy();
      expect(mine?.assigneeName).toContain("Petugas T3");
      expect(mine?.warehouseName).toBeTruthy();
      expect(mine?.status).toBe("open");

      const options = await listOpnameAssigneeOptions(tx, ORG_ID);
      expect(options.some((row) => row.userId === ASSIGNEE)).toBe(true);
      expect(options.some((row) => row.userId === OWNER)).toBe(true);
    });
  });

  it("penanggung jawab bukan anggota perusahaan → ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouseId = await defaultWarehouseId(tx);
      await expect(
        createOpnameTask(tx, {
          companyId: ORG_ID,
          userId: OWNER,
          warehouseId,
          assigneeId: "01900000-0000-7000-8000-00000000ffff",
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  it("posting opname oleh yang ditugasi menyelesaikan tugasnya otomatis & tertaut dokumen", async () => {
    await rollbackTransaction(async (tx) => {
      await seedAssignee(tx);
      const warehouseId = await defaultWarehouseId(tx);
      const task = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        assigneeId: ASSIGNEE,
      });

      const [product] = await tx
        .select({ id: products.id, qty: stockOnHand.qty })
        .from(products)
        .innerJoin(
          stockOnHand,
          and(eq(stockOnHand.productId, products.id), eq(stockOnHand.warehouseId, warehouseId)),
        )
        .where(and(eq(products.companyId, ORG_ID), eq(products.trackStock, true)))
        .limit(1);
      expect(product).toBeTruthy();

      // Hitung persis stok sistem (selisih nol) — dokumen tetap
      // terposting dan tugas harus selesai karenanya.
      const doc = await createOpname(tx, {
        companyId: ORG_ID,
        userId: ASSIGNEE,
        warehouseId,
        date: today,
        lines: [{ productId: product.id, countedQty: product.qty }],
      });

      const after = await listOpnameTasks(tx, ORG_ID, { assigneeId: ASSIGNEE });
      const completed = after.find((row) => row.id === task.id);
      expect(completed?.status).toBe("done");
      expect(completed?.documentId).toBe(doc.id);
      expect(completed?.documentNumber).toBe(doc.number);
    });
  });

  it("selesaikan manual & batal: status berpindah sekali, pengulangan ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      await seedAssignee(tx);
      const warehouseId = await defaultWarehouseId(tx);
      const first = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        assigneeId: ASSIGNEE,
      });
      const second = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        assigneeId: ASSIGNEE,
      });

      await completeOpnameTask(tx, { companyId: ORG_ID, userId: ASSIGNEE, taskId: first.id });
      await expect(
        completeOpnameTask(tx, { companyId: ORG_ID, userId: ASSIGNEE, taskId: first.id }),
      ).rejects.toBeInstanceOf(AppError);

      await cancelOpnameTask(tx, { companyId: ORG_ID, userId: OWNER, taskId: second.id });
      const rows = await listOpnameTasks(tx, ORG_ID, { assigneeId: ASSIGNEE });
      expect(rows.find((row) => row.id === first.id)?.status).toBe("done");
      expect(rows.find((row) => row.id === second.id)?.status).toBe("cancelled");
    });
  });
});

describe("antrean Mode Operasi (G1)", () => {
  it("tugas saya terpisah dari antrean umum; PO terkirim tampil sebagai kartu penerimaan", async () => {
    await rollbackTransaction(async (tx) => {
      await seedAssignee(tx);
      const warehouseId = await defaultWarehouseId(tx);
      const myTask = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        assigneeId: ASSIGNEE,
      });
      const otherTask = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: ASSIGNEE,
        warehouseId,
        assigneeId: OWNER,
      });

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
      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        supplierId: supplier.id,
        date: today,
        lines: [{ productId: product.id, qty: "4", unitCost: "1000" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: OWNER, orderId: order.id });

      const queue = await getOperationQueue(tx, ORG_ID, ASSIGNEE);
      expect(queue.myTasks.map((card) => card.id)).toContain(myTask.id);
      expect(queue.queue.map((card) => card.id)).toContain(otherTask.id);
      const poCard = queue.queue.find((card) => card.kind === "purchase_order" && card.id === order.id);
      expect(poCard).toBeTruthy();
      expect(poCard?.number).toBe(order.number);
      expect(poCard?.href).toBe(`/app/gudang/penerimaan?po=${order.id}`);
      expect(poCard?.productIds).toContain(product.id);
    });
  });
});
