"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { parseInput } from "@/lib/action-validation";
import { guard } from "@/lib/errors";
import { requirePermissionInModule } from "@/lib/session";
import { writeAudit } from "@/server/audit";
import {
  createPosTerminal,
  isValidVersion,
  issuePairingCode,
  revokePosTerminal,
  setDesktopReleaseSettings,
} from "@/server/pos";

/**
 * Administrasi terminal POS desktop (POS Native Langkah 6).
 * Mengelola registry terminal adalah tindakan supervisor —
 * gerbangnya `pos.void` di modul pos, sejajar pengelolaan
 * Peninjauan offline (lihat & kelola dipisah: halaman terminal
 * terlihat pemegang `pos.session`, mutasi di sini supervisor).
 * Semua tulis tabel registry berjalan lewat domain
 * `server/pos/terminals.ts` (pemilik tunggal tabelnya).
 */

const createSchema = z.object({
  name: z.string().trim().min(1, "Nama terminal wajib diisi.").max(80),
  warehouseId: z.string().uuid().nullish(),
  userId: z.string().min(1, "Kasir/aktor terminal wajib dipilih."),
});

const terminalIdSchema = z.object({
  terminalId: z.string().uuid(),
});

const releaseSchema = z.object({
  version: z
    .string()
    .trim()
    .refine((value) => isValidVersion(value), "Versi harus berbentuk mayor.minor.patch (mis. 1.2.0)."),
  rolloutPercent: z.number().int().min(0).max(100),
  minVersion: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidVersion(value), "Versi minimum harus berbentuk mayor.minor.patch.")
    .nullish(),
  notes: z.string().trim().max(500).nullish(),
});

/**
 * Tetapkan rilis aplikasi desktop perusahaan (Langkah 7, D4):
 * versi yang ditawarkan endpoint updater, persen rollout bertahap
 * per terminal, dan versi minimum shell (di bawahnya pembaruan
 * WAJIB). Artefaknya sendiri diunggah admin rilis ke direktori
 * rilis server lewat skrip rilis — aksi ini hanya mengatur
 * penawarannya; endpoint tidak menawarkan versi yang artefaknya
 * belum ada di direktori rilis.
 */
export async function setDesktopReleaseAction(input: z.input<typeof releaseSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(releaseSchema, input);
    const saved = await withCompany(ctx.company.id, async (tx) => {
      const row = await setDesktopReleaseSettings(tx, {
        companyId: ctx.company.id,
        version: data.version,
        rolloutPercent: data.rolloutPercent,
        minVersion: data.minVersion ? data.minVersion : null,
        notes: data.notes ? data.notes : null,
        updatedBy: ctx.user.id,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "pos_desktop_release.set",
        entityType: "pos_desktop_release",
        after: {
          version: row.version,
          rolloutPercent: row.rolloutPercent,
          minVersion: row.minVersion,
        },
      });
      return row;
    });
    revalidatePath("/app/pos/terminal");
    return {
      version: saved.version,
      rolloutPercent: saved.rolloutPercent,
      minVersion: saved.minVersion,
      publishedAt: saved.publishedAt.toISOString(),
    };
  });
}

export async function createPosTerminalAction(input: z.input<typeof createSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(createSchema, input);
    const created = await withCompany(ctx.company.id, async (tx) => {
      const row = await createPosTerminal(tx, {
        companyId: ctx.company.id,
        name: data.name,
        warehouseId: data.warehouseId ?? null,
        userId: data.userId,
        createdBy: ctx.user.id,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "pos_terminal.create",
        entityType: "pos_terminal",
        entityId: row.id,
        after: { name: data.name, warehouseId: data.warehouseId ?? null },
      });
      return row;
    });
    revalidatePath("/app/pos/terminal");
    return created;
  });
}

export async function revokePosTerminalAction(input: z.input<typeof terminalIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(terminalIdSchema, input);
    await withCompany(ctx.company.id, async (tx) => {
      await revokePosTerminal(tx, {
        companyId: ctx.company.id,
        terminalId: data.terminalId,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "pos_terminal.revoke",
        entityType: "pos_terminal",
        entityId: data.terminalId,
      });
    });
    revalidatePath("/app/pos/terminal");
    return { id: data.terminalId };
  });
}

/**
 * Terbitkan kode pasangan sekali pakai untuk terminal. Kode TEKS
 * dikembalikan SATU KALI lewat hasil aksi ini (server hanya
 * menyimpan digest-nya) — panel admin menampilkannya sebagai teks
 * + QR untuk diketik/dipindai di aplikasi desktop.
 */
export async function issuePairingCodeAction(input: z.input<typeof terminalIdSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("pos.void", "pos");
    const data = parseInput(terminalIdSchema, input);
    const issued = await withCompany(ctx.company.id, async (tx) => {
      const result = await issuePairingCode(tx, {
        companyId: ctx.company.id,
        terminalId: data.terminalId,
        createdBy: ctx.user.id,
      });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "pos_terminal.pairing_code",
        entityType: "pos_terminal",
        entityId: data.terminalId,
        after: { expiresAt: result.expiresAt.toISOString() },
      });
      return result;
    });
    return {
      code: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
    };
  });
}
