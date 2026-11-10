import { and, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import { accounts, expenses, partyPayments, suppliers } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { d, lineTax, toDb, type MoneyInput } from "@/lib/money";
import { getAccountId, postJournal, reverseSourceJournal } from "@/server/accounting";
import { writeAudit } from "@/server/audit";
import { assertCashLikeAccount } from "@/server/employee-advances";
import { claimIdempotencyKey } from "@/server/idempotency";
import { nextDocumentNumber } from "@/server/sequences";
import { getCompanySettingsRow } from "@/server/settings";

/**
 * Akun beban hanya boleh akun tipe expense yang aktif dan dapat
 * diposting — pola penjaga yang sama dengan kategori reimbursement
 * (R3-03: ditegakkan di domain, bukan hanya dibatasi pilihan UI).
 */
export async function assertExpenseAccount(tx: Tx, companyId: string, accountId: string) {
  const [account] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      isPostable: accounts.isPostable,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.id, accountId)))
    .limit(1);
  if (!account) throw new AppError("VALIDATION", "Akun beban tidak ditemukan di perusahaan ini.");
  if (account.type !== "expense" || !account.isPostable || !account.isActive) {
    throw new AppError(
      "VALIDATION",
      `Akun ${account.code} — ${account.name} tidak dapat menjadi akun beban: harus akun beban (tipe expense) yang aktif dan dapat diposting.`,
    );
  }
  return account;
}

/**
 * Domain pencatatan beban (diekstrak dari createExpenseAction agar modal
 * Catat Transaksi A-12 memakai jalur yang persis sama, dalam transaksi
 * pemanggil): satu dokumen beban + jurnal Dr akun beban / Cr akun
 * pembayaran.
 *
 * A-21 (R3-11): mode terutang — bila `supplierId` diisi (dan akun
 * pembayaran kosong), kredit jurnal adalah akun utang terpeta bertag
 * pemasok dan dokumen beban menjadi dokumen utang: tampil di daftar
 * utang (listPayables, sumber "expense") dan dilunasi lewat
 * payExpensePayable / FIFO bayar utang, persis seperti utang
 * penerimaan dan saldo awal.
 *
 * FIX-P1 Tahap 4 (AK1-06/AK4-04): opsi "Termasuk PPN" menutup kekurangan
 * yang dicatat sejak A-12. Bila `taxIncluded` aktif, nominal adalah
 * nominal BRUTO yang dibayar (termasuk PPN): jurnal terbelah menjadi
 * Dr Beban (DPP) + Dr PPN Masukan (pemetaan `tax_input`) / Cr akun
 * pembayaran (bruto), dan porsi pajak dibekukan di baris beban. Tarif
 * berasal dari `company_settings` perusahaan (diteruskan aksi lewat
 * `effectiveTaxRate`); tarif efektif 0 — PPN nonaktif atau tarif belum
 * diatur — dengan opsi aktif DITOLAK, tidak diabaikan diam-diam.
 */
export async function createExpense(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    date: string;
    expenseAccountId: string;
    /** Mode tunai: akun kas/bank yang dikredit sekarang. Wajib diisi
     * pada mode tunai, harus kosong pada mode terutang. */
    paymentAccountId?: string | null;
    /** Mode terutang (A-21 R3-11): pemasok yang diutangi — beban
     * diakui sekarang, kas keluar belakangan lewat jalur pembayaran
     * utang (payExpensePayable/FIFO). Mengisi ini memilih mode
     * terutang; dokumen lahir sebagai dokumen utang pemasok. */
    supplierId?: string | null;
    amount: MoneyInput;
    description: string;
    /** Nominal termasuk PPN — pisahkan PPN Masukan dari beban. */
    taxIncluded?: boolean;
    /** Tarif PPN perusahaan (persen) saat posting; dari pengaturan. */
    taxRate?: MoneyInput;
    /** Kunci idempotensi klien (R3-04, pola AK-P3-02). */
    idempotencyKey?: string | null;
  },
) {
  // A-21 (R3-04): replay idempotensi — submit ulang berkunci sama
  // (klik ganda, retry sesudah timeout) mengembalikan beban pertama,
  // bukan membuat dokumen kedua. Pola GDG3-06 yang sama dengan form
  // gudang: klaim kunci bersama di dalam transaksi dokumen itu sendiri.
  const idemKey = input.idempotencyKey?.trim() || null;
  const findExpenseByKey = async () => {
    if (!idemKey) return undefined;
    const [row] = await tx
      .select({ id: expenses.id, number: expenses.number })
      .from(expenses)
      .where(and(eq(expenses.companyId, input.companyId), eq(expenses.idempotencyKey, idemKey)))
      .limit(1);
    return row;
  };
  if (idemKey) {
    const existing = await findExpenseByKey();
    if (existing) return { ...existing, warnings: [] as string[] };
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: idemKey,
      scope: "accounting.expense",
    });
    if (!claimed) {
      const winner = await findExpenseByKey();
      if (winner) return { ...winner, warnings: [] as string[] };
      throw new AppError(
        "CONFLICT",
        "Beban dengan kunci yang sama sedang diproses. Coba lagi sebentar.",
      );
    }
  }

  const amount = d(input.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("VALIDATION", "Nominal beban harus lebih dari nol.");
  }

  // A-21 (R3-11): mode dokumen — tunai (akun pembayaran) ATAU
  // terutang (pemasok), tidak pernah keduanya dan tidak pernah
  // tidak keduanya. Mode terutang mengikuti pola pengakuan utang
  // penerimaan pembelian: jurnal mengkredit akun utang terpeta
  // bertag pemasok, dan dokumennya menjadi dokumen utang yang
  // dilunasi lewat party_payments (bukan pulau pencatatan baru).
  const supplierId = input.supplierId ?? null;
  const paymentAccountId = input.paymentAccountId ?? null;
  if (supplierId && paymentAccountId) {
    throw new AppError(
      "VALIDATION",
      "Pilih satu mode beban: dibayar tunai sekarang ATAU terutang ke pemasok — keduanya tidak dapat dipilih bersamaan.",
    );
  }
  if (!supplierId && !paymentAccountId) {
    throw new AppError(
      "VALIDATION",
      "Pilih akun pembayaran untuk beban tunai, atau pemasok untuk beban terutang (belum dibayar).",
    );
  }
  if (supplierId) {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.companyId, input.companyId), eq(suppliers.id, supplierId)))
      .limit(1);
    if (!supplier) throw new AppError("NOT_FOUND", "Pemasok tidak ditemukan di perusahaan ini.");
  }

  const taxIncluded = input.taxIncluded ?? false;
  const taxRate = taxIncluded ? d(input.taxRate ?? 0) : d(0);
  if (taxIncluded && (!taxRate.isFinite() || taxRate.lte(0))) {
    throw new AppError(
      "VALIDATION",
      "Opsi \"Termasuk PPN\" dipilih, tetapi PPN perusahaan sedang nonaktif atau tarifnya 0. Aktifkan PPN dan atur tarifnya di Pengaturan, atau matikan opsi tersebut.",
    );
  }
  const tax = taxIncluded ? lineTax({ net: amount, rate: taxRate, inclusive: true }) : d(0);
  const netAmount = amount.minus(tax);
  // Pemetaan wajib ada sebelum apa pun ditulis — akun tidak ditebak.
  const taxInputAccountId = tax.gt(0)
    ? await getAccountId(tx, input.companyId, "tax_input")
    : null;

  // A-21 (R3-03): penjaga domain yang sama seperti jalur kasbon,
  // pinjaman, dan klaim — akun beban harus akun tipe expense yang
  // layak, dan akun pembayaran harus akun kas/bank/QRIS terpetakan.
  // Pilihan UI memang membatasi, tetapi domain tidak memercayai klien.
  // Mode terutang tidak punya akun pembayaran: kreditnya adalah akun
  // utang terpeta, diselesaikan sebelum penulisan apa pun (pola
  // tax_input di atas — akun tidak ditebak).
  await assertExpenseAccount(tx, input.companyId, input.expenseAccountId);
  if (paymentAccountId) {
    await assertCashLikeAccount(tx, input.companyId, paymentAccountId);
  }
  const payableAccountId = supplierId
    ? await getAccountId(tx, input.companyId, "payable")
    : null;

  const number = await nextDocumentNumber(tx, input.companyId, "EXPENSE", input.date);
  const [expense] = await tx
    .insert(expenses)
    .values({
      companyId: input.companyId,
      number,
      date: input.date,
      expenseAccountId: input.expenseAccountId,
      paymentAccountId,
      supplierId,
      idempotencyKey: idemKey,
      amount: toDb(amount),
      // Beban tunai lahir terbayar penuh (pola penerimaan tunai D-5);
      // beban terutang lahir belum dibayar sama sekali.
      paidAmount: supplierId ? "0" : toDb(amount),
      paymentStatus: supplierId ? "unpaid" : "paid",
      taxRate: toDb(taxRate),
      taxAmount: toDb(tax),
      description: input.description,
      createdBy: input.userId,
    })
    .returning({ id: expenses.id, number: expenses.number });

  const journal = await postJournal(tx, {
    companyId: input.companyId,
    date: input.date,
    description: `Beban ${number} — ${input.description}`,
    sourceType: "expense",
    sourceId: expense.id,
    createdBy: input.userId,
    idempotencyKey: `expense:${expense.id}`,
    lines: [
      { accountId: input.expenseAccountId, debit: netAmount, description: input.description },
      ...(taxInputAccountId
        ? [{ accountId: taxInputAccountId, debit: tax, description: "PPN masukan atas beban" }]
        : []),
      ...(supplierId
        ? [
            {
              accountId: payableAccountId!,
              credit: amount,
              description: "Utang beban ke pemasok",
              partyType: "supplier" as const,
              partyId: supplierId,
            },
          ]
        : [
            {
              accountId: paymentAccountId!,
              credit: amount,
              description: "Pembayaran beban",
            },
          ]),
    ],
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "expense.create",
    entityType: "expense",
    entityId: expense.id,
    after: {
      number,
      amount: toDb(amount),
      ...(tax.gt(0) ? { taxAmount: toDb(tax) } : {}),
      ...(supplierId ? { mode: "accrual", supplierId } : {}),
    },
  });
  // FIX-R2 Tahap 3 (RV2-01): peringatan penjaga saldo kas/bank diteruskan
  // ke hasil aksi agar tampil di UI (mode warn); kosong pada mode lain.
  return { ...expense, warnings: journal.warnings };
}

/**
 * Tarif PPN efektif perusahaan untuk jalur yang memisahkan pajak:
 * "0" bila PPN nonaktif — pola yang sama seperti penjualan tunai
 * cepat (SIM-2 S2: saklar ditegakkan di server, bukan hanya UI).
 */
export async function effectiveTaxRate(tx: Tx, companyId: string): Promise<string> {
  const settings = await getCompanySettingsRow(tx, companyId);
  return settings?.taxEnabled ? (settings?.taxRate ?? "0") : "0";
}

/**
 * A-26 Q4 (K-03): pembatalan beban — dipindah utuh dari
 * voidExpenseAction; lapisan aksi kini hanya auth, parsing, dan
 * revalidasi. Perilaku & pesan identik dengan blok transaksi lama.
 */
export async function voidExpense(
  tx: Tx,
  input: { companyId: string; userId: string; expenseId: string; reason: string },
) {
  const [expense] = await tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, input.expenseId)))
    .limit(1);
  if (!expense) throw new AppError("NOT_FOUND", "Beban tidak ditemukan.");
  if (expense.status === "void") throw new AppError("INVALID_STATE", "Beban sudah dibatalkan.");

  // A-21 (R3-11): beban terutang yang sudah memiliki pembayaran
  // aktif tidak boleh di-void langsung — reverseSourceJournal
  // hanya membalik jurnal akrualnya, sedangkan jurnal pembayaran
  // (sumber "payment") akan tertinggal dan membuat utang GL
  // negatif. Batalkan pembayarannya dulu (pola void dokumen
  // induk lain), baru beban dapat dibatalkan.
  if (expense.supplierId) {
    const activePayments = await tx
      .select({ id: partyPayments.id })
      .from(partyPayments)
      .where(
        and(
          eq(partyPayments.companyId, input.companyId),
          eq(partyPayments.expenseId, expense.id),
          ne(partyPayments.status, "void"),
        ),
      )
      .limit(1);
    if (activePayments.length > 0) {
      throw new AppError(
        "VALIDATION",
        `Beban ${expense.number} adalah beban terutang yang sudah memiliki pembayaran. Batalkan pembayaran utangnya terlebih dahulu dari halaman Piutang & Utang, lalu batalkan bebannya.`,
      );
    }
  }

  // AK-P2-05: reverseSourceJournal mengembalikan null bila jurnal asal
  // tidak ditemukan (sudah dibalik jalur lain / data lama). Hasil null
  // TIDAK boleh ditelan: tanpa jurnal pembalik, menandai beban void akan
  // membuat daftar beban dan buku besar berbeda diam-diam. Batalkan void.
  const reversal = await reverseSourceJournal(tx, {
    companyId: input.companyId,
    sourceType: "expense",
    sourceId: expense.id,
    date: todayISO(),
    description: `Pembatalan beban ${expense.number} — ${input.reason}`,
    createdBy: input.userId,
  });
  if (!reversal) {
    throw new AppError(
      "VALIDATION",
      `Jurnal asal beban ${expense.number} tidak ditemukan, sehingga jurnal pembalik tidak dapat dibuat. Pembatalan beban dibatalkan agar daftar beban dan buku besar tetap selaras; periksa jurnal beban ini terlebih dahulu.`,
    );
  }
  await tx
    .update(expenses)
    .set({ status: "void" })
    .where(and(eq(expenses.companyId, input.companyId), eq(expenses.id, input.expenseId)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "expense.void",
    entityType: "expense",
    entityId: expense.id,
    after: { number: expense.number, reason: input.reason },
  });
}
