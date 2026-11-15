import type { Tx } from "@/db";
import { branches, warehouses } from "@/db/schema";
import type { MappedBranch, MappedWarehouse } from "@/lib/import-parse";
import type { SimpleMasterResult } from "./commit-commerce";

/**
 * Commit baris cabang & gudang, dipisah dari commit.ts agar berkas
 * orkestrator tetap ≤800 baris. Semantiknya sama: duplikat dalam file
 * = error, duplikat di database = skip, kode kosong dibuat otomatis.
 */
export type LocationContext = {
  tx: Tx;
  companyId: string;
  existingNames: Map<string, string>;
  existingCodes: Map<string, string>;
  seenNames: Set<string>;
  seenCodes: Set<string>;
  nextCode: (prefix: string, seq: number) => { code: string; seq: number };
  seq: number;
};

function checkDuplicate(
  ctx: LocationContext,
  name: string,
  code: string | null,
  label: string,
): SimpleMasterResult | null {
  const nameKey = name.toLowerCase();
  const codeKey = code?.toLowerCase() ?? null;
  if (ctx.seenNames.has(nameKey) || (codeKey && ctx.seenCodes.has(codeKey))) {
    return { status: "error", message: `Nama/kode ${label.toLowerCase()} duplikat di file` };
  }
  ctx.seenNames.add(nameKey);
  if (codeKey) ctx.seenCodes.add(codeKey);
  const existingId =
    ctx.existingNames.get(nameKey) ?? (codeKey ? ctx.existingCodes.get(codeKey) : undefined);
  if (existingId) {
    return { status: "skipped", message: `${label} sudah ada`, id: existingId };
  }
  return null;
}

export async function commitBranch(
  ctx: LocationContext,
  value: MappedBranch,
): Promise<{ result: SimpleMasterResult; seq: number }> {
  const duplicate = checkDuplicate(ctx, value.name, value.code, "Cabang");
  if (duplicate) return { result: duplicate, seq: ctx.seq };
  let code = value.code;
  let seq = ctx.seq;
  if (!code) {
    const generated = ctx.nextCode("BRN", seq);
    code = generated.code;
    seq = generated.seq;
  }
  const [created] = await ctx.tx
    .insert(branches)
    .values({
      companyId: ctx.companyId,
      code,
      name: value.name,
      address: value.address,
      phone: value.phone,
      isActive: value.isActive,
    })
    .onConflictDoNothing()
    .returning({ id: branches.id });
  if (!created) {
    return { result: { status: "skipped", message: "Cabang sudah ada" }, seq };
  }
  ctx.existingNames.set(value.name.toLowerCase(), created.id);
  ctx.existingCodes.set(code.toLowerCase(), created.id);
  return { result: { status: "imported", id: created.id }, seq };
}

export type WarehouseContext = LocationContext & {
  branchIdByCode: Map<string, string>;
  seq: number;
};

export async function commitWarehouse(
  ctx: WarehouseContext,
  value: MappedWarehouse,
): Promise<{ result: SimpleMasterResult; seq: number }> {
  const duplicate = checkDuplicate(ctx, value.name, value.code, "Gudang");
  if (duplicate) return { result: duplicate, seq: ctx.seq };
  let branchId: string | null = null;
  if (value.branchCode) {
    branchId = ctx.branchIdByCode.get(value.branchCode.toLowerCase()) ?? null;
    if (!branchId) {
      return {
        result: { status: "error", message: `Kode cabang "${value.branchCode}" tidak ditemukan` },
        seq: ctx.seq,
      };
    }
  }
  let code = value.code;
  let seq = ctx.seq;
  if (!code) {
    const generated = ctx.nextCode("GD", seq);
    code = generated.code;
    seq = generated.seq;
  }
  const [created] = await ctx.tx
    .insert(warehouses)
    .values({
      companyId: ctx.companyId,
      branchId,
      code,
      name: value.name,
      type: value.type,
      isActive: value.isActive,
    })
    .onConflictDoNothing()
    .returning({ id: warehouses.id });
  if (!created) {
    return { result: { status: "skipped", message: "Gudang sudah ada" }, seq };
  }
  ctx.existingNames.set(value.name.toLowerCase(), created.id);
  ctx.existingCodes.set(code.toLowerCase(), created.id);
  return { result: { status: "imported", id: created.id }, seq };
}
