import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { periodRange } from "@/lib/hr";
import { formatIDR } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { DataList } from "@/components/blocks/data-list";
import { FilterChips } from "@/components/blocks/search-form";
import { StatusBadge } from "@/components/blocks/status-badge";
import {
  OvertimeDecisionButtons,
  OvertimeRequestForm,
  ThrComputeForm,
  ThrDraftVoidButton,
} from "@/components/akuntansi/hr-panel";
import { listEmployeeOptions, listOvertimeRequests, listThrDrafts } from "@/server/hr";

export const metadata = { title: "Lembur & THR" };
export const dynamic = "force-dynamic";

const DAY_TYPE_LABELS: Record<string, string> = {
  workday: "Hari kerja",
  rest_5day: "Libur (5 hari)",
  rest_6day: "Libur (6 hari)",
  shortest_day_6day: "Libur hari terpendek",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disahkan",
  rejected: "Ditolak",
};

const STATUS_FILTER_OPTIONS = [
  { label: "Semua status", value: "" },
  { label: "Menunggu", value: "pending" },
  { label: "Disahkan", value: "approved" },
  { label: "Ditolak", value: "rejected" },
];

export default async function OvertimeThrPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; status?: string }>;
}) {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");
  // A-28 Tahap 5 (H-HR-01): nominal THR adalah turunan langsung upah
  // sebulan (THR penuh = 1× gaji) — angka gaji bagi yang tak memegang
  // payroll.salary/payroll.manage. Nominal lembur per pengajuan adalah
  // nominal dokumen lemburnya sendiri, tetap ranah payroll.view.
  const canSeeSalary = can(ctx, "payroll.salary") || manageable;
  const params = await searchParams;
  const { period: rawPeriod } = params;
  const period = /^\d{4}-\d{2}$/.test(rawPeriod ?? "") ? (rawPeriod as string) : todayISO().slice(0, 7);
  const { start, end } = periodRange(period);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [staff, requests, drafts] = await Promise.all([
      listEmployeeOptions(tx, ctx.company.id, { activeOnly: true }),
      listOvertimeRequests(tx, ctx.company.id, { start, end }),
      listThrDrafts(tx, ctx.company.id, period),
    ]);
    return { staff, requests, drafts };
  });

  const filteredRequests = params.status
    ? data.requests.filter((row) => row.status === params.status)
    : data.requests;

  return (
    <div>
      <PageHeader
        title="Lembur & THR"
        description="Pengajuan lembur dengan persetujuan atasan, dan perhitungan THR menjadi draf komponen payroll — draf tidak memposting jurnal apa pun."
        actions={
          <form className="flex items-center gap-1.5" action="/app/akuntansi/hr/lembur">
            <label className="text-[12px] text-muted-foreground" htmlFor="period">Periode</label>
            <input id="period" type="month" name="period" defaultValue={period} className="h-9 rounded-md border border-input bg-background px-2 text-[12px]" />
            {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
            <button type="submit" className="h-8 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted">
              Tampilkan
            </button>
          </form>
        }
      />

      {manageable ? <OvertimeRequestForm employees={data.staff} /> : null}

      <h2 className="mb-2 mt-5 text-[13px] font-semibold">Pengajuan lembur periode {period}</h2>
      <DataList
        headerActions={
          <FilterChips
            basePath="/app/akuntansi/hr/lembur"
            param="status"
            value={params.status}
            params={{ period }}
            options={STATUS_FILTER_OPTIONS}
          />
        }
        isEmpty={filteredRequests.length === 0}
        empty={
          <EmptyState
            title="Belum ada pengajuan"
            description={
              params.status
                ? "Tidak ada pengajuan lembur dengan status ini pada periode terpilih."
                : "Belum ada pengajuan lembur pada periode ini."
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Karyawan</th>
                <th>Jenis hari</th>
                <th className="text-right">Jam</th>
                <th>Alasan</th>
                <th>Status</th>
                {manageable ? <th className="text-right">Keputusan</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRequests.map((row) => (
                <tr key={row.id}>
                  <td className="num text-[11px]">{formatDate(row.date)}</td>
                  <td className="text-[12px] font-medium">{row.employeeName}</td>
                  <td className="text-[12px]">{DAY_TYPE_LABELS[row.dayType] ?? row.dayType}</td>
                  <td className="num text-right">{row.hours}</td>
                  <td className="text-[11px] text-muted-foreground">{row.reason ?? "—"}</td>
                  <td>
                    <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />
                    {row.decisionNote ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.decisionNote}</span> : null}
                  </td>
                  {manageable ? (
                    <td className="text-right">
                      {row.status === "pending" ? <OvertimeDecisionButtons id={row.id} /> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>

      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Draf THR periode {period}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Draf masuk otomatis ke run payroll periode yang sama sebagai baris “THR”. Menghitung ulang menggantikan draf yang belum terpakai.
            </p>
          </div>
          {manageable ? <ThrComputeForm period={period} /> : null}
        </div>
        {data.drafts.length === 0 ? (
          <EmptyState title="Belum ada draf THR" description={manageable ? "Gunakan tombol Hitung THR untuk menghasilkan draf dari masa kerja & upah konfigurasi." : "Draf THR yang dihitung akan tampil di sini. Peran Anda hanya dapat melihat."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Karyawan</th>
                  <th className="text-right">Masa kerja (bulan)</th>
                  <th className="text-right">THR</th>
                  <th>Status</th>
                  {manageable ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.drafts.map((row) => (
                  <tr key={row.id}>
                    <td className="text-[12px] font-medium">{row.employeeName}</td>
                    <td className="num text-right">{String(row.basisSnapshot?.monthsOfService ?? "—")}</td>
                    <td className="num text-right font-medium">{canSeeSalary ? formatIDR(row.amount) : "•••"}</td>
                    <td className="text-[12px]">
                      {row.status === "draft" ? "Draf" : row.status === "consumed" ? "Terpakai di run" : "Dibatalkan"}
                    </td>
                    {manageable ? (
                      <td className="text-right">{row.status === "draft" ? <ThrDraftVoidButton id={row.id} /> : null}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
