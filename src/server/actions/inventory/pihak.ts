// A-26 Q4 (K-03): pecahan src/server/actions/inventory.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  eq,
  ne,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  customerGroups,
  customers,
  partyCredits,
  partyOpeningBalances,
  partyPayments,
  products,
  purchaseAdvances,
  purchaseOrders,
  sales,
  stockDocuments,
  stockReceipts,
  suppliers,
} from "@/db/schema";

import { type CustomFieldValues } from "@/lib/custom-fields";
import { writeAudit } from "@/server/audit";
import { requirePermissionInModule } from "@/lib/session";
import { can } from "@/lib/permissions";

import {
  AppError,
  guard,
} from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";

import { toDb } from "@/lib/money";

import {
  definedOnly,
  resolveCustomAttributes,
} from "./shared";

const supplierSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(40),
  name: z.string().min(2).max(160),
  phone: z.string().max(40).optional(),
  email: z.string().max(160).optional(),
  address: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
  // S3 (§18D): NPWP, rekening pembayaran, termin bawaan.
  taxId: z.string().max(40).optional(),
  bankName: z.string().max(80).optional(),
  bankAccountNumber: z.string().max(40).optional(),
  bankAccountName: z.string().max(120).optional(),
  paymentTermDays: z.number().int().min(0).max(3650).nullish(),
  // T5-2 (D-16): custom-field values; validated against definitions.
  attributes: z.record(z.string(), z.string()).optional(),
});

export async function saveSupplierAction(input: z.input<typeof supplierSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(supplierSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      // S3 (§18I): snapshot penuh baris lama untuk audit before/after —
      // buat & ubah pihak WAJIB berjejak seperti produk.
      let current: typeof suppliers.$inferSelect | undefined;
      if (data.id) {
        [current] = await tx
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.companyId, ctx.company.id), eq(suppliers.id, data.id)))
          .limit(1);
      }

      // MD-013: Validasi keunikan taxId/NPWP pemasok
      if (data.taxId && data.taxId.trim()) {
        const cleanTaxId = data.taxId.trim();
        const [dup] = await tx
          .select({ id: suppliers.id, name: suppliers.name, code: suppliers.code })
          .from(suppliers)
          .where(
            and(
              eq(suppliers.companyId, ctx.company.id),
              eq(suppliers.taxId, cleanTaxId),
              data.id ? ne(suppliers.id, data.id) : undefined,
            ),
          )
          .limit(1);
        if (dup) {
          throw new AppError("CONFLICT", `NPWP/Tax ID ${cleanTaxId} sudah terdaftar untuk pemasok ${dup.name} (${dup.code}).`);
        }
      }
      const attributes = await resolveCustomAttributes(
        tx,
        ctx.company.id,
        "supplier",
        current?.attributes ?? null,
        data.attributes,
      );
      const values = {
        code: data.code,
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
        notes: data.notes,
        // Field §18D: tidak dikirim (undefined) = pertahankan nilai lama;
        // string kosong = kosongkan (null); terisi = simpan terpangkas.
        taxId: data.taxId === undefined ? undefined : data.taxId.trim() || null,
        bankName: data.bankName === undefined ? undefined : data.bankName.trim() || null,
        bankAccountNumber:
          data.bankAccountNumber === undefined ? undefined : data.bankAccountNumber.trim() || null,
        bankAccountName:
          data.bankAccountName === undefined ? undefined : data.bankAccountName.trim() || null,
        paymentTermDays: data.paymentTermDays,
        attributes,
      };
      const snapshot = (row: {
        code: string;
        name: string;
        phone: string | null;
        email: string | null;
        address: string | null;
        notes: string | null;
        taxId: string | null;
        bankName: string | null;
        bankAccountNumber: string | null;
        bankAccountName: string | null;
        paymentTermDays: number | null;
        isActive: boolean;
        attributes: CustomFieldValues | null;
      }) => ({
        code: row.code,
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        notes: row.notes,
        taxId: row.taxId,
        bankName: row.bankName,
        bankAccountNumber: row.bankAccountNumber,
        bankAccountName: row.bankAccountName,
        paymentTermDays: row.paymentTermDays,
        isActive: row.isActive,
        attributes: row.attributes ?? null,
      });
      if (data.id) {
        const [updated] = await tx
          .update(suppliers)
          .set(values)
          .where(and(eq(suppliers.companyId, ctx.company.id), eq(suppliers.id, data.id)))
          .returning({ id: suppliers.id });
        // P3-10: update yang tidak mengenai baris mana pun bukan sukses.
        if (!updated || !current) throw new AppError("NOT_FOUND", "Pemasok tidak ditemukan.");
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "supplier.update",
          entityType: "supplier",
          entityId: data.id,
          before: snapshot(current),
          after: snapshot({ ...current, ...definedOnly(values) }),
        });
        return updated;
      }
      const [created] = await tx
        .insert(suppliers)
        .values({ companyId: ctx.company.id, ...values })
        .returning({ id: suppliers.id });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "supplier.create",
        entityType: "supplier",
        entityId: created.id,
        after: snapshot({
          ...values,
          phone: values.phone ?? null,
          email: values.email ?? null,
          address: values.address ?? null,
          notes: values.notes ?? null,
          taxId: values.taxId ?? null,
          bankName: values.bankName ?? null,
          bankAccountNumber: values.bankAccountNumber ?? null,
          bankAccountName: values.bankAccountName ?? null,
          paymentTermDays: values.paymentTermDays ?? null,
          isActive: true,
        }),
      });
      return created;
    });
    revalidatePath("/app/gudang/pemasok");
    return result;
  });
}

const customerSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(40),
  name: z.string().min(2).max(160),
  phone: z.string().max(40).optional(),
  email: z.string().max(160).optional(),
  address: z.string().max(300).optional(),
  groupId: z.string().uuid().nullish(),
  creditLimit: z.union([z.string(), z.number()]).optional(),
  // S3 (§18D): NPWP/NIK & termin pembayaran bawaan.
  taxId: z.string().max(40).optional(),
  paymentTermDays: z.number().int().min(0).max(3650).nullish(),
  // T5-2 (D-16): custom-field values; validated against definitions.
  attributes: z.record(z.string(), z.string()).optional(),
});

export async function saveCustomerAction(input: z.input<typeof customerSchema>) {
  return guard(async () => {
    // GDG-001 & MD-023: Master pelanggan dikelola dengan izin gudang inventory.manage
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(customerSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      // S3 (§18I): snapshot penuh baris lama untuk audit before/after —
      // perubahan batas kredit khususnya WAJIB berjejak siapa & kapan.
      let current: typeof customers.$inferSelect | undefined;
      if (data.id) {
        [current] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.companyId, ctx.company.id), eq(customers.id, data.id)))
          .limit(1);
      }

      // MD-023: Pengubahan atau penetapan batas kredit memerlukan izin akuntansi atau owner/admin
      if (data.creditLimit !== undefined) {
        const requestedLimit = toDb(data.creditLimit);
        const currentLimit = current?.creditLimit ?? "0";
        if (
          requestedLimit !== currentLimit &&
          ctx.role &&
          !can(ctx, "accounting.manage") &&
          ctx.role !== "owner" &&
          ctx.role !== "admin"
        ) {
          throw new AppError(
            "FORBIDDEN",
            "Pengubahan batas kredit (credit limit) memerlukan izin akuntansi atau peran pemilik/admin.",
          );
        }
      }

      // MD-004: validasi kelompok pelanggan milik perusahaan yang aktif
      if (data.groupId) {
        const [group] = await tx
          .select({ id: customerGroups.id })
          .from(customerGroups)
          .where(and(eq(customerGroups.companyId, ctx.company.id), eq(customerGroups.id, data.groupId)))
          .limit(1);
        if (!group) {
          throw new AppError("VALIDATION", "Kelompok pelanggan tidak ditemukan di perusahaan ini.");
        }
      }

      // MD-013: Validasi keunikan taxId/NPWP pelanggan
      if (data.taxId && data.taxId.trim()) {
        const cleanTaxId = data.taxId.trim();
        const [dup] = await tx
          .select({ id: customers.id, name: customers.name, code: customers.code })
          .from(customers)
          .where(
            and(
              eq(customers.companyId, ctx.company.id),
              eq(customers.taxId, cleanTaxId),
              data.id ? ne(customers.id, data.id) : undefined,
            ),
          )
          .limit(1);
        if (dup) {
          throw new AppError("CONFLICT", `NPWP/Tax ID ${cleanTaxId} sudah terdaftar untuk pelanggan ${dup.name} (${dup.code}).`);
        }
      }

      const attributes = await resolveCustomAttributes(
        tx,
        ctx.company.id,
        "customer",
        current?.attributes ?? null,
        data.attributes,
      );
      const values = {
        code: data.code,
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
        groupId: data.groupId ?? null,
        creditLimit: toDb(data.creditLimit ?? 0),
        // Field §18D: tidak dikirim = pertahankan; kosong = null.
        taxId: data.taxId === undefined ? undefined : data.taxId.trim() || null,
        paymentTermDays: data.paymentTermDays,
        attributes,
      };
      const snapshot = (row: {
        code: string;
        name: string;
        phone: string | null;
        email: string | null;
        address: string | null;
        groupId: string | null;
        creditLimit: string;
        taxId: string | null;
        paymentTermDays: number | null;
        isActive: boolean;
        attributes: CustomFieldValues | null;
      }) => ({
        code: row.code,
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        groupId: row.groupId,
        creditLimit: row.creditLimit,
        taxId: row.taxId,
        paymentTermDays: row.paymentTermDays,
        isActive: row.isActive,
        attributes: row.attributes ?? null,
      });
      if (data.id) {
        const [updated] = await tx
          .update(customers)
          .set(values)
          .where(and(eq(customers.companyId, ctx.company.id), eq(customers.id, data.id)))
          .returning({ id: customers.id });
        // P3-10: update yang tidak mengenai baris mana pun bukan sukses.
        if (!updated || !current) throw new AppError("NOT_FOUND", "Pelanggan tidak ditemukan.");
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "customer.update",
          entityType: "customer",
          entityId: data.id,
          before: snapshot(current),
          after: snapshot({ ...current, ...definedOnly(values) }),
        });
        return updated;
      }
      const [created] = await tx
        .insert(customers)
        .values({ companyId: ctx.company.id, ...values })
        .returning({ id: customers.id });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "customer.create",
        entityType: "customer",
        entityId: created.id,
        after: snapshot({
          ...values,
          phone: values.phone ?? null,
          email: values.email ?? null,
          address: values.address ?? null,
          taxId: values.taxId ?? null,
          paymentTermDays: values.paymentTermDays ?? null,
          isActive: true,
        }),
      });
      return created;
    });
    revalidatePath("/app/gudang/pelanggan");
    revalidatePath("/app/pos");
    return result;
  });
}

export async function toggleSupplierAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [updated] = await tx
        .update(suppliers)
        .set({ isActive: data.isActive })
        .where(and(eq(suppliers.companyId, ctx.company.id), eq(suppliers.id, data.id)))
        .returning({ id: suppliers.id });
      if (!updated) throw new AppError("NOT_FOUND", "Pemasok tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "supplier.activate" : "supplier.deactivate",
        entityType: "supplier",
        entityId: data.id,
      });
    });
    revalidatePath("/app/gudang/pemasok");
    return data;
  });
}

export async function deleteSupplierAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const supplierId = parseInput(z.string().uuid(), id);
    await withCompany(ctx.company.id, async (tx) => {
      const [supplier] = await tx
        .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name })
        .from(suppliers)
        .where(and(eq(suppliers.companyId, ctx.company.id), eq(suppliers.id, supplierId)))
        .limit(1);
      if (!supplier) throw new AppError("NOT_FOUND", "Pemasok tidak ditemukan.");
      const [receipts] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockReceipts)
        .where(and(eq(stockReceipts.companyId, ctx.company.id), eq(stockReceipts.supplierId, supplierId)));
      if ((receipts?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pemasok sudah memiliki dokumen penerimaan dan utang usaha. Nonaktifkan pemasok alih-alih menghapus.",
        );
      }
      const [documents] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockDocuments)
        .where(and(eq(stockDocuments.companyId, ctx.company.id), eq(stockDocuments.supplierId, supplierId)));
      if ((documents?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pemasok sudah terkait dokumen gudang (mis. retur pembelian). Nonaktifkan pemasok alih-alih menghapus.",
        );
      }
      const [asMain] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.companyId, ctx.company.id), eq(products.supplierId, supplierId)));
      if ((asMain?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          `Pemasok masih menjadi pemasok utama ${asMain!.value} produk. Ganti pemasok utama produk tersebut terlebih dahulu.`,
        );
      }
      // MD-001 & WF-017: Penjaga saldo awal dan pembayaran utang
      const [hasSupplierPayments] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ctx.company.id), eq(partyPayments.partyId, supplierId)));
      if ((hasSupplierPayments?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pemasok memiliki riwayat pembayaran utang. Nonaktifkan pemasok alih-alih menghapus.",
        );
      }
      const [hasSupplierOpening] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(partyOpeningBalances)
        .where(and(eq(partyOpeningBalances.companyId, ctx.company.id), eq(partyOpeningBalances.partyId, supplierId)));
      if ((hasSupplierOpening?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pemasok memiliki saldo awal utang. Nonaktifkan pemasok alih-alih menghapus.",
        );
      }
      const [pos] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, ctx.company.id), eq(purchaseOrders.supplierId, supplierId)));
      if ((pos?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pemasok memiliki riwayat pesanan pembelian (Purchase Order). Nonaktifkan pemasok alih-alih menghapus.",
        );
      }
      const [advances] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(purchaseAdvances)
        .where(and(eq(purchaseAdvances.companyId, ctx.company.id), eq(purchaseAdvances.supplierId, supplierId)));
      if ((advances?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pemasok memiliki riwayat uang muka pembelian. Nonaktifkan pemasok alih-alih menghapus.",
        );
      }
      await tx
        .delete(suppliers)
        .where(and(eq(suppliers.companyId, ctx.company.id), eq(suppliers.id, supplierId)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "supplier.delete",
        entityType: "supplier",
        entityId: supplierId,
        before: { code: supplier.code, name: supplier.name },
      });
    });
    revalidatePath("/app/gudang/pemasok");
    revalidatePath("/app/gudang/produk");
    return { id: supplierId };
  });
}

export async function toggleCustomerAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [updated] = await tx
        .update(customers)
        .set({ isActive: data.isActive })
        .where(and(eq(customers.companyId, ctx.company.id), eq(customers.id, data.id)))
        .returning({ id: customers.id });
      if (!updated) throw new AppError("NOT_FOUND", "Pelanggan tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "customer.activate" : "customer.deactivate",
        entityType: "customer",
        entityId: data.id,
      });
    });
    revalidatePath("/app/gudang/pemasok");
    revalidatePath("/app/pos");
    return data;
  });
}

export async function deleteCustomerAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const customerId = parseInput(z.string().uuid(), id);
    await withCompany(ctx.company.id, async (tx) => {
      const [customer] = await tx
        .select({ id: customers.id, code: customers.code, name: customers.name })
        .from(customers)
        .where(and(eq(customers.companyId, ctx.company.id), eq(customers.id, customerId)))
        .limit(1);
      if (!customer) throw new AppError("NOT_FOUND", "Pelanggan tidak ditemukan.");
      const [sold] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(sales)
        .where(and(eq(sales.companyId, ctx.company.id), eq(sales.customerId, customerId)));
      if ((sold?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pelanggan sudah memiliki riwayat penjualan dan piutang. Nonaktifkan pelanggan alih-alih menghapus.",
        );
      }
      // MD-001 & WF-017: Penjaga saldo awal, pembayaran piutang, dan kredit aktif
      const [hasPayments] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(partyPayments)
        .where(and(eq(partyPayments.companyId, ctx.company.id), eq(partyPayments.partyId, customerId)));
      if ((hasPayments?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pelanggan memiliki riwayat pembayaran piutang. Nonaktifkan pelanggan alih-alih menghapus.",
        );
      }
      const [hasCredits] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(partyCredits)
        .where(and(eq(partyCredits.companyId, ctx.company.id), eq(partyCredits.partyId, customerId)));
      if ((hasCredits?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pelanggan memiliki saldo atau riwayat kredit pelanggan. Nonaktifkan pelanggan alih-alih menghapus.",
        );
      }
      const [hasOpening] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(partyOpeningBalances)
        .where(and(eq(partyOpeningBalances.companyId, ctx.company.id), eq(partyOpeningBalances.partyId, customerId)));
      if ((hasOpening?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Pelanggan memiliki saldo awal piutang. Nonaktifkan pelanggan alih-alih menghapus.",
        );
      }
      await tx
        .delete(customers)
        .where(and(eq(customers.companyId, ctx.company.id), eq(customers.id, customerId)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "customer.delete",
        entityType: "customer",
        entityId: customerId,
        before: { code: customer.code, name: customer.name },
      });
    });
    revalidatePath("/app/gudang/pemasok");
    revalidatePath("/app/pos");
    return { id: customerId };
  });
}
