import { withApiError } from "@/lib/api-error";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { payrollRuns } from "@/db/schema";
import { csvResponse, toCsv } from "@/lib/csv";
import { xlsxResponse, type XlsxCell } from "@/lib/xlsx";
import { d, toDb } from "@/lib/money";
import { getPayrollRecap } from "@/server/payroll-indonesia";
import { requirePermission } from "@/lib/session";
import { requireFreshSession } from "@/lib/session-freshness";

export const runtime = "nodejs";

/**
 * SIM-2 S2 — Rekap payroll per run untuk setoran PPh 21 & BPJS.
 * Format: satu baris per karyawan; kolom iuran per program terpisah
 * pekerja/perusahaan; kolom "Total setoran" = iuran pekerja +
 * iuran perusahaan + PPh 21 yang disetor perusahaan.
 * Parameter wajib: ?runId=<uuid>.
 */
const EMPLOYEE_COLUMNS: Array<{ code: string; header: string }> = [
  { code: "bpjs_kes_employee", header: "BPJS Kesehatan (pekerja)" },
  { code: "jht_employee", header: "JHT (pekerja)" },
  { code: "jp_employee", header: "JP (pekerja)" },
];
const EMPLOYER_COLUMNS: Array<{ code: string; header: string }> = [
  { code: "bpjs_kes_employer", header: "BPJS Kesehatan (perusahaan)" },
  { code: "jht_employer", header: "JHT (perusahaan)" },
  { code: "jkk_employer", header: "JKK (perusahaan)" },
  { code: "jkm_employer", header: "JKM (perusahaan)" },
  { code: "jp_employer", header: "JP (perusahaan)" },
  { code: "jkp_employer", header: "JKP (perusahaan)" },
];

function sumRecord(record: Record<string, string>): string {
  return toDb(Object.values(record).reduce((acc, value) => acc.plus(d(value)), d(0)));
}

async function GETHandler(request: NextRequest) {
  // A-28 Tahap 5 (H-HR-01): rekap ini adalah dokumen angka gaji yang
  // keluar dari layar — gerbangnya izin lihat angka gaji
  // `payroll.salary`, bukan payroll.view umum. Pemilik dapat memberi
  // izin ini sendiri ke peran kustom (mis. akuntan pemeriksa) tanpa
  // membuka seluruh halaman HR.
  const ctx = await requirePermission("payroll.salary");
  // R3 K-5: ekspor massal angka gaji adalah titik sensitif — lapis
  // kedua sesudah izin adalah kesegaran sesi (maks 1 jam sejak masuk).
  requireFreshSession(ctx);
  const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) {
    return new Response("Parameter runId wajib diisi.", { status: 400 });
  }

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [run] = await tx
      .select({ period: payrollRuns.period })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ctx.company.id), eq(payrollRuns.id, runId)))
      .limit(1);
    if (!run) return null;
    const rows = await getPayrollRecap(tx, ctx.company.id, runId);
    return { run, rows };
  });
  if (!data) {
    return new Response("Run payroll tidak ditemukan.", { status: 404 });
  }

  const headers = [
    "Kode karyawan",
    "Nama",
    "Status PTKP",
    "Bruto",
    "Potongan tetap",
    ...EMPLOYEE_COLUMNS.map((column) => column.header),
    "Total iuran pekerja",
    "PPh 21",
    "Potongan kasbon",
    "Gaji bersih",
    ...EMPLOYER_COLUMNS.map((column) => column.header),
    "Total beban perusahaan",
    "Total setoran (iuran pekerja + perusahaan + PPh 21)",
  ];
  const rows = data.rows.map((row) => {
    const totalEmployee = sumRecord(row.statutoryEmployee);
    const totalEmployer = sumRecord(row.statutoryEmployer);
    const totalDeposit = toDb(d(totalEmployee).plus(d(totalEmployer)).plus(d(row.pph21)));
    return [
      row.employeeCode,
      row.employeeName,
      row.ptkpStatus ?? "",
      row.gross,
      row.regularDeductions,
      ...EMPLOYEE_COLUMNS.map((column) => row.statutoryEmployee[column.code] ?? "0"),
      totalEmployee,
      row.pph21,
      row.advanceDeduction,
      row.net,
      ...EMPLOYER_COLUMNS.map((column) => row.statutoryEmployer[column.code] ?? "0"),
      totalEmployer,
      totalDeposit,
    ];
  });
  const today = new Date().toISOString().slice(0, 10);
  const filename = `rekap-payroll-${data.run.period}-${today}`;
  if (format === "xlsx") {
    const cells: XlsxCell[][] = rows.map((row) =>
      row.map((value, index) => {
        if (index < 3) return value;
        const number = Number(value);
        return Number.isFinite(number) ? number : value;
      }),
    );
    return xlsxResponse(`${filename}.xlsx`, [
      { name: "Rekap Payroll", headers, rows: cells },
    ]);
  }
  return csvResponse(`${filename}.csv`, toCsv(headers, rows));
}

export const GET = withApiError(GETHandler);
