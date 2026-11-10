"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatIDR, formatNumber } from "@/lib/money";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { PercentInput } from "@/components/percent-input";
import { QtyInput } from "@/components/qty-input";
import { runActionResult } from "@/components/use-action-runner";
import type { ActionResult } from "@/lib/errors";
import { fieldClass, fieldWidths, labelClass } from "@/components/blocks/field-classes";
import { SettingsSection, useSettingsSection } from "@/components/blocks/settings-layout";
import {
  JKK_RISK_CLASSES,
  STATUTORY_PROGRAM_LABELS,
  type StatutoryProgramCode,
} from "@/lib/payroll-indonesia-defaults";
import {
  saveMinimumWageAction,
  savePtkpStatusAction,
  saveStatutoryParameterAction,
  saveStatutoryProgramAction,
  saveStatutorySettingsAction,
  saveTerBracketRateAction,
} from "@/server/actions/payroll-indonesia";

export interface ProgramRowData {
  program: string;
  riskClass: string | null;
  isEnabled: boolean;
  employerRate: string;
  employeeRate: string;
  wageCap: string | null;
  wageFloor: string | null;
  fundingNote: string | null;
  effectiveFrom: string;
}

export interface PtkpRowData {
  code: string;
  annualAmount: string;
  terCategory: string;
  effectiveFrom: string;
}

export interface ParameterRow {
  key: string;
  value: string;
  effectiveFrom: string;
}

export interface TerBracketRow {
  category: string;
  lowerBound: string;
  upperBound: string | null;
  rate: string;
}

export interface MinimumWageRow {
  regionCode: string;
  regionName: string;
  year: number;
  amount: string;
  decreeRef: string | null;
}

const PARAMETER_LABELS: Record<string, string> = {
  biaya_jabatan_rate: "Biaya jabatan (%)",
  biaya_jabatan_cap_year: "Batas biaya jabatan / tahun (Rp)",
  biaya_jabatan_cap_month: "Batas biaya jabatan / bulan (Rp)",
  non_npwp_surcharge_rate: "Tambahan tarif tanpa NPWP (%)",
  thr_min_months: "THR — masa kerja minimum (bulan)",
  thr_full_months: "THR — masa kerja penuh (bulan)",
  overtime_hourly_divisor: "Lembur — pembagi upah sejam",
};

/* Kunci parameter yang nilainya uang (Rp) — dirender dengan MoneyInput;
   kunci persen dirender dengan PercentInput (A-25 U6); kunci lain
   (bulan, pembagi) dirender dengan QtyInput bersama (G2/UX4-11 —
   dulu input angka polos yang menampilkan string mentah "173.0000"). */
const MONEY_PARAMETER_KEYS = new Set(["biaya_jabatan_cap_year", "biaya_jabatan_cap_month"]);
const PERCENT_PARAMETER_KEYS = new Set(["biaya_jabatan_rate", "non_npwp_surcharge_rate"]);

/**
 * A-25 U6 (POLA-05): seluruh halaman ini kini memakai pola
 * SettingsLayout — TIDAK ada lagi tombol Simpan per baris (±25
 * tombol). Setiap seksi mendaftar satu saver yang menyimpan semua
 * baris berubah di seksinya lewat aksi server yang SUDAH ada,
 * dengan payload yang persis sama seperti tombol per baris lama
 * (termasuk tanggal efektif dari draf barisnya). Saver melempar
 * bila ada baris yang gagal agar bilah simpan halaman menahan
 * status kotor seksi itu; baris yang berhasil dibersihkan drafnya.
 *
 * G2 (FRM-05): inti pola simpan (jalankan aksi → toast error bila
 * gagal) kini hidup di helper bersama `runActionResult`
 * (components/use-action-runner) — runSaver tinggal adaptor boolean
 * untuk saver seksi pengaturan di berkas ini, semantiknya sama.
 */
async function runSaver(promise: Promise<ActionResult<unknown>>): Promise<boolean> {
  return (await runActionResult(promise)) !== null;
}

export function PayrollIndonesiaSettingsForm(props: {
  today: string;
  settings: { isEnabled: boolean; pph21Enabled: boolean } | null;
  programs: ProgramRowData[];
  ptkp: PtkpRowData[];
  parameters: ParameterRow[];
  terBrackets: TerBracketRow[];
  minimumWages: MinimumWageRow[];
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [isEnabled, setIsEnabled] = useState(props.settings?.isEnabled ?? false);
  const [pph21Enabled, setPph21Enabled] = useState(props.settings?.pph21Enabled ?? true);
  const baselineRef = useRef({
    isEnabled: props.settings?.isEnabled ?? false,
    pph21Enabled: props.settings?.pph21Enabled ?? true,
  });

  async function saveSettings() {
    const ok = await runSaver(saveStatutorySettingsAction({ isEnabled, pph21Enabled }));
    if (!ok) throw new Error("Saklar gagal disimpan.");
    baselineRef.current = { isEnabled, pph21Enabled };
    refresh();
  }

  const { setDirty } = useSettingsSection("saklar", saveSettings);

  useEffect(() => {
    setDirty(
      isEnabled !== baselineRef.current.isEnabled ||
        pph21Enabled !== baselineRef.current.pph21Enabled,
    );
  }, [isEnabled, pph21Enabled, setDirty]);

  return (
    <div>
      <SettingsSection
        id="saklar"
        title="Saklar engine"
        description="Engine nonaktif = payroll berjalan generik persis seperti sebelumnya: tidak ada perhitungan PPh 21/BPJS, tidak ada baris statutory di jurnal maupun slip. Setiap program BPJS juga punya saklarnya sendiri di tabel program."
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />
            Payroll Indonesia aktif
          </label>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={pph21Enabled} onChange={(event) => setPph21Enabled(event.target.checked)} />
            Engine PPh 21 (TER + masa pajak terakhir) aktif
          </label>
          {props.settings === null ? (
            <p className="text-[11px] text-muted-foreground">
              Perusahaan ini belum memiliki konfigurasi — menyimpan saklar akan menanam konfigurasi bawaan (PTKP, TER, BPJS) lebih dulu.
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <ProgramSection programs={props.programs} today={props.today} refresh={refresh} />
      <PtkpSection rows={props.ptkp} today={props.today} refresh={refresh} />
      <ParameterSection rows={props.parameters} today={props.today} refresh={refresh} />
      <TerSection rows={props.terBrackets} today={props.today} refresh={refresh} />
      <MinimumWageSection rows={props.minimumWages} refresh={refresh} />
    </div>
  );
}

function ProgramSection({ programs, today, refresh }: { programs: ProgramRowData[]; today: string; refresh: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, ProgramRowData & { effectiveFrom: string }>>({});
  const keyOf = (row: ProgramRowData) => `${row.program}|${row.riskClass ?? ""}`;
  const draftOf = (row: ProgramRowData) => drafts[keyOf(row)] ?? { ...row, effectiveFrom: today };
  // Tanggal efektif draf selalu "hari ini" untuk baris yang belum
  // disentuh — ia BUKAN penanda perubahan (simpan lama pun menulis
  // baris bertanggal efektif baru dari tanggal pilihan). Yang
  // dihitung berubah: saklar, tarif, dan batas.
  const isChanged = (row: ProgramRowData) => {
    const draft = draftOf(row);
    return (
      draft.isEnabled !== row.isEnabled ||
      draft.employerRate !== row.employerRate ||
      draft.employeeRate !== row.employeeRate ||
      (draft.wageCap ?? "") !== (row.wageCap ?? "") ||
      (draft.wageFloor ?? "") !== (row.wageFloor ?? "")
    );
  };

  async function saveAll() {
    const changed = programs.filter(isChanged);
    let failed = false;
    for (const row of changed) {
      const draft = draftOf(row);
      const ok = await runSaver(
        saveStatutoryProgramAction({
          program: row.program as StatutoryProgramCode,
          riskClass: (row.riskClass as never) ?? null,
          isEnabled: draft.isEnabled,
          employerRate: draft.employerRate,
          employeeRate: draft.employeeRate,
          wageCap: draft.wageCap || null,
          wageFloor: draft.wageFloor || null,
          effectiveFrom: draft.effectiveFrom,
        }),
      );
      if (!ok) failed = true;
      else
        setDrafts((current) => {
          const next = { ...current };
          delete next[keyOf(row)];
          return next;
        });
    }
    if (failed) throw new Error("Sebagian program gagal disimpan.");
    if (changed.length > 0) refresh();
  }

  const { setDirty } = useSettingsSection("program", saveAll);
  const anyChanged = programs.some(isChanged);

  useEffect(() => {
    setDirty(anyChanged);
  }, [anyChanged, setDirty]);

  return (
    <SettingsSection
      id="program"
      title="Program BPJS — tarif, batas & saklar per program"
      description="Program nonaktif tidak dihitung, tidak tampil di slip, dan tidak dijurnal. JKK memiliki satu baris per kelas risiko. JKP dihitung & dilaporkan tetapi bukan beban kas perusahaan (dibiayai Pemerintah Pusat + rekomposisi), sehingga tidak masuk jurnal."
    >
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Program</th>
              <th>Aktif</th>
              <th className="text-right">Perusahaan</th>
              <th className="text-right">Pekerja</th>
              <th className="text-right">Batas upah</th>
              <th className="text-right">Batas bawah</th>
              <th>Berlaku sejak</th>
            </tr>
          </thead>
          <tbody>
            {programs.map((row) => {
              const draft = draftOf(row);
              const set = (patch: Partial<ProgramRowData & { effectiveFrom: string }>) =>
                setDrafts((current) => ({ ...current, [keyOf(row)]: { ...draft, ...patch } }));
              const riskLabel = row.riskClass
                ? JKK_RISK_CLASSES.find((entry) => entry.code === row.riskClass)?.label ?? row.riskClass
                : null;
              return (
                <tr key={keyOf(row)}>
                  <td>
                    <p className="text-[12px] font-medium">
                      {STATUTORY_PROGRAM_LABELS[row.program as StatutoryProgramCode] ?? row.program}
                      {riskLabel ? <span className="text-muted-foreground"> · {riskLabel}</span> : null}
                    </p>
                    {row.fundingNote ? (
                      <p className="max-w-105 text-[10px] leading-4 text-muted-foreground">{row.fundingNote}</p>
                    ) : null}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={draft.isEnabled}
                      onChange={(event) => set({ isEnabled: event.target.checked })}
                      aria-label={`Aktif ${row.program}`}
                    />
                  </td>
                  <td>
                    <PercentInput value={draft.employerRate} onChange={(value) => set({ employerRate: value })} className="h-9 w-24 text-[12px]" aria-label="Tarif perusahaan" />
                  </td>
                  <td>
                    <PercentInput value={draft.employeeRate} onChange={(value) => set({ employeeRate: value })} className="h-9 w-24 text-[12px]" aria-label="Tarif pekerja" />
                  </td>
                  <td>
                    {/* Nilai uang lewat MoneyInput — tampil berpemisah
                        ribuan, nilai kanonis yang disimpan identik. */}
                    <MoneyInput value={draft.wageCap ?? ""} onChange={(value) => set({ wageCap: value || null })} className="h-9 w-32 text-[12px]" placeholder="—" aria-label="Batas upah" />
                  </td>
                  <td>
                    <MoneyInput value={draft.wageFloor ?? ""} onChange={(value) => set({ wageFloor: value || null })} className="h-9 w-32 text-[12px]" placeholder="—" aria-label="Batas bawah upah" />
                  </td>
                  <td>
                    <DateField value={draft.effectiveFrom} onChange={(value) => set({ effectiveFrom: value })} className={fieldWidths.date} aria-label="Tanggal efektif" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

function PtkpSection({ rows, today, refresh }: { rows: PtkpRowData[]; today: string; refresh: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, { annualAmount: string; terCategory: string; effectiveFrom: string }>>({});
  const draftOf = (row: PtkpRowData) =>
    drafts[row.code] ?? { annualAmount: row.annualAmount, terCategory: row.terCategory, effectiveFrom: today };
  const isChanged = (row: PtkpRowData) => {
    const draft = draftOf(row);
    return draft.annualAmount !== row.annualAmount || draft.terCategory !== row.terCategory;
  };

  async function saveAll() {
    const changed = rows.filter(isChanged);
    let failed = false;
    for (const row of changed) {
      const draft = draftOf(row);
      const ok = await runSaver(
        savePtkpStatusAction({
          code: row.code,
          annualAmount: draft.annualAmount,
          terCategory: draft.terCategory as "A" | "B" | "C",
          effectiveFrom: draft.effectiveFrom,
        }),
      );
      if (!ok) failed = true;
      else
        setDrafts((current) => {
          const next = { ...current };
          delete next[row.code];
          return next;
        });
    }
    if (failed) throw new Error("Sebagian PTKP gagal disimpan.");
    if (changed.length > 0) refresh();
  }

  const { setDirty } = useSettingsSection("ptkp", saveAll);
  const anyChanged = rows.some(isChanged);

  useEffect(() => {
    setDirty(anyChanged);
  }, [anyChanged, setDirty]);

  return (
    <SettingsSection
      id="ptkp"
      title="PTKP & kategori TER"
      description="Status PTKP karyawan menentukan kategori TER-nya. Nilai bawaan mengikuti PMK 101/PMK.010/2016 dan pemetaan kategori PMK 168/2023."
    >
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th className="text-right">PTKP setahun</th>
              <th>Kategori TER</th>
              <th>Berlaku sejak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const draft = draftOf(row);
              const set = (patch: Partial<typeof draft>) =>
                setDrafts((current) => ({ ...current, [row.code]: { ...draft, ...patch } }));
              return (
                <tr key={row.code}>
                  <td className="num text-[12px] font-medium">{row.code}</td>
                  <td>
                    <MoneyInput value={draft.annualAmount} onChange={(value) => set({ annualAmount: value })} className="h-9 w-40 text-[12px]" aria-label={`PTKP ${row.code}`} />
                  </td>
                  <td>
                    <select value={draft.terCategory} onChange={(event) => set({ terCategory: event.target.value })} className={`${fieldClass} w-20`} aria-label={`Kategori TER ${row.code}`}>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                    </select>
                  </td>
                  <td>
                    <DateField value={draft.effectiveFrom} onChange={(value) => set({ effectiveFrom: value })} className={fieldWidths.date} aria-label="Tanggal efektif" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

function ParameterSection({ rows, today, refresh }: { rows: ParameterRow[]; today: string; refresh: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, { value: string; effectiveFrom: string }>>({});
  const draftOf = (row: ParameterRow) => drafts[row.key] ?? { value: row.value, effectiveFrom: today };
  const isChanged = (row: ParameterRow) => draftOf(row).value !== row.value;

  async function saveAll() {
    const changed = rows.filter(isChanged);
    let failed = false;
    for (const row of changed) {
      const draft = draftOf(row);
      const ok = await runSaver(
        saveStatutoryParameterAction({
          key: row.key as never,
          value: draft.value,
          effectiveFrom: draft.effectiveFrom,
        }),
      );
      if (!ok) failed = true;
      else
        setDrafts((current) => {
          const next = { ...current };
          delete next[row.key];
          return next;
        });
    }
    if (failed) throw new Error("Sebagian parameter gagal disimpan.");
    if (changed.length > 0) refresh();
  }

  const { setDirty } = useSettingsSection("parameter", saveAll);
  const anyChanged = rows.some(isChanged);

  useEffect(() => {
    setDirty(anyChanged);
  }, [anyChanged, setDirty]);

  return (
    <SettingsSection
      id="parameter"
      title="Parameter perhitungan"
      description="Biaya jabatan, tambahan tarif tanpa NPWP, ambang THR, dan pembagi upah sejam lembur — semuanya bertanggal efektif."
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const draft = draftOf(row);
          const set = (patch: Partial<typeof draft>) =>
            setDrafts((current) => ({ ...current, [row.key]: { ...draft, ...patch } }));
          return (
            <div key={row.key} className="flex flex-wrap items-end gap-2 rounded-md border border-border/70 p-2.5">
              <label className="min-w-44 flex-1 space-y-1">
                <span className={labelClass}>{PARAMETER_LABELS[row.key] ?? row.key}</span>
                {MONEY_PARAMETER_KEYS.has(row.key) ? (
                  <MoneyInput value={draft.value} onChange={(value) => set({ value })} className="h-9 text-[12px]" />
                ) : PERCENT_PARAMETER_KEYS.has(row.key) ? (
                  <PercentInput value={draft.value} onChange={(value) => set({ value })} className="h-9 text-[12px]" />
                ) : (
                  /* G2 (UX4-11): parameter angka polos (masa kerja
                     THR, pembagi upah sejam) kini QtyInput bersama —
                     "173.0000" tampil sebagai "173"; nilai kanonis
                     yang disimpan tidak berubah. */
                  <QtyInput value={draft.value} onChange={(value) => set({ value })} aria-label={PARAMETER_LABELS[row.key] ?? row.key} className="h-9 text-[12px]" />
                )}
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Berlaku sejak</span>
                <DateField value={draft.effectiveFrom} onChange={(value) => set({ effectiveFrom: value })} className={fieldWidths.date} aria-label="Berlaku sejak" />
              </label>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}

function TerSection({ rows, today, refresh }: { rows: TerBracketRow[]; today: string; refresh: () => void }) {
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const keyOf = (row: TerBracketRow) => `${row.category}|${row.lowerBound}`;
  const isChanged = (row: TerBracketRow) => (drafts[keyOf(row)] ?? row.rate) !== row.rate;

  async function saveAll() {
    const changed = rows.filter(isChanged);
    let failed = false;
    for (const row of changed) {
      const ok = await runSaver(
        saveTerBracketRateAction({
          category: row.category as "A" | "B" | "C",
          lowerBound: row.lowerBound,
          rate: drafts[keyOf(row)] ?? row.rate,
          effectiveFrom,
        }),
      );
      if (!ok) failed = true;
      else
        setDrafts((current) => {
          const next = { ...current };
          delete next[keyOf(row)];
          return next;
        });
    }
    if (failed) throw new Error("Sebagian tarif TER gagal disimpan.");
    if (changed.length > 0) refresh();
  }

  const { setDirty } = useSettingsSection("ter", saveAll);
  const anyChanged = rows.some(isChanged);

  useEffect(() => {
    setDirty(anyChanged);
  }, [anyChanged, setDirty]);

  return (
    <SettingsSection
      id="ter"
      title="Tabel tarif TER (Lampiran PP 58/2023)"
      description="Tarif efektif per lapisan bruto bulanan. Mengubah tarif menulis baris bertanggal efektif baru; lapisan pada run yang sudah terposting tidak berubah."
    >
      <div className="mb-3 flex items-end gap-2">
        <label className="space-y-1">
          <span className={labelClass}>Perubahan berlaku sejak</span>
          <DateField value={effectiveFrom} onChange={setEffectiveFrom} className={fieldWidths.date} aria-label="Perubahan berlaku sejak" />
        </label>
      </div>
      {(["A", "B", "C"] as const).map((category) => {
        const categoryRows = rows.filter((row) => row.category === category);
        return (
          <details key={category} className="border-t border-border first:border-t-0">
            <summary className="cursor-pointer py-2.5 text-[12px] font-semibold">
              Kategori {category} — {categoryRows.length} lapisan
            </summary>
            <div className="max-h-96 overflow-y-auto pb-3">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bruto bulanan</th>
                    <th className="text-right">Tarif</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map((row) => {
                    const key = keyOf(row);
                    return (
                      <tr key={key}>
                        <td className="num text-[11px]">
                          {formatIDR(row.lowerBound)} – {row.upperBound ? formatIDR(row.upperBound) : "∞"}
                        </td>
                        <td>
                          <PercentInput
                            value={drafts[key] ?? row.rate}
                            onChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))}
                            className="h-9 w-28 text-[12px]"
                            aria-label={`Tarif TER ${category} ${row.lowerBound}`}
                          />
                        </td>
                        <td>
                          {isChanged(row) ? (
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
                              <span aria-hidden className="size-1.5 rounded-full bg-tone-amber" />
                              Berubah
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </SettingsSection>
  );
}

function MinimumWageSection({ rows, refresh }: { rows: MinimumWageRow[]; refresh: () => void }) {
  const [form, setForm] = useState({ regionCode: "", regionName: "", year: String(new Date().getFullYear()), amount: "", decreeRef: "" });

  // Form ini MENAMBAH baris wilayah baru; ia mendaftar sebagai
  // saver agar halaman tetap satu pintu simpan. Kotor hanya bila
  // ada isian inti; saver memvalidasi kelengkapan seperti tombol
  // lama (aksi menolak data tak lengkap dengan pesannya sendiri).
  async function saveAll() {
    const ok = await runSaver(
      saveMinimumWageAction({
        regionCode: form.regionCode,
        regionName: form.regionName,
        year: Number(form.year),
        amount: form.amount,
        decreeRef: form.decreeRef || null,
      }),
    );
    if (!ok) throw new Error("Upah minimum gagal disimpan.");
    setForm({ regionCode: "", regionName: "", year: form.year, amount: "", decreeRef: "" });
    refresh();
  }

  const { setDirty } = useSettingsSection("upah-minimum", saveAll);

  useEffect(() => {
    setDirty(Boolean(form.regionCode || form.regionName || form.amount || form.decreeRef));
  }, [form, setDirty]);

  return (
    <SettingsSection
      id="upah-minimum"
      title="Upah minimum per wilayah"
      description="Dipakai pemeriksaan TC-12 saat payroll: karyawan berkode wilayah yang upahnya (pokok + tunjangan) di bawah nilai ini menghalangi posting sampai diakui eksplisit. Kode wilayah diisi pada data karyawan."
    >
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Wilayah</th>
              <th>Tahun</th>
              <th className="text-right">Upah minimum</th>
              <th>Dasar (SK)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.regionCode}|${row.year}`}>
                <td className="num text-[11px]">{row.regionCode}</td>
                <td className="text-[12px]">{row.regionName}</td>
                <td className="num text-[11px]">{row.year}</td>
                <td className="num text-right text-[12px]">{formatIDR(row.amount)}</td>
                <td className="text-[11px] text-muted-foreground">{row.decreeRef ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <label className="space-y-1">
          <span className={labelClass}>Kode wilayah</span>
          <input value={form.regionCode} onChange={(event) => setForm({ ...form, regionCode: event.target.value })} className={`${fieldClass} w-24`} placeholder="ID-JK" />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Nama wilayah</span>
          <input value={form.regionName} onChange={(event) => setForm({ ...form, regionName: event.target.value })} className={`${fieldClass} w-44`} placeholder="DKI Jakarta" />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Tahun</span>
          <input value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} inputMode="numeric" className={`${fieldClass} num w-20`} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Upah minimum</span>
          <MoneyInput value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} className="h-9 w-36 text-[12px]" placeholder={formatNumber(0)} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Nomor SK (opsional)</span>
          <input value={form.decreeRef} onChange={(event) => setForm({ ...form, decreeRef: event.target.value })} className={`${fieldClass} w-52`} />
        </label>
      </div>
    </SettingsSection>
  );
}
