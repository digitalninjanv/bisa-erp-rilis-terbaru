import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  companySettings,
  member,
  opnameTasks,
  products,
  purchaseOrderLines,
  stockDocumentLines,
  stockDocuments,
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
  getOpnameReminders,
  listOpnameAssigneeOptions,
  listOpnameTasks,
} from "@/server/inventory";
import { autoCompleteOpnameTaskForPosting } from "@/server/inventory/opname-tasks";
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

describe("Cabang tugas opname: kategori, dokumen, dan pengingat", () => {
  it("kategori valid/hilang, complete dengan dokumen, auto-complete tanpa tugas", async () => {
    await rollbackTransaction(async (tx) => {
      await seedAssignee(tx);
      const warehouseId = await defaultWarehouseId(tx);
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.companyId, ORG_ID))
        .limit(1);
      if (category) {
        const withCategory = await createOpnameTask(tx, {
          companyId: ORG_ID,
          userId: OWNER,
          warehouseId,
          categoryId: category.id,
          assigneeId: ASSIGNEE,
        });
        expect(withCategory.id).toBeTruthy();
      }
      await expect(
        createOpnameTask(tx, {
          companyId: ORG_ID,
          userId: OWNER,
          warehouseId,
          categoryId: crypto.randomUUID(),
          assigneeId: ASSIGNEE,
        }),
      ).rejects.toBeInstanceOf(AppError);

      const task = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        assigneeId: ASSIGNEE,
      });
      await expect(
        completeOpnameTask(tx, {
          companyId: ORG_ID,
          userId: OWNER,
          taskId: task.id,
          documentId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(AppError);

      const [doc] = await tx
        .insert(stockDocuments)
        .values({
          companyId: ORG_ID,
          type: "opname",
          number: `OPN-CAB-${crypto.randomUUID().slice(0, 8)}`,
          date: today,
          warehouseId,
          status: "posted",
          createdBy: ASSIGNEE,
        })
        .returning({ id: stockDocuments.id });
      const completed = await completeOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        taskId: task.id,
        documentId: doc.id,
      });
      expect(completed.documentId).toBe(doc.id);

      expect(
        await autoCompleteOpnameTaskForPosting(tx, {
          companyId: ORG_ID,
          userId: OWNER,
          warehouseId,
          documentId: doc.id,
        }),
      ).toBeNull();

      await expect(
        completeOpnameTask(tx, {
          companyId: ORG_ID,
          userId: OWNER,
          taskId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        cancelOpnameTask(tx, {
          companyId: ORG_ID,
          userId: OWNER,
          taskId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  it("pengingat: konfigurasi kosong, jatuh tempo, dan belum jatuh tempo", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouseId = await defaultWarehouseId(tx);
      const [category] = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(eq(categories.companyId, ORG_ID))
        .limit(1);
      await tx
        .update(companySettings)
        .set({ opnameCycle: null })
        .where(eq(companySettings.companyId, ORG_ID));
      expect(await getOpnameReminders(tx, ORG_ID, "2026-11-15")).toEqual([]);

      await tx
        .update(companySettings)
        .set({
          opnameCycle: {
            warehouseDays: { [warehouseId]: 30 },
            categoryDays: category ? { [category.id]: 30 } : {},
          },
        })
        .where(eq(companySettings.companyId, ORG_ID));
      const due = await getOpnameReminders(tx, ORG_ID, "2099-12-31");
      expect(due.some((row) => row.scopeType === "warehouse")).toBe(true);
      if (category) expect(due.some((row) => row.scopeType === "category")).toBe(true);

      await tx.insert(stockDocuments).values({
        companyId: ORG_ID,
        type: "opname",
        number: `OPN-REM-${crypto.randomUUID().slice(0, 8)}`,
        date: "2026-11-15",
        warehouseId,
        status: "posted",
      });
      if (category) {
        await tx.insert(opnameTasks).values({
          companyId: ORG_ID,
          warehouseId,
          categoryId: category.id,
          assigneeId: OWNER,
          status: "done",
          completedAt: new Date("2026-11-15T00:00:00Z"),
          createdBy: OWNER,
        });
      }
      const notDue = await getOpnameReminders(tx, ORG_ID, "2026-11-15");
      expect(notDue.some((row) => row.scopeType === "warehouse")).toBe(false);
      if (category) expect(notDue.some((row) => row.scopeType === "category")).toBe(false);
    });
  });
});

describe("antrean operasi — cabang kartu", () => {
  it("melewati PO tanpa sisa, transfer tanpa baris, dan memisahkan tugas saya", async () => {
    await rollbackTransaction(async (tx) => {
      await seedAssignee(tx);
      const warehouseId = await defaultWarehouseId(tx);
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

      const full = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        supplierId: supplier.id,
        date: today,
        lines: [{ productId: product.id, qty: "1", unitCost: "1000" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: OWNER, orderId: full.id });
      await tx
        .update(purchaseOrderLines)
        .set({ receivedQty: "1" })
        .where(eq(purchaseOrderLines.orderId, full.id));

      const open = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        supplierId: supplier.id,
        date: today,
        lines: [{ productId: product.id, qty: "2", unitCost: "1000" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: OWNER, orderId: open.id });

      const [transferWithLines] = await tx
        .insert(stockDocuments)
        .values({
          companyId: ORG_ID,
          type: "transfer",
          number: `TRF-Q-${crypto.randomUUID().slice(0, 8)}`,
          date: today,
          warehouseId,
          toWarehouseId: warehouseId,
          status: "in_transit",
        })
        .returning({ id: stockDocuments.id });
      await tx.insert(stockDocumentLines).values({
        companyId: ORG_ID,
        documentId: transferWithLines.id,
        productId: product.id,
        qty: "3",
        qtyInput: "3",
        productName: "Transfer uji",
      });
      await tx.insert(stockDocuments).values({
        companyId: ORG_ID,
        type: "transfer",
        number: `TRF-EMPTY-${crypto.randomUUID().slice(0, 8)}`,
        date: today,
        warehouseId,
        toWarehouseId: warehouseId,
        status: "in_transit",
      });
      const [transferNoDest] = await tx
        .insert(stockDocuments)
        .values({
          companyId: ORG_ID,
          type: "transfer",
          number: `TRF-NODEST-${crypto.randomUUID().slice(0, 8)}`,
          date: today,
          warehouseId,
          status: "in_transit",
        })
        .returning({ id: stockDocuments.id });
      await tx.insert(stockDocumentLines).values({
        companyId: ORG_ID,
        documentId: transferNoDest.id,
        productId: product.id,
        qty: "1",
        qtyInput: "1",
      });

      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.companyId, ORG_ID))
        .limit(1);
      const mine = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        categoryId: category?.id,
        assigneeId: OWNER,
        dueDate: today,
        notes: "Cek rak",
      });
      const other = await createOpnameTask(tx, {
        companyId: ORG_ID,
        userId: OWNER,
        warehouseId,
        assigneeId: ASSIGNEE,
      });

      const queue = await getOperationQueue(tx, ORG_ID, OWNER);
      expect(queue.myTasks.some((card) => card.id === mine.id)).toBe(true);
      expect(queue.queue.some((card) => card.id === other.id)).toBe(true);
      expect(queue.queue.some((card) => card.id === full.id)).toBe(false);
      expect(queue.queue.some((card) => card.id === open.id)).toBe(true);
      expect(queue.queue.some((card) => card.id === transferWithLines.id)).toBe(true);
      expect(queue.queue.some((card) => card.id === transferNoDest.id)).toBe(true);
      const noDest = queue.queue.find((card) => card.id === transferNoDest.id);
      expect(noDest?.detail).toContain("gudang tujuan");
    });
  });
});
