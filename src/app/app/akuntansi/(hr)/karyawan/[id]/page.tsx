import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { TerminationPanel } from "@/components/akuntansi/hr-panel";
import { getEmployeeDetail } from "@/server/hr";

export const metadata = { title: "Detail Karyawan" };
export const dynamic = "force-dynamic";

const HISTORY_GROUP_LABELS: Record<string, string> = {
  position: "Jabatan",
  department: "Departemen",
  base_salary: "Gaji pokok",
  contract: "Kontrak",
  branch: "Cabang",
  manager: "Atasan",
  status: "Status",
};

// A-28 Tahap 5 (H-HR-01): kunci snapshot yang merupakan angka gaji —
// disamarkan bagi pembaca tanpa izin payroll.salary (riwayat perubahan
// gaji pokok tidak boleh menjadi jalan pintas melihat gaji).
const SALARY_SNAPSHOT_KEYS = new Set(["baseSalary", "allowances", "deductions"]);

function snapshotText(snapshot: Record<string, unknown> | null, maskSalary = false): string {
  if (!snapshot) return "—";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined || key.endsWith("Id")) continue;
    if (maskSalary && SALARY_SNAPSHOT_KEYS.has(key)) parts.push("•••");
    else if (key === "baseSalary") parts.push(formatIDR(value as string));
    else if (key === "isActive") parts.push(value ? "Aktif" : "Nonaktif");
    else parts.push(String(value));
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");
  // A-28 Tahap 5 (H-HR-01): angka gaji level field (pola
  // inventory.cost) — komponen gaji, riwayat gaji & bersih payroll
  // terakhir hanya untuk payroll.salary / payroll.manage.
  const canSeeSalary = can(ctx, "payroll.salary") || manageable;
  const { id } = await params;
  const { tab = "ringkasan" } = await searchParams;

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getEmployeeDetail(tx, ctx.company.id, id),
  );
  if (!data) notFound();
  const { person } = data;

  const tabs = [
    { key: "ringkasan", label: "Ringkasan" },
    { key: "riwayat", label: `Riwayat perubahan (${data.history.length})` },
  ];

  // A-25 U5 (HR-05): field inti yang kosong diberi nama secara
  // eksplisit beserta jalan melengkapinya — bukan lagi deretan
  // "—" yang terlihat seperti profil rusak tanpa petunjuk.
  const missingCore: string[] = [
    !data.department ? "Departemen" : null,
    !data.manager ? "Atasan langsung" : null,
    !data.branch ? "Cabang" : null,
    !person.contractType ? "Jenis kontrak" : null,
    !person.nik ? "NIK" : null,
    !person.npwp ? "NPWP" : null,
    !person.ptkpStatus ? "Status PTKP" : null,
  ].filter((value): value is string => value !== null);

  return (
    <div>
      <PageHeader
        eyebrow="HR"
        title={person.name}
        description={`${person.code} · ${data.positionName ?? "Tanpa jabatan"}${person.employmentStatus === "terminated" ? " · Sudah berhenti" : ""}`}
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/app/akuntansi/payroll" className="inline-flex h-8 items-center rounded border border-border bg-card px-2 text-[11px] transition-colors hover:bg-muted">
          ← Payroll & karyawan
        </Link>
        <Link href={`/app/akuntansi/kasbon/${person.id}`} className="inline-flex h-8 items-center rounded border border-border bg-card px-2 text-[11px] transition-colors hover:bg-muted">
          Kasbon karyawan ini
        </Link>
      </div>

      {tab === "ringkasan" && manageable && person.employmentStatus !== "terminated" && missingCore.length > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
          <p className="text-[12px]">
            <span className="font-semibold">Data kepegawaian belum lengkap:</span> {missingCore.join(", ")} masih
            kosong. Lengkapi lewat tombol <span className="font-medium">Ubah</span> pada baris karyawan ini di{" "}
            <Link href="/app/akuntansi/payroll" className="font-medium underline underline-offset-2">
              Payroll &amp; Karyawan
            </Link>
            .
          </p>
        </div>
      ) : null}

      <div className="mb-3 flex gap-1 border-b border-border">
        {tabs.map((entry) => (
          <Link
            key={entry.key}
            href={`/app/akuntansi/karyawan/${person.id}?tab=${entry.key}`}
            className={`px-3 py-2 text-[12px] ${tab === entry.key ? "border-b-2 border-primary font-semibold" : "text-muted-foreground transition-colors hover:text-foreground"}`}
          >
            {entry.label}
          </Link>
        ))}
      </div>

      {tab === "riwayat" ? (
        data.history.length === 0 ? (
          <EmptyState title="Belum ada riwayat" description="Perubahan jabatan, departemen, gaji pokok, kontrak, cabang, atasan, dan status akan tercatat di sini." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {/* A-22 K6: tabel riwayat 5 kolom dibungkus overflow-x-auto
                seperti tabel daftar lain. */}
            <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tanggal efektif</th>
                  <th>Perubahan</th>
                  <th>Sebelumnya</th>
                  <th>Sesudahnya</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[11px]">{formatDate(row.effectiveDate)}</td>
                    <td className="text-[12px] font-medium">{HISTORY_GROUP_LABELS[row.fieldGroup] ?? row.fieldGroup}</td>
                    <td className="text-[12px] text-muted-foreground">{snapshotText(row.before, !canSeeSalary)}</td>
                    <td className="text-[12px]">{snapshotText(row.after, !canSeeSalary)}</td>
                    <td className="text-[11px] text-muted-foreground">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Data kepegawaian</h2>
            </div>
            <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 px-4 py-3 text-[12px]">
              <dt className="text-muted-foreground">Departemen</dt>
              <dd>{data.department ?? "—"}</dd>
              <dt className="text-muted-foreground">Jabatan</dt>
              <dd>{data.positionName ?? "—"}</dd>
              <dt className="text-muted-foreground">Atasan langsung</dt>
              <dd>{data.manager ?? "—"}</dd>
              <dt className="text-muted-foreground">Cabang</dt>
              <dd>{data.branch ?? "—"}</dd>
              <dt className="text-muted-foreground">Jenis kontrak</dt>
              <dd>{person.contractType ?? "—"}</dd>
              <dt className="text-muted-foreground">Tanggal masuk</dt>
              <dd>{formatDate(person.joinedAt)}</dd>
              <dt className="text-muted-foreground">Kontrak</dt>
              <dd>
                {formatDate(person.contractStart)} s.d. {formatDate(person.contractEnd)}
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                {person.employmentStatus === "terminated"
                  ? `Berhenti ${person.terminationDate ? formatDate(person.terminationDate) : ""} (${person.terminationReason ?? "—"})`
                  : person.isActive
                    ? "Aktif"
                    : "Nonaktif"}
              </dd>
              {person.terminationNote ? (
                <>
                  <dt className="text-muted-foreground">Catatan berhenti</dt>
                  <dd>{person.terminationNote}</dd>
                </>
              ) : null}
            </dl>
          </section>
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Penggajian & riwayat gaji</h2>
            </div>
            <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 px-4 py-3 text-[12px]">
              {canSeeSalary ? (
                <>
                  <dt className="text-muted-foreground">Gaji pokok</dt>
                  <dd className="num">{formatIDR(person.baseSalary)}</dd>
                  <dt className="text-muted-foreground">Tunjangan</dt>
                  <dd className="num">{formatIDR(person.allowances)}</dd>
                  <dt className="text-muted-foreground">Potongan tetap</dt>
                  <dd className="num">{formatIDR(person.deductions)}</dd>
                </>
              ) : (
                <>
                  <dt className="text-muted-foreground">Angka gaji</dt>
                  <dd className="text-muted-foreground">Tidak ditampilkan (butuh izin lihat angka gaji)</dd>
                </>
              )}
              <dt className="text-muted-foreground">NIK / NPWP</dt>
              <dd>{person.nik ?? "—"} / {person.npwp ?? "—"}</dd>
              <dt className="text-muted-foreground">Status PTKP</dt>
              <dd>{person.ptkpStatus ?? "—"}</dd>
            </dl>
            {canSeeSalary && data.items.length > 0 ? (
              <div className="border-t border-border px-4 py-3">
                <h3 className="mb-1 text-[12px] font-semibold">Payroll terakhir</h3>
                <ul className="space-y-0.5">
                  {data.items.map((item) => (
                    <li key={item.number} className="flex justify-between text-[12px]">
                      <span>
                        {item.period} · <span className="num text-muted-foreground">{item.number}</span>
                        {item.status === "void" ? " (dibatalkan)" : ""}
                      </span>
                      <span className="num font-medium">{formatIDR(item.net)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      )}

      {tab === "ringkasan" && manageable ? (
        <TerminationPanel
          employeeId={person.id}
          reasons={data.terminationReasons}
          isTerminated={person.employmentStatus === "terminated"}
          hasFinalRun={data.hasFinalRun}
          openAdvance={data.openAdvance}
        />
      ) : null}
    </div>
  );
}
