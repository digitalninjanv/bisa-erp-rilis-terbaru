"use server";

// A-26 Q8b: pecahan actions/settings.ts per topik (pola Q4) — identitas perusahaan, pajak & ambang, saklar fitur, dan kesiapan pengaturan.
// Perilaku & nama aksi identik; pemanggil berpindah mekanis ke berkas ini.

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { companySettings, warehouses } from "@/db/schema";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { qrisImageSchema } from "@/lib/qris-image";
import { d, toDb } from "@/lib/money";

const settingsSchema = z.object({
  legalName: z.string().min(2).max(160),
  taxId: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  roundingMode: z.enum(["none", "nearest_100", "nearest_500", "nearest_1000", "up_500", "up_1000"]),
  // A-28 UI-2 (UX-D01): field warisan nota (receiptHeader/Footer/
  // ShowLogo/ShowCashier/ShowTax) DIHAPUS — pengaturan nota kini
  // satu pintu di mesin cetak (savePrintSettingsAction).
  qrisImage: qrisImageSchema.optional().nullable(),
  allowNegativeStock: z.boolean(),
  // AK-P3-06: tarif di luar 0–100% akan mengalir diam-diam ke perhitungan
  // pajak POS; tolak di skema dengan pesan yang jelas.
  taxRate: z.union([z.string(), z.number()]).refine(
    (value) => {
      try {
        const rate = d(value);
        return rate.isFinite() && rate.gte(0) && rate.lte(100);
      } catch {
        return false;
      }
    },
    { message: "Tarif pajak harus antara 0 dan 100 persen." },
  ),
  // SIM-2 S2 (audit PPN): saklar eksplisit. Opsional agar pemanggil
  // lama yang belum mengirim field ini tidak mengubah keadaan saklar.
  taxEnabled: z.boolean().optional(),
  // A-21 Tahap R3-A (R3-06): saklar potongan pajak (withholding PPh)
  // pada pembayaran keluar — opsional dengan alasan yang sama.
  withholdingEnabled: z.boolean().optional(),
  // A-21 Tahap R3-A (R3-07): ambang maksimum write-off sisa pelunasan
  // (Rupiah) — opsional dengan alasan yang sama; 0/kosong menonaktifkan.
  writeoffMaxAmount: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .refine(
      (value) => {
        if (value === undefined || value === null || value === "") return true;
        try {
          const amount = d(value);
          return amount.isFinite() && amount.gte(0);
        } catch {
          return false;
        }
      },
      { message: "Ambang write-off harus berupa nominal 0 atau lebih." },
    ),
  // FIX-P1 Tahap 5 (AK3-07): termin bawaan (hari) — utang pembelian
  // tanpa termin pemasok & bawaan tempo penjualan utang POS. Opsional
  // dengan alasan yang sama seperti taxEnabled.
  payableDefaultTermDays: z.number().int().min(0).max(3650).optional(),
  receivableDefaultTermDays: z.number().int().min(0).max(3650).optional(),
  // FIX-R2 Tahap 3 (RV2-01/AK3-11): kebijakan saldo kas/bank negatif.
  // Opsional dengan alasan yang sama — pemanggil lama tidak mengubahnya.
  cashNegativePolicy: z.enum(["allow", "warn", "block"]).optional(),
  // FIX-GDG Tahap 2 (GDG1-09): kedaluwarsa bawaan reservasi stok
  // (hari) — reservasi tanpa tanggal kedaluwarsa eksplisit memakai
  // angka ini. Opsional dengan alasan yang sama; bawaan skema 7.
  reservationDefaultExpiryDays: z.number().int().min(1).max(365).optional(),
  // A-28 Tahap 2 (H-GDG-02): jendela peringatan mendekati kedaluwarsa
  // batch (hari) di beranda Gudang — opsional dengan alasan yang sama;
  // bawaan skema 30. 0 = hanya batch yang sudah kedaluwarsa yang tampil.
  expiryWarningDays: z.number().int().min(0).max(3650).optional(),
  // SIM-2 S7B-2 (D-25): saklar fitur per perusahaan — opsional dengan
  // alasan yang sama seperti taxEnabled.
  posOfflineEnabled: z.boolean().optional(),
  transferTwoStepEnabled: z.boolean().optional(),
  // SIM-2 S7B-2 Batch 3: ambang persetujuan PR; kosong/null = nonaktif.
  prApprovalThreshold: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .refine(
      (value) => {
        if (value === undefined || value === null || value === "") return true;
        try {
          const amount = d(value);
          return amount.isFinite() && amount.gte(0);
        } catch {
          return false;
        }
      },
      { message: "Ambang persetujuan PR harus berupa nominal 0 atau lebih." },
    ),
  // A-28 Tahap 1 (H-POS-02): toleransi selisih kas tutup sesi POS
  // (Rupiah) — opsional dengan alasan yang sama seperti writeoff;
  // 0/kosong = semua selisih wajib alasan.
  posSessionDifferenceTolerance: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .refine(
      (value) => {
        if (value === undefined || value === null || value === "") return true;
        try {
          const amount = d(value);
          return amount.isFinite() && amount.gte(0);
        } catch {
          return false;
        }
      },
      { message: "Toleransi selisih sesi harus berupa nominal 0 atau lebih." },
    ),
  // POS-DISC-01 (D-10): ambang persen diskon manual POS; di atasnya
  // wajib izin `pos.discount`.
  posDiscountThresholdPercent: z
    .union([z.string(), z.number()])
    .refine((value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 && n <= 100;
    }, "Ambang diskon harus antara 0 dan 100 persen."),
  // T5-3 (D-17): ambang persetujuan penyesuaian stok (maker-checker).
  // Kosong/null = nonaktif; selain itu nominal Rupiah ≥ 0 yang terbaca.
  adjustmentApprovalThreshold: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .refine(
      (value) => {
        if (value === undefined || value === null || value === "") return true;
        try {
          const amount = d(value);
          return amount.isFinite() && amount.gte(0);
        } catch {
          return false;
        }
      },
      { message: "Ambang persetujuan penyesuaian harus berupa nominal 0 atau lebih." },
    ),
  reportNotes: z.string().max(5000).optional(),
  defaultWarehouseId: z.string().uuid().nullable().optional(),
});

export async function saveSettingsAction(input: z.input<typeof settingsSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    const data = parseInput(settingsSchema, input);
    await withCompany(ctx.company.id, async (tx) => {
      const [before] = await tx
        .select({ taxId: companySettings.taxId, qrisImage: companySettings.qrisImage })
        .from(companySettings)
        .where(eq(companySettings.companyId, ctx.company.id))
        .limit(1);
      // MD-008: validasi gudang default milik perusahaan yang aktif
      if (data.defaultWarehouseId) {
        const [wh] = await tx
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.companyId, ctx.company.id), eq(warehouses.id, data.defaultWarehouseId)))
          .limit(1);
        if (!wh) {
          throw new AppError("VALIDATION", "Gudang default tidak ditemukan di perusahaan ini.");
        }
      }

      await tx
        .update(companySettings)
        .set({
          legalName: data.legalName,
          taxId: data.taxId,
          address: data.address,
          phone: data.phone,
          roundingMode: data.roundingMode,
          qrisImage: data.qrisImage ?? null,
          allowNegativeStock: data.allowNegativeStock,
          taxRate: toDb(data.taxRate),
          ...(data.taxEnabled !== undefined ? { taxEnabled: data.taxEnabled } : {}),
          ...(data.withholdingEnabled !== undefined
            ? { withholdingEnabled: data.withholdingEnabled }
            : {}),
          ...(data.writeoffMaxAmount !== undefined
            ? {
                writeoffMaxAmount:
                  data.writeoffMaxAmount === null || data.writeoffMaxAmount === ""
                    ? "0"
                    : toDb(data.writeoffMaxAmount),
              }
            : {}),
          ...(data.payableDefaultTermDays !== undefined
            ? { payableDefaultTermDays: data.payableDefaultTermDays }
            : {}),
          ...(data.receivableDefaultTermDays !== undefined
            ? { receivableDefaultTermDays: data.receivableDefaultTermDays }
            : {}),
          ...(data.cashNegativePolicy !== undefined
            ? { cashNegativePolicy: data.cashNegativePolicy }
            : {}),
          ...(data.reservationDefaultExpiryDays !== undefined
            ? { reservationDefaultExpiryDays: data.reservationDefaultExpiryDays }
            : {}),
          ...(data.expiryWarningDays !== undefined
            ? { expiryWarningDays: data.expiryWarningDays }
            : {}),
          ...(data.posOfflineEnabled !== undefined ? { posOfflineEnabled: data.posOfflineEnabled } : {}),
          ...(data.transferTwoStepEnabled !== undefined
            ? { transferTwoStepEnabled: data.transferTwoStepEnabled }
            : {}),
          ...(data.prApprovalThreshold !== undefined
            ? {
                prApprovalThreshold:
                  data.prApprovalThreshold === null || data.prApprovalThreshold === ""
                    ? null
                    : toDb(data.prApprovalThreshold),
              }
            : {}),
          ...(data.posSessionDifferenceTolerance !== undefined
            ? {
                posSessionDifferenceTolerance:
                  data.posSessionDifferenceTolerance === null ||
                  data.posSessionDifferenceTolerance === ""
                    ? "0"
                    : toDb(data.posSessionDifferenceTolerance),
              }
            : {}),
          posDiscountThresholdPercent: toDb(data.posDiscountThresholdPercent),
          adjustmentApprovalThreshold:
            data.adjustmentApprovalThreshold === undefined ||
            data.adjustmentApprovalThreshold === null ||
            data.adjustmentApprovalThreshold === ""
              ? null
              : toDb(data.adjustmentApprovalThreshold),
          reportNotes: data.reportNotes ?? null,
          defaultWarehouseId: data.defaultWarehouseId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(companySettings.companyId, ctx.company.id));

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "settings.update",
        entityType: "company_settings",
        entityId: ctx.company.id,
        after: {
          legalName: data.legalName,
          taxId: data.taxId ?? null,
          roundingMode: data.roundingMode,
          taxRate: data.taxRate,
          posDiscountThresholdPercent: data.posDiscountThresholdPercent,
          qrisChanged: (before?.qrisImage ?? null) !== (data.qrisImage ?? null),
          qrisSha256: data.qrisImage
            ? createHash("sha256").update(data.qrisImage).digest("hex")
            : null,
        },
      });
    });
    revalidatePath("/app/pengaturan");
    revalidatePath("/app/pos");
    return { ok: true };
  });
}


export async function assertSettingsReady() {
  return guard(async () => {
    const ctx = await requirePermission("settings.manage");
    return withCompany(ctx.company.id, async (tx) => {
      const [row] = await tx
        .select({ id: companySettings.companyId })
        .from(companySettings)
        .where(eq(companySettings.companyId, ctx.company.id))
        .limit(1);
      if (!row) throw new AppError("NOT_FOUND", "Pengaturan perusahaan belum dibuat.");
      return row;
    });
  });
}
