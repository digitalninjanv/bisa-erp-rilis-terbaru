import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvResponse } from "@/lib/csv";
import {
  buildReportExportTable,
  reportTableToCsv,
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

export async function GET(request: Request) {
  const ctx = await requirePermission("accounting.view");
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

  // A-28 UI-3 (AKT-09): saklar akun nol yang sama dengan layar —
  // `nol=1` berarti pengguna menyalakan "Tampilkan akun bersaldo nol".
  const showZero = url.searchParams.get("nol") === "1";
  const table = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    buildReportExportTable(tx, ctx.company, type, from, to, { hideZero: !showZero }),
  );

  if (format === "xlsx") {
    return xlsxResponse(`laporan-${type}-${from}-${to}.xlsx`, table);
  }
  return csvResponse(`laporan-${type}-${from}-${to}.csv`, reportTableToCsv(table));
}
