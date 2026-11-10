"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { DateField } from "@/components/date-field";
import { MoneyInput } from "@/components/money-input";
import { saveEmployeeAction } from "@/server/actions/hr/karyawan";
import { voidPayrollRunAction } from "@/server/actions/hr/payroll";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { Modal } from "@/components/blocks/modal";

export type Employee = {
  id: string;
  code: string;
  name: string;
  position: string | null;
  baseSalary: string;
  allowances: string;
  deductions: string;
  isActive: boolean;
  // SIM-2 S2: field Payroll Indonesia (opsional).
  nik?: string | null;
  npwp?: string | null;
  ptkpStatus?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  contractType?: string | null;
  jkkRiskClass?: string | null;
  workRegionCode?: string | null;
  statutoryEnrollments?: Record<string, boolean>;
  // SIM-2 S7B-1: struktur organisasi & kontrak (opsional).
  departmentId?: string | null;
  positionId?: string | null;
  managerEmployeeId?: string | null;
  branchId?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
};

export type OrgOption = { id: string; name: string; isActive: boolean };
export type OrgOptions = {
  departments: OrgOption[];
  positions: OrgOption[];
  branches: OrgOption[];
  managers: Array<{ id: string; name: string }>;
};

const PTKP_CODES = ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"];
const PROGRAM_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "bpjs_kes", label: "BPJS Kesehatan" },
  { code: "jht", label: "JHT" },
  { code: "jkk", label: "JKK" },
  { code: "jkm", label: "JKM" },
  { code: "jp", label: "JP" },
  { code: "jkp", label: "JKP" },
];

export function EmployeeForm({
  employee,
  orgOptions,
}: {
  employee?: Employee;
  orgOptions?: OrgOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(employee?.code ?? "");
  const [name, setName] = useState(employee?.name ?? "");
  const [position, setPosition] = useState(employee?.position ?? "");
  const [departmentId, setDepartmentId] = useState(employee?.departmentId ?? "");
  const [positionId, setPositionId] = useState(employee?.positionId ?? "");
  const [managerEmployeeId, setManagerEmployeeId] = useState(employee?.managerEmployeeId ?? "");
  const [branchId, setBranchId] = useState(employee?.branchId ?? "");
  const [contractStart, setContractStart] = useState(employee?.contractStart ?? "");
  const [contractEnd, setContractEnd] = useState(employee?.contractEnd ?? "");
  const [baseSalary, setBaseSalary] = useState(employee?.baseSalary ?? "0");
  const [allowances, setAllowances] = useState(employee?.allowances ?? "0");
  const [deductions, setDeductions] = useState(employee?.deductions ?? "0");
  const [isActive, setIsActive] = useState(employee?.isActive ?? true);
  const [nik, setNik] = useState(employee?.nik ?? "");
  const [npwp, setNpwp] = useState(employee?.npwp ?? "");
  const [ptkpStatus, setPtkpStatus] = useState(employee?.ptkpStatus ?? "");
  const [birthDate, setBirthDate] = useState(employee?.birthDate ?? "");
  const [gender, setGender] = useState(employee?.gender ?? "");
  const [contractType, setContractType] = useState(employee?.contractType ?? "");
  const [jkkRiskClass, setJkkRiskClass] = useState(employee?.jkkRiskClass ?? "");
  const [workRegionCode, setWorkRegionCode] = useState(employee?.workRegionCode ?? "");
  const [enrollments, setEnrollments] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      PROGRAM_OPTIONS.map((option) => [option.code, employee?.statutoryEnrollments?.[option.code] ?? true]),
    ),
  );
  const [busy, setBusy] = useState(false);
  // A-28 Tahap 4 (H-PGT-01): komponen gaji memakai MoneyInput
  // bersama; ketikan yang belum terbaca menahan kirim.
  const [invalidMoney, setInvalidMoney] = useState<Record<string, boolean>>({});
  const markMoney =
    (key: string) =>
    (valid: boolean) =>
      setInvalidMoney((prev) => ({ ...prev, [key]: !valid }));

  async function submit() {
    if (!code.trim() || name.trim().length < 2) {
      toast.error("Kode dan nama karyawan wajib diisi.");
      return;
    }
    if (Object.values(invalidMoney).some(Boolean)) {
      toast.error("Komponen gaji belum terbaca — periksa kembali nominal gaji.");
      return;
    }
    setBusy(true);
    const result = await saveEmployeeAction({
      id: employee?.id,
      code,
      name,
      position: position || undefined,
      baseSalary,
      allowances: allowances || "0",
      deductions: deductions || "0",
      isActive,
      nik: nik || "",
      npwp: npwp || "",
      ptkpStatus: ptkpStatus || "",
      birthDate: birthDate || "",
      gender: (gender || undefined) as "male" | "female" | undefined,
      contractType: (contractType || undefined) as "pkwtt" | "pkwt" | "harian" | "magang" | undefined,
      jkkRiskClass: (jkkRiskClass || undefined) as
        | "very_low"
        | "low"
        | "medium"
        | "high"
        | "very_high"
        | undefined,
      workRegionCode: workRegionCode || "",
      statutoryEnrollments: enrollments as Record<
        "bpjs_kes" | "jht" | "jkk" | "jkm" | "jp" | "jkp",
        boolean
      >,
      departmentId: departmentId || null,
      positionId: positionId || null,
      managerEmployeeId: managerEmployeeId || null,
      branchId: branchId || null,
      contractStart: contractStart || null,
      contractEnd: contractEnd || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Data karyawan disimpan.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          employee
            ? "inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] hover:bg-muted"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
        }
      >
        {employee ? <Save className="size-3" /> : <UserPlus className="size-3.5" />}
        {employee ? "Ubah" : "Karyawan baru"}
      </button>

      {open ? (
        <Modal
          title={employee ? "Ubah karyawan" : "Karyawan baru"}
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Gaji bersih = gaji pokok + tunjangan − potongan.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Kode</span>
                <input value={code} onChange={(event) => setCode(event.target.value)} className={fieldClass} placeholder="EMP-001" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Nama</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Jabatan</span>
                <input value={position} onChange={(event) => setPosition(event.target.value)} className={fieldClass} placeholder="Kasir, staf gudang…" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Gaji pokok</span>
                <MoneyInput value={baseSalary} onChange={setBaseSalary} onValidityChange={markMoney("base")} aria-label="Gaji pokok" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Tunjangan</span>
                <MoneyInput value={allowances} onChange={setAllowances} onValidityChange={markMoney("allow")} aria-label="Tunjangan" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Potongan</span>
                <MoneyInput value={deductions} onChange={setDeductions} onValidityChange={markMoney("deduct")} aria-label="Potongan" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="flex items-center gap-2 self-end pb-1 text-[12px]">
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                Karyawan aktif
              </label>
              <fieldset className="rounded-md border border-border/80 p-3 sm:col-span-2">
                <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Organisasi & kontrak
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className={labelClass}>Departemen</span>
                    <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={fieldClass}>
                      <option value="">— tanpa departemen —</option>
                      {(orgOptions?.departments ?? []).map((option) => (
                        <option key={option.id} value={option.id} disabled={!option.isActive && option.id !== departmentId}>
                          {option.name}{option.isActive ? "" : " (nonaktif)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Jabatan (master)</span>
                    <select value={positionId} onChange={(event) => setPositionId(event.target.value)} className={fieldClass}>
                      <option value="">— pakai teks bebas di atas —</option>
                      {(orgOptions?.positions ?? []).map((option) => (
                        <option key={option.id} value={option.id} disabled={!option.isActive && option.id !== positionId}>
                          {option.name}{option.isActive ? "" : " (nonaktif)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Atasan langsung</span>
                    <select value={managerEmployeeId} onChange={(event) => setManagerEmployeeId(event.target.value)} className={fieldClass}>
                      <option value="">— tanpa atasan —</option>
                      {(orgOptions?.managers ?? [])
                        .filter((option) => option.id !== employee?.id)
                        .map((option) => (
                          <option key={option.id} value={option.id}>{option.name}</option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Cabang</span>
                    <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={fieldClass}>
                      <option value="">— tanpa cabang —</option>
                      {(orgOptions?.branches ?? []).map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Kontrak mulai</span>
                    <DateField value={contractStart} onChange={setContractStart} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Kontrak berakhir (PKWT)</span>
                    <DateField value={contractEnd} onChange={setContractEnd} />
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Perubahan jabatan, departemen, gaji pokok, dan kontrak tercatat otomatis di riwayat karyawan.
                </p>
              </fieldset>
              <fieldset className="rounded-md border border-border/80 p-3 sm:col-span-2">
                <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payroll Indonesia (PPh 21 & BPJS)
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className={labelClass}>NIK</span>
                    <input value={nik} onChange={(event) => setNik(event.target.value)} className={fieldClass} placeholder="16 digit" />
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>NPWP</span>
                    <input value={npwp} onChange={(event) => setNpwp(event.target.value)} className={fieldClass} placeholder="99.999.999.9-999.999" />
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Status PTKP</span>
                    <select value={ptkpStatus} onChange={(event) => setPtkpStatus(event.target.value)} className={fieldClass}>
                      <option value="">— belum diisi (dianggap TK/0) —</option>
                      {PTKP_CODES.map((entry) => (
                        <option key={entry} value={entry}>{entry}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Tanggal lahir</span>
                    <DateField value={birthDate} onChange={setBirthDate} />
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Jenis kelamin</span>
                    <select value={gender} onChange={(event) => setGender(event.target.value)} className={fieldClass}>
                      <option value="">—</option>
                      <option value="male">Laki-laki</option>
                      <option value="female">Perempuan</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Jenis kontrak</span>
                    <select value={contractType} onChange={(event) => setContractType(event.target.value)} className={fieldClass}>
                      <option value="">—</option>
                      <option value="pkwtt">PKWTT (tetap)</option>
                      <option value="pkwt">PKWT (kontrak)</option>
                      <option value="harian">Harian</option>
                      <option value="magang">Magang</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Kelas risiko JKK</span>
                    <select value={jkkRiskClass} onChange={(event) => setJkkRiskClass(event.target.value)} className={fieldClass}>
                      <option value="">— bawaan (sangat rendah) —</option>
                      <option value="very_low">Sangat rendah (0,24%)</option>
                      <option value="low">Rendah (0,54%)</option>
                      <option value="medium">Sedang (0,89%)</option>
                      <option value="high">Tinggi (1,27%)</option>
                      <option value="very_high">Sangat tinggi (1,74%)</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Kode wilayah kerja (upah minimum)</span>
                    <input value={workRegionCode} onChange={(event) => setWorkRegionCode(event.target.value)} className={fieldClass} placeholder="mis. ID-JK" />
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Kepesertaan program (bawaan: ikut semua program yang aktif di perusahaan):</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {PROGRAM_OPTIONS.map((option) => (
                    <label key={option.code} className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={enrollments[option.code] ?? true}
                        onChange={(event) =>
                          setEnrollments((current) => ({ ...current, [option.code]: event.target.checked }))
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

export type AdvanceProposalRow = {
  employeeId: string;
  employeeName: string;
  openTotal: string;
  proposed: string;
};

export function PayrollVoidButton({
  id,
  number,
  asMenu = false,
}: {
  id: string;
  number: string;
  /** G3 (UX4-01): menu ⋯ satu item destruktif — lihat BankTransferVoidButton. */
  asMenu?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidPayrollRunAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Payroll dibatalkan dan jurnal pembalik dibuat.");
    router.refresh();
  }

  return (
    <>
      {asMenu ? (
        <RowMenu
          label={`Aksi untuk payroll ${number}`}
          items={[{ key: "void", label: "Batalkan payroll", danger: true, disabled: busy }]}
          onAction={(key) => {
            if (key === "void") setOpen(true);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {busy ? "…" : "Batalkan"}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Batalkan payroll ${number}?`}
        description="Jurnal pembalik akan dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan payroll"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

