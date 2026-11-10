import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  customers,
  partyOpeningBalances,
  suppliers,
} from "@/db/schema";
import {
  assertPeriodOpen,
  getAccountMap,
  postJournal,
  reverseJournalEntry,
} from "@/server/accounting";
import { nextDocumentNumber } from "@/server/sequences";
import { sumReturnAllocations } from "@/server/supplier-returns";
import { writeAudit } from "@/server/audit";
import { AppError } from "@/lib/errors";
import { d, toDb, type MoneyInput } from "@/lib/money";

// A-26 Q8 (K-10): siklus hidup dokumen saldo awal — dipisah dari
// pembayaran (payments.ts) agar dua concern modul ini punya rumah
// masing-masing. Perilaku tidak berubah.

/**
 * T4-5b (D-14): dokumen saldo awal hutang/piutang.
 *
 * Saldo awal BUKAN penerimaan/penjualan samaran — stok tidak bergerak.
 * Setiap dokumen membawa satu jurnal pembuka terhadap akun ekuitas
 * (Dr ekuitas / Cr utang untuk AP; Dr piutang / Cr ekuitas untuk AR,
 * baris utang/piutang bertag pihak) dan dilunasi lewat party_payments
 * dengan opening_id terisi. Koreksi selalu lewat jurnal balik.
 */

export type OpeningKind = "payable" | "receivable";

export type OpeningDoc = typeof partyOpeningBalances.$inferSelect;

function partyTypeFor(kind: OpeningKind): "supplier" | "customer" {
  return kind === "payable" ? "supplier" : "customer";
}

async function assertParty(
  tx: Tx,
  companyId: string,
  kind: OpeningKind,
  partyId: string,
): Promise<{ paymentTermDays: number | null }> {
  if (kind === "payable") {
    const [row] = await tx
      .select({ id: suppliers.id, paymentTermDays: suppliers.paymentTermDays })
      .from(suppliers)
      .where(and(eq(suppliers.companyId, companyId), eq(suppliers.id, partyId)))
      .limit(1);
    if (!row) {
      throw new AppError("VALIDATION", "Pemasok tidak ditemukan di perusahaan ini untuk saldo awal utang.");
    }
    return { paymentTermDays: row.paymentTermDays };
  }
  const [row] = await tx
    .select({ id: customers.id, paymentTermDays: customers.paymentTermDays })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), eq(customers.id, partyId)))
    .limit(1);
  if (!row) {
    throw new AppError("VALIDATION", "Pelanggan tidak ditemukan di perusahaan ini untuk saldo awal piutang.");
  }
  return { paymentTermDays: row.paymentTermDays };
}

/** Tambah hari ke tanggal ISO (UTC, tanpa geser zona waktu). */
function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * T4R-2 (review Tahap 4, P1): cerminkan validasi akun AK-P1-02 milik
 * postJournal untuk akun-akun jurnal pembuka (pemetaan harus ada, akun
 * harus milik perusahaan ini, dapat diposting, dan aktif) — dijalankan
 * SEBELUM baris dokumen apa pun ditulis, lihat createOpeningBalance.
 */
async function assertOpeningAccountsUsable(
  tx: Tx,
  companyId: string,
  kind: OpeningKind,
  map: Record<string, string>,
): Promise<{ equityId: string; counterId: string }> {
  const counterKey = kind === "payable" ? "payable" : "receivable";
  const wanted: Array<{ key: string; accountId: string | undefined }> = [
    { key: "equity", accountId: map.equity },
    { key: counterKey, accountId: map[counterKey] },
  ];
  for (const entry of wanted) {
    if (!entry.accountId) {
      throw new AppError("VALIDATION", `Akun untuk "${entry.key}" belum dipetakan di Pengaturan.`);
    }
  }
  const ids = [...new Set(wanted.map((entry) => entry.accountId as string))];
  const rows = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), inArray(accounts.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const entry of wanted) {
    const account = byId.get(entry.accountId as string);
    if (!account) {
      throw new AppError(
        "VALIDATION",
        `Akun pemetaan "${entry.key}" untuk saldo awal tidak ditemukan di perusahaan ini. Periksa Pemetaan akun di Pengaturan.`,
      );
    }
    if (!account.isPostable) {
      throw new AppError(
        "VALIDATION",
        `Akun ${account.code} (${account.name}) adalah akun induk dan tidak dapat dipakai untuk posting jurnal.`,
      );
    }
    if (!account.isActive) {
      throw new AppError(
        "VALIDATION",
        `Akun ${account.code} (${account.name}) sudah tidak aktif dan tidak dapat dipakai untuk posting jurnal.`,
      );
    }
  }
  return { equityId: map.equity, counterId: map[counterKey] };
}

export async function createOpeningBalance(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    kind: OpeningKind;
    partyId: string;
    date: string;
    dueDate?: string | null;
    amount: MoneyInput;
    reference?: string | null;
    notes?: string | null;
  },
): Promise<OpeningDoc> {
  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nominal saldo awal harus lebih dari nol.");
  }
  const party = await assertParty(tx, input.companyId, input.kind, input.partyId);
  // S3 (§18D): jatuh tempo tidak diisi pemanggil → pakai termin
  // pembayaran bawaan pihak (tanggal dokumen + termin hari) bila ada.
  const dueDate =
    input.dueDate ??
    (party.paymentTermDays != null ? addDaysISO(input.date, party.paymentTermDays) : null);
  const partyType = partyTypeFor(input.kind);
  const map = await getAccountMap(tx, input.companyId);

  // T4R-2 (review Tahap 4, P1): urutan dibuat anti-yatim. Commit impor
  // menangkap AppError per baris dan MELANJUTKAN dalam transaksi yang
  // sama, jadi kegagalan postJournal sesudah insert dokumen (periode
  // cutover yang sudah ditutup, akun pemetaan yang dinonaktifkan)
  // meninggalkan dokumen ber-journal_id NULL yang ikut ter-commit dan
  // tampil sebagai utang/piutang sah — bahkan bisa dibayar. Karena itu:
  // (1) semua yang bisa ditolak postJournal divalidasi lebih dulu,
  // (2) jurnal diposting SEBELUM dokumen ada, (3) dokumen disisipkan
  // terakhir dengan journal_id sudah terisi. Id dokumen dibuat lebih
  // dulu (uuidv7 tetap dihasilkan database) agar jurnal dapat
  // merujuknya lewat sourceId/idempotencyKey seperti sebelumnya.
  await assertPeriodOpen(tx, input.companyId, input.date);
  const { equityId, counterId } = await assertOpeningAccountsUsable(tx, input.companyId, input.kind, map);

  const number = await nextDocumentNumber(
    tx,
    input.companyId,
    input.kind === "payable" ? "OPENING_PAYABLE" : "OPENING_RECEIVABLE",
    input.date,
  );

  const idRows = (await tx.execute(sql`select uuidv7() as id`)) as unknown as { id: string }[];
  const docId = idRows[0]?.id;
  if (!docId) throw new AppError("VALIDATION", "Gagal membuat id dokumen saldo awal.");

  const label = input.kind === "payable" ? "Saldo awal utang" : "Saldo awal piutang";
  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: input.reference ? `${label} ${number} (${input.reference})` : `${label} ${number}`,
    sourceType: "opening_balance",
    sourceId: docId,
    createdBy: input.userId,
    idempotencyKey: `opening:${docId}`,
    lines:
      input.kind === "payable"
        ? [
            { accountId: equityId, debit: amount, description: "Ekuitas saldo awal" },
            {
              accountId: counterId,
              credit: amount,
              description: label,
              partyType,
              partyId: input.partyId,
            },
          ]
        : [
            {
              accountId: counterId,
              debit: amount,
              description: label,
              partyType,
              partyId: input.partyId,
            },
            { accountId: equityId, credit: amount, description: "Ekuitas saldo awal" },
          ],
  });

  const [doc] = await tx
    .insert(partyOpeningBalances)
    .values({
      id: docId,
      companyId: input.companyId,
      number,
      kind: input.kind,
      partyType,
      partyId: input.partyId,
      date: input.date,
      dueDate,
      amount: toDb(amount),
      journalId: journal.id,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      createdBy: input.userId,
    })
    .returning();

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "opening_balance.create",
    entityType: "party_opening_balance",
    entityId: doc.id,
    after: { number, kind: input.kind, amount: toDb(amount), reference: input.reference ?? null },
  });
  return doc;
}

export async function lockOpeningDoc(tx: Tx, companyId: string, openingId: string): Promise<OpeningDoc> {
  const [doc] = await tx
    .select()
    .from(partyOpeningBalances)
    .where(and(eq(partyOpeningBalances.companyId, companyId), eq(partyOpeningBalances.id, openingId)))
    .limit(1)
    .for("update");
  if (!doc) throw new AppError("NOT_FOUND", "Dokumen saldo awal tidak ditemukan.");
  return doc;
}

export async function voidOpeningBalance(
  tx: Tx,
  input: { companyId: string; userId: string; openingId: string; reason: string; date: string },
): Promise<OpeningDoc> {
  const doc = await lockOpeningDoc(tx, input.companyId, input.openingId);
  if (doc.status === "void") throw new AppError("INVALID_STATE", "Saldo awal sudah dibatalkan.");
  if (d(doc.paidAmount).gt(0)) {
    throw new AppError(
      "VALIDATION",
      "Saldo awal yang sudah memiliki pembayaran tidak dapat dibatalkan; batalkan pembayarannya terlebih dahulu.",
    );
  }
  // A-9 (D-20): a payable opening balance that supplier returns have
  // settled against cannot be voided either — its allocations would
  // dangle and the return's Dr Utang would lose its document.
  if (doc.kind === "payable") {
    const allocated = await sumReturnAllocations(tx, input.companyId, { openingId: doc.id });
    if (allocated.gt(0)) {
      throw new AppError(
        "VALIDATION",
        "Saldo awal utang ini sudah dilunasi sebagian oleh retur pembelian dan tidak dapat dibatalkan; batalkan retur terkait terlebih dahulu.",
      );
    }
  }
  if (!doc.journalId) {
    throw new AppError("VALIDATION", "Jurnal pembuka saldo awal tidak ditemukan, sehingga tidak dapat dibalik.");
  }
  const { reversal } = await reverseJournalEntry(tx, {
    companyId: input.companyId,
    entryId: doc.journalId,
    date: input.date,
    description: `Pembatalan ${doc.kind === "payable" ? "saldo awal utang" : "saldo awal piutang"} ${doc.number} — ${input.reason}`,
    createdBy: input.userId,
  });

  const [updated] = await tx
    .update(partyOpeningBalances)
    .set({ status: "void" })
    .where(and(eq(partyOpeningBalances.companyId, input.companyId), eq(partyOpeningBalances.id, doc.id)))
    .returning();

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "opening_balance.void",
    entityType: "party_opening_balance",
    entityId: doc.id,
    after: { number: doc.number, amount: doc.amount, reason: input.reason, reversalNumber: reversal.number },
  });
  return updated;
}
