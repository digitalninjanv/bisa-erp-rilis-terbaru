// FIX-ARS Tahap 4 pola: bagian dari modul inventory — tugas opname
// (A-24 T3, pola G3). Lapisan penugasan DI ATAS domain opname:
// createOpname tidak berubah perilakunya; tabel opname_tasks hanya
// mencatat penugasan & penyelesaiannya.

import { and, asc, desc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  categories,
  companyRoles,
  member,
  opnameTasks,
  stockDocuments,
  user,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { modulesFor, sanitizeModules } from "@/lib/permissions";
import {
  opnameDueStatus,
  sanitizeOpnameCycleConfig,
  type OpnameDueStatus,
} from "@/lib/opname-cycle";
import { writeAudit } from "@/server/audit";
import { assertWarehouseOwned } from "./movements";
import { getCompanySettingsRow } from "@/server/settings";

export type OpnameTaskRow = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  categoryId: string | null;
  categoryName: string | null;
  assigneeId: string;
  assigneeName: string;
  dueDate: string | null;
  status: string;
  documentId: string | null;
  documentNumber: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export async function createOpnameTask(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    categoryId?: string | null;
    assigneeId: string;
    dueDate?: string | null;
    notes?: string | null;
  },
) {
  await assertWarehouseOwned(tx, input.companyId, input.warehouseId);

  if (input.categoryId) {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.companyId, input.companyId), eq(categories.id, input.categoryId)))
      .limit(1);
    if (!category) throw new AppError("VALIDATION", "Kategori cakupan tugas tidak ditemukan.");
  }

  // Yang ditugasi harus anggota perusahaan ini — tugas untuk orang
  // luar tidak pernah bisa diselesaikan dari dalam sistem.
  const [membership] = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, input.companyId), eq(member.userId, input.assigneeId)))
    .limit(1);
  if (!membership) {
    throw new AppError("VALIDATION", "Penanggung jawab harus anggota perusahaan ini.");
  }

  const [task] = await tx
    .insert(opnameTasks)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      categoryId: input.categoryId ?? null,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate ?? null,
      notes: input.notes?.trim() || null,
      createdBy: input.userId,
    })
    .returning({ id: opnameTasks.id });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.opname_task.create",
    entityType: "opname_task",
    entityId: task.id,
    after: {
      warehouseId: input.warehouseId,
      categoryId: input.categoryId ?? null,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate ?? null,
    },
  });
  return task;
}

export async function listOpnameTasks(
  tx: Tx,
  companyId: string,
  filter: { status?: string; assigneeId?: string } = {},
): Promise<OpnameTaskRow[]> {
  const conditions = [eq(opnameTasks.companyId, companyId)];
  if (filter.status) conditions.push(eq(opnameTasks.status, filter.status));
  if (filter.assigneeId) conditions.push(eq(opnameTasks.assigneeId, filter.assigneeId));
  return tx
    .select({
      id: opnameTasks.id,
      warehouseId: opnameTasks.warehouseId,
      warehouseName: warehouses.name,
      categoryId: opnameTasks.categoryId,
      categoryName: categories.name,
      assigneeId: opnameTasks.assigneeId,
      assigneeName: user.name,
      dueDate: opnameTasks.dueDate,
      status: opnameTasks.status,
      documentId: opnameTasks.documentId,
      documentNumber: stockDocuments.number,
      notes: opnameTasks.notes,
      createdBy: opnameTasks.createdBy,
      createdAt: opnameTasks.createdAt,
      completedAt: opnameTasks.completedAt,
    })
    .from(opnameTasks)
    .innerJoin(warehouses, eq(opnameTasks.warehouseId, warehouses.id))
    .leftJoin(categories, eq(opnameTasks.categoryId, categories.id))
    .innerJoin(user, eq(opnameTasks.assigneeId, user.id))
    .leftJoin(stockDocuments, eq(opnameTasks.documentId, stockDocuments.id))
    .where(and(...conditions))
    .orderBy(asc(opnameTasks.dueDate), asc(opnameTasks.createdAt));
}

/** Selesaikan tugas terbuka. Dokumen penyelesaian: yang diberikan
 *  pemanggil bila sah, selain itu opname terposting terakhir oleh
 *  yang ditugasi di gudang tugas (boleh kosong — hitung bisa saja
 *  dilakukan lewat jalur lain). */
export async function completeOpnameTask(
  tx: Tx,
  input: { companyId: string; userId: string; taskId: string; documentId?: string | null },
) {
  const [task] = await tx
    .select()
    .from(opnameTasks)
    .where(and(eq(opnameTasks.companyId, input.companyId), eq(opnameTasks.id, input.taskId)))
    .limit(1);
  if (!task) throw new AppError("NOT_FOUND", "Tugas opname tidak ditemukan.");
  if (task.status !== "open") {
    throw new AppError("VALIDATION", "Tugas ini sudah tidak terbuka.");
  }

  let documentId: string | null = null;
  if (input.documentId) {
    const [doc] = await tx
      .select({ id: stockDocuments.id })
      .from(stockDocuments)
      .where(
        and(
          eq(stockDocuments.companyId, input.companyId),
          eq(stockDocuments.id, input.documentId),
          eq(stockDocuments.type, "opname"),
        ),
      )
      .limit(1);
    if (!doc) throw new AppError("VALIDATION", "Dokumen opname penyelesaian tidak ditemukan.");
    documentId = doc.id;
  } else {
    const [latest] = await tx
      .select({ id: stockDocuments.id })
      .from(stockDocuments)
      .where(
        and(
          eq(stockDocuments.companyId, input.companyId),
          eq(stockDocuments.type, "opname"),
          eq(stockDocuments.status, "posted"),
          eq(stockDocuments.warehouseId, task.warehouseId),
          eq(stockDocuments.createdBy, task.assigneeId),
        ),
      )
      .orderBy(desc(stockDocuments.createdAt))
      .limit(1);
    documentId = latest?.id ?? null;
  }

  await tx
    .update(opnameTasks)
    .set({
      status: "done",
      documentId,
      completedBy: input.userId,
      completedAt: new Date(),
    })
    .where(and(eq(opnameTasks.companyId, input.companyId), eq(opnameTasks.id, task.id)));

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.opname_task.complete",
    entityType: "opname_task",
    entityId: task.id,
    after: { documentId },
  });
  return { id: task.id, documentId };
}

export async function cancelOpnameTask(
  tx: Tx,
  input: { companyId: string; userId: string; taskId: string },
) {
  const [task] = await tx
    .select({ id: opnameTasks.id, status: opnameTasks.status })
    .from(opnameTasks)
    .where(and(eq(opnameTasks.companyId, input.companyId), eq(opnameTasks.id, input.taskId)))
    .limit(1);
  if (!task) throw new AppError("NOT_FOUND", "Tugas opname tidak ditemukan.");
  if (task.status !== "open") {
    throw new AppError("VALIDATION", "Tugas ini sudah tidak terbuka.");
  }
  await tx
    .update(opnameTasks)
    .set({ status: "cancelled", completedBy: input.userId, completedAt: new Date() })
    .where(and(eq(opnameTasks.companyId, input.companyId), eq(opnameTasks.id, task.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.opname_task.cancel",
    entityType: "opname_task",
    entityId: task.id,
  });
  return { id: task.id };
}

/**
 * Penyelesaian otomatis dari jalur posting: saat pengguna memposting
 * opname, tugas TERBUKA TERTUA miliknya untuk gudang itu selesai dan
 * tertaut ke dokumennya. Dipanggil createOpname sesudah dokumen
 * terposting — satu-satunya titik sambung tugas ke domain, dan ia
 * tidak mengubah stok/jurnal sedikit pun.
 */
export async function autoCompleteOpnameTaskForPosting(
  tx: Tx,
  input: { companyId: string; userId: string; warehouseId: string; documentId: string },
) {
  const [task] = await tx
    .select({ id: opnameTasks.id })
    .from(opnameTasks)
    .where(
      and(
        eq(opnameTasks.companyId, input.companyId),
        eq(opnameTasks.warehouseId, input.warehouseId),
        eq(opnameTasks.assigneeId, input.userId),
        eq(opnameTasks.status, "open"),
      ),
    )
    .orderBy(asc(opnameTasks.dueDate), asc(opnameTasks.createdAt))
    .limit(1);
  if (!task) return null;
  await tx
    .update(opnameTasks)
    .set({
      status: "done",
      documentId: input.documentId,
      completedBy: input.userId,
      completedAt: new Date(),
    })
    .where(and(eq(opnameTasks.companyId, input.companyId), eq(opnameTasks.id, task.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "inventory.opname_task.complete",
    entityType: "opname_task",
    entityId: task.id,
    after: { documentId: input.documentId, via: "posting" },
  });
  return task.id;
}

/** Pilihan penanggung jawab tugas: anggota perusahaan yang modulnya
 *  mencakup Gudang (peran bawaan lewat modulesFor; peran kustom lewat
 *  baris company_roles-nya — resolusi yang sama seperti sesi). */
export async function listOpnameAssigneeOptions(tx: Tx, companyId: string) {
  const members = await tx
    .select({ userId: user.id, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, companyId))
    .orderBy(asc(user.name));

  const customRoles = await tx
    .select({ key: companyRoles.key, modules: companyRoles.modules, isActive: companyRoles.isActive })
    .from(companyRoles)
    .where(eq(companyRoles.companyId, companyId));
  const customModules = new Map(
    customRoles.map((row) => [row.key, row.isActive ? sanitizeModules(row.modules) : []]),
  );

  return members.filter((row) => {
    const modules = customModules.has(row.role)
      ? (customModules.get(row.role) ?? [])
      : modulesFor(row.role);
    return modules.includes("gudang");
  });
}

export type OpnameReminder = {
  scopeType: "warehouse" | "category";
  scopeId: string;
  scopeName: string;
  warehouseName: string | null;
  frequencyDays: number;
  lastCountDate: string | null;
  status: OpnameDueStatus;
};

/**
 * Kartu pengingat dashboard Gudang: cakupan berkonfigurasi yang sudah
 * jatuh tempo. Tanggal hitung terakhir per gudang = dokumen opname
 * terposting terakhir di gudang itu; per kategori = penyelesaian
 * tugas bercakupan kategori terakhir (dokumen opname tidak mencatat
 * cakupan kategori — tugaslah catatan cakupannya).
 */
export async function getOpnameReminders(
  tx: Tx,
  companyId: string,
  today: string,
): Promise<OpnameReminder[]> {
  const settings = await getCompanySettingsRow(tx, companyId);
  const config = sanitizeOpnameCycleConfig(settings?.opnameCycle);
  const warehouseIds = Object.keys(config.warehouseDays);
  const categoryIds = Object.keys(config.categoryDays);
  if (warehouseIds.length === 0 && categoryIds.length === 0) return [];

  const reminders: OpnameReminder[] = [];

  if (warehouseIds.length > 0) {
    const warehouseRows = await tx
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.companyId, companyId));
    const nameById = new Map(warehouseRows.map((row) => [row.id, row.name]));
    for (const warehouseId of warehouseIds) {
      const [last] = await tx
        .select({ date: stockDocuments.date })
        .from(stockDocuments)
        .where(
          and(
            eq(stockDocuments.companyId, companyId),
            eq(stockDocuments.type, "opname"),
            eq(stockDocuments.status, "posted"),
            eq(stockDocuments.warehouseId, warehouseId),
          ),
        )
        .orderBy(desc(stockDocuments.date), desc(stockDocuments.createdAt))
        .limit(1);
      const status = opnameDueStatus({
        lastCountDate: last?.date ?? null,
        frequencyDays: config.warehouseDays[warehouseId],
        today,
      });
      if (!status.due) continue;
      reminders.push({
        scopeType: "warehouse",
        scopeId: warehouseId,
        scopeName: nameById.get(warehouseId) ?? "Gudang",
        warehouseName: null,
        frequencyDays: config.warehouseDays[warehouseId],
        lastCountDate: last?.date ?? null,
        status,
      });
    }
  }

  if (categoryIds.length > 0) {
    const categoryRows = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.companyId, companyId));
    const nameById = new Map(categoryRows.map((row) => [row.id, row.name]));
    for (const categoryId of categoryIds) {
      const [lastTask] = await tx
        .select({ completedAt: opnameTasks.completedAt })
        .from(opnameTasks)
        .where(
          and(
            eq(opnameTasks.companyId, companyId),
            eq(opnameTasks.categoryId, categoryId),
            eq(opnameTasks.status, "done"),
          ),
        )
        .orderBy(desc(opnameTasks.completedAt))
        .limit(1);
      const lastCountDate = lastTask?.completedAt
        ? lastTask.completedAt.toISOString().slice(0, 10)
        : null;
      const status = opnameDueStatus({
        lastCountDate,
        frequencyDays: config.categoryDays[categoryId],
        today,
      });
      if (!status.due) continue;
      reminders.push({
        scopeType: "category",
        scopeId: categoryId,
        scopeName: nameById.get(categoryId) ?? "Kategori",
        warehouseName: null,
        frequencyDays: config.categoryDays[categoryId],
        lastCountDate,
        status,
      });
    }
  }

  return reminders;
}
