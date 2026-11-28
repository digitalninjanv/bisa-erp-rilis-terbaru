"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { saveEmployeeAction } from "@/server/actions/hr/karyawan";
import { voidPayrollRunAction } from "@/server/actions/hr/payroll";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { Modal } from "@/components/blocks/modal";
import { DateField } from "@/components/date-field";

export type Employee = {
  id: string;
  code: string;
  name: string;
  position: string | null;
  baseSalary: string;
  allowances: string;
  deductions: string;
  joinedAt: string | null;
  isActive: boolean;
  nik?: string | null;
  npwp?: string | null;
  ptkpStatus?: string | null;
  contractType?: string | null;
  jkkRiskClass?: string | null;
  workRegionCode?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  managerEmployeeId?: string | null;
  branchId?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
};

export type EmployeeOrgOptions = {
  departments: { id: string; name: string; isActive: boolean }[];
  positions: { id: string; name: string; isActive: boolean }[];
  branches: { id: string; name: string }[];
  managers: { id: string; name: string }[];
};

export function EmployeeForm({
  employee,
  orgOptions,
}: {
  employee?: Employee;
  orgOptions?: EmployeeOrgOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(employee?.code ?? "");
  const [name, setName] = useState(employee?.name ?? "");
  const [position, setPosition] = useState(employee?.position ?? "");
  const [baseSalary, setBaseSalary] = useState(employee?.baseSalary ?? "0");
  const [allowances, setAllowances] = useState(employee?.allowances ?? "0");
  const [deductions, setDeductions] = useState(employee?.deductions ?? "0");
  const [joinedAt, setJoinedAt] = useState(employee?.joinedAt ?? "");
  const [isActive, setIsActive] = useState(employee?.isActive ?? true);
  const [nik, setNik] = useState(employee?.nik ?? "");
  const [npwp, setNpwp] = useState(employee?.npwp ?? "");
  const [ptkpStatus, setPtkpStatus] = useState(employee?.ptkpStatus ?? "");
  const [contractType, setContractType] = useState(employee?.contractType ?? "");
  const [jkkRiskClass, setJkkRiskClass] = useState(employee?.jkkRiskClass ?? "");
  const [workRegionCode, setWorkRegionCode] = useState(employee?.workRegionCode ?? "");
  const [departmentId, setDepartmentId] = useState(employee?.departmentId ?? "");
  const [positionId, setPositionId] = useState(employee?.positionId ?? "");
  const [managerEmployeeId, setManagerEmployeeId] = useState(employee?.managerEmployeeId ?? "");
  const [branchId, setBranchId] = useState(employee?.branchId ?? "");
  const [contractStart, setContractStart] = useState(employee?.contractStart ?? "");
  const [contractEnd, setContractEnd] = useState(employee?.contractEnd ?? "");
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
      joinedAt: joinedAt || undefined,
      isActive,
      nik: nik || undefined,
      npwp: npwp || undefined,
      ptkpStatus: ptkpStatus || undefined,
      contractType: contractType
        ? (contractType as "pkwtt" | "pkwt" | "harian" | "magang")
        : undefined,
      jkkRiskClass: jkkRiskClass
        ? (jkkRiskClass as "very_low" | "low" | "medium" | "high" | "very_high")
        : undefined,
      workRegionCode: workRegionCode || undefined,
      departmentId: departmentId || undefined,
      positionId: positionId || undefined,
      managerEmployeeId: managerEmployeeId || undefined,
      branchId: branchId || undefined,
      contractStart: contractStart || undefined,
      contractEnd: contractEnd || undefined,
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
            <p className="mb-3 text-[11px] text-muted-foreground">Isi data dasar dan nominal bulanan. Perkiraan gaji bersih = pokok + tunjangan − potongan tetap; cicilan kasbon dihitung saat proses gaji.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Kode karyawan <span className="text-destructive">*</span></span>
                <input value={code} onChange={(event) => setCode(event.target.value)} className={fieldClass} placeholder="EMP-001" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Nama lengkap <span className="text-destructive">*</span></span>
                <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Jabatan</span>
                <input value={position} onChange={(event) => setPosition(event.target.value)} className={fieldClass} placeholder="Kasir, staf gudang…" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Tanggal masuk</span>
                <DateField value={joinedAt} onChange={setJoinedAt} aria-label="Tanggal masuk" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Gaji pokok / bulan</span>
                <MoneyInput value={baseSalary} onChange={setBaseSalary} onValidityChange={markMoney("base")} aria-label="Gaji pokok" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Tunjangan tetap / bulan</span>
                <MoneyInput value={allowances} onChange={setAllowances} onValidityChange={markMoney("allow")} aria-label="Tunjangan" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Potongan tetap / bulan</span>
                <MoneyInput value={deductions} onChange={setDeductions} onValidityChange={markMoney("deduct")} aria-label="Potongan" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="flex items-center gap-2 self-end pb-1 text-[12px]">
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                Karyawan aktif
              </label>
            </div>

            <details className="mt-3 rounded-md border border-border px-3 py-2">
              <summary className="cursor-pointer text-[12px] font-semibold">
                Data statutori, kontrak & struktur organisasi
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={labelClass}>NIK</span>
                  <input value={nik} onChange={(event) => setNik(event.target.value)} className={fieldClass} />
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>NPWP</span>
                  <input value={npwp} onChange={(event) => setNpwp(event.target.value)} className={fieldClass} />
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Status PTKP</span>
                  <select value={ptkpStatus} onChange={(event) => setPtkpStatus(event.target.value)} className={fieldClass}>
                    <option value="">—</option>
                    {["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"].map((code) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Jenis kontrak</span>
                  <select value={contractType} onChange={(event) => setContractType(event.target.value)} className={fieldClass}>
                    <option value="">—</option>
                    <option value="pkwtt">PKWTT</option>
                    <option value="pkwt">PKWT</option>
                    <option value="harian">Harian</option>
                    <option value="magang">Magang</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Kelas risiko JKK</span>
                  <select value={jkkRiskClass} onChange={(event) => setJkkRiskClass(event.target.value)} className={fieldClass}>
                    <option value="">—</option>
                    <option value="very_low">Sangat rendah</option>
                    <option value="low">Rendah</option>
                    <option value="medium">Sedang</option>
                    <option value="high">Tinggi</option>
                    <option value="very_high">Sangat tinggi</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Kode wilayah upah</span>
                  <input value={workRegionCode} onChange={(event) => setWorkRegionCode(event.target.value)} className={fieldClass} placeholder="mis. 3171" />
                </label>
                {orgOptions ? (
                  <>
                    <label className="space-y-1">
                      <span className={labelClass}>Departemen</span>
                      <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={fieldClass}>
                        <option value="">—</option>
                        {orgOptions.departments.filter((row) => row.isActive).map((row) => (
                          <option key={row.id} value={row.id}>{row.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Jabatan master</span>
                      <select value={positionId} onChange={(event) => setPositionId(event.target.value)} className={fieldClass}>
                        <option value="">—</option>
                        {orgOptions.positions.filter((row) => row.isActive).map((row) => (
                          <option key={row.id} value={row.id}>{row.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Atasan</span>
                      <select value={managerEmployeeId} onChange={(event) => setManagerEmployeeId(event.target.value)} className={fieldClass}>
                        <option value="">—</option>
                        {orgOptions.managers.filter((row) => row.id !== employee?.id).map((row) => (
                          <option key={row.id} value={row.id}>{row.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Cabang</span>
                      <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className={fieldClass}>
                        <option value="">—</option>
                        {orgOptions.branches.map((row) => (
                          <option key={row.id} value={row.id}>{row.name}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                <label className="space-y-1">
                  <span className={labelClass}>Mulai kontrak</span>
                  <DateField value={contractStart} onChange={setContractStart} aria-label="Mulai kontrak" />
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Akhir kontrak</span>
                  <DateField value={contractEnd} onChange={setContractEnd} aria-label="Akhir kontrak" />
                </label>
              </div>
            </details>
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

