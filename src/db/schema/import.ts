/**
 * Skema domain: impor data (pekerjaan & baris impor).
 * A-26 Q2: pecahan src/db/schema.ts — definisi dipindah utuh, tanpa perubahan.
 * Impor publik tetap lewat barrel "@/db/schema" (src/db/schema.ts).
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    entity: text("entity").notNull(), // products | customers | suppliers
    fileName: text("file_name").notNull(),
    // GDG3-15: SHA-256 isi berkas mentah — dasar penolakan impor ulang
    // berkas identik yang datanya sudah diterapkan (src/server/import-files.ts).
    fileHash: text("file_hash"),
    status: text("status").notNull().default("preview"), // preview | completed | failed
    totalRows: integer("total_rows").notNull().default(0),
    successRows: integer("success_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    mapping: jsonb("mapping"),
    summary: jsonb("summary"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_jobs_company_created_idx").on(t.companyId, t.createdAt)],
);
export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    companyId: text("company_id").notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    data: jsonb("data"),
    status: text("status").notNull(), // imported | skipped | error
    error: text("error"),
    entityId: uuid("entity_id"),
  },
  (t) => [index("import_rows_job_idx").on(t.jobId)],
);
