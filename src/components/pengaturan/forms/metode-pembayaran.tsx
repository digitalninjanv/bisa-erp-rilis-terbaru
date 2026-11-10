/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — metode pembayaran (form & aksi baris).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { deletePaymentMethodAction, savePaymentMethodAction, setPaymentMethodActiveAction, updatePaymentMethodAction } from "@/server/actions/settings/pembayaran";
import { MoneyInput } from "@/components/money-input";
import { PercentInput } from "@/components/percent-input";
import { fieldClass } from "@/components/blocks/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { Field, Modal, type Account } from "./shared";

export type PaymentMethodInput = {
  id: string;
  code: string;
  name: string;
  type: string;
  accountId: string | null;
  instructions: string | null;
  sortOrder: number;
  // A-21 Tahap R3-A (R3-01): konfigurasi tarif fee/MDR metode.
  feeEnabled: boolean;
  feeType: string;
  feeValue: string;
};

export function PaymentMethodForm({
  accounts,
  method,
  receivableAccountId,
  customerCreditAccountId,
}: {
  accounts: Account[];
  method?: PaymentMethodInput;
  /** A-27 B3: akun kontrol utk tipe kredit — pilihan akun metode kredit adalah akun pemetaan ini, bukan kas/bank. */
  receivableAccountId?: string | null;
  customerCreditAccountId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // A-27 B3 (menutup F-02 sisi UI): pilihan akun mengikuti TIPE
  // metode — tunai→kelas cash, transfer→kelas bank, QRIS→kelas
  // clearing, kredit→akun pemetaan piutang, kredit pelanggan→akun
  // pemetaannya. Akun metode yang sedang diubah selalu ikut tampil
  // (ditandai) walau kelasnya tak lagi cocok, agar nilai saat ini
  // tidak berganti diam-diam; server tetap memvalidasi saat simpan.
  function optionsForType(type: string): Account[] {
    let list: Account[];
    if (type === "credit") {
      list = accounts.filter((row) => row.id === receivableAccountId);
    } else if (type === "customer_credit") {
      list = accounts.filter((row) => row.id === customerCreditAccountId);
    } else {
      const kind = type === "cash" ? "cash" : type === "bank" ? "bank" : "clearing";
      list = accounts.filter((row) => row.cashBankKind === kind);
    }
    if (method?.accountId && !list.some((row) => row.id === method.accountId)) {
      const own = accounts.find((row) => row.id === method.accountId);
      if (own) list = [...list, own];
    }
    return list;
  }

  const [form, setForm] = useState({
    code: method?.code ?? "",
    name: method?.name ?? "",
    type: method?.type ?? "cash",
    accountId: method?.accountId ?? optionsForType(method?.type ?? "cash")[0]?.id ?? "",
    instructions: method?.instructions ?? "",
    sortOrder: String(method?.sortOrder ?? 0),
    feeEnabled: method?.feeEnabled ?? false,
    feeType: method?.feeType ?? "none",
    feeValue: method?.feeValue ?? "0",
  });
  const [busy, setBusy] = useState(false);
  // A-28 Tahap 4 (H-PGT-01/02): nilai tarif mengikuti MODE fee —
  // persen memakai PercentInput, nominal memakai MoneyInput
  // (sebelumnya satu input type="number" step="any" yang tafsir
  // desimalnya bergantung lokal peramban). Nilai yang dikirim ke
  // server tetap string kanonis yang sama.
  const [feeValid, setFeeValid] = useState(true);
  const visibleAccounts = optionsForType(form.type);

  async function submit() {
    if ((!method && !form.code.trim()) || !form.name.trim() || !form.accountId) {
      toast.error(method ? "Nama dan akun wajib diisi." : "Kode, nama, dan akun wajib diisi.");
      return;
    }
    if (form.feeEnabled && !feeValid) {
      toast.error("Tarif fee belum terbaca — periksa kembali nilainya.");
      return;
    }
    const type = form.type as "cash" | "bank" | "qris" | "credit" | "customer_credit";
    const sortOrder = Number(form.sortOrder);
    const feePayload = {
      feeEnabled: form.feeEnabled,
      feeType: form.feeType as "none" | "fixed" | "percent",
      feeValue: form.feeValue,
    };
    setBusy(true);
    const result = method
      ? await updatePaymentMethodAction({
          id: method.id,
          name: form.name,
          type,
          accountId: form.accountId,
          instructions: form.instructions || undefined,
          sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
          ...feePayload,
        })
      : await savePaymentMethodAction({
          code: form.code,
          name: form.name,
          type,
          accountId: form.accountId,
          instructions: form.instructions || undefined,
          sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
          ...feePayload,
        });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(method ? "Metode pembayaran diperbarui." : "Metode pembayaran disimpan.");
    if (!method) {
      setForm({ code: "", name: "", type: "cash", accountId: optionsForType("cash")[0]?.id ?? "", instructions: "", sortOrder: "0", feeEnabled: false, feeType: "none", feeValue: "0" });
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          method
            ? "inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
        }
      >
        {method ? <Save className="size-3" /> : <Plus className="size-3.5" />}
        {method ? "Ubah" : "Metode baru"}
      </button>
      {open ? (
        <Modal title={method ? "Ubah metode pembayaran" : "Metode pembayaran baru"} onClose={() => setOpen(false)} onSubmit={submit} busy={busy}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Kode">
              <input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                className={fieldClass}
                placeholder="CASH"
                disabled={Boolean(method)}
              />
              {method ? (
                <p className="mt-1 text-[10px] text-muted-foreground">Kode terkunci — kode adalah identitas metode pada riwayat transaksi, jadi tidak bisa diubah sesudah dibuat.</p>
              ) : null}
            </Field>
            <Field label="Nama"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} placeholder="Tunai" /></Field>
            <Field label="Jenis">
              <select
                value={form.type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  const options = optionsForType(nextType);
                  setForm({
                    ...form,
                    type: nextType,
                    accountId: options.some((row) => row.id === form.accountId)
                      ? form.accountId
                      : options[0]?.id ?? "",
                  });
                }}
                className={fieldClass}
              >
                <option value="cash">Tunai</option>
                <option value="bank">Transfer bank</option>
                <option value="qris">QRIS</option>
                <option value="credit">Kredit / tempo</option>
                <option value="customer_credit">Kredit pelanggan (retur)</option>
              </select>
            </Field>
            <Field
              label={
                form.type === "credit"
                  ? "Akun piutang (pemetaan)"
                  : form.type === "customer_credit"
                    ? "Akun kredit pelanggan (pemetaan)"
                    : "Akun kas/bank"
              }
            >
              <select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} className={fieldClass}>
                {visibleAccounts.map((row) => (
                  <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                ))}
              </select>
              {visibleAccounts.length === 0 ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {form.type === "credit" || form.type === "customer_credit"
                    ? "Akun pemetaan untuk jenis ini belum diatur di tab Pemetaan akun."
                    : "Belum ada akun berkelas yang sesuai — buat akunnya dulu di Bagan Akun dan beri kelas kas/bank."}
                </p>
              ) : null}
            </Field>
            <Field label="Urutan tampil">
              <input type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} className={fieldClass} />
            </Field>
            <Field label="Instruksi" className="sm:col-span-2"><input value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} className={fieldClass} /></Field>
            {/* A-21 Tahap R3-A (R3-01): tarif fee/MDR metode — nilai
                awal yang selalu dapat diubah pengguna saat membayar. */}
            <div className="sm:col-span-2 rounded-md border border-border p-2">
              <label className="flex items-center gap-2 text-[12px] font-medium">
                <input
                  type="checkbox"
                  checked={form.feeEnabled}
                  onChange={(event) => setForm({ ...form, feeEnabled: event.target.checked })}
                />
                Metode ini dipotong fee / MDR
              </label>
              {form.feeEnabled ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label="Jenis tarif">
                    <select value={form.feeType} onChange={(event) => setForm({ ...form, feeType: event.target.value })} className={fieldClass}>
                      <option value="fixed">Tetap per transaksi (Rp)</option>
                      <option value="percent">Persen dari nominal (%)</option>
                    </select>
                  </Field>
                  <Field label={form.feeType === "percent" ? "Tarif — persen dari nominal" : "Tarif — nominal tetap per transaksi (Rp)"}>
                    {form.feeType === "percent" ? (
                      <PercentInput
                        value={form.feeValue}
                        onChange={(value) => setForm({ ...form, feeValue: value })}
                        onValidityChange={setFeeValid}
                        aria-label="Tarif fee persen"
                        className="h-9 px-2.5 text-[12px]"
                      />
                    ) : (
                      <MoneyInput
                        value={form.feeValue}
                        onChange={(value) => setForm({ ...form, feeValue: value })}
                        onValidityChange={setFeeValid}
                        aria-label="Tarif fee nominal"
                        className="h-9 px-2.5 text-[12px]"
                      />
                    )}
                  </Field>
                  <p className="text-[10px] text-muted-foreground sm:col-span-2">
                    Tarif ini adalah nilai awal di form pembayaran — nominal fee final selalu dapat diubah saat transaksi dan dibekukan di dokumen pembayaran.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function PaymentMethodRowActions({
  id,
  name,
  isActive,
}: {
  id: string;
  name: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function toggle() {
    setBusy(true);
    const result = await setPaymentMethodActiveAction({ id, isActive: !isActive });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(isActive ? "Metode pembayaran dinonaktifkan." : "Metode pembayaran diaktifkan.");
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = await deletePaymentMethodAction(id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Metode pembayaran dihapus.");
    router.refresh();
  }

  // G3 (UX4-01): aksi baris metode pembayaran kini satu menu ⋯
  // (pola Produk) — sebelumnya dua tombol permanen per baris.
  return (
    <>
      <RowMenu
        label={`Aksi untuk metode pembayaran ${name}`}
        items={[
          { key: "toggle", label: isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
          { key: "delete", label: "Hapus", danger: true, disabled: busy },
        ]}
        onAction={(key) => {
          if (key === "toggle") void toggle();
          if (key === "delete") setConfirming(true);
        }}
      />
      <ConfirmDialog
        open={confirming}
        title={`Hapus metode pembayaran "${name}"?`}
        description="Metode yang sudah dipakai transaksi tidak bisa dihapus — nonaktifkan saja agar tidak tampil di kasir."
        confirmLabel="Hapus metode"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
