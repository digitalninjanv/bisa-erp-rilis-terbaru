// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.

import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { branches, cashMovements, cashSessions } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import { getAccountMap, postJournal } from "@/server/accounting";
import { getCompanySettingsRow } from "@/server/settings";
import { writeAudit } from "@/server/audit";
import {
  claimIdempotencyKey,
  paymentRequestFingerprint,
  readIdempotencyResultRef,
  writeIdempotencyResultRef,
} from "@/server/idempotency";
import { todayISO } from "@/lib/format";

function uniqueViolationConstraint(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (e.code === "23505") return e.constraint_name ?? "";
    current = e.cause;
  }
  return null;
}


export async function openCashSession(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    branchId?: string | null;
    openingCash: string | number;
    sessionId?: string;
    openedAt?: string;
  },
) {
  // MD-006: validasi cabang milik perusahaan yang aktif
  if (input.branchId) {
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.companyId, input.companyId), eq(branches.id, input.branchId)))
      .limit(1);
    if (!branch) {
      throw new AppError("VALIDATION", "Cabang tidak ditemukan di perusahaan ini.");
    }
  }

  // Terminal POS dapat membuka sesi saat offline dan mengirim intent
  // kemudian. ID lokal dipakai sebagai ID server agar penjualan antrean
  // tetap menunjuk sesi asal yang sama. Retry identik harus aman.
  if (input.sessionId) {
    const [sameSession] = await tx
      .select({ id: cashSessions.id, userId: cashSessions.userId, status: cashSessions.status })
      .from(cashSessions)
      .where(and(eq(cashSessions.companyId, input.companyId), eq(cashSessions.id, input.sessionId)))
      .limit(1)
      .for("update");
    if (sameSession) {
      if (sameSession.userId !== input.userId) {
        throw new AppError("CONFLICT", "ID sesi kas terminal sudah digunakan oleh kasir lain.");
      }
      if (sameSession.status !== "open") {
        throw new AppError(
          "INVALID_STATE",
          "Sesi kas terminal ini sudah ditutup. Buka sesi baru untuk melanjutkan.",
        );
      }
      return { id: sameSession.id };
    }
  }

  const [existing] = await tx
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.companyId, input.companyId),
        eq(cashSessions.userId, input.userId),
        eq(cashSessions.status, "open"),
      ),
    )
    .limit(1);
  if (existing) throw new AppError("INVALID_STATE", "Anda masih memiliki sesi terbuka.");
  const opening = d(input.openingCash);
  if (opening.lt(0)) throw new AppError("VALIDATION", "Kas awal tidak boleh negatif.");
  // POS-SES-01: the pre-check above races, so the partial unique index
  // (migration 0012) is the real guard; translate its violation into the
  // same friendly rejection instead of a raw database error.
  let session: { id: string };
  try {
    const [row] = await tx
      .insert(cashSessions)
      .values({
        id: input.sessionId,
        openedAt: input.openedAt ? new Date(input.openedAt) : undefined,
        companyId: input.companyId,
        userId: input.userId,
        branchId: input.branchId ?? null,
        openingCash: toDb(opening),
        status: "open",
      })
      .returning({ id: cashSessions.id });
    session = row;
  } catch (error) {
    if (uniqueViolationConstraint(error) === "cash_sessions_one_open_per_user_uq") {
      throw new AppError("INVALID_STATE", "Anda masih memiliki sesi terbuka.");
    }
    throw error;
  }
  await tx.insert(cashMovements).values({
    companyId: input.companyId,
    sessionId: session.id,
    type: "opening",
    amount: toDb(opening),
    createdBy: input.userId,
  });
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.session.open",
    entityType: "cash_session",
    entityId: session.id,
    after: { openingCash: toDb(opening) },
  });
  return session;
}


/**
 * Pratinjau tutup sesi dua fase: hitung `expected` di server TANPA
 * mengirimkannya ke terminal sampai kasir menyerahkan hitungan fisik.
 * Dipakai aksi `prepareSessionCloseAction`; tidak mengubah state.
 */
export async function previewCashSession(
  tx: Tx,
  input: { companyId: string; userId: string; sessionId: string },
) {
  const [session] = await tx
    .select({
      id: cashSessions.id,
      userId: cashSessions.userId,
      status: cashSessions.status,
    })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.companyId, input.companyId),
        eq(cashSessions.id, input.sessionId),
        eq(cashSessions.userId, input.userId),
      ),
    )
    .limit(1);
  if (!session) throw new AppError("NOT_FOUND", "Sesi kas tidak ditemukan.");
  if (session.status !== "open") throw new AppError("INVALID_STATE", "Sesi kas sudah ditutup.");
  const [movement] = await tx
    .select({ total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)` })
    .from(cashMovements)
    .where(eq(cashMovements.sessionId, session.id));
  const settingsRow = await getCompanySettingsRow(tx, input.companyId);
  return {
    session,
    expected: d(movement?.total),
    tolerance: d(settingsRow?.posSessionDifferenceTolerance ?? "0"),
  };
}

export async function closeCashSession(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    sessionId: string;
    countedCash: string | number;
    notes?: string;
    differenceReason?: string;
    /** Supervisor force-close: target session may belong to another cashier. */
    allowAnyUser?: boolean;
    /** Nilai expected yang disetujui saat hitungan dikunci (token preview). */
    expectedGuard?: string | number;
  },
) {
  // POS-SES-01: a cashier can only close their OWN session. Filtering by
  // the actor makes a foreign session indistinguishable from a missing
  // one (NOT_FOUND), so its existence is not leaked. A supervisor with
  // pos.void may explicitly force-close any session (audited).
  const sessionConditions = [
    eq(cashSessions.companyId, input.companyId),
    eq(cashSessions.id, input.sessionId),
    ...(input.allowAnyUser ? [] : [eq(cashSessions.userId, input.userId)]),
  ];
  const [session] = await tx
    .select()
    .from(cashSessions)
    .where(and(...sessionConditions))
    .limit(1)
    .for("update");
  if (!session) throw new AppError("NOT_FOUND", "Sesi kas tidak ditemukan.");
  if (session.status !== "open") throw new AppError("INVALID_STATE", "Sesi kas sudah ditutup.");

  // Pesanan ditahan dimiliki oleh kasir pembuatnya (`sales.cashier_id`).
  // Sesi kasir ini hanya boleh tertahan oleh pesanan milik kasir yang sama.
  const heldCount = await countHeldSales(tx, input.companyId, session.userId);
  if (heldCount > 0) {
    throw new AppError(
      "INVALID_STATE",
      `Tidak dapat menutup sesi kas: Anda masih memiliki ${heldCount} pesanan tertahan. Buka Pesanan Ditahan (/app/pos/ditahan), lanjutkan atau batalkan pesanan milik Anda, lalu tutup kembali sesi.`,
    );
  }

  const [movement] = await tx
    .select({ total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)` })
    .from(cashMovements)
    .where(eq(cashMovements.sessionId, session.id));
  const expected = d(movement?.total);
  if (input.expectedGuard != null && !expected.eq(d(input.expectedGuard))) {
    throw new AppError(
      "CONFLICT",
      "Mutasi kas berubah setelah hitungan dikunci. Hitung ulang dan tinjau kembali sebelum menutup sesi.",
    );
  }
  const counted = d(input.countedCash);
  if (counted.lt(0)) {
    throw new AppError("VALIDATION", "Uang dihitung tidak boleh negatif.");
  }
  const difference = counted.minus(expected);

  // A-28 Tahap 1 (H-POS-02): disiplin selisih tutup sesi ditegakkan di
  // server, bukan hanya UI. Selisih yang nilai mutlaknya MELEWATI
  // toleransi perusahaan (pengaturan; bawaan Rp0 = semua selisih)
  // wajib disertai alasan tertulis — penolakan terjadi SEBELUM sesi
  // berubah keadaan, sehingga kasir dapat melengkapi alasan dan
  // mencoba lagi. Di dalam toleransi alasan opsional. Jurnal selisih
  // (cash_over/cash_short) di bawah tidak berubah.
  const settingsRow = await getCompanySettingsRow(tx, input.companyId);
  const tolerance = d(settingsRow?.posSessionDifferenceTolerance ?? "0");
  const differenceReason = input.differenceReason?.trim() ?? "";
  if (difference.abs().gt(tolerance) && differenceReason === "") {
    throw new AppError(
      "VALIDATION",
      `Selisih kas Rp${difference.abs().toFixed(0)} melewati toleransi selisih Rp${tolerance.toFixed(0)}. Alasan selisih wajib diisi sebelum sesi ditutup.`,
    );
  }

  await tx
    .update(cashSessions)
    .set({
      status: "closed",
      closedAt: new Date(),
      expectedCash: toDb(expected),
      countedCash: toDb(counted),
      difference: toDb(difference),
      notes: input.notes,
      differenceReason: differenceReason === "" ? null : differenceReason,
    })
    .where(and(eq(cashSessions.companyId, input.companyId), eq(cashSessions.id, session.id)));

  if (!difference.eq(0)) {
    const map = await getAccountMap(tx, input.companyId);
    await postJournal(tx, {
      companyId: input.companyId,
      date: todayISO(),
      description: `Selisih kas sesi ${session.id.slice(0, 8)}`,
      sourceType: "cash_session",
      sourceId: session.id,
      createdBy: input.userId,
      idempotencyKey: `cash_session:${session.id}`,
      lines: difference.gt(0)
        ? [
            { accountId: map.cash, debit: difference, description: "Kas lebih" },
            { accountId: map.cash_over, credit: difference, description: "Selisih kas lebih" },
          ]
        : [
            { accountId: map.cash_short, debit: difference.abs(), description: "Selisih kas kurang" },
            { accountId: map.cash, credit: difference.abs(), description: "Kas kurang" },
          ],
    });
  }

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "pos.session.close",
    entityType: "cash_session",
    entityId: session.id,
    after: {
      expected: toDb(expected),
      counted: toDb(counted),
      difference: toDb(difference),
      differenceReason: differenceReason === "" ? null : differenceReason,
      differenceTolerance: toDb(tolerance),
      targetUserId: session.userId,
      forced: Boolean(input.allowAnyUser && session.userId !== input.userId),
    },
  });

  return { expected: expected.toNumber(), counted: counted.toNumber(), difference: difference.toNumber() };
}


export async function cashDrawerMovement(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    sessionId: string;
    type: "deposit" | "withdrawal";
    amount: string | number;
    notes?: string;
    idempotencyKey?: string;
  },
) {
  let idempotencyFingerprint: string | null = null;
  if (input.idempotencyKey) {
    // Retry setelah respons hilang: mutasi yang sudah commit tidak
    // diulang. Fingerprint membedakan retry identik dari pemakaian ulang
    // kunci untuk data berbeda (mis. nominal diubah setelah error).
    const fingerprint = paymentRequestFingerprint({
      userId: input.userId,
      sessionId: input.sessionId,
      type: input.type,
      amount: toDb(d(input.amount)),
      notes: input.notes?.trim() ?? "",
    });
    const readReplay = async (): Promise<boolean> => {
      const stored = await readIdempotencyResultRef(tx, {
        companyId: input.companyId,
        key: input.idempotencyKey!,
        scope: "pos.cash_movement",
      });
      if (!stored) return false;
      try {
        const parsed = JSON.parse(stored) as {
          type?: string;
          fingerprint?: string;
        };
        if (parsed?.type === "pos.cash_movement.result") {
          if (parsed.fingerprint !== fingerprint) {
            throw new AppError(
              "CONFLICT",
              "Kunci mutasi kas sudah dipakai untuk data yang berbeda.",
            );
          }
          return true;
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        // Baris lama menyimpan ID movement mentah; perlakukan sebagai
        // replay tanpa fingerprint (tidak bisa dibandingkan).
      }
      return true;
    };
    if (await readReplay()) return;
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: input.idempotencyKey,
      scope: "pos.cash_movement",
    });
    if (!claimed) {
      if (await readReplay()) return;
      throw new AppError("CONFLICT", "Mutasi kas dengan kunci ini sedang diproses.");
    }
    // Simpan fingerprint setelah movement dibuat; variabel dipakai di
    // bagian akhir fungsi. Klaim tanpa hasil tetap dianggap kegagalan lama
    // dan akan dilepas oleh rollback transaksi.
    idempotencyFingerprint = fingerprint;
  }
  // POS-SES-01: drawer movements are likewise limited to the actor's
  // own session; a foreign session reads as "not active", like a closed
  // or missing one.
  // POS1-03: baris sesi dikunci FOR UPDATE — pemeriksaan saldo laci di
  // bawah harus menilai keadaan yang sama dengan yang akan ditambah
  // mutasinya, dan terserialisasi terhadap mutasi/penutupan sesi lain.
  const [session] = await tx
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.companyId, input.companyId),
        eq(cashSessions.id, input.sessionId),
        eq(cashSessions.userId, input.userId),
      ),
    )
    .limit(1)
    .for("update");
  if (!session || session.status !== "open") throw new AppError("INVALID_STATE", "Sesi kas tidak aktif.");
  const amount = d(input.amount);
  if (amount.lte(0)) throw new AppError("VALIDATION", "Jumlah harus lebih dari nol.");

  // POS1-03: setoran adalah uang yang FISIK keluar dari laci ke bank,
  // jadi nominalnya tidak boleh melebihi isi laci sesi saat ini
  // (modal awal + seluruh mutasi sesi — definisi yang sama dengan
  // expectedCash saat tutup sesi). Tanpa plafon ini, setoran fiktif
  // menaikkan saldo bank GL dan tutup sesi sesudahnya mengarang
  // pendapatan "selisih kas lebih" sebesar kekurangannya. Penarikan
  // (uang masuk dari bank) tidak dibatasi: kedatangannya dapat
  // diverifikasi dari mutasi bank, bukan dari isi laci.
  if (input.type === "deposit") {
    const [movement] = await tx
      .select({ total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)` })
      .from(cashMovements)
      .where(eq(cashMovements.sessionId, session.id));
    const drawerBalance = d(movement?.total);
    if (amount.gt(drawerBalance)) {
      throw new AppError(
        "VALIDATION",
        `Setoran Rp${amount.toFixed(0)} melebihi saldo laci sesi saat ini Rp${drawerBalance.toFixed(0)}. Setoran tidak dapat melebihi uang tunai yang benar-benar ada di laci.`,
      );
    }
  }
  const signed = input.type === "deposit" ? amount.neg() : amount;

  const [movement] = await tx.insert(cashMovements).values({
    companyId: input.companyId,
    sessionId: session.id,
    type: input.type,
    amount: toDb(signed),
    notes: input.notes,
    createdBy: input.userId,
  }).returning({ id: cashMovements.id });

  const map = await getAccountMap(tx, input.companyId);
  await postJournal(tx, {
    companyId: input.companyId,
    date: todayISO(),
    description: input.type === "deposit" ? "Setoran kas ke bank" : "Penarikan kas dari bank",
    sourceType: "cash_movement",
    sourceId: session.id,
    createdBy: input.userId,
    idempotencyKey: `cash_movement:${crypto.randomUUID()}`,
    lines:
      input.type === "deposit"
        ? [
            { accountId: map.bank, debit: amount, description: "Setoran bank" },
            { accountId: map.cash, credit: amount, description: "Kas keluar" },
          ]
        : [
            { accountId: map.cash, debit: amount, description: "Kas masuk" },
            { accountId: map.bank, credit: amount, description: "Penarikan bank" },
          ],
  });

  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: `pos.cash.${input.type}`,
    entityType: "cash_session",
    entityId: session.id,
    after: { amount: toDb(amount) },
  });

  if (input.idempotencyKey && idempotencyFingerprint) {
    await writeIdempotencyResultRef(tx, {
      companyId: input.companyId,
      key: input.idempotencyKey,
      scope: "pos.cash_movement",
      resultRef: JSON.stringify({
        type: "pos.cash_movement.result",
        fingerprint: idempotencyFingerprint,
        movementId: movement.id,
      }),
    });
  }
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman (FIX-ARS Tahap 6, ARS1-01): dua kueri SQL mentah
// yang dulu inline di halaman terminal POS kini tinggal di modul sesi;
// semantiknya dipindah apa adanya.
// ---------------------------------------------------------------------------

export async function getOpenCashSession(tx: Tx, companyId: string, userId: string) {
  const [row] = await tx
    .select({
      id: cashSessions.id,
      openingCash: cashSessions.openingCash,
      openedAt: cashSessions.openedAt,
      branchId: cashSessions.branchId,
      branchName: branches.name,
    })
    .from(cashSessions)
    .leftJoin(branches, eq(cashSessions.branchId, branches.id))
    .where(
      and(
        eq(cashSessions.companyId, companyId),
        eq(cashSessions.userId, userId),
        eq(cashSessions.status, "open"),
      ),
    )
    .orderBy(desc(cashSessions.openedAt))
    .limit(1);
  return row ?? null;
}

export async function countHeldSales(tx: Tx, companyId: string, cashierId?: string) {
  const cashierFilter = cashierId ? sql`and cashier_id = ${cashierId}` : sql``;
  const rows = (await tx.execute(sql`
    select count(*)::int as value from sales
    where company_id = ${companyId} and status = 'held' ${cashierFilter}
  `)) as unknown as { value: number }[];
  return rows[0]?.value ?? 0;
}
