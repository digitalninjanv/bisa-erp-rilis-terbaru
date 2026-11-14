import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withCompany } from "@/db/tenant";
import { importJobs, importRows } from "@/db/schema";
import { requirePermission } from "@/lib/session";
import { ENTITY_FIELDS, isImportEntity, suggestMappingFor } from "@/lib/import-parse";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import { customFieldImportField } from "@/lib/import/import-custom-fields";
import { getCompanySettingsRow } from "@/server/settings";
import {
  duplicateImportMessage,
  findAppliedImportDuplicate,
  hashImportFile,
} from "@/server/import-files";
import { AppError, type AppErrorCode } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 25_000;
const MAX_BYTES = 20 * 1024 * 1024;

const APP_ERROR_STATUS: Partial<Record<AppErrorCode, number>> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
};

/** Next's redirect() signals through a thrown error; it must not be swallowed. */
function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("import.manage");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimum 20MB." }, { status: 413 });
    }
    const form = await request.formData();
    // T4-5a: jenis impor dipilih pengunggah; bawaan "products" menjaga
    // wizard produk lama tetap bekerja tanpa perubahan kontrak.
    const entityRaw = String(form.get("entity") ?? "products");
    if (!isImportEntity(entityRaw)) {
      return NextResponse.json({ error: "Jenis impor tidak dikenal." }, { status: 400 });
    }
    const entity = entityRaw;
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File wajib diunggah." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimum 20MB." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // GDG3-15: sidik isi berkas dihitung dari byte mentah SEBELUM
    // parsing — dua berkas dengan isi identik dikenali walau namanya
    // berbeda.
    const fileHash = hashImportFile(buffer);
    let workbook: ReturnType<typeof XLSX.read>;
    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch {
      // Hanya kegagalan baca berkas sungguhan yang menjadi pesan ini;
      // error izin/otentikasi ditangani di catch luar apa adanya.
      return NextResponse.json(
        { error: "Gagal membaca file. Pastikan format XLSX/CSV valid." },
        { status: 400 },
      );
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ error: "File tidak memiliki lembar kerja." }, { status: 400 });
    }
    // GD-P3-11: hanya sheet pertama yang dibaca; sheet lain dilaporkan
    // agar pengguna tahu ada data yang tidak ikut terbaca.
    const ignoredSheets = workbook.SheetNames.slice(1);
    const sheet = workbook.Sheets[sheetName];
    // GD-P3-11: raw: true — ambil nilai sel sebenarnya, bukan teks
    // tampilannya. Angka berformat akuntansi/tampilan (mis. negatif
    // "(2,500)") akan terbaca keliru bila memakai nilai terformat.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    if (matrix.length < 2) {
      return NextResponse.json({ error: "File harus memiliki baris judul dan minimal satu baris data." }, { status: 400 });
    }

    const headerRow = (matrix[0] as unknown[]).map((cell, index) => {
      const text = String(cell ?? "").trim();
      return text || `Kolom ${index + 1}`;
    });
    const headers = dedupe(headerRow);

    const dataRows = matrix.slice(1).filter((row) =>
      Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""),
    );
    if (dataRows.length === 0) {
      return NextResponse.json({ error: "Tidak ada baris data yang bisa diimpor." }, { status: 400 });
    }
    if (dataRows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Baris maksimum ${MAX_ROWS.toLocaleString("id-ID")}. Pecah file menjadi beberapa bagian.` },
        { status: 413 },
      );
    }

    const result = await withCompany(ctx.company.id, async (tx) => {
      const settings = await getCompanySettingsRow(tx, ctx.company.id);
      const customEntity =
        entity === "suppliers" ? "supplier" : entity === "customers" ? "customer" : null;
      const customFields = customEntity
        ? customFieldDefinitionsFor(settings?.customFields, customEntity)
        : [];
      const mapping = suggestMappingFor(
        [...ENTITY_FIELDS[entity], ...customFields.map(customFieldImportField)],
        headers,
      );

      // GDG3-15: berkas identik yang datanya SUDAH diterapkan oleh job
      // lain ditolak di sini dengan menyebut job asalnya. Job
      // pratinjau yang belum di-commit tidak menghalangi unggahan
      // ulang; penjaga kedua ada di commit (commitImportBatchAction).
      const duplicate = await findAppliedImportDuplicate(tx, {
        companyId: ctx.company.id,
        fileHash,
      });
      if (duplicate) throw new AppError("CONFLICT", duplicateImportMessage(duplicate));

      const [job] = await tx
        .insert(importJobs)
        .values({
          companyId: ctx.company.id,
          entity,
          fileName: file.name,
          fileHash,
          status: "preview",
          totalRows: dataRows.length,
          mapping,
          createdBy: ctx.user.id,
        })
        .returning({ id: importJobs.id });

      const values = dataRows.map((row, index) => {
        const object: Record<string, string> = {};
        headers.forEach((header, column) => {
          const cell = (row as unknown[])[column];
          object[header] = cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell ?? "").trim();
        });
        return {
          companyId: ctx.company.id,
          jobId: job.id,
          rowNumber: index + 1,
          data: object,
          status: "pending",
        };
      });

      for (let start = 0; start < values.length; start += 500) {
        await tx.insert(importRows).values(values.slice(start, start + 500));
      }

      return { jobId: job.id, rows: values.length, mapping };
    });

    return NextResponse.json({
      jobId: result.jobId,
      entity,
      fileName: file.name,
      sheet: sheetName,
      ignoredSheets,
      headers,
      totalRows: dataRows.length,
      mapping: result.mapping,
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    // GD-P3-10: error otorisasi/izin (PermissionError adalah AppError)
    // diteruskan dengan status dan pesan aslinya — bukan 500 generik.
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message },
        { status: APP_ERROR_STATUS[error.code] ?? 500 },
      );
    }
    console.error("import parse failed", error);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
  }
}

function dedupe(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header} (${count + 1})`;
  });
}
