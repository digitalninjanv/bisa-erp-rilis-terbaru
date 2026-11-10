import { withCompanyReadOnly } from "@/db/tenant";
import { getPayrollIndonesiaSettingsData } from "@/server/payroll-indonesia";
import { requirePermissionPage } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { SettingsPageFrame } from "@/components/pengaturan/settings-page-frame";
import {
  PayrollIndonesiaSettingsForm,
  type MinimumWageRow,
  type ParameterRow,
  type ProgramRowData,
  type PtkpRowData,
  type TerBracketRow,
} from "@/components/pengaturan/payroll-indonesia-form";

export const metadata = { title: "Payroll Indonesia" };
export const dynamic = "force-dynamic";

function effectiveNow<T extends { effectiveFrom: string; effectiveTo: string | null }>(
  rows: T[],
  keyOf: (row: T) => string,
  today: string,
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    if (row.effectiveFrom > today) continue;
    if (row.effectiveTo !== null && row.effectiveTo < today) continue;
    const key = keyOf(row);
    const current = byKey.get(key);
    if (!current || row.effectiveFrom > current.effectiveFrom) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export default async function PayrollIndonesiaSettingsPage() {
  const ctx = await requirePermissionPage("settings.manage");
  const today = todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getPayrollIndonesiaSettingsData(tx, ctx.company.id),
  );

  const settings = data.settingsRows[0] ?? null;
  const programs: ProgramRowData[] = effectiveNow(
    data.programRows,
    (row) => `${row.program}|${row.riskClass ?? ""}`,
    today,
  )
    .map((row) => ({
      program: row.program,
      riskClass: row.riskClass,
      isEnabled: row.isEnabled,
      employerRate: row.employerRate,
      employeeRate: row.employeeRate,
      wageCap: row.wageCap,
      wageFloor: row.wageFloor,
      fundingNote: row.fundingNote,
      effectiveFrom: row.effectiveFrom,
    }))
    .sort((a, b) => `${a.program}|${a.riskClass ?? ""}`.localeCompare(`${b.program}|${b.riskClass ?? ""}`));
  const ptkp: PtkpRowData[] = effectiveNow(data.ptkpRows, (row) => row.code, today)
    .map((row) => ({
      code: row.code,
      annualAmount: row.annualAmount,
      terCategory: row.terCategory,
      effectiveFrom: row.effectiveFrom,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const parameters: ParameterRow[] = effectiveNow(data.parameterRows, (row) => row.key, today)
    .map((row) => ({ key: row.key, value: row.value, effectiveFrom: row.effectiveFrom }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const terBrackets: TerBracketRow[] = effectiveNow(
    data.terRows,
    (row) => `${row.category}|${row.lowerBound}`,
    today,
  )
    .map((row) => ({
      category: row.category,
      lowerBound: row.lowerBound,
      upperBound: row.upperBound,
      rate: row.rate,
    }))
    .sort((a, b) =>
      a.category === b.category
        ? Number(a.lowerBound) - Number(b.lowerBound)
        : a.category.localeCompare(b.category),
    );
  const minimumWages: MinimumWageRow[] = data.wageRows
    .map((row) => ({
      regionCode: row.regionCode,
      regionName: row.regionName,
      year: row.year,
      amount: row.amount,
      decreeRef: row.decreeRef,
    }))
    .sort((a, b) => b.year - a.year || a.regionName.localeCompare(b.regionName));

  return (
    <div>
      <PageHeader
        eyebrow="Pengaturan"
        title="Payroll Indonesia"
        description="Engine PPh 21 (TER & masa pajak terakhir) dan iuran BPJS yang sepenuhnya dapat dikonfigurasi per perusahaan. Semua tarif, batas, dan kategori adalah baris konfigurasi bertanggal efektif — mengubahnya di sini mengubah hasil payroll periode berikutnya tanpa mengubah kode dan tanpa mengubah run yang sudah terposting."
      />
      {/* A-25 U6 (PNG-01/PNG-05): tautan "Kembali" dibuang.
          Validasi 2 (V-02): navigasi tunggal di sidebar cangkang;
          semua seksi form adalah saver dengan satu bilah simpan
          halaman dari bingkai. */}
      <SettingsPageFrame>
        <PayrollIndonesiaSettingsForm
          today={today}
          settings={settings ? { isEnabled: settings.isEnabled, pph21Enabled: settings.pph21Enabled } : null}
          programs={programs}
          ptkp={ptkp}
          parameters={parameters}
          terBrackets={terBrackets}
          minimumWages={minimumWages}
        />
      </SettingsPageFrame>
    </div>
  );
}
