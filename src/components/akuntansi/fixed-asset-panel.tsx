"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Play, Tags } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { PercentInput } from "@/components/percent-input";
import { formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  disposeFixedAssetAction,
  registerFixedAssetAction,
  runDepreciationAction,
  saveFixedAssetCategoryAction,
  voidDepreciationRunAction,
} from "@/server/actions/fixed-assets";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { Modal } from "@/components/blocks/modal";

export type AssetAccountOption = { id: string; label: string };
export type AssetCategoryOption = {
  id: string;
  code: string;
  name: string;
  defaultUsefulLifeMonths: number | null;
};

export function CategoryForm({ accounts }: { accounts: AssetAccountOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [life, setLife] = useState("");
  const [residualPercent, setResidualPercent] = useState("");
  // A-28 Tahap 4 (H-PGT-02): residu bawaan memakai PercentInput
  // bersama; string kanonis yang dikirim sama seperti sebelumnya.
  const [residualValid, setResidualValid] = useState(true);
  const [assetAccountId, setAssetAccountId] = useState("");
  const [accumulatedAccountId, setAccumulatedAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (code.trim().length < 1 || name.trim().length < 2) return toast.error("Kode dan nama kategori wajib diisi.");
    if (!residualValid) return toast.error("Persen residu belum terbaca — periksa kembali nilainya.");
    setBusy(true);
    const result = await saveFixedAssetCategoryAction({
      code: code.trim(),
      name: name.trim(),
      defaultUsefulLifeMonths: life ? Number(life) : null,
      defaultResidualPercent: residualPercent === "" ? null : residualPercent,
      assetAccountId: assetAccountId || null,
      accumulatedAccountId: accumulatedAccountId || null,
      expenseAccountId: expenseAccountId || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Kategori ${result.data.code} tersimpan.`);
    setOpen(false);
    setCode("");
    setName("");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
      >
        <Tags className="size-3.5" /> Kategori Baru
      </button>
      {open ? (
        <Modal
          title="Kategori aset tetap"
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Simpan kategori"
          busyLabel="Menyimpan…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Bawaan umur manfaat &amp; persen residu terisi otomatis saat registrasi. Akun per kategori (opsional) mengalahkan pemetaan akun perusahaan.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Kode</span>
                <input value={code} onChange={(event) => setCode(event.target.value)} className={fieldClass} placeholder="KND" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Nama kategori</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Kendaraan" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Umur manfaat bawaan (bulan)</span>
                <input type="number" min={1} value={life} onChange={(event) => setLife(event.target.value)} className={fieldClass} placeholder="48" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Residu bawaan (% dari harga)</span>
                <PercentInput value={residualPercent} onChange={setResidualPercent} onValidityChange={setResidualValid} aria-label="Residu bawaan (% dari harga)" className="h-9 px-2.5 text-[12px]" />
              </label>
              <AccountSelect label="Akun aset (opsional)" value={assetAccountId} onChange={setAssetAccountId} accounts={accounts} />
              <AccountSelect label="Akun akumulasi (opsional)" value={accumulatedAccountId} onChange={setAccumulatedAccountId} accounts={accounts} />
              <AccountSelect label="Akun beban penyusutan (opsional)" value={expenseAccountId} onChange={setExpenseAccountId} accounts={accounts} />
            </div>
        </Modal>
      ) : null}
    </>
  );
}

export function AssetForm({
  categories,
  sourceAccounts,
}: {
  categories: AssetCategoryOption[];
  sourceAccounts: AssetAccountOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [cost, setCost] = useState("");
  const [residual, setResidual] = useState("");
  const [life, setLife] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState(sourceAccounts[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  function pickCategory(id: string) {
    setCategoryId(id);
    const category = categories.find((row) => row.id === id);
    if (category?.defaultUsefulLifeMonths && !life) setLife(String(category.defaultUsefulLifeMonths));
  }

  async function submit() {
    if (name.trim().length < 2) return toast.error("Nama aset wajib diisi.");
    if (!cost || Number(cost) <= 0) return toast.error("Harga perolehan harus lebih dari nol.");
    if (!sourceAccountId) return toast.error("Pilih akun sumber perolehan.");
    setBusy(true);
    const result = await registerFixedAssetAction({
      name: name.trim(),
      categoryId: categoryId || null,
      acquisitionDate: date,
      cost,
      residualValue: residual === "" ? null : residual,
      usefulLifeMonths: life ? Number(life) : null,
      sourceAccountId,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Aset ${result.data.number} terdaftar — jurnal perolehan diposting.`);
    setOpen(false);
    setName("");
    setCost("");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={sourceAccounts.length === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        <Building2 className="size-3.5" /> Daftarkan Aset
      </button>
      {open ? (
        <Modal
          title="Registrasi aset tetap"
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Daftarkan aset"
          busyLabel="Mendaftarkan…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Jurnal perolehan Dr Akun Aset / Cr Akun Sumber dibuat otomatis. Penyusutan garis lurus mulai bulan perolehan.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Nama aset</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Mesin kasir + komputer" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Kategori</span>
                <select value={categoryId} onChange={(event) => pickCategory(event.target.value)} className={fieldClass}>
                  <option value="">— Tanpa kategori —</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.code} · {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Tanggal perolehan</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal perolehan" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Harga perolehan</span>
                <MoneyInput value={cost} onChange={setCost} aria-label="Harga perolehan" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Nilai residu</span>
                <MoneyInput value={residual} onChange={setResidual} aria-label="Nilai residu" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Umur manfaat (bulan)</span>
                <input type="number" min={1} value={life} onChange={(event) => setLife(event.target.value)} className={fieldClass} placeholder="dari kategori bila kosong" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Akun sumber (kas/bank/modal)</span>
                <select value={sourceAccountId} onChange={(event) => setSourceAccountId(event.target.value)} className={fieldClass}>
                  {sourceAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Catatan / nomor seri</span>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="Opsional" />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

export function DepreciationRunner() {
  const router = useRouter();
  const [period, setPeriod] = useState(() => todayISO().slice(0, 7));
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await runDepreciationAction({ period });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Penyusutan ${period} diposting: ${result.data.assetCount} aset, ${formatIDR(result.data.totalAmount)}.`);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="month"
        value={period}
        onChange={(event) => setPeriod(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-[12px]"
        aria-label="Periode penyusutan"
      />
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Play className="size-3.5" /> {busy ? "Memproses…" : "Proses Penyusutan"}
      </button>
    </span>
  );
}

export function VoidRunButton({ runId, period }: { runId: string; period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function voidRun(reason: string) {
    setBusy(true);
    const result = await voidDepreciationRunAction({ runId, reason: reason || undefined });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Penyusutan ${period} dibatalkan — jurnal dibalik.`);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        Batalkan
      </button>
      <ConfirmDialog
        open={open}
        title={`Batalkan penyusutan periode ${period}?`}
        description="Jurnal penyusutan periode ini akan dibalik."
        confirmLabel="Batalkan penyusutan"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan (opsional)", initialValue: "", minLength: 0 }}
        onConfirm={(reason) => void voidRun(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export function DisposeAssetButton({
  assetId,
  number,
  accounts,
}: {
  assetId: string;
  number: string;
  accounts: AssetAccountOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [proceeds, setProceeds] = useState("0");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function dispose() {
    if (Number(proceeds) > 0 && !accountId) return toast.error("Pilih akun penerima hasil pelepasan.");
    setBusy(true);
    const result = await disposeFixedAssetAction({
      assetId,
      date,
      proceeds,
      proceedsAccountId: accountId || accounts[0]?.id || assetId,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Aset ${number} dilepas — penyusutan berhenti & jurnal pelepasan diposting.`);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] transition-colors hover:bg-muted"
      >
        Lepas
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <DateField value={date} onChange={setDate} aria-label="Tanggal pelepasan" className="h-9 w-[132px] px-1 text-[11px]" />
      <MoneyInput value={proceeds} onChange={setProceeds} aria-label="Hasil pelepasan" className="h-9 w-[110px] px-1.5 text-[11px]" placeholder="Hasil jual" />
      <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-9 max-w-[140px] rounded border border-input bg-background px-1 text-[11px]" aria-label="Akun penerima">
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={dispose} disabled={busy} className="inline-flex h-8 items-center rounded bg-primary px-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40">
        {busy ? "…" : "OK"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px]">
        ✕
      </button>
    </span>
  );
}

function AccountSelect({
  label,
  value,
  onChange,
  accounts,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accounts: AssetAccountOption[];
}) {
  return (
    <label className="space-y-1">
      <span className={labelClass}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass}>
        <option value="">— Ikuti pemetaan —</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
          </option>
        ))}
      </select>
    </label>
  );
}

