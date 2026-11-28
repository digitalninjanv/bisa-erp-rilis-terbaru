"use server";

import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { adminDb } from "@/db/admin";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { assertDatabaseEmpty, bootstrapCompany } from "@/server/bootstrap";

const setupSchema = z.object({
  token: z.string().min(1, "Token setup wajib diisi."),
  companyName: z.string().trim().min(2, "Nama perusahaan minimal 2 karakter.").max(160),
  ownerName: z.string().trim().min(2, "Nama owner minimal 2 karakter.").max(160),
  ownerEmail: z.string().trim().toLowerCase().email("Format email tidak valid.").max(160),
  ownerPassword: z.string().min(12, "Kata sandi owner minimal 12 karakter.").max(128),
  branchName: z.string().trim().max(120).optional(),
  warehouseName: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
});

function tokenMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Setup publik satu kali. Tidak memakai sesi karena belum ada pengguna;
 * gerbangnya adalah database kosong + BISA_SETUP_TOKEN yang hanya
 * diketahui operator instalasi.
 */
export async function bootstrapSetupAction(input: z.input<typeof setupSchema>) {
  return guard(async () => {
    const expectedToken = process.env.BISA_SETUP_TOKEN?.trim() ?? "";
    if (!expectedToken) {
      throw new AppError(
        "FORBIDDEN",
        "Setup web dinonaktifkan: BISA_SETUP_TOKEN belum diisi. Gunakan CLI bootstrap atau isi token di env.",
      );
    }
    const data = parseInput(setupSchema, input);
    if (!tokenMatches(data.token, expectedToken)) {
      throw new AppError("FORBIDDEN", "Token setup tidak cocok.");
    }

    const result = await adminDb.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('bisa.bootstrap', 0))`);
      await assertDatabaseEmpty(tx);
      return bootstrapCompany(tx, {
        companyName: data.companyName,
        ownerName: data.ownerName,
        ownerEmail: data.ownerEmail,
        ownerPassword: data.ownerPassword,
        branchName: data.branchName,
        warehouseName: data.warehouseName,
        address: data.address,
        phone: data.phone,
      });
    });

    revalidatePath("/login");
    return { companyId: result.companyId, ownerEmail: data.ownerEmail };
  });
}
