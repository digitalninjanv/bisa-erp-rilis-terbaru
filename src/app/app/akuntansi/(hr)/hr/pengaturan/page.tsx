import Link from "next/link";
import { withCompany } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/blocks/page-header";
import { SettingsLayout } from "@/components/blocks/settings-layout";
import { HrParametersForm, MasterOrgManager } from "@/components/akuntansi/hr-panel";
import { getHrParameters, hrParamBool, hrParamNumber, listExpiringContracts, listOrgMasters } from "@/server/hr";

export const metadata = { title: "Pengaturan HR" };
export const dynamic = "force-dynamic";

const PARAMETER_LABELS: Array<{ key: string; label: string; kind: "number" | "switch" }> = [
  { key: "working_days_per_month", label: "Hari kerja per bulan (tarif harian)", kind: "number" },
  { key: "overtime_payroll_enabled", label: "Lembur disahkan masuk payroll otomatis", kind: "switch" },
  { key: "unpaid_leave_payroll_enabled", label: "Cuti tidak berbayar memotong payroll", kind: "switch" },
  { key: "leave_carry_over_enabled", label: "Sisa cuti terbawa ke tahun berikutnya", kind: "switch" },
  { key: "contract_expiry_warning_days", label: "Peringatan kontrak berakhir (hari)", kind: "number" },
];

export default async function HrSettingsPage() {
  const ctx = await requirePermissionPage("payroll.view");
  const manageable = can(ctx, "payroll.manage");

  // withCompany (bukan read-only): getHrParameters menanam konfigurasi
  // bawaan pada kunjungan pertama perusahaan.
  const data = await withCompany(ctx.company.id, async (tx) => {
    const [org, params, expiring] = await Promise.all([
      listOrgMasters(tx, ctx.company.id),
      getHrParameters(tx, ctx.company.id),
      listExpiringContracts(tx, ctx.company.id),
    ]);
    return { deptRows: org.departments, positionRows: org.positions, params, expiring };
  });

  return (
    <div>
      <PageHeader
        title="Pengaturan HR"
        description="Master departemen dan jabatan, parameter HR perusahaan, serta peringatan kontrak yang akan berakhir."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can(ctx, "settings.manage") ? (
              <Link
                href="/app/pengaturan/payroll-indonesia"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Pengaturan PPh 21 & BPJS
              </Link>
            ) : null}
            <Link
              href="/app/akuntansi/hr"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Kembali ke ringkasan
            </Link>
          </div>
        }
      />

      {data.expiring.length > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
          <h2 className="text-[12px] font-semibold">Kontrak PKWT akan berakhir</h2>
          <ul className="mt-1 space-y-0.5">
            {data.expiring.map((row) => (
              <li key={row.employeeId} className="text-[12px]">
                <Link href={`/app/akuntansi/karyawan/${row.employeeId}`} className="font-medium transition-colors hover:underline">
                  {row.employeeName}
                </Link>{" "}
                · berakhir {row.contractEnd} ({row.daysLeft} hari lagi)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {manageable ? (
        /* A-25 U6: hub ini kini memakai pola SettingsLayout yang
           sama dengan Pengaturan — navigasi kiri jangkar tunggal
           dan SATU bilah simpan (parameter HR mendaftar sebagai
           saver seksi; master departemen/jabatan tetap CRUD dialog
           dengan simpannya sendiri). */
        <SettingsLayout
          nav={[
            { id: "departemen", label: "Departemen" },
            { id: "jabatan", label: "Jabatan" },
            { id: "parameter-hr", label: "Parameter HR" },
          ]}
        >
          <div id="departemen" className="scroll-mt-4">
            <MasterOrgManager
              kind="department"
              rows={data.deptRows.map((row) => ({ id: row.id, code: row.code, name: row.name, isActive: row.isActive }))}
            />
          </div>
          <div id="jabatan" className="mt-3 scroll-mt-4">
            <MasterOrgManager
              kind="position"
              rows={data.positionRows.map((row) => ({ id: row.id, code: row.code, name: row.name, isActive: row.isActive }))}
            />
          </div>
          <div id="parameter-hr" className="mt-3 scroll-mt-4">
            <HrParametersForm
              rows={PARAMETER_LABELS.map((row) => ({
                ...row,
                value:
                  row.kind === "switch"
                    ? hrParamBool(data.params, row.key)
                      ? "true"
                      : "false"
                    : String(hrParamNumber(data.params, row.key, 0)),
              }))}
            />
          </div>
        </SettingsLayout>
      ) : (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
          Anda hanya dapat melihat data HR. Pengelolaan memerlukan izin kelola payroll.
        </div>
      )}
    </div>
  );
}
