// A-26 Q4 (K-03): pecahan src/server/actions/accounting.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Tx } from "@/db";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  accounts,
  customers,
  journalEntries,
  journalLines,
  suppliers,
} from "@/db/schema";
import {
  getAccountMap,
  postJournal,
  reverseJournalEntry,
} from "@/server/accounting";

import { writeAudit } from "@/server/audit";
import {
  requirePermission,
  requirePermissionInModule,
} from "@/lib/session";

import {
  AppError,
  guard,
} from "@/lib/errors";
import {
  isoDate,
  moneyStringOptionalNonNegative,
  parseInput,
} from "@/lib/action-validation";

import { d } from "@/lib/money";

const journalLineSchema = z
  .object({
    accountId: z.string().uuid(),
    // FIX-P1 Tahap 3 (AK6-01/AK1-02): sisi jurnal tidak boleh negatif dan
    // tidak boleh terisi dua-duanya — selaras dengan penjaga domain di
    // postJournal, tetapi ditolak di batas form dengan pesan per baris.
    debit: moneyStringOptionalNonNegative("Debit"),
    credit: moneyStringOptionalNonNegative("Kredit"),
    description: z.string().max(200).optional(),
    // A-21 (R3-09): tag pihak opsional per baris — journal_lines
    // memang punya party_type/party_id dan postJournal menerimanya
    // (dipakai semua jalur pembayaran); form manual sebelumnya tidak
    // mengeksposnya sehingga penyesuaian akun kontrol tidak
    // teratribusi ke pihak mana pun.
    partyType: z.enum(["customer", "supplier"]).optional(),
    partyId: z.string().uuid().optional(),
  })
  .superRefine((line, ctx) => {
    if (line.debit && line.credit && d(line.debit).gt(0) && d(line.credit).gt(0)) {
      ctx.addIssue({
        code: "custom",
        path: ["credit"],
        message: "Baris jurnal hanya boleh terisi di satu sisi (debit atau kredit), tidak boleh keduanya sekaligus.",
      });
    }
    if (Boolean(line.partyType) !== Boolean(line.partyId)) {
      ctx.addIssue({
        code: "custom",
        path: ["partyId"],
        message: "Tag pihak baris jurnal harus lengkap: pilih jenis dan pihaknya, atau kosongkan keduanya.",
      });
    }
  });

/** Modul asal jurnal sistem — untuk pesan penolakan pembalikan level-jurnal. */
const JOURNAL_SOURCE_MODULE: Record<string, string> = {
  sale: "modul POS",
  sale_return: "modul POS",
  payment: "modul POS/Akuntansi",
  cash_session: "modul POS",
  cash_movement: "modul POS",
  purchase: "modul Gudang",
  purchase_return: "modul Gudang",
  adjustment: "modul Gudang",
  opname: "modul Gudang",
  opening: "modul Gudang",
  expense: "menu Beban di Akuntansi",
  payroll: "menu Payroll di Akuntansi",
  payroll_payment: "menu Payroll di Akuntansi",
  bank_transfer: "menu Bank di Akuntansi",
  capital: "menu Modal di Akuntansi",
  opening_balance: "menu Piutang & utang (saldo awal)",
};

export async function reverseJournalAction(input: {
  entryId: string;
  date: string;
  description?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({
        entryId: z.string().uuid(),
        date: isoDate("Tanggal"),
        description: z.string().max(200).optional(),
      }),
      input,
    );

    const result = await withCompany(ctx.company.id, async (tx) => {
      // Jurnal bersumber modul tidak boleh dibalik dari halaman jurnal:
      // pembalikan di sini hanya mengubah buku besar, sedangkan dokumen
      // sumber, stok, dan subledger-nya tetap aktif. Koreksi yang sah adalah
      // pembatalan/void dokumen dari modul asalnya (reverseSourceJournal).
      const [entry] = await tx
        .select({ sourceType: journalEntries.sourceType })
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ctx.company.id), eq(journalEntries.id, data.entryId)))
        .limit(1);
      if (!entry) throw new AppError("NOT_FOUND", "Jurnal tidak ditemukan.");
      // Jurnal manual dan penjualan tunai input cepat (A-12) adalah
      // jurnal mandiri tanpa dokumen sumber di modul lain — pembalikan
      // level-jurnal adalah jalur koreksi yang sah untuk keduanya.
      if (entry.sourceType !== "manual" && entry.sourceType !== "quick_cash_sale") {
        const origin = JOURNAL_SOURCE_MODULE[entry.sourceType] ?? "modul asalnya";
        throw new AppError(
          "VALIDATION",
          `Jurnal ini dibuat otomatis oleh ${origin} dan tidak bisa dibalik dari halaman jurnal. Batalkan atau void dokumen asalnya dari ${origin} agar dokumen, stok, dan subledger ikut terkoreksi.`,
        );
      }

      const reversed = await reverseJournalEntry(tx, {
        companyId: ctx.company.id,
        entryId: data.entryId,
        date: data.date,
        description: data.description,
        createdBy: ctx.user.id,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "journal.reverse",
        entityType: "journal_entry",
        entityId: reversed.original.id,
        after: { reversalId: reversed.reversal.id, reversalNumber: reversed.reversal.number, reason: data.description },
      });
      return reversed.reversal;
    });

    revalidatePath("/app/akuntansi/jurnal");
    revalidatePath(`/app/akuntansi/jurnal/${data.entryId}`);
    revalidatePath("/app/akuntansi");
    return result;
  });
}


/**
 * Validasi bersama jalur jurnal manual: tag pihak harus nyata di
 * perusahaan, akun Persediaan tidak boleh dimutasi manual, dan akun
 * kontrol Piutang/Utang wajib bertag pihak. Dipakai saat posting dan
 * saat memposting draf agar aturannya tidak bercabang.
 */
async function assertManualJournalLines(
  tx: Tx,
  companyId: string,
  lines: Array<{
    accountId: string;
    debit?: string | null;
    credit?: string | null;
    description?: string | null;
    partyType?: string | null;
    partyId?: string | null;
  }>,
) {
  const tagged = lines.filter((line) => line.partyId && line.partyType);
  if (tagged.length > 0) {
    const customerIds = [...new Set(tagged.filter((l) => l.partyType === "customer").map((l) => l.partyId!))];
    const supplierIds = [...new Set(tagged.filter((l) => l.partyType === "supplier").map((l) => l.partyId!))];
    const found = new Set<string>();
    if (customerIds.length > 0) {
      const rows = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), inArray(customers.id, customerIds)));
      for (const row of rows) found.add(`customer:${row.id}`);
    }
    if (supplierIds.length > 0) {
      const rows = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.companyId, companyId), inArray(suppliers.id, supplierIds)));
      for (const row of rows) found.add(`supplier:${row.id}`);
    }
    for (const line of tagged) {
      if (!found.has(`${line.partyType}:${line.partyId}`)) {
        throw new AppError(
          "VALIDATION",
          `Pihak bertag pada baris jurnal (${line.partyType === "customer" ? "pelanggan" : "pemasok"}) tidak ditemukan di perusahaan ini.`,
        );
      }
    }
  }

  const map = await getAccountMap(tx, companyId);
  const invalidLine = lines.find((l) => {
    if (l.accountId === map.inventory) return true;
    if (l.accountId === map.receivable && (!l.partyType || !l.partyId)) return true;
    if (l.accountId === map.payable && (!l.partyType || !l.partyId)) return true;
    return false;
  });
  if (invalidLine) {
    throw new AppError(
      "VALIDATION",
      invalidLine.accountId === map.inventory
        ? "Akun kontrol Persediaan Barang tidak boleh dimutasi lewat jurnal umum manual. Gunakan dokumen transaksi terkait (Penerimaan Barang atau Penyesuaian Stok)."
        : "Akun kontrol Piutang Usaha dan Hutang Usaha wajib menyertakan tag pihak (pelanggan/pemasok) bila disesuaikan lewat jurnal manual agar sinkron dengan buku pembantu.",
    );
  }
}

export async function postManualJournalAction(input: {
  date: string;
  description: string;
  idempotencyKey?: string;
  lines: z.input<typeof journalLineSchema>[];
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(
      z.object({
        date: isoDate("Tanggal"),
        // Keterangan opsional (spesifikasi UX jurnal): kosong = teks
        // bawaan "Jurnal umum <nomor>" diisi saat posting.
        description: z.string().trim().max(200).optional(),
        // AK-P3-02: kunci idempotensi per sesi form dari klien — retry
        // jaringan/klik ganda mengembalikan jurnal yang sama, bukan
        // menggandakannya (postJournal menegakkannya).
        idempotencyKey: z.string().trim().min(8).max(120).optional(),
        lines: z.array(journalLineSchema).min(2).max(50),
      }),
      input,
    );

    const result = await withCompany(ctx.company.id, async (tx) => {
      await assertManualJournalLines(tx, ctx.company.id, data.lines);

      return postJournal(tx, {
        companyId: ctx.company.id,
        date: data.date,
        description: data.description?.trim() || "Jurnal umum",
        sourceType: "manual",
        createdBy: ctx.user.id,
        idempotencyKey: data.idempotencyKey,
        lines: data.lines,
      });
    });
    revalidatePath("/app/akuntansi/jurnal");
    revalidatePath("/app/akuntansi");
    return result;
  });
}


const journalDraftSchema = z.object({
  draftId: z.string().uuid().optional(),
  date: isoDate("Tanggal"),
  description: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  lines: z.array(journalLineSchema).min(2).max(50),
});

/**
 * Simpan draf jurnal manual. Draf belum menyentuh buku besar maupun
 * ringkasan bulanan; ia hanya dokumen kerja untuk direview sebelum
 * diposting. Aturan akun kontrol/tag pihak tetap divalidasi agar draf
 * tidak menyimpan kombinasi yang pasti ditolak saat posting.
 */
export async function saveJournalDraftAction(input: z.input<typeof journalDraftSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(journalDraftSchema, input);
    const debit = data.lines.reduce((acc, line) => acc.plus(d(line.debit || "0")), d(0));
    const credit = data.lines.reduce((acc, line) => acc.plus(d(line.credit || "0")), d(0));
    if (!debit.eq(credit) || debit.lte(0)) {
      throw new AppError(
        "VALIDATION",
        `Draf jurnal harus seimbang dan bernilai lebih dari nol. Debit ${debit.toFixed(2)} vs kredit ${credit.toFixed(2)}.`,
      );
    }

    const result = await withCompany(ctx.company.id, async (tx) => {
      await assertManualJournalLines(tx, ctx.company.id, data.lines);
      const idempotencyKey = data.idempotencyKey ? `draft:${data.idempotencyKey}` : null;
      if (!data.draftId && idempotencyKey) {
        const [existing] = await tx
          .select({ id: journalEntries.id, number: journalEntries.number })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.companyId, ctx.company.id),
              eq(journalEntries.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return existing;
      }

      let entryId: string;
      let number: string;
      if (data.draftId) {
        const [draft] = await tx
          .select({ id: journalEntries.id, number: journalEntries.number })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.companyId, ctx.company.id),
              eq(journalEntries.id, data.draftId),
            ),
          )
          .limit(1)
          .for("update");
        if (!draft) throw new AppError("NOT_FOUND", "Draf jurnal tidak ditemukan.");
        const [fresh] = await tx
          .select({ status: journalEntries.status })
          .from(journalEntries)
          .where(eq(journalEntries.id, draft.id))
          .limit(1);
        if (fresh?.status !== "draft") {
          throw new AppError("INVALID_STATE", "Jurnal ini bukan draf dan tidak dapat disimpan sebagai draf.");
        }
        entryId = draft.id;
        number = draft.number;
        await tx
          .update(journalEntries)
          .set({
            date: data.date,
            description: data.description?.trim() || "Jurnal umum (draf)",
          })
          .where(and(eq(journalEntries.companyId, ctx.company.id), eq(journalEntries.id, draft.id)));
        await tx
          .delete(journalLines)
          .where(and(eq(journalLines.companyId, ctx.company.id), eq(journalLines.entryId, draft.id)));
      } else {
        number = `DRAFT-${data.date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const [created] = await tx
          .insert(journalEntries)
          .values({
            companyId: ctx.company.id,
            number,
            date: data.date,
            description: data.description?.trim() || "Jurnal umum (draf)",
            sourceType: "manual",
            status: "draft",
            idempotencyKey,
            createdBy: ctx.user.id,
          })
          .returning({ id: journalEntries.id });
        entryId = created.id;
      }

      await tx.insert(journalLines).values(
        data.lines.map((line, index) => ({
          companyId: ctx.company.id,
          entryId,
          accountId: line.accountId,
          debit: d(line.debit || "0").toFixed(4),
          credit: d(line.credit || "0").toFixed(4),
          description: line.description ?? null,
          partyType: line.partyType ?? null,
          partyId: line.partyId ?? null,
          lineNo: index + 1,
        })),
      );

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.draftId ? "journal.draft.update" : "journal.draft.create",
        entityType: "journal_entry",
        entityId: entryId,
        after: { number, date: data.date, lines: data.lines.length },
      });
      return { id: entryId, number };
    });

    revalidatePath("/app/akuntansi/jurnal");
    revalidatePath("/app/akuntansi/jurnal/riwayat");
    return result;
  });
}

/** Posting draf: validasi yang sama dengan jurnal manual, lalu draf diganti jurnal posted. */
export async function postJournalDraftAction(input: { entryId: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(z.object({ entryId: z.string().uuid() }), input);

    const result = await withCompany(ctx.company.id, async (tx) => {
      const [draft] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ctx.company.id),
            eq(journalEntries.id, data.entryId),
          ),
        )
        .limit(1)
        .for("update");
      if (!draft) throw new AppError("NOT_FOUND", "Draf jurnal tidak ditemukan.");
      if (draft.status !== "draft") {
        throw new AppError("INVALID_STATE", "Jurnal ini sudah diposting atau dibatalkan.");
      }
      const lines = await tx
        .select({
          accountId: journalLines.accountId,
          debit: journalLines.debit,
          credit: journalLines.credit,
          description: journalLines.description,
          partyType: journalLines.partyType,
          partyId: journalLines.partyId,
        })
        .from(journalLines)
        .where(eq(journalLines.entryId, draft.id))
        .orderBy(asc(journalLines.lineNo));
      if (lines.length < 2) {
        throw new AppError("VALIDATION", "Draf jurnal minimal memiliki dua baris.");
      }
      await assertManualJournalLines(tx, ctx.company.id, lines);

      const posted = await postJournal(tx, {
        companyId: ctx.company.id,
        date: draft.date,
        description: draft.description,
        sourceType: "manual",
        createdBy: ctx.user.id,
        idempotencyKey: `journal-draft-post:${draft.id}`,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          description: line.description ?? undefined,
          partyType: (line.partyType as "customer" | "supplier" | null) ?? undefined,
          partyId: line.partyId ?? undefined,
        })),
      });

      await tx.delete(journalLines).where(eq(journalLines.entryId, draft.id));
      await tx.delete(journalEntries).where(eq(journalEntries.id, draft.id));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "journal.draft.post",
        entityType: "journal_entry",
        entityId: posted.id,
        after: { number: posted.number, fromDraft: draft.number },
      });
      return posted;
    });

    revalidatePath("/app/akuntansi/jurnal");
    revalidatePath("/app/akuntansi/jurnal/riwayat");
    revalidatePath("/app/akuntansi");
    return result;
  });
}

/** Hapus draf yang tidak jadi dipakai. Jurnal posted tidak dapat dihapus. */
export async function deleteJournalDraftAction(input: { entryId: string }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.post", "akuntansi");
    const data = parseInput(z.object({ entryId: z.string().uuid() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [draft] = await tx
        .select({ id: journalEntries.id, number: journalEntries.number, status: journalEntries.status })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ctx.company.id),
            eq(journalEntries.id, data.entryId),
          ),
        )
        .limit(1)
        .for("update");
      if (!draft) throw new AppError("NOT_FOUND", "Draf jurnal tidak ditemukan.");
      if (draft.status !== "draft") {
        throw new AppError("INVALID_STATE", "Hanya draf yang dapat dihapus. Jurnal posted memakai pembalik.");
      }
      await tx.delete(journalLines).where(eq(journalLines.entryId, draft.id));
      await tx.delete(journalEntries).where(eq(journalEntries.id, draft.id));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "journal.draft.delete",
        entityType: "journal_entry",
        entityId: draft.id,
        before: { number: draft.number },
      });
    });
    revalidatePath("/app/akuntansi/jurnal");
    revalidatePath("/app/akuntansi/jurnal/riwayat");
  });
}

// T5R-2: semua action TULIS di berkas ini memakai
// requirePermissionInModule(..., "akuntansi") — kecuali pasangan
// pembayaran saldo awal yang dwi-modul (lihat assertOpeningPaymentModule).
// Dua action terakhir ini murni membaca (daftar akun untuk form jurnal
// dan pemeriksaan neraca saldo), jadi dikecualikan dari gerbang saklar.
export async function listJournalAccountsForForm() {
  return guard(async () => {
    const ctx = await requirePermission("accounting.post");
    return withCompany(ctx.company.id, async (tx) => {
      return tx
        .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
        .from(accounts)
        .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.isActive, true), eq(accounts.isPostable, true)))
        .orderBy(accounts.code);
    });
  });
}

export async function trialBalanceCheckAction() {
  return guard(async () => {
    const ctx = await requirePermission("accounting.view");
    return withCompanyReadOnly(ctx.company.id, async (tx) => {
      const [row] = await tx
        .select({
          debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
          credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.companyId, ctx.company.id),
            eq(journalEntries.companyId, ctx.company.id),
            eq(journalEntries.status, "posted"),
          ),
        );
      return { debit: d(row?.debit ?? 0).toNumber(), credit: d(row?.credit ?? 0).toNumber() };
    });
  });
}
