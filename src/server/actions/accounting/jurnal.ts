// A-26 Q4 (K-03): pecahan src/server/actions/accounting.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
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
      // R3-09: tag pihak datang dari klien dan journal_lines.party_id
      // tanpa FK — keberadaan pihak di perusahaan ini diverifikasi di
      // sini (jalur pembayaran lain tidak pernah menerima pihak dari
      // klien; mereka menurunkannya dari dokumen).
      const tagged = data.lines.filter((line) => line.partyId && line.partyType);
      if (tagged.length > 0) {
        const customerIds = [...new Set(tagged.filter((l) => l.partyType === "customer").map((l) => l.partyId!))];
        const supplierIds = [...new Set(tagged.filter((l) => l.partyType === "supplier").map((l) => l.partyId!))];
        const found = new Set<string>();
        if (customerIds.length > 0) {
          const rows = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.companyId, ctx.company.id), inArray(customers.id, customerIds)));
          for (const row of rows) found.add(`customer:${row.id}`);
        }
        if (supplierIds.length > 0) {
          const rows = await tx
            .select({ id: suppliers.id })
            .from(suppliers)
            .where(and(eq(suppliers.companyId, ctx.company.id), inArray(suppliers.id, supplierIds)));
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

      // DATA-014: larang jurnal manual memposting ke akun kontrol (piutang, persediaan, hutang dagang).
      // Mutasi akun kontrol hanya boleh terjadi otomatis dari dokumen subledger (penjualan, penerimaan, pembayaran, dll).
      const map = await getAccountMap(tx, ctx.company.id);
      const controlAccountIds = new Set(
        [map.receivable, map.payable, map.inventory].filter(Boolean),
      );
      const invalidLine = data.lines.find((l) => controlAccountIds.has(l.accountId));
      if (invalidLine) {
        throw new AppError(
          "VALIDATION",
          "Akun kontrol buku besar (Piutang Usaha, Hutang Usaha, dan Persediaan Barang) tidak boleh dimutasi lewat jurnal umum manual. Gunakan dokumen transaksi terkait (Faktur, Penerimaan Barang, atau Penyesuaian Stok) agar saldo GL dan kartu pembantu tetap sinkron.",
        );
      }

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
    return withCompany(ctx.company.id, async (tx) => {
      const [row] = await tx
        .select({
          debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
          credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .where(eq(journalLines.companyId, ctx.company.id));
      return { debit: Number(row?.debit ?? 0), credit: Number(row?.credit ?? 0) };
    });
  });
}
