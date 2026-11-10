// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.

import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { cashMovements, cashSessions } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, toDb } from "@/lib/money";
import { getAccountMap, postJournal } from "@/server/accounting";
import { getCompanySettingsRow } from "@/server/settings";
import { writeAudit } from "@/server/audit";
import { claimIdempotencyKey } from "@/server/idempotency";
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
  input: { companyId: string; userId: string; branchId?: string | null; openingCash: string | number },
) {
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


export async function closeCashSession(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    sessionId: string;
    countedCash: string | number;
    notes?: string;
    differenceReason?: string;
  },
) {
  // POS-SES-01: a cashier can only close their OWN session. Filtering by
  // the actor makes a foreign session indistinguishable from a missing
  // one (NOT_FOUND), so its existence is not leaked.
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
  if (!session) throw new AppError("NOT_FOUND", "Sesi kas tidak ditemukan.");
  if (session.status !== "open") throw new AppError("INVALID_STATE", "Sesi kas sudah ditutup.");

  const [movement] = await tx
    .select({ total: sql<string>`coalesce(sum(${cashMovements.amount}), 0)` })
    .from(cashMovements)
    .where(eq(cashMovements.sessionId, session.id));
  const expected = d(movement?.total);
  const counted = d(input.countedCash);
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
  if (input.idempotencyKey) {
    const claimed = await claimIdempotencyKey(tx, {
      companyId: input.companyId,
      key: input.idempotencyKey,
      scope: "pos.cash_movement",
    });
    if (!claimed) {
      throw new AppError("CONFLICT", "Mutasi kas dengan kunci ini sedang diproses.");
    }
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

  await tx.insert(cashMovements).values({
    companyId: input.companyId,
    sessionId: session.id,
    type: input.type,
    amount: toDb(signed),
    notes: input.notes,
    createdBy: input.userId,
  });

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
    })
    .from(cashSessions)
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

export async function countHeldSales(tx: Tx, companyId: string) {
  const rows = (await tx.execute(sql`
    select count(*)::int as value from sales
    where company_id = ${companyId} and status = 'held'
  `)) as unknown as { value: number }[];
  return rows[0]?.value ?? 0;
}
