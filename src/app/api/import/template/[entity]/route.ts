import { NextResponse } from "next/server";
import { IMPORT_SAMPLES, isImportEntity } from "@/lib/import-parse";
import { requirePermission } from "@/lib/session";
import { csvResponse } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * T4-5a: contoh CSV per jenis impor. Isinya berasal dari IMPORT_SAMPLES
 * yang sama dengan yang dikenali parser, jadi header unduhan selalu
 * persis header yang diterima saat pengguna mengunggah kembali.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;
  if (!isImportEntity(entity)) {
    return NextResponse.json({ error: "Jenis impor tidak dikenal." }, { status: 404 });
  }
  await requirePermission("import.manage");
  const sample = IMPORT_SAMPLES[entity];
  return csvResponse(sample.fileName, sample.csv);
}
