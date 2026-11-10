import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  member,
  posPairingCodes,
  posTerminalSessionReviews,
  posTerminals,
  user,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";

/**
 * Registry terminal POS desktop (POS Native Langkah 6, RENCANA-TAURI
 * D5/D7) — pemilik tunggal tabel `pos_terminals`,
 * `pos_pairing_codes`, dan `pos_terminal_session_reviews`
 * (kontrak kepemilikan tulis: semua insert/update/delete ketiga
 * tabel hidup di berkas ini; aksi admin & lapisan API perangkat
 * memanggil fungsi di sini).
 *
 * Model keamanan:
 * - Token perangkat & kode pasangan adalah rahasia acak entropi
 *   tinggi; server hanya menyimpan digest SHA-256 (hex). Kode
 *   pasangan teks hanya ada SATU KALI — pada respons aksi yang
 *   menerbitkannya.
 * - Autentikasi perangkat bersifat PRA-TENANT: token harus
 *   diresolusi menjadi perusahaan sebelum `withCompany` bisa
 *   berjalan. Resolusi memakai transaksi khusus yang memasang
 *   pengaturan transaksi-lokal `app.device_digest`; kebijakan RLS
 *   `device_digest_lookup`/`pairing_digest_lookup` (migrasi 0060)
 *   lalu membuka TEPAT satu baris yang digest-nya cocok untuk
 *   SELECT. Begitu companyId baris itu diketahui, transaksi yang
 *   sama memasang `app.company_id` dan semua tulis berikutnya
 *   berjalan di bawah kebijakan tenant biasa.
 * - Terminal yang dicabut (status `revoked`) berhenti bekerja pada
 *   panggilan berikutnya: resolusi hanya menerima status `active`.
 */

// ---------------------------------------------------------------------------
// Tipe bersama
// ---------------------------------------------------------------------------

export type PosTerminalIdentity = {
  terminalId: string;
  companyId: string;
  /** Anggota perusahaan yang menjadi aktor penyinkron terminal. */
  userId: string;
  terminalName: string;
  /** Gudang terminal; null = gudang bawaan perusahaan. */
  warehouseId: string | null;
};

export type PosTerminalRow = {
  id: string;
  name: string;
  warehouseId: string | null;
  warehouseName: string | null;
  userId: string;
  status: string;
  paired: boolean;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
};

export type PosTerminalSessionReviewRow = {
  id: string;
  terminalId: string;
  terminalName: string;
  cashierId: string | null;
  localSessionId: string;
  openedAt: Date | null;
  closedAt: Date;
  openingCash: string;
  expectedCash: string;
  countedCash: string;
  difference: string;
  differenceReason: string | null;
  receivedAt: Date;
};

export type TerminalSessionCloseIntent = {
  clientKey: string;
  warehouseId: string;
  cashierId?: string | null;
  localSessionId: string;
  openedAt?: string | null;
  closedAt: string;
  openingCash: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  denominations?: Array<{ denomination: string; count: number }> | null;
  differenceReason?: string | null;
};

const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;
/** Sentuhan last_seen_at paling sering sekali per jendela ini. */
const LAST_SEEN_TOUCH_MS = 5 * 60 * 1000;
/** Alfabet kode pasangan: tanpa karakter yang mudah tertukar. */
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function digestSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function generatePairingCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (let i = 0; i < 10; i += 1) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
    if (i === 4) code += "-";
  }
  return code;
}

function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------------------
// Administrasi (konteks tenant — dipanggil aksi admin)
// ---------------------------------------------------------------------------

export async function createPosTerminal(
  tx: Tx,
  input: {
    companyId: string;
    name: string;
    warehouseId: string | null;
    userId: string;
    createdBy: string;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(posTerminals)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      name: input.name,
      userId: input.userId,
      createdBy: input.createdBy,
    })
    .returning({ id: posTerminals.id });
  return { id: row.id };
}

export async function listPosTerminals(
  tx: Tx,
  companyId: string,
): Promise<PosTerminalRow[]> {
  const rows = await tx
    .select({
      id: posTerminals.id,
      name: posTerminals.name,
      warehouseId: posTerminals.warehouseId,
      warehouseName: warehouses.name,
      userId: posTerminals.userId,
      status: posTerminals.status,
      tokenDigest: posTerminals.tokenDigest,
      pairedAt: posTerminals.pairedAt,
      lastSeenAt: posTerminals.lastSeenAt,
      createdAt: posTerminals.createdAt,
    })
    .from(posTerminals)
    .leftJoin(warehouses, eq(warehouses.id, posTerminals.warehouseId))
    .where(eq(posTerminals.companyId, companyId))
    .orderBy(desc(posTerminals.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    userId: row.userId,
    status: row.status,
    paired: row.tokenDigest !== null,
    pairedAt: row.pairedAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  }));
}

/** Pilihan aktor terminal untuk form admin: anggota perusahaan
 *  (userId + nama + peran) — aktor inilah yang menjadi pemilik
 *  penyinkronan penjualan terminal di server. */
export async function listTerminalActorOptions(
  tx: Tx,
  companyId: string,
): Promise<Array<{ userId: string; name: string; role: string }>> {
  return tx
    .select({ userId: member.userId, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, companyId))
    .orderBy(user.name);
}

export async function revokePosTerminal(
  tx: Tx,
  input: { companyId: string; terminalId: string },
): Promise<void> {
  const [row] = await tx
    .update(posTerminals)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(posTerminals.companyId, input.companyId),
        eq(posTerminals.id, input.terminalId),
      ),
    )
    .returning({ id: posTerminals.id });
  if (!row) throw new AppError("NOT_FOUND", "Terminal tidak ditemukan.");
}

/**
 * Terbitkan kode pasangan sekali pakai (15 menit) untuk terminal.
 * Kode yang belum terpakai sebelumnya untuk terminal yang sama
 * DIBAKAR (ditandai terpakai) — hanya kode terakhir yang hidup.
 * Mengembalikan kode TEKS satu-satunya kali; server hanya menyimpan
 * digest-nya.
 */
export async function issuePairingCode(
  tx: Tx,
  input: { companyId: string; terminalId: string; createdBy: string },
): Promise<{ code: string; expiresAt: Date }> {
  const [terminal] = await tx
    .select({ id: posTerminals.id, status: posTerminals.status })
    .from(posTerminals)
    .where(
      and(
        eq(posTerminals.companyId, input.companyId),
        eq(posTerminals.id, input.terminalId),
      ),
    )
    .limit(1);
  if (!terminal) throw new AppError("NOT_FOUND", "Terminal tidak ditemukan.");
  if (terminal.status !== "active") {
    throw new AppError("INVALID_STATE", "Terminal yang dicabut tidak dapat dipasangkan.");
  }
  const now = new Date();
  await tx
    .update(posPairingCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(posPairingCodes.terminalId, input.terminalId),
        isNull(posPairingCodes.usedAt),
      ),
    );
  const code = generatePairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  await tx.insert(posPairingCodes).values({
    companyId: input.companyId,
    terminalId: input.terminalId,
    codeDigest: digestSecret(code),
    expiresAt,
    createdBy: input.createdBy,
  });
  return { code, expiresAt };
}

// ---------------------------------------------------------------------------
// Resolusi pra-tenant (token & kode pasangan)
// ---------------------------------------------------------------------------

/**
 * Resolusi token pembawa → identitas terminal, atau null. Berjalan
 * dalam satu transaksi khusus di luar `withCompany` (lihat kepala
 * berkas): pasang digest → SELECT lewat kebijakan digest → pasang
 * company_id → sentuh last_seen_at (terjeda 5 menit) di bawah
 * kebijakan tenant.
 */
export async function resolvePosTerminalByToken(
  token: string,
): Promise<PosTerminalIdentity | null> {
  const digest = digestSecret(token.trim());
  if (!token.trim()) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.device_digest', ${digest}, true)`);
    const [terminal] = await tx
      .select({
        id: posTerminals.id,
        companyId: posTerminals.companyId,
        userId: posTerminals.userId,
        name: posTerminals.name,
        warehouseId: posTerminals.warehouseId,
        status: posTerminals.status,
        lastSeenAt: posTerminals.lastSeenAt,
      })
      .from(posTerminals)
      .where(eq(posTerminals.tokenDigest, digest))
      .limit(1);
    if (!terminal || terminal.status !== "active") return null;
    await tx.execute(
      sql`select set_config('app.company_id', ${terminal.companyId}, true)`,
    );
    const stale =
      !terminal.lastSeenAt ||
      Date.now() - terminal.lastSeenAt.getTime() > LAST_SEEN_TOUCH_MS;
    if (stale) {
      await tx
        .update(posTerminals)
        .set({ lastSeenAt: new Date() })
        .where(eq(posTerminals.id, terminal.id));
    }
    return {
      terminalId: terminal.id,
      companyId: terminal.companyId,
      userId: terminal.userId,
      terminalName: terminal.name,
      warehouseId: terminal.warehouseId,
    };
  });
}

export type PairingResult = {
  token: string;
  terminal: PosTerminalIdentity;
};

/**
 * Tukar kode pasangan → token perangkat per-terminal. Kode hangus
 * dalam transaksi yang sama (used_at terisi + token lama terminal
 * tergantikan, sehingga pemasangan ulang mencabut token
 * sebelumnya). Kode tidak dikenal / sudah terpakai / kedaluwarsa /
 * terminal dicabut → null (pemanggil menjawab 401 seragam, tanpa
 * membedakan sebab).
 */
export async function consumePairingCode(rawCode: string): Promise<PairingResult | null> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;
  const digest = digestSecret(code);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.device_digest', ${digest}, true)`);
    const [pairing] = await tx
      .select({
        id: posPairingCodes.id,
        companyId: posPairingCodes.companyId,
        terminalId: posPairingCodes.terminalId,
        expiresAt: posPairingCodes.expiresAt,
        usedAt: posPairingCodes.usedAt,
      })
      .from(posPairingCodes)
      .where(eq(posPairingCodes.codeDigest, digest))
      .limit(1);
    if (!pairing || pairing.usedAt) return null;
    if (pairing.expiresAt.getTime() <= Date.now()) return null;
    await tx.execute(
      sql`select set_config('app.company_id', ${pairing.companyId}, true)`,
    );
    const [terminal] = await tx
      .select({
        id: posTerminals.id,
        userId: posTerminals.userId,
        name: posTerminals.name,
        warehouseId: posTerminals.warehouseId,
        status: posTerminals.status,
      })
      .from(posTerminals)
      .where(eq(posTerminals.id, pairing.terminalId))
      .limit(1);
    if (!terminal || terminal.status !== "active") return null;
    const token = generateDeviceToken();
    const now = new Date();
    await tx
      .update(posTerminals)
      .set({
        tokenDigest: digestSecret(token),
        pairedAt: now,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(posTerminals.id, terminal.id));
    await tx
      .update(posPairingCodes)
      .set({ usedAt: now })
      .where(eq(posPairingCodes.id, pairing.id));
    return {
      token,
      terminal: {
        terminalId: terminal.id,
        companyId: pairing.companyId,
        userId: terminal.userId,
        terminalName: terminal.name,
        warehouseId: terminal.warehouseId,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Catatan peninjauan tutup sesi terminal (intent cash_session_close)
// ---------------------------------------------------------------------------

/**
 * Catat intent tutup sesi terminal sebagai bahan peninjauan admin.
 * IDEMPOTEN per (company, terminal, clientKey): pengiriman ulang
 * intent yang sama → "duplicate" tanpa baris kedua. Ini FAKTA
 * peninjauan — tidak ada jurnal dan tidak ada baris cash_sessions
 * server yang dibuat darinya; sesi web tetap pemilik posting sesi.
 */
export async function recordTerminalSessionClose(
  tx: Tx,
  input: { companyId: string; terminalId: string; intent: TerminalSessionCloseIntent },
): Promise<"recorded" | "duplicate"> {
  const intent = input.intent;
  const inserted = await tx
    .insert(posTerminalSessionReviews)
    .values({
      companyId: input.companyId,
      terminalId: input.terminalId,
      clientKey: intent.clientKey,
      warehouseId: intent.warehouseId,
      cashierId: intent.cashierId ?? null,
      localSessionId: intent.localSessionId,
      openedAt: intent.openedAt ? new Date(intent.openedAt) : null,
      closedAt: new Date(intent.closedAt),
      openingCash: String(intent.openingCash),
      expectedCash: String(intent.expectedCash),
      countedCash: String(intent.countedCash),
      difference: String(intent.difference),
      denominations: intent.denominations ?? null,
      differenceReason: intent.differenceReason ?? null,
    })
    .onConflictDoNothing({
      target: [
        posTerminalSessionReviews.companyId,
        posTerminalSessionReviews.terminalId,
        posTerminalSessionReviews.clientKey,
      ],
    })
    .returning({ id: posTerminalSessionReviews.id });
  return inserted.length > 0 ? "recorded" : "duplicate";
}

export async function listTerminalSessionReviews(
  tx: Tx,
  companyId: string,
  limit = 100,
): Promise<PosTerminalSessionReviewRow[]> {
  const rows = await tx
    .select({
      id: posTerminalSessionReviews.id,
      terminalId: posTerminalSessionReviews.terminalId,
      terminalName: posTerminals.name,
      cashierId: posTerminalSessionReviews.cashierId,
      localSessionId: posTerminalSessionReviews.localSessionId,
      openedAt: posTerminalSessionReviews.openedAt,
      closedAt: posTerminalSessionReviews.closedAt,
      openingCash: posTerminalSessionReviews.openingCash,
      expectedCash: posTerminalSessionReviews.expectedCash,
      countedCash: posTerminalSessionReviews.countedCash,
      difference: posTerminalSessionReviews.difference,
      differenceReason: posTerminalSessionReviews.differenceReason,
      receivedAt: posTerminalSessionReviews.receivedAt,
    })
    .from(posTerminalSessionReviews)
    .innerJoin(posTerminals, eq(posTerminals.id, posTerminalSessionReviews.terminalId))
    .where(eq(posTerminalSessionReviews.companyId, companyId))
    .orderBy(desc(posTerminalSessionReviews.receivedAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    openingCash: String(row.openingCash),
    expectedCash: String(row.expectedCash),
    countedCash: String(row.countedCash),
    difference: String(row.difference),
  }));
}
