import { and, asc, eq, inArray, or, sql, count } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  accounts,
  accountMappings,
  categories,
  customerGroups,
  customers,
  importRows,
  suppliers,
  units,
} from "@/db/schema";
import { ACCOUNT_MAPPING_KEYS, mappingAllowsAccountType, MAPPING_LABELS } from "@/lib/account-mappings";
import { defaultSection } from "@/lib/accounting";
import { toDb } from "@/lib/money";
import type { MappedCustomer, MappedSupplier } from "@/lib/import-parse";
import {
  loadRequiredCustomFields,
  mapMasterRow,
  requiredCustomFieldsNote,
  type MasterEntity,
} from "./masters";
import { finalizeJob, markRow, type JobRow, type Mapping, type RowData } from "./shared";

/**
 * A-26 Q6 (K-10): commit batch impor entitas master — pemasok,
 * pelanggan, akun (pecahan src/server/import-masters.ts). Commit
 * berjalan per batch dari baris "pending" dan menandai setiap baris
 * dengan hasil akhirnya. Saldo awal punya jalur commitnya sendiri
 * di opening.ts.
 */

export type MasterCommitResult = {
  processed: number;
  remaining: number;
  done: boolean;
  imported: number;
  skipped: number;
  failed: number;
  receiptNumber?: string | null;
};


export async function commitMasterBatch(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    job: JobRow;
    mapping: Mapping;
    limit: number;
    selectedRows?: number[];
  },
): Promise<MasterCommitResult> {
  const { companyId, job, mapping } = input;
  const entity = job.entity as Exclude<MasterEntity, "opening_stock">;

  const rows = await tx
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, job.id),
        eq(importRows.status, "pending"),
        input.selectedRows?.length ? inArray(importRows.rowNumber, input.selectedRows) : sql`true`,
      ),
    )
    .orderBy(asc(importRows.rowNumber))
    .limit(input.limit);

  if (rows.length === 0) {
    const remaining = await finalizeJob(tx, { companyId, userId: input.userId, job, imported: 0, failed: 0 });
    return { processed: 0, remaining, done: remaining === 0, imported: 0, skipped: 0, failed: 0 };
  }

  // Muat master yang relevan dengan batch ini saja (pola GD-P3-8).
  const mappedRows = rows.map((row) => ({
    row,
    mapped: mapMasterRow(entity, (row.data ?? {}) as RowData, mapping),
  }));
  const nameKeys = [
    ...new Set(
      mappedRows.flatMap(({ mapped }) => {
        if (!mapped.value) return [];
        if (mapped.value.kind === "suppliers" || mapped.value.kind === "customers") {
          return [mapped.value.value.name.toLowerCase()];
        }
        if (mapped.value.kind === "categories" || mapped.value.kind === "units") {
          return [mapped.value.value.name.toLowerCase()];
        }
        return [];
      }),
    ),
  ];
  const codeKeys = [
    ...new Set(
      mappedRows.flatMap(({ mapped }) => {
        if (!mapped.value) return [];
        if (mapped.value.kind === "accounts") return [mapped.value.value.code.toLowerCase()];
        if (mapped.value.kind === "units") return [mapped.value.value.code.toLowerCase()];
        if (mapped.value.kind === "suppliers" || mapped.value.kind === "customers") {
          return mapped.value.value.code ? [mapped.value.value.code.toLowerCase()] : [];
        }
        return [];
      }),
    ),
  ];

  const existingNames = new Map<string, string>();
  const existingCodes = new Map<string, string>();
  let supplierSeq = 0;
  let customerSeq = 0;
  const groupByName = new Map<string, string>();
  const categoryByName = new Map<string, string>();
  const existingUnitNames = new Map<string, string>();
  const accountIdByCode = new Map<string, string>();
  const accountMetaByCode = new Map<
    string,
    { type: string; isPostable: boolean; isActive: boolean }
  >();
  const mappingIdByKey = new Map<string, string>();

  if (entity === "suppliers") {
    const keyConditions = [
      ...(nameKeys.length ? [inArray(sql`lower(${suppliers.name})`, nameKeys)] : []),
      ...(codeKeys.length ? [inArray(sql`lower(${suppliers.code})`, codeKeys)] : []),
    ];
    const found = keyConditions.length
      ? await tx
          .select({ id: suppliers.id, name: suppliers.name, code: suppliers.code })
          .from(suppliers)
          .where(and(eq(suppliers.companyId, companyId), or(...keyConditions)))
      : [];
    for (const row of found) {
      existingNames.set(row.name.toLowerCase(), row.id);
      existingCodes.set(row.code.toLowerCase(), row.id);
    }
    const [countRow] = await tx
      .select({ value: count() })
      .from(suppliers)
      .where(eq(suppliers.companyId, companyId));
    supplierSeq = (countRow?.value ?? 0) + 1;
  } else if (entity === "customers") {
    const keyConditions = [
      ...(nameKeys.length ? [inArray(sql`lower(${customers.name})`, nameKeys)] : []),
      ...(codeKeys.length ? [inArray(sql`lower(${customers.code})`, codeKeys)] : []),
    ];
    const found = keyConditions.length
      ? await tx
          .select({ id: customers.id, name: customers.name, code: customers.code })
          .from(customers)
          .where(and(eq(customers.companyId, companyId), or(...keyConditions)))
      : [];
    for (const row of found) {
      existingNames.set(row.name.toLowerCase(), row.id);
      existingCodes.set(row.code.toLowerCase(), row.id);
    }
    const [countRow] = await tx
      .select({ value: count() })
      .from(customers)
      .where(eq(customers.companyId, companyId));
    customerSeq = (countRow?.value ?? 0) + 1;
    const groups = await tx
      .select({ id: customerGroups.id, name: customerGroups.name })
      .from(customerGroups)
      .where(eq(customerGroups.companyId, companyId));
    for (const group of groups) groupByName.set(group.name.toLowerCase(), group.id);
  } else if (entity === "accounts") {
    const found = codeKeys.length
      ? await tx
          .select({ id: accounts.id, code: accounts.code })
          .from(accounts)
          .where(and(eq(accounts.companyId, companyId), inArray(sql`lower(${accounts.code})`, codeKeys)))
      : [];
    for (const row of found) existingCodes.set(row.code.toLowerCase(), row.id);
  } else if (entity === "categories") {
    const found = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.companyId, companyId));
    for (const row of found) categoryByName.set(row.name.toLowerCase(), row.id);
  } else if (entity === "units") {
    const found = await tx
      .select({ id: units.id, code: units.code, name: units.name })
      .from(units)
      .where(eq(units.companyId, companyId));
    for (const row of found) {
      existingCodes.set(row.code.toLowerCase(), row.id);
      existingUnitNames.set(row.name.toLowerCase(), row.id);
    }
  } else if (entity === "account_mappings") {
    const [accountRows, mappingRows] = await Promise.all([
      tx
        .select({
          id: accounts.id,
          code: accounts.code,
          type: accounts.type,
          isPostable: accounts.isPostable,
          isActive: accounts.isActive,
        })
        .from(accounts)
        .where(eq(accounts.companyId, companyId)),
      tx
        .select({ id: accountMappings.id, key: accountMappings.key })
        .from(accountMappings)
        .where(eq(accountMappings.companyId, companyId)),
    ]);
    for (const row of accountRows) {
      existingCodes.set(row.code.toLowerCase(), row.id);
      accountIdByCode.set(row.code.toLowerCase(), row.id);
      accountMetaByCode.set(row.code.toLowerCase(), {
        type: row.type,
        isPostable: row.isPostable,
        isActive: row.isActive,
      });
    }
    for (const row of mappingRows) mappingIdByKey.set(row.key, row.id);
  }

  const seenNames = new Set<string>();
  const seenCodes = new Set<string>();
  const seenMappingKeys = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  // T5R-3: pesan hasil untuk baris pemasok/pelanggan yang terimpor
  // selama ada kolom kustom wajib yang belum terisi untuk entitas itu.
  const requiredNote =
    entity === "suppliers" || entity === "customers"
      ? await loadRequiredCustomFields(
          tx,
          companyId,
          entity === "suppliers" ? "supplier" : "customer",
        ).then((defs) =>
          defs.length > 0 ? requiredCustomFieldsNote(defs.map((field) => field.label)) : null,
        )
      : null;

  const nextCode = (prefix: string, seq: number): { code: string; seq: number } => {
    let next = seq;
    let code = `${prefix}-${String(next).padStart(3, "0")}`;
    while (existingCodes.has(code.toLowerCase())) {
      next += 1;
      code = `${prefix}-${String(next).padStart(3, "0")}`;
    }
    return { code, seq: next + 1 };
  };

  for (const { row, mapped } of mappedRows) {
    if (!mapped.value) {
      failed += 1;
      await markRow(tx, row.id, "error", mapped.error ?? "Baris tidak valid");
      continue;
    }
    const value = mapped.value;

    if (value.kind === "suppliers" || value.kind === "customers") {
      const party = value.value;
      const nameKey = party.name.toLowerCase();
      const codeKey = party.code?.toLowerCase() ?? null;
      if (seenNames.has(nameKey) || (codeKey && seenCodes.has(codeKey))) {
        failed += 1;
        await markRow(tx, row.id, "error", "Nama/kode duplikat di file");
        continue;
      }
      seenNames.add(nameKey);
      if (codeKey) seenCodes.add(codeKey);
      const existingId = existingNames.get(nameKey) ?? (codeKey ? existingCodes.get(codeKey) : undefined);
      if (existingId) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Sudah ada", existingId);
        continue;
      }

      if (value.kind === "suppliers") {
        const supplier = party as MappedSupplier;
        let code = party.code;
        if (!code) {
          const generated = nextCode("SUP", supplierSeq);
          code = generated.code;
          supplierSeq = generated.seq;
        }
        const [created] = await tx
          .insert(suppliers)
          .values({
            companyId,
            code,
            name: party.name,
            phone: party.phone,
            email: party.email,
            address: party.address,
            notes: party.notes,
            taxId: supplier.taxId,
            bankName: supplier.bankName,
            bankAccountNumber: supplier.bankAccountNumber,
            bankAccountName: supplier.bankAccountName,
            paymentTermDays: supplier.paymentTermDays,
          })
          .onConflictDoNothing()
          .returning({ id: suppliers.id });
        if (!created) {
          skipped += 1;
          await markRow(tx, row.id, "skipped", "Sudah ada");
          continue;
        }
        existingNames.set(nameKey, created.id);
        existingCodes.set(code.toLowerCase(), created.id);
        imported += 1;
        await markRow(tx, row.id, "imported", requiredNote, created.id);
      } else {
        const customer = party as MappedCustomer;
        let groupId: string | null = null;
        if (customer.group) {
          groupId = groupByName.get(customer.group.toLowerCase()) ?? null;
          if (!groupId) {
            failed += 1;
            await markRow(tx, row.id, "error", `Kelompok harga "${customer.group}" tidak ditemukan`);
            continue;
          }
        }
        let code = party.code;
        if (!code) {
          const generated = nextCode("CUST", customerSeq);
          code = generated.code;
          customerSeq = generated.seq;
        }
        const [created] = await tx
          .insert(customers)
          .values({
            companyId,
            code,
            name: party.name,
            phone: party.phone,
            email: party.email,
            address: party.address,
            groupId,
            creditLimit: toDb(customer.creditLimit),
            notes: party.notes,
            taxId: customer.taxId,
            paymentTermDays: customer.paymentTermDays,
          })
          .onConflictDoNothing()
          .returning({ id: customers.id });
        if (!created) {
          skipped += 1;
          await markRow(tx, row.id, "skipped", "Sudah ada");
          continue;
        }
        existingNames.set(nameKey, created.id);
        existingCodes.set(code.toLowerCase(), created.id);
        imported += 1;
        await markRow(tx, row.id, "imported", requiredNote, created.id);
      }
      continue;
    }

    if (value.kind === "accounts") {
      const account = value.value;
      const codeKey = account.code.toLowerCase();
      if (seenCodes.has(codeKey)) {
        failed += 1;
        await markRow(tx, row.id, "error", "Kode akun duplikat di file");
        continue;
      }
      seenCodes.add(codeKey);
      const existingId = existingCodes.get(codeKey);
      if (existingId) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Kode sudah ada", existingId);
        continue;
      }
      const [created] = await tx
        .insert(accounts)
        .values({
          companyId,
          code: account.code,
          name: account.name,
          type: account.type,
          normalBalance: account.normalBalance,
          section: account.section ?? defaultSection(account.type),
          description: account.description,
          isPostable: true,
          isActive: true,
        })
        .onConflictDoNothing()
        .returning({ id: accounts.id });
      if (!created) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Kode sudah ada");
        continue;
      }
      existingCodes.set(codeKey, created.id);
      imported += 1;
      await markRow(tx, row.id, "imported", null, created.id);
    }

    if (value.kind === "categories") {
      const category = value.value;
      const nameKey = category.name.toLowerCase();
      if (seenNames.has(nameKey)) {
        failed += 1;
        await markRow(tx, row.id, "error", "Nama kategori duplikat di file");
        continue;
      }
      seenNames.add(nameKey);
      const existingId = categoryByName.get(nameKey);
      if (existingId) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Kategori sudah ada", existingId);
        continue;
      }
      let parentId: string | null = null;
      if (category.parent) {
        parentId = categoryByName.get(category.parent.toLowerCase()) ?? null;
        if (!parentId) {
          failed += 1;
          await markRow(
            tx,
            row.id,
            "error",
            `Induk kategori "${category.parent}" tidak ditemukan — buat induknya dulu`,
          );
          continue;
        }
      }
      const [created] = await tx
        .insert(categories)
        .values({
          companyId,
          name: category.name,
          parentId,
          isActive: category.isActive,
        })
        .onConflictDoNothing()
        .returning({ id: categories.id });
      if (!created) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Kategori sudah ada");
        continue;
      }
      categoryByName.set(nameKey, created.id);
      imported += 1;
      await markRow(tx, row.id, "imported", null, created.id);
    }

    if (value.kind === "units") {
      const unit = value.value;
      const codeKey = unit.code.toLowerCase();
      const nameKey = unit.name.toLowerCase();
      if (seenCodes.has(codeKey) || seenNames.has(nameKey)) {
        failed += 1;
        await markRow(tx, row.id, "error", "Kode/nama satuan duplikat di file");
        continue;
      }
      seenCodes.add(codeKey);
      seenNames.add(nameKey);
      const existingId = existingCodes.get(codeKey) ?? existingUnitNames.get(nameKey);
      if (existingId) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Satuan sudah ada", existingId);
        continue;
      }
      const [created] = await tx
        .insert(units)
        .values({ companyId, code: unit.code, name: unit.name, isActive: unit.isActive })
        .onConflictDoNothing()
        .returning({ id: units.id });
      if (!created) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Satuan sudah ada");
        continue;
      }
      existingCodes.set(codeKey, created.id);
      existingUnitNames.set(nameKey, created.id);
      imported += 1;
      await markRow(tx, row.id, "imported", null, created.id);
    }

    if (value.kind === "account_mappings") {
      const key = value.value.key;
      const codeKey = value.value.accountCode.toLowerCase();
      if (!(ACCOUNT_MAPPING_KEYS as readonly string[]).includes(key)) {
        failed += 1;
        await markRow(tx, row.id, "error", `Kunci pemetaan "${key}" tidak dikenal`);
        continue;
      }
      if (seenMappingKeys.has(key)) {
        failed += 1;
        await markRow(tx, row.id, "error", "Kunci pemetaan duplikat di file");
        continue;
      }
      seenMappingKeys.add(key);
      const accountId = accountIdByCode.get(codeKey);
      const meta = accountMetaByCode.get(codeKey);
      if (!accountId || !meta) {
        failed += 1;
        await markRow(tx, row.id, "error", `Kode akun "${value.value.accountCode}" tidak ditemukan`);
        continue;
      }
      if (!mappingAllowsAccountType(key, meta.type)) {
        failed += 1;
        await markRow(
          tx,
          row.id,
          "error",
          `Akun ${value.value.accountCode} bertipe ${meta.type}, tidak sesuai untuk pemetaan "${MAPPING_LABELS[key] ?? key}"`,
        );
        continue;
      }
      if (!meta.isPostable || !meta.isActive) {
        failed += 1;
        await markRow(tx, row.id, "error", `Akun ${value.value.accountCode} harus aktif dan dapat diposting`);
        continue;
      }
      const existingId = mappingIdByKey.get(key);
      if (existingId) {
        await tx
          .update(accountMappings)
          .set({ accountId, updatedAt: new Date() })
          .where(
            and(
              eq(accountMappings.companyId, companyId),
              eq(accountMappings.id, existingId),
            ),
          );
        imported += 1;
        await markRow(tx, row.id, "imported", "Diperbarui", existingId);
        continue;
      }
      const [created] = await tx
        .insert(accountMappings)
        .values({ companyId, key, accountId })
        .onConflictDoNothing()
        .returning({ id: accountMappings.id });
      if (!created) {
        skipped += 1;
        await markRow(tx, row.id, "skipped", "Pemetaan sudah ada");
        continue;
      }
      mappingIdByKey.set(key, created.id);
      imported += 1;
      await markRow(tx, row.id, "imported", null, created.id);
    }
  }

  const remaining = await finalizeJob(tx, { companyId, userId: input.userId, job, imported, failed });
  return { processed: rows.length, remaining, done: remaining === 0, imported, skipped, failed };
}

