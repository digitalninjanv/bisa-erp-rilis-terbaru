import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionInModule } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { csvStreamResponse } from "@/lib/csv";
import {
  buildReportExportTable,
  reportTableToCsvStream,
  xlsxResponse,
} from "@/server/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FIX-R2 (RD2-05/08/09): CSV laporan sebelumnya adalah dump angka
// mentah tanpa identitas perusahaan, membuang kolom pembanding yang
// tampil di layar, dan menulis kode mentah (sourceType arus kas,
// tipe metode bayar). Kini setiap CSV dibuka nama legal perusahaan,
// mempertahankan kolom pembanding tahun sebelumnya untuk SEMUA
// laporan berkala, dan memakai label Bahasa Indonesia yang sama
// dengan layar & dokumen cetak.
// A-28 Tahap 3 (H-AKT-01): perakitan baris kini hidup di
// buildReportExportTable (src/server/reports/export-builders.ts) —
// SATU model tabel untuk CSV & XLSX berformat (format=xlsx), agar
// kedua format tidak pernah berangkat dari definisi berbeda. CSV di
// bawah tetap byte-identik dengan format warisan di atas.

async function GETHandler(request: Request) {
  const ctx = await requirePermissionInModule("accounting.view", "akuntansi");
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "laba-rugi";
  // AK-P3-05(d): "catatan" is free text (reportNotes), not a table — never
  // let it fall through to the income-statement default below.
  if (type === "catatan") {
    return new Response("Tab catatan tidak tersedia sebagai CSV.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const from = url.searchParams.get("from") || `${todayISO().slice(0, 7)}-01`;
  const to = url.searchParams.get("to") || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError("VALIDATION", "Format tanggal laporan harus YYYY-MM-DD.");
  }

  // A-28 UI-3 (AKT-09): saklar akun nol yang sama dengan layar —
  // `nol=1` berarti pengguna menyalakan "Tampilkan akun bersaldo nol".
  const showZero = url.searchParams.get("nol") === "1";
  const table = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    buildReportExportTable(tx, ctx.company, type, from, to, { hideZero: !showZero }),
  );

  if (format === "xlsx") {
    return xlsxResponse(`laporan-${type}-${from}-${to}.xlsx`, table);
  }
  return csvStreamResponse(`laporan-${type}-${from}-${to}.csv`, reportTableToCsvStream(table));
}

export const GET = withApiError(GETHandler);
