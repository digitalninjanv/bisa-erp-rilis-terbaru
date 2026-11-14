// A-26 Q6 (K-10): pecahan src/server/actions/import.ts per tahap
// wizard impor. Nama aksi, skema Zod, izin, & payload tidak berubah;
// pemanggil kini mengimpor dari berkas sub-domain ini langsung
// (re-export silang antar berkas "use server" tidak dipakai —
// pelajaran A-24 T2).

"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { importJobs } from "@/db/schema";
import { requirePermission } from "@/lib/session";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { ENTITY_FIELDS, IMPORT_FIELDS, type ImportField } from "@/lib/import-parse";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import { customFieldImportField } from "@/lib/import/import-custom-fields";
import { getCompanySettingsRow } from "@/server/settings";
import { analyzeMasterImport, assertMasterEntity } from "@/server/import-masters";
import { analyzeProductJob } from "./shared";

const mappingSchema = z.record(z.string(), z.string().optional()).optional();

export async function analyzeImportAction(input: { jobId: string; mapping?: Record<string, string | undefined> }) {
  return guard(async () => {
    const ctx = await requirePermission("import.manage");
    const data = parseInput(z.object({ jobId: z.string().uuid(), mapping: mappingSchema }), input);

    return withCompany(ctx.company.id, async (tx) => {
      const [job] = await tx
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.companyId, ctx.company.id), eq(importJobs.id, data.jobId)))
        .limit(1);
      if (!job) throw new AppError("NOT_FOUND", "Job impor tidak ditemukan.");

      const provided = Object.fromEntries(
        Object.entries(data.mapping ?? {}).filter(([, value]) => Boolean(value)),
      ) as Partial<Record<ImportField, string>>;
      const mapping = Object.keys(provided).length > 0 ? provided : ((job.mapping ?? {}) as Partial<Record<ImportField, string>>);

      if (job.entity !== "products") {
        // T4-5a: entitas master & stok awal dianalisis domain import-masters
        // dengan kerangka isu-per-baris yang sama; jalur produk di bawah
        // tidak berubah sama sekali.
        const entity = assertMasterEntity(job.entity);
        const customEntity =
          entity === "suppliers" ? "supplier" : entity === "customers" ? "customer" : null;
        const settings = customEntity ? await getCompanySettingsRow(tx, ctx.company.id) : null;
        const customFields = customEntity
          ? customFieldDefinitionsFor(settings?.customFields, customEntity)
          : [];
        const result = await analyzeMasterImport(tx, {
          companyId: ctx.company.id,
          job,
          mapping: mapping as Partial<Record<string, string>>,
          customFields,
        });
        return {
          summary: result.summary,
          preview: result.preview,
          mapping,
          fields: [...ENTITY_FIELDS[entity], ...customFields.map(customFieldImportField)].map((f) => ({
            key: f.key,
            label: f.label,
            required: f.required ?? false,
          })),
        };
      }

      const { summary, preview } = await analyzeProductJob(tx, ctx.company.id, data.jobId, mapping);
      return { summary, preview, mapping, fields: IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required ?? false })) };
    });
  });
}
