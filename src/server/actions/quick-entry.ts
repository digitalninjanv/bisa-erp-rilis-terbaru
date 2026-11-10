"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  accounts,
  quickEntryDrafts,
  quickEntrySubmissions,
} from "@/db/schema";
import { getAccountMap, listCashBankIds } from "@/server/accounting";
import { createBankTransfer } from "@/server/bank-transfers";
import { listCustomers, listSuppliers } from "@/server/catalog";
import { createExpense, effectiveTaxRate } from "@/server/expenses";
import { listOpenExpensePayables } from "@/server/payables";
import {
  listOpenReceivableDocsForCustomers,
  payPayableFifo,
  postQuickCashSale,
  receiveReceivableFifo,
} from "@/server/quick-entry";
import { listPayables, listReceivables } from "@/server/reports";
import { listSupplierOpenPayableDocsForSuppliers } from "@/server/supplier-returns";
import { requirePermissionInModule } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { isoDate, moneyString, moneyStringOptional, parseInput } from "@/lib/action-validation";
import { d, toDb } from "@/lib/money";
import { todayISO } from "@/lib/format";
import type { QuickEntryPayload, QuickEntryPostResult } from "@/lib/quick-entry";

import { getCompanySettingsRow } from "@/server/settings";
const kindSchema = z.enum(["cash_sale", "expense", "receive", "pay", "transfer"]);

/**
 * Skema posting (ketat): payload draf TIDAK pernah dipercaya — posting
 * dari draf pun melewati skema ini dan seluruh validasi domain dari
 * nol, jadi draf yang dirusak di DB tetap ditolak di sini.
 */
const postPayloadSchema = z.object({
  kind: kindSchema,
  date: isoDate("Tanggal"),
  amount: moneyString("Jumlah"),
  accountId: z.string().uuid().optional(),
  counterAccountId: z.string().uuid().optional(),
  partyId: z.string().uuid().optional(),
  fromAccountId: z.string().uuid().optional(),
  toAccountId: z.string().uuid().optional(),
  // A-21: biaya transfer — validasi sama seperti aksi transfer khusus
  // (moneyStringOptional); tanda negatif ditolak domain createBankTransfer.
  fee: moneyStringOptional("Biaya transfer"),
  // A-21 (R3-05): diskon penjualan tunai; batas atas & tanda negatif
  // ditegakkan domain postQuickCashSale.
  discount: moneyStringOptional("Diskon"),
  // A-21 (R3-08): nomor referensi/bukti untuk transfer & pembayaran
  // pihak (satu pola dengan kolom referensi dokumen tetangga).
  reference: z.string().trim().max(100).optional(),
  // A-21 Tahap R3-A (R3-06): potongan pajak TOTAL pembayaran utang
  // FIFO — didistribusikan domain mengikuti urutan dokumen.
  withholdingType: z.enum(["pph23", "pph42"]).optional(),
  withholdingRate: moneyStringOptional("Tarif potongan"),
  withholdingAmount: moneyStringOptional("Nominal potongan"),
  // A-21 (R3-11): pemasok untuk beban mode terutang — hanya bermakna
  // pada jenis expense; mengisinya menggantikan akun pembayaran.
  expenseSupplierId: z.string().uuid().optional(),
  taxIncluded: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

/**
 * Skema draf (longgar bentuknya, tetap tervalidasi Zod): draf adalah
 * formulir setengah terisi yang sah untuk disimpan — yang wajib hanya
 * jenisnya; kelengkapan ditegakkan nanti oleh skema posting.
 */
const draftPayloadSchema = z.object({
  kind: kindSchema,
  date: z.string().max(10).optional().default(""),
  amount: z.string().max(40).optional().default(""),
  accountId: z.string().max(64).optional(),
  counterAccountId: z.string().max(64).optional(),
  partyId: z.string().max(64).optional(),
  fromAccountId: z.string().max(64).optional(),
  toAccountId: z.string().max(64).optional(),
  fee: z.string().max(40).optional(),
  discount: z.string().max(40).optional(),
  reference: z.string().max(100).optional(),
  withholdingType: z.string().max(10).optional(),
  withholdingRate: z.string().max(40).optional(),
  withholdingAmount: z.string().max(40).optional(),
  expenseSupplierId: z.string().max(64).optional(),
  taxIncluded: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

type PickerAccount = { id: string; code: string; name: string; type: string };

function toPicker(row: { id: string; code: string; name: string; type: string }): PickerAccount {
  return { id: row.id, code: row.code, name: row.name, type: row.type };
}

/**
 * Semua data yang dibutuhkan modal dalam satu panggilan: akun pemilih,
 * tarif pajak perusahaan, pihak dengan saldo terbuka beserta dokumen
 * terbukanya (tertua dulu — sumber pratinjau alokasi FIFO), dan draf
 * milik pengguna saat ini.
 */
export async function getQuickEntryBootstrapAction() {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    return withCompanyReadOnly(ctx.company.id, async (tx) => {
      const settings = await getCompanySettingsRow(tx, ctx.company.id);
      const map = await getAccountMap(tx, ctx.company.id);
      const accountRows = await tx
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          type: accounts.type,
          isPostable: accounts.isPostable,
          isActive: accounts.isActive,
        })
        .from(accounts)
        .where(eq(accounts.companyId, ctx.company.id))
        .orderBy(accounts.code);
      const usable = accountRows.filter((row) => row.isPostable && row.isActive);
      const byId = new Map(accountRows.map((row) => [row.id, row]));
      // A-27 B2: pemilih akun kas/bank modal = himpunan kelas kas/bank
      // (listCashBankIds), bukan lagi tiga akun pemetaan cash/bank/qris.
      const cashBankIds = await listCashBankIds(tx, ctx.company.id);

      const cashAccounts = usable.filter((row) => cashBankIds.has(row.id)).map(toPicker);
      const revenueAccounts = usable.filter((row) => row.type === "revenue").map(toPicker);
      // A-21 (R3-15): daftar akun beban disamakan dengan halaman Beban
      // khusus (listExpenseAccounts di reports.ts) — hanya tipe
      // expense; HPP (cogs) bukan akun beban untuk jalur pencatatan
      // beban, dan domain createExpense kini menegakkan hal yang sama.
      const expenseAccounts = usable
        .filter((row) => row.type === "expense")
        .map(toPicker);
      const labelOf = (key: string): PickerAccount | null => {
        const row = map[key] ? byId.get(map[key]) : undefined;
        return row ? toPicker(row) : null;
      };

      // Pihak dengan saldo terbuka + dokumennya (untuk pemilih & pratinjau FIFO).
      const receivableRows = await listReceivables(tx, ctx.company.id);
      const customerNames = new Map<string, string>();
      for (const row of receivableRows) {
        if (row.customerId && row.customerName) customerNames.set(row.customerId, row.customerName);
      }
      const customers: { id: string; name: string; totalOutstanding: string }[] = [];
      const receivableDocs: {
        partyId: string;
        kind: string;
        id: string;
        number: string | null;
        date: string;
        outstanding: string;
      }[] = [];
      // A-26 Q1b (I-01): dokumen semua pelanggan dimuat dengan 2
      // kueri batch — sebelumnya 2 kueri PER pelanggan (N+1).
      const receivableDocsByCustomer = await listOpenReceivableDocsForCustomers(
        tx,
        ctx.company.id,
        [...customerNames.keys()],
      );
      for (const [customerId, name] of customerNames) {
        const docs = receivableDocsByCustomer.get(customerId) ?? [];
        if (docs.length === 0) continue;
        customers.push({
          id: customerId,
          name,
          totalOutstanding: toDb(docs.reduce((acc, doc) => acc.plus(doc.outstanding), d(0))),
        });
        for (const doc of docs) {
          receivableDocs.push({
            partyId: customerId,
            kind: doc.kind,
            id: doc.id,
            number: doc.number,
            date: doc.date,
            outstanding: toDb(doc.outstanding),
          });
        }
      }

      const payableRows = await listPayables(tx, ctx.company.id);
      const supplierNames = new Map<string, string>();
      for (const row of payableRows) {
        if (row.supplierId && row.supplierName) supplierNames.set(row.supplierId, row.supplierName);
      }
      const suppliers: { id: string; name: string; totalOutstanding: string }[] = [];
      const payableDocs: {
        partyId: string;
        kind: string;
        id: string;
        number: string | null;
        date: string;
        outstanding: string;
      }[] = [];
      // A-26 Q1b (I-01): dokumen barang semua pemasok dimuat batch
      // (listSupplierOpenPayableDocsForSuppliers) dan dokumen beban
      // dengan SATU panggilan listOpenExpensePayables tanpa pemasok
      // lalu dikelompokkan — sebelumnya keduanya per pemasok (N+1).
      const goodsDocsBySupplier = await listSupplierOpenPayableDocsForSuppliers(
        tx,
        ctx.company.id,
        [...supplierNames.keys()],
      );
      const allExpensePayables = await listOpenExpensePayables(tx, ctx.company.id);
      const expenseDocsBySupplier = new Map<string, typeof allExpensePayables>();
      for (const row of allExpensePayables) {
        if (!row.supplierId) continue;
        const list = expenseDocsBySupplier.get(row.supplierId) ?? [];
        list.push(row);
        expenseDocsBySupplier.set(row.supplierId, list);
      }
      for (const [supplierId, name] of supplierNames) {
        const goodsDocs = goodsDocsBySupplier.get(supplierId) ?? [];
        // A-21 (R3-11): dokumen beban terutang ikut tampil & terhitung
        // di pratinjau FIFO modal — definisi terbukanya sama dengan
        // yang dilunasi payPayableFifo di server.
        const expenseDocs = expenseDocsBySupplier.get(supplierId) ?? [];
        const docs = [
          ...goodsDocs.map((doc) => ({
            kind: doc.kind as string,
            id: doc.id,
            number: doc.number,
            date: doc.date,
            outstanding: doc.outstanding,
          })),
          ...expenseDocs.map((doc) => ({
            kind: "expense",
            id: doc.id,
            number: doc.number as string | null,
            date: doc.date,
            outstanding: toDb(doc.outstanding),
          })),
        ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (docs.length === 0) continue;
        suppliers.push({
          id: supplierId,
          name,
          totalOutstanding: toDb(docs.reduce((acc, doc) => acc.plus(d(doc.outstanding)), d(0))),
        });
        for (const doc of docs) {
          payableDocs.push({
            partyId: supplierId,
            kind: doc.kind,
            id: doc.id,
            number: doc.number,
            date: doc.date,
            outstanding: doc.outstanding,
          });
        }
      }

      const draftRows = await tx
        .select()
        .from(quickEntryDrafts)
        .where(
          and(eq(quickEntryDrafts.companyId, ctx.company.id), eq(quickEntryDrafts.userId, ctx.user.id)),
        )
        .orderBy(desc(quickEntryDrafts.updatedAt));

      return {
        today: todayISO(),
        // SIM-2 S2: PPN nonaktif → tarif efektif 0 (opsi "Termasuk PPN"
        // di modal hilang, sama seperti tarif 0 sebelumnya) — lewat
        // definisi kanonis effectiveTaxRate (A-26 Q1b, D-04; sebelumnya
        // ekspresi ini disalin inline di berkas ini).
        taxRate: await effectiveTaxRate(tx, ctx.company.id),
        withholdingEnabled: settings?.withholdingEnabled ?? false,
        taxOutputAccount: labelOf("tax_output"),
        // FIX-P1 Tahap 4 (AK4-04): akun PPN Masukan untuk pratinjau &
        // opsi "Termasuk PPN" pada jenis Beban.
        taxInputAccount: labelOf("tax_input"),
        receivableAccount: labelOf("receivable"),
        payableAccount: labelOf("payable"),
        // A-21: label akun biaya administrasi bank terpetakan untuk
        // baris biaya pada pratinjau transfer.
        bankFeeAccount: labelOf("bank_fee"),
        // A-21 (R3-05): label akun diskon terpetakan untuk baris
        // diskon pada pratinjau penjualan tunai, dan daftar pelanggan
        // aktif untuk tag pihak opsionalnya (daftar `customers` di
        // bawah hanya memuat pelanggan berpiutang terbuka).
        discountAccount: labelOf("sales_discount"),
        customerOptions: await listCustomers(tx, ctx.company.id),
        // A-21 (R3-11): daftar pemasok aktif untuk mode terutang pada
        // jenis Beban (daftar `suppliers` di bawah hanya memuat
        // pemasok berutang terbuka — untuk pelunasan, bukan pengakuan).
        supplierOptions: await listSuppliers(tx, ctx.company.id),
        defaultRevenueAccountId: map.revenue ?? null,
        cashAccounts,
        revenueAccounts,
        expenseAccounts,
        customers,
        suppliers,
        receivableDocs,
        payableDocs,
        drafts: draftRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          payload: row.payload as QuickEntryPayload,
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    });
  });
}

export async function postQuickEntryAction(input: {
  payload: z.input<typeof postPayloadSchema>;
  idempotencyKey?: string;
  draftId?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({
        payload: postPayloadSchema,
        // Pola AK-P3-02: kunci idempotensi per sesi formulir dari klien.
        idempotencyKey: z.string().trim().min(8).max(120).optional(),
        draftId: z.string().uuid().optional(),
      }),
      input,
    );
    const payload = data.payload;
    const amount = d(payload.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new AppError("VALIDATION", "Jumlah harus lebih dari nol.");
    }
    // Kelengkapan per jenis ditegakkan eksplisit dengan pesan yang
    // menyebut kolomnya (skema bersama sengaja longgar antar-jenis).
    const need = (value: string | undefined, message: string): string => {
      if (!value) throw new AppError("VALIDATION", message);
      return value;
    };
    if (payload.kind === "cash_sale") {
      need(payload.accountId, "Pilih akun kas/bank tujuan penerimaan.");
      need(payload.counterAccountId, "Pilih akun pendapatan.");
    } else if (payload.kind === "expense") {
      need(payload.counterAccountId, "Pilih akun beban.");
      // A-21 (R3-11): mode terutang (pemasok dipilih) menggantikan
      // akun pembayaran; tanpa pemasok, akun pembayaran tetap wajib.
      if (!payload.expenseSupplierId) {
        need(payload.accountId, "Pilih akun pembayaran beban.");
      }
      if ((payload.notes ?? "").trim().length < 3) {
        throw new AppError("VALIDATION", "Keterangan beban wajib diisi minimal 3 karakter.");
      }
    } else if (payload.kind === "receive") {
      need(payload.partyId, "Pilih pelanggan yang membayar.");
      need(payload.accountId, "Pilih akun kas/bank tujuan penerimaan.");
    } else if (payload.kind === "pay") {
      need(payload.partyId, "Pilih pemasok yang dibayar.");
      need(payload.accountId, "Pilih akun kas/bank sumber pembayaran.");
    } else if (payload.kind === "transfer") {
      need(payload.fromAccountId, "Pilih rekening asal.");
      need(payload.toAccountId, "Pilih rekening tujuan.");
    }

    const result = await withCompany(ctx.company.id, async (tx) => {
      // Replay idempoten: kunci yang sama mengembalikan hasil pertama
      // tanpa memposting ulang (dan draf yang menyertainya tetap
      // dibersihkan, karena posting aslinya sudah terjadi).
      if (data.idempotencyKey) {
        const [submission] = await tx
          .select({ result: quickEntrySubmissions.result })
          .from(quickEntrySubmissions)
          .where(
            and(
              eq(quickEntrySubmissions.companyId, ctx.company.id),
              eq(quickEntrySubmissions.idempotencyKey, data.idempotencyKey),
            ),
          )
          .limit(1);
        if (submission) {
          if (data.draftId) {
            await tx
              .delete(quickEntryDrafts)
              .where(
                and(
                  eq(quickEntryDrafts.companyId, ctx.company.id),
                  eq(quickEntryDrafts.userId, ctx.user.id),
                  eq(quickEntryDrafts.id, data.draftId),
                ),
              );
          }
          return submission.result as QuickEntryPostResult;
        }
      }

      let posted: QuickEntryPostResult;
      switch (payload.kind) {
        case "cash_sale": {
          const sale = await postQuickCashSale(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            date: payload.date,
            amount: payload.amount,
            accountId: payload.accountId!,
            revenueAccountId: payload.counterAccountId!,
            taxIncluded: payload.taxIncluded ?? false,
            // SIM-2 S2: saklar PPN ditegakkan di server, bukan hanya UI
            // — lewat definisi kanonis effectiveTaxRate (A-26 Q1b,
            // D-04; sebelumnya ekspresi disalin inline + satu kueri
            // pengaturan khusus hanya untuk tarif ini).
            taxRate: await effectiveTaxRate(tx, ctx.company.id),
            // A-21 (R3-05): diskon & tag pelanggan opsional — tanpa
            // keduanya jurnal persis seperti sebelum tahap ini.
            discount: payload.discount,
            customerId: payload.partyId,
            notes: payload.notes,
            idempotencyKey: data.idempotencyKey ? `quick_entry:${data.idempotencyKey}` : null,
          });
          posted = { kind: payload.kind, numbers: [sale.journalNumber] };
          break;
        }
        case "expense": {
          const expense = await createExpense(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            date: payload.date,
            expenseAccountId: payload.counterAccountId!,
            // A-21 (R3-11): pemasok pada payload memilih mode
            // terutang di domain yang sama seperti form khusus.
            paymentAccountId: payload.expenseSupplierId ? null : payload.accountId!,
            supplierId: payload.expenseSupplierId ?? null,
            amount: payload.amount,
            description: (payload.notes ?? "").trim(),
            // FIX-P1 Tahap 4 (AK4-04): opsi "Termasuk PPN" untuk beban
            // (tertunda sejak A-12) — tarif efektif dari pengaturan,
            // saklar PPN ditegakkan di server seperti penjualan tunai.
            taxIncluded: payload.taxIncluded ?? false,
            taxRate: await effectiveTaxRate(tx, ctx.company.id),
          });
          posted = { kind: payload.kind, numbers: [expense.number], warnings: expense.warnings };
          break;
        }
        case "receive": {
          const paid = await receiveReceivableFifo(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            customerId: payload.partyId!,
            date: payload.date,
            amount: payload.amount,
            accountId: payload.accountId!,
            notes: payload.notes,
            reference: payload.reference,
            // POS1-05: kunci pengiriman modal diteruskan agar lapisan
            // domain ikut idempoten per dokumen, bukan hanya replay
            // di tabel submissions.
            idempotencyKey: data.idempotencyKey,
          });
          // A-21 (R3-02): nomor dokumen kredit sisa FIFO ikut tampil
          // di hasil agar kelebihan bayar terlihat, bukan menghilang.
          posted = { kind: payload.kind, numbers: paid.creditNumber ? [...paid.numbers, paid.creditNumber] : paid.numbers, allocations: paid.allocations, warnings: paid.warnings };
          break;
        }
        case "pay": {
          const paid = await payPayableFifo(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            supplierId: payload.partyId!,
            date: payload.date,
            amount: payload.amount,
            accountId: payload.accountId!,
            notes: payload.notes,
            reference: payload.reference,
            // A-21 Tahap R3-A (R3-06): potongan total FIFO (bila ada).
            withholding:
              payload.withholdingAmount && d(payload.withholdingAmount).gt(0)
                ? {
                    type: payload.withholdingType ?? "pph23",
                    rate: payload.withholdingRate,
                    amount: payload.withholdingAmount,
                  }
                : undefined,
          });
          posted = { kind: payload.kind, numbers: paid.creditNumber ? [...paid.numbers, paid.creditNumber] : paid.numbers, allocations: paid.allocations, warnings: paid.warnings };
          break;
        }
        case "transfer": {
          const transfer = await createBankTransfer(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            date: payload.date,
            fromAccountId: payload.fromAccountId!,
            toAccountId: payload.toAccountId!,
            amount: payload.amount,
            // A-21: biaya dari formulir (draf lama tanpa field = 0),
            // diposting domain transfer yang sama seperti jalur khusus.
            fee: payload.fee ?? "0",
            // A-21 (R3-08): referensi dari formulir — domain transfer
            // sudah menerimanya; jalur cepat sebelumnya tidak bisa
            // mengisinya sama sekali.
            reference: payload.reference,
            description: payload.notes,
          });
          posted = { kind: payload.kind, numbers: [transfer.number], warnings: transfer.warnings };
          break;
        }
      }

      if (data.idempotencyKey) {
        await tx.insert(quickEntrySubmissions).values({
          companyId: ctx.company.id,
          userId: ctx.user.id,
          idempotencyKey: data.idempotencyKey,
          kind: payload.kind,
          result: posted,
        });
      }
      // Posting dari draf menghapus drafnya dalam transaksi yang sama:
      // bila posting di atas gagal, transaksi mundur dan draf tetap ada.
      if (data.draftId) {
        await tx
          .delete(quickEntryDrafts)
          .where(
            and(
              eq(quickEntryDrafts.companyId, ctx.company.id),
              eq(quickEntryDrafts.userId, ctx.user.id),
              eq(quickEntryDrafts.id, data.draftId),
            ),
          );
      }
      return posted;
    });

    revalidatePath("/app/akuntansi");
    revalidatePath("/app/akuntansi/jurnal");
    revalidatePath("/app/akuntansi/beban");
    revalidatePath("/app/akuntansi/bank");
    revalidatePath("/app/akuntansi/piutang-utang");
    return result;
  });
}

export async function saveQuickEntryDraftAction(input: {
  id?: string;
  payload: z.input<typeof draftPayloadSchema>;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({
        id: z.string().uuid().optional(),
        payload: draftPayloadSchema,
      }),
      input,
    );
    const payload = data.payload as QuickEntryPayload;
    const saved = await withCompany(ctx.company.id, async (tx) => {
      if (data.id) {
        const [row] = await tx
          .update(quickEntryDrafts)
          .set({ kind: payload.kind, payload, updatedAt: new Date() })
          .where(
            and(
              eq(quickEntryDrafts.companyId, ctx.company.id),
              eq(quickEntryDrafts.userId, ctx.user.id),
              eq(quickEntryDrafts.id, data.id),
            ),
          )
          .returning({ id: quickEntryDrafts.id });
        if (!row) throw new AppError("NOT_FOUND", "Draf tidak ditemukan.");
        return row;
      }
      const [row] = await tx
        .insert(quickEntryDrafts)
        .values({
          companyId: ctx.company.id,
          userId: ctx.user.id,
          kind: payload.kind,
          payload,
        })
        .returning({ id: quickEntryDrafts.id });
      return row;
    });
    revalidatePath("/app/akuntansi");
    return saved;
  });
}

export async function listQuickEntryDraftsAction() {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    return withCompanyReadOnly(ctx.company.id, async (tx) => {
      const rows = await tx
        .select()
        .from(quickEntryDrafts)
        .where(
          and(eq(quickEntryDrafts.companyId, ctx.company.id), eq(quickEntryDrafts.userId, ctx.user.id)),
        )
        .orderBy(desc(quickEntryDrafts.updatedAt));
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row.payload as QuickEntryPayload,
        updatedAt: row.updatedAt.toISOString(),
      }));
    });
  });
}

export async function deleteQuickEntryDraftAction(input: { id: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(z.object({ id: z.string().uuid() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [row] = await tx
        .delete(quickEntryDrafts)
        .where(
          and(
            eq(quickEntryDrafts.companyId, ctx.company.id),
            eq(quickEntryDrafts.userId, ctx.user.id),
            eq(quickEntryDrafts.id, data.id),
          ),
        )
        .returning({ id: quickEntryDrafts.id });
      if (!row) throw new AppError("NOT_FOUND", "Draf tidak ditemukan.");
    });
    revalidatePath("/app/akuntansi");
    return { id: data.id };
  });
}
