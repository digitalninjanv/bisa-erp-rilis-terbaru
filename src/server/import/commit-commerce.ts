import type { Tx } from "@/db";
import { customerGroups, paymentMethods } from "@/db/schema";
import { toDb } from "@/lib/money";
import type { MappedCustomerGroup, MappedPaymentMethod } from "@/lib/import-parse";
import { markRow } from "./shared";

/**
 * Commit baris master "sederhana" (metode pembayaran & kelompok harga).
 * Dipisah dari commit.ts agar berkas orkestrator tetap di bawah plafon
 * arsitektur; kontrak hasilnya sama dengan cabang/gudang.
 */
export type SimpleMasterResult =
  | { status: "imported"; id: string }
  | { status: "skipped"; message: string; id?: string }
  | { status: "error"; message: string };

export type SimpleMasterContext = {
  tx: Tx;
  companyId: string;
  rowId: string;
  existingNames: Map<string, string>;
  existingCodes: Map<string, string>;
  accountIdByCode: Map<string, string>;
  seenNames: Set<string>;
  seenCodes: Set<string>;
  nextCode: (prefix: string, seq: number) => { code: string; seq: number };
  seq: number;
};

export async function commitPaymentMethod(
  ctx: SimpleMasterContext,
  value: MappedPaymentMethod,
): Promise<{ result: SimpleMasterResult; seq: number }> {
  const nameKey = value.name.toLowerCase();
  const codeKey = value.code?.toLowerCase() ?? null;
  if (ctx.seenNames.has(nameKey) || (codeKey && ctx.seenCodes.has(codeKey))) {
    return { result: { status: "error", message: "Nama/kode metode pembayaran duplikat di file" }, seq: ctx.seq };
  }
  ctx.seenNames.add(nameKey);
  if (codeKey) ctx.seenCodes.add(codeKey);
  const existingId =
    ctx.existingNames.get(nameKey) ?? (codeKey ? ctx.existingCodes.get(codeKey) : undefined);
  if (existingId) {
    return { result: { status: "skipped", message: "Metode pembayaran sudah ada", id: existingId }, seq: ctx.seq };
  }
  let accountId: string | null = null;
  if (value.accountCode) {
    accountId = ctx.accountIdByCode.get(value.accountCode.toLowerCase()) ?? null;
    if (!accountId) {
      return {
        result: { status: "error", message: `Kode akun "${value.accountCode}" tidak ditemukan` },
        seq: ctx.seq,
      };
    }
  }
  let code = value.code;
  let seq = ctx.seq;
  if (!code) {
    const generated = ctx.nextCode("PM", seq);
    code = generated.code;
    seq = generated.seq;
  }
  const [created] = await ctx.tx
    .insert(paymentMethods)
    .values({
      companyId: ctx.companyId,
      code,
      name: value.name,
      type: value.type,
      accountId,
      instructions: value.instructions,
      isActive: value.isActive,
    })
    .onConflictDoNothing()
    .returning({ id: paymentMethods.id });
  if (!created) {
    return { result: { status: "skipped", message: "Metode pembayaran sudah ada" }, seq };
  }
  ctx.existingNames.set(nameKey, created.id);
  ctx.existingCodes.set(code.toLowerCase(), created.id);
  return { result: { status: "imported", id: created.id }, seq };
}

export async function commitCustomerGroup(
  ctx: SimpleMasterContext,
  value: MappedCustomerGroup,
): Promise<SimpleMasterResult> {
  const nameKey = value.name.toLowerCase();
  if (ctx.seenNames.has(nameKey)) {
    return { status: "error", message: "Nama kelompok harga duplikat di file" };
  }
  ctx.seenNames.add(nameKey);
  const existingId = ctx.existingNames.get(nameKey);
  if (existingId) {
    return { status: "skipped", message: "Kelompok harga sudah ada", id: existingId };
  }
  const [created] = await ctx.tx
    .insert(customerGroups)
    .values({
      companyId: ctx.companyId,
      name: value.name,
      discountType: value.discountType,
      discountValue: toDb(value.discountValue),
      roundingStep: value.roundingStep,
      roundingDirection: value.roundingDirection,
      roundCashTotal: value.roundCashTotal,
      isActive: value.isActive,
    })
    .onConflictDoNothing()
    .returning({ id: customerGroups.id });
  if (!created) {
    return { status: "skipped", message: "Kelompok harga sudah ada" };
  }
  ctx.existingNames.set(nameKey, created.id);
  return { status: "imported", id: created.id };
}

/** Menulis hasil helper ke baris impor agar kontrak UI tetap sama. */
export async function markSimpleResult(
  tx: Tx,
  rowId: string,
  result: SimpleMasterResult,
): Promise<{ imported: number; skipped: number; failed: number }> {
  if (result.status === "imported") {
    await markRow(tx, rowId, "imported", null, result.id);
    return { imported: 1, skipped: 0, failed: 0 };
  }
  if (result.status === "skipped") {
    await markRow(tx, rowId, "skipped", result.message, result.id);
    return { imported: 0, skipped: 1, failed: 0 };
  }
  await markRow(tx, rowId, "error", result.message);
  return { imported: 0, skipped: 0, failed: 1 };
}
