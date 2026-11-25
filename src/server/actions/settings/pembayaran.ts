"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — metode pembayaran (termasuk fee/MDR & akun kredit) dan unggah QRIS.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import type { Tx } from "@/db";
import { accountMappings, accounts, companySettings, paymentMethods, salePayments } from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { qrisImageSchema } from "@/lib/qris-image";

const feeConfigSchema = {
  // A-21 Tahap R3-A (R3-01): tarif fee/MDR metode (pola D-25 —
  // konfigurasi per perusahaan + saklar; bawaan mati).
  feeEnabled: z.boolean().optional(),
  feeType: z.enum(["none", "fixed", "percent"]).optional(),
  feeValue: z.union([z.string(), z.number()]).optional(),
};

function assertFeeConfig(data: { feeEnabled?: boolean; feeType?: string; feeValue?: string | number }) {
  if (!data.feeEnabled) return;
  if (!data.feeType || data.feeType === "none") {
    throw new AppError("VALIDATION", "Pilih jenis tarif fee (tetap per transaksi atau persen) bila fee metode diaktifkan.");
  }
  const value = Number(data.feeValue ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError("VALIDATION", "Nilai tarif fee harus lebih dari nol bila fee metode diaktifkan.");
  }
  if (data.feeType === "percent" && value >= 100) {
    throw new AppError("VALIDATION", "Tarif fee persen harus di bawah 100%.");
  }
}

const methodSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(60),
  type: z.enum(["cash", "bank", "qris", "credit", "customer_credit"]),
  accountId: z.string().uuid(),
  instructions: z.string().max(300).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  ...feeConfigSchema,
});

/**
 * D-12: metode Kredit Pelanggan menebus liabilitas retur, jadi akunnya
 * tidak bebas dipilih — wajib akun pemetaan customer_credit, sama
 * seperti yang ditegakkan createSale saat penebusan. Tanpa pemetaan,
 * metode ini tidak bisa dibuat atau diubah menjadi tipe tersebut.
 */
async function assertCustomerCreditAccount(tx: Tx, companyId: string, type: string, accountId: string) {
  if (type !== "customer_credit") return;
  const [mapping] = await tx
    .select({ accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(and(eq(accountMappings.companyId, companyId), eq(accountMappings.key, "customer_credit")))
    .limit(1);
  if (!mapping) {
    throw new AppError(
      "VALIDATION",
      'Akun untuk "customer_credit" belum dipetakan di Pengaturan. Atur pemetaan Kredit pelanggan terlebih dahulu.',
    );
  }
  if (accountId !== mapping.accountId) {
    throw new AppError(
      "VALIDATION",
      "Metode Kredit Pelanggan wajib memakai akun pemetaan Kredit pelanggan.",
    );
  }
}

/**
 * A-27 B3 (menutup F-09 sisi tulis): akun tujuan metode divalidasi di
 * server — sebelumnya accountId diterima mentah (satu-satunya penjaga
 * adalah dropdown UI yang justru membatasi pilihan ke 3 akun
 * terpetakan, F-02). Kini akun wajib: ada, sekantor, postable, aktif,
 * dan KELASNYA sesuai tipe metode:
 *   cash → kelas cash · bank → kelas bank · qris → kelas clearing
 *   credit → akun pemetaan receivable (akun kontrol piutang — BUKAN
 *     kas/bank; penjualan kredit mendebit piutang, kas masuk saat
 *     pelunasan lewat akun kas/bank pembayaran piutang)
 *   customer_credit → aturan khusus assertCustomerCreditAccount.
 * Kegagalan selalu berpesan bernama (akun apa, kelas apa yang
 * diharapkan) — tidak pernah diam.
 */
const METHOD_KIND_LABEL: Record<string, string> = {
  cash: "Kas",
  bank: "Bank",
  clearing: "Kliring/Settlement",
};

async function assertMethodAccount(tx: Tx, companyId: string, type: string, accountId: string) {
  if (type === "customer_credit") {
    await assertCustomerCreditAccount(tx, companyId, type, accountId);
    return;
  }
  const [account] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
      cashBankKind: accounts.cashBankKind,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) {
    throw new AppError("VALIDATION", "Akun tujuan metode pembayaran tidak ditemukan untuk perusahaan ini.");
  }
  if (!account.isPostable) {
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} (${account.name}) adalah akun induk dan tidak dapat dipakai sebagai akun metode pembayaran.`,
    );
  }
  if (!account.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} (${account.name}) sudah tidak aktif dan tidak dapat dipakai sebagai akun metode pembayaran.`,
    );
  }
  if (type === "credit") {
    const map = await getAccountMap(tx, companyId);
    if (!map.receivable) {
      throw new AppError(
        "VALIDATION",
        'Akun untuk "receivable" (Piutang usaha) belum dipetakan di Pengaturan. Atur pemetaan Piutang usaha terlebih dahulu.',
      );
    }
    if (accountId !== map.receivable) {
      throw new AppError(
        "VALIDATION",
        "Metode Kredit / tempo wajib memakai akun pemetaan Piutang usaha.",
      );
    }
    return;
  }
  const expectedKind = type === "cash" ? "cash" : type === "bank" ? "bank" : "clearing";
  if (account.cashBankKind !== expectedKind) {
    const actual = account.cashBankKind
      ? `berkelas ${METHOD_KIND_LABEL[account.cashBankKind] ?? account.cashBankKind}`
      : "tidak berkelas kas/bank";
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} (${account.name}) ${actual}; metode jenis ini wajib memakai akun berkelas ${METHOD_KIND_LABEL[expectedKind]}. Atur kelas akun di Bagan Akun terlebih dahulu.`,
    );
  }
}

/**
 * Create-only (A-8): perubahan metode yang sudah ada wajib lewat
 * updatePaymentMethodAction agar kode tidak pernah berubah dari
 * belakang dan status aktif tidak ter-reset diam-diam.
 */
export async function savePaymentMethodAction(input: z.input<typeof methodSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(methodSchema, input);
    if (data.id) {
      throw new AppError(
        "VALIDATION",
        "Metode yang sudah ada diubah lewat aksi ubah metode pembayaran, bukan simpan baru.",
      );
    }
    assertFeeConfig(data);
    const result = await withCompany(ctx.company.id, async (tx) => {
      // SET-004: Validasi ketersediaan akun bank_fee sebelum menyimpan metode ber-fee
      if (data.feeEnabled && data.feeType && data.feeType !== "none" && Number(data.feeValue) > 0) {
        const map = await getAccountMap(tx, ctx.company.id);
        if (!map.bank_fee) {
          throw new AppError(
            "VALIDATION",
            'Akun biaya bank ("bank_fee") belum dipetakan di Pengaturan > Pemetaan Akun. Atur akun Biaya Bank terlebih dahulu sebelum mengaktifkan fee pada metode pembayaran.',
          );
        }
      }
      await assertMethodAccount(tx, ctx.company.id, data.type, data.accountId);
      const [row] = await tx
        .insert(paymentMethods)
        .values({
          companyId: ctx.company.id,
          code: data.code.toUpperCase(),
          name: data.name,
          type: data.type,
          accountId: data.accountId,
          instructions: data.instructions,
          isActive: data.isActive ?? true,
          sortOrder: data.sortOrder ?? 0,
          feeEnabled: data.feeEnabled ?? false,
          feeType: data.feeType ?? "none",
          feeValue: String(data.feeValue ?? "0"),
        })
        .returning({ id: paymentMethods.id });

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payment_method.create",
        entityType: "payment_method",
        entityId: row.id,
        after: {
          code: data.code.toUpperCase(),
          name: data.name,
          type: data.type,
          accountId: data.accountId,
        },
      });

      return row;
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return result;
  });
}

const methodUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  type: z.enum(["cash", "bank", "qris", "credit", "customer_credit"]),
  accountId: z.string().uuid(),
  instructions: z.string().max(300).optional(),
  sortOrder: z.number().int().optional(),
  ...feeConfigSchema,
});

/**
 * A-8: ubah metode pembayaran. Kode SENGAJA tidak ada di skema — kode
 * adalah identitas yang dirujuk riwayat (sale_payments.method_id tidak
 * ber-FK dan laporan menampilkan nama dari baris metode), jadi kode
 * terkunci sejak dibuat; kunci tambahan apa pun dari klien dibuang
 * Zod. Status aktif juga tidak disentuh di sini: ia hanya berubah
 * lewat setPaymentMethodActiveAction.
 */
export async function updatePaymentMethodAction(input: z.input<typeof methodUpdateSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(methodUpdateSchema, input);
    assertFeeConfig(data);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const [existing] = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ctx.company.id), eq(paymentMethods.id, data.id)))
        .limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "Metode pembayaran tidak ditemukan.");
      // SET-01: tipe/akun adalah makna historis pembayaran. sale_payments
      // hanya menyimpan method_id dan laporan/refund memakai metode live;
      // izinkan ubah nama/urutan/fee, tetapi bukan identitas kanal setelah
      // metode dipakai. Buat metode baru bila kanal memang berubah.
      const identityChanged =
        data.type !== existing.type || data.accountId !== existing.accountId;
      if (identityChanged) {
        const [used] = await tx
          .select({ id: salePayments.id })
          .from(salePayments)
          .where(
            and(
              eq(salePayments.companyId, ctx.company.id),
              eq(salePayments.methodId, existing.id),
            ),
          )
          .limit(1);
        if (used) {
          throw new AppError(
            "CONFLICT",
            `Metode ${existing.name} sudah dipakai transaksi. Tipe dan akun tidak dapat diubah agar laporan/refund historis tetap sesuai; buat metode baru untuk kanal berbeda.`,
          );
        }
      }
      // SET-004: Validasi ketersediaan akun bank_fee sebelum menyimpan metode ber-fee
      const isFeeActive = data.feeEnabled ?? existing.feeEnabled;
      const feeType = data.feeType ?? existing.feeType;
      const feeVal = Number(data.feeValue !== undefined ? data.feeValue : existing.feeValue);
      if (isFeeActive && feeType !== "none" && feeVal > 0) {
        const map = await getAccountMap(tx, ctx.company.id);
        if (!map.bank_fee) {
          throw new AppError(
            "VALIDATION",
            'Akun biaya bank ("bank_fee") belum dipetakan di Pengaturan > Pemetaan Akun. Atur akun Biaya Bank terlebih dahulu sebelum mengaktifkan fee pada metode pembayaran.',
          );
        }
      }
      await assertMethodAccount(tx, ctx.company.id, data.type, data.accountId);
      const [row] = await tx
        .update(paymentMethods)
        .set({
          name: data.name,
          type: data.type,
          accountId: data.accountId,
          instructions: data.instructions ?? existing.instructions,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          feeEnabled: data.feeEnabled ?? existing.feeEnabled,
          feeType: data.feeType ?? existing.feeType,
          feeValue: data.feeValue !== undefined ? String(data.feeValue) : existing.feeValue,
        })
        .where(and(eq(paymentMethods.companyId, ctx.company.id), eq(paymentMethods.id, data.id)))
        .returning({ id: paymentMethods.id });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payment_method.update",
        entityType: "payment_method",
        entityId: data.id,
        before: {
          code: existing.code,
          name: existing.name,
          type: existing.type,
          accountId: existing.accountId,
          sortOrder: existing.sortOrder,
        },
        after: {
          code: existing.code,
          name: data.name,
          type: data.type,
          accountId: data.accountId,
          sortOrder: data.sortOrder ?? existing.sortOrder,
        },
      });
      return row;
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return result;
  });
}

export async function setPaymentMethodActiveAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [updated] = await tx
        .update(paymentMethods)
        .set({ isActive: data.isActive })
        .where(and(eq(paymentMethods.companyId, ctx.company.id), eq(paymentMethods.id, data.id)))
        .returning({ id: paymentMethods.id });
      if (!updated) throw new AppError("NOT_FOUND", "Metode pembayaran tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "payment_method.activate" : "payment_method.deactivate",
        entityType: "payment_method",
        entityId: data.id,
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return data;
  });
}

/**
 * A-8: hapus metode pembayaran berpenjaga. Satu-satunya referensi
 * transaksi ke metode adalah sale_payments.method_id (uuid tanpa FK;
 * pembayaran piutang/utang memakai account_id langsung dan mutasi kas
 * menunjuk sesi, bukan metode). Karena laporan & detail penjualan
 * membaca nama metode lewat leftJoin ke baris ini, metode yang sudah
 * dipakai tidak boleh hilang — tolak dan arahkan ke nonaktifkan.
 */
export async function deletePaymentMethodAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const methodId = parseInput(z.string().uuid(), id);
    await withCompany(ctx.company.id, async (tx) => {
      const [method] = await tx
        .select({ id: paymentMethods.id, code: paymentMethods.code, name: paymentMethods.name })
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ctx.company.id), eq(paymentMethods.id, methodId)))
        .limit(1);
      if (!method) throw new AppError("NOT_FOUND", "Metode pembayaran tidak ditemukan.");
      const [used] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(salePayments)
        .where(and(eq(salePayments.companyId, ctx.company.id), eq(salePayments.methodId, methodId)));
      const usedCount = used?.value ?? 0;
      if (usedCount > 0) {
        throw new AppError(
          "CONFLICT",
          `Metode pembayaran sudah dipakai pada ${usedCount} transaksi penjualan dan tidak dapat dihapus. Nonaktifkan metode ini agar tidak tampil lagi di kasir.`,
        );
      }
      await tx
        .delete(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ctx.company.id), eq(paymentMethods.id, methodId)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "payment_method.delete",
        entityType: "payment_method",
        entityId: methodId,
        before: { code: method.code, name: method.name },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return { id: methodId };
  });
}


export async function uploadQrisAction(input: { dataUrl: string }) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(z.object({ dataUrl: qrisImageSchema }), input);
    await withCompany(ctx.company.id, async (tx) => {
      await tx
        .update(companySettings)
        .set({ qrisImage: data.dataUrl, updatedAt: new Date() })
        .where(eq(companySettings.companyId, ctx.company.id));
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return { ok: true };
  });
}
