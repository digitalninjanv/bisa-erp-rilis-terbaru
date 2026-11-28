import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import type { adminDb } from "@/db/admin";
import type { Tx } from "@/db";
import {
  account,
  accountMappings,
  branches,
  companySettings,
  customerGroups,
  customers,
  member,
  organization,
  paymentMethods,
  user,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { ensureFiscalPeriods, seedChartOfAccounts } from "@/server/accounting";
import { seedPayrollIndonesiaDefaults } from "@/server/payroll-indonesia";

export type BootstrapExecutor = Parameters<Parameters<typeof adminDb.transaction>[0]>[0];

export type BootstrapCompanyInput = {
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  branchName?: string;
  warehouseName?: string;
  address?: string;
  phone?: string;
};

export type BootstrapCompanyResult = {
  companyId: string;
  ownerUserId: string;
  branchId: string;
  warehouseId: string;
};

/** Tolak bootstrap bila database sudah berisi organisasi apa pun. */
export async function assertDatabaseEmpty(tx: BootstrapExecutor): Promise<void> {
  const [existing] = await tx.select({ id: organization.id }).from(organization).limit(1);
  if (existing) {
    throw new AppError(
      "CONFLICT",
      "Database sudah memiliki perusahaan. Bootstrap hanya untuk instalasi baru yang masih kosong.",
    );
  }
}

/**
 * Membuat perusahaan pertama yang benar-benar dapat dipakai: owner,
 * keanggotaan, cabang, gudang, pengaturan, bagan akun + pemetaan,
 * periode fiskal tahun berjalan, konfigurasi payroll Indonesia, metode
 * pembayaran dasar, kelompok harga Umum, dan pelanggan umum.
 *
 * Fungsi ini tidak melakukan commit; pemanggil wajib membungkusnya dalam
 * transaksi dan memanggil `assertDatabaseEmpty` lebih dulu.
 */
export async function bootstrapCompany(
  tx: BootstrapExecutor,
  input: BootstrapCompanyInput,
): Promise<BootstrapCompanyResult> {
  const companyName = input.companyName.trim();
  const ownerName = input.ownerName.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (companyName.length < 2) throw new AppError("VALIDATION", "Nama perusahaan minimal 2 karakter.");
  if (ownerName.length < 2) throw new AppError("VALIDATION", "Nama owner minimal 2 karakter.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) {
    throw new AppError("VALIDATION", "Email owner tidak valid.");
  }
  if (input.ownerPassword.length < 12) {
    throw new AppError("VALIDATION", "Kata sandi owner minimal 12 karakter.");
  }

  const companyId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const slugBase = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const slug = `${slugBase || "perusahaan"}-${companyId.slice(0, 8)}`;

  await tx.insert(user).values({
    id: ownerUserId,
    name: ownerName,
    email: ownerEmail,
    emailVerified: true,
    role: "owner",
  });
  await tx.insert(account).values({
    id: crypto.randomUUID(),
    accountId: ownerUserId,
    providerId: "credential",
    userId: ownerUserId,
    password: await hashPassword(input.ownerPassword),
  });
  await tx.insert(organization).values({
    id: companyId,
    name: companyName,
    slug,
    createdAt: new Date(),
  });
  await tx.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: companyId,
    userId: ownerUserId,
    role: "owner",
    createdAt: new Date(),
  });

  const [branch] = await tx
    .insert(branches)
    .values({
      companyId,
      code: "BR-01",
      name: input.branchName?.trim() || "Toko Utama",
      address: input.address ?? null,
      phone: input.phone ?? null,
      isDefault: true,
    })
    .returning({ id: branches.id });

  const [warehouse] = await tx
    .insert(warehouses)
    .values({
      companyId,
      branchId: branch.id,
      code: "GD-01",
      name: input.warehouseName?.trim() || "Gudang Utama",
      type: "warehouse",
      isDefault: true,
    })
    .returning({ id: warehouses.id });

  await tx.insert(companySettings).values({
    companyId,
    legalName: companyName,
    taxId: null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    defaultWarehouseId: warehouse.id,
    roundingMode: "none",
    taxRate: "0",
    taxEnabled: false,
    allowNegativeStock: false,
    posOfflineEnabled: false,
  });

  const mapping = await seedChartOfAccounts(tx as unknown as Tx, companyId);

  await tx.insert(paymentMethods).values([
    {
      companyId,
      code: "CASH",
      name: "Tunai",
      type: "cash",
      accountId: mapping.cash,
      sortOrder: 1,
    },
    {
      companyId,
      code: "QRIS",
      name: "QRIS",
      type: "qris",
      accountId: mapping.qris,
      sortOrder: 2,
      instructions: "Scan QRIS di layar kasir, lalu konfirmasi pembayaran.",
    },
    {
      companyId,
      code: "TRANSFER",
      name: "Transfer Bank",
      type: "bank",
      accountId: mapping.bank,
      sortOrder: 3,
    },
    {
      companyId,
      code: "CREDIT",
      name: "Utang / Tempo",
      type: "credit",
      accountId: mapping.receivable,
      sortOrder: 4,
    },
    {
      companyId,
      code: "CUSTCREDIT",
      name: "Kredit Pelanggan",
      type: "customer_credit",
      accountId: mapping.customer_credit,
      sortOrder: 5,
      instructions: "Masukkan nomor dokumen retur tukar barang/kredit toko.",
    },
  ]);

  const [group] = await tx
    .insert(customerGroups)
    .values({ companyId, name: "Umum", roundingStep: 0, roundingDirection: "down" })
    .returning({ id: customerGroups.id });
  await tx.insert(customers).values({
    companyId,
    code: "CUST-0000",
    name: "Pelanggan Umum",
    groupId: group.id,
    creditLimit: "0",
  });

  await ensureFiscalPeriods(tx as unknown as Tx, companyId, new Date().getFullYear());
  await seedPayrollIndonesiaDefaults(tx, companyId);

  // Pastikan mapping yang dibuat benar-benar milik perusahaan ini — jaring
  // pengaman murah terhadap salah ketik seed di masa depan.
  const [mapped] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(accountMappings)
    .where(eq(accountMappings.companyId, companyId));
  if ((mapped?.count ?? 0) === 0) {
    throw new AppError("INTERNAL", "Bagan akun bootstrap tidak menghasilkan pemetaan akun.");
  }

  return {
    companyId,
    ownerUserId,
    branchId: branch.id,
    warehouseId: warehouse.id,
  };
}
