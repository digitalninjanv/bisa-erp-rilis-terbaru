"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { toast } from "sonner";
import {
  deleteCustomerAction,
  deleteSupplierAction,
  saveCustomerAction,
  saveSupplierAction,
  toggleCustomerAction,
  toggleSupplierAction,
} from "@/server/actions/inventory/pihak";
import { checkPartySimilarityAction } from "@/server/actions/master-data";
import type { SimilarPartyMatch } from "@/server/master-data";
import { MoneyInput } from "@/components/money-input";
import { requireFilled } from "@/components/use-action-runner";
import { CustomFieldInputs } from "@/components/gudang/custom-field-inputs";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import { fieldClass } from "@/components/blocks/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { Modal } from "@/components/blocks/modal";
import { Field } from "@/components/blocks/field";
import { RowMenu } from "@/components/blocks/row-menu";

type Group = { id: string; name: string };

export type SupplierInput = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  taxId?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  paymentTermDays?: number | null;
  attributes?: Record<string, string> | null;
};

export type CustomerInput = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  groupId: string | null;
  creditLimit: string;
  taxId?: string | null;
  paymentTermDays?: number | null;
  attributes?: Record<string, string> | null;
};

export function SupplierForm({
  supplier,
  customFields = [],
  open: controlledOpen,
  onOpenChange,
}: {
  supplier?: SupplierInput;
  customFields?: CustomFieldDefinition[];
  /**
   * G3 (UX4-01): mode terkendali — pemicu dipegang pemanggil (menu
   * baris ⋯ di daftar pihak); tanpa props ini form merender tombol
   * pemicunya sendiri seperti sebelumnya (kepala daftar, halaman
   * detail).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [form, setForm] = useState({
    code: supplier?.code ?? "",
    name: supplier?.name ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    notes: supplier?.notes ?? "",
    taxId: supplier?.taxId ?? "",
    bankName: supplier?.bankName ?? "",
    bankAccountNumber: supplier?.bankAccountNumber ?? "",
    bankAccountName: supplier?.bankAccountName ?? "",
    paymentTermDays: supplier?.paymentTermDays != null ? String(supplier.paymentTermDays) : "",
  });
  const [customValues, setCustomValues] = useState<Record<string, string>>(
    () => ({ ...(supplier?.attributes ?? {}) }),
  );
  const [busy, setBusy] = useState(false);
  // S3 (§18G): peringatan lembut duplikat — tidak memblokir; pengguna
  // yang memutuskan tetap menyimpan setelah melihat kemiripannya.
  const [dupWarnings, setDupWarnings] = useState<SimilarPartyMatch[] | null>(null);

  async function submit() {
    // G2 (FRM-05): validasi wajib-isi kini helper bersama.
    if (!requireFilled(form.code, "Kode dan nama pemasok wajib diisi.") || !requireFilled(form.name, "Kode dan nama pemasok wajib diisi.")) {
      return;
    }
    if (dupWarnings === null) {
      setBusy(true);
      const check = await checkPartySimilarityAction({
        kind: "supplier",
        name: form.name,
        phone: form.phone || null,
        taxId: form.taxId || null,
        excludeId: supplier?.id,
      });
      setBusy(false);
      if (check.ok && check.data.length > 0) {
        setDupWarnings(check.data);
        return;
      }
      setDupWarnings([]);
    }
    await doSave();
  }

  async function doSave() {
    setBusy(true);
    const result = await saveSupplierAction({
      id: supplier?.id,
      code: form.code,
      name: form.name,
      phone: form.phone,
      email: form.email,
      address: form.address,
      notes: form.notes,
      taxId: form.taxId,
      bankName: form.bankName,
      bankAccountNumber: form.bankAccountNumber,
      bankAccountName: form.bankAccountName,
      paymentTermDays: form.paymentTermDays.trim() === "" ? null : Number(form.paymentTermDays),
      attributes: customValues,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(supplier ? "Pemasok diperbarui." : "Pemasok disimpan.");
    if (!supplier) {
      setForm({
        code: "", name: "", phone: "", email: "", address: "", notes: "",
        taxId: "", bankName: "", bankAccountNumber: "", bankAccountName: "", paymentTermDays: "",
      });
      setCustomValues({});
    }
    setDupWarnings(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      {onOpenChange ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            supplier
              ? "inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              : "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          }
        >
          {supplier ? <Save className="size-3" /> : <Plus className="size-3.5" />}
          {supplier ? "Ubah" : "Pemasok baru"}
        </button>
      )}
      {open ? (
        <Modal title={supplier ? "Ubah pemasok" : "Pemasok baru"} onClose={() => setOpen(false)} onSubmit={submit} busy={busy}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Kode"><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className={fieldClass} /></Field>
            <Field label="Nama"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} /></Field>
            <Field label="Telepon"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={fieldClass} /></Field>
            <Field label="Email"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={fieldClass} /></Field>
            <Field label="Alamat" className="sm:col-span-2"><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className={fieldClass} /></Field>
            <Field label="NPWP"><input value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} className={`${fieldClass} num`} /></Field>
            <Field label="Termin pembayaran (hari)"><input value={form.paymentTermDays} onChange={(event) => setForm({ ...form, paymentTermDays: event.target.value })} inputMode="numeric" className={`${fieldClass} num text-right`} /></Field>
            <Field label="Nama bank"><input value={form.bankName} onChange={(event) => setForm({ ...form, bankName: event.target.value })} className={fieldClass} /></Field>
            <Field label="Nomor rekening"><input value={form.bankAccountNumber} onChange={(event) => setForm({ ...form, bankAccountNumber: event.target.value })} className={`${fieldClass} num`} /></Field>
            <Field label="Rekening atas nama" className="sm:col-span-2"><input value={form.bankAccountName} onChange={(event) => setForm({ ...form, bankAccountName: event.target.value })} className={fieldClass} /></Field>
            <Field label="Catatan" className="sm:col-span-2"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} className={fieldClass} /></Field>
            <CustomFieldInputs
              definitions={customFields}
              values={customValues}
              onChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
            />
          </div>
          {dupWarnings && dupWarnings.length > 0 ? (
            <DuplicateWarning
              matches={dupWarnings}
              busy={busy}
              onKeepSaving={doSave}
              onBack={() => setDupWarnings(null)}
            />
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

export function CustomerForm({
  groups,
  customer,
  customFields = [],
  open: controlledOpen,
  onOpenChange,
}: {
  groups: Group[];
  customer?: CustomerInput;
  customFields?: CustomFieldDefinition[];
  /** G3 (UX4-01): mode terkendali — lihat SupplierForm. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [form, setForm] = useState({
    code: customer?.code ?? "",
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    groupId: customer?.groupId ?? "",
    creditLimit: customer?.creditLimit ?? "0",
    taxId: customer?.taxId ?? "",
    paymentTermDays: customer?.paymentTermDays != null ? String(customer.paymentTermDays) : "",
  });
  const [customValues, setCustomValues] = useState<Record<string, string>>(
    () => ({ ...(customer?.attributes ?? {}) }),
  );
  const [busy, setBusy] = useState(false);
  // A-28 Tahap 4 (H-PGT-01): limit kredit memakai MoneyInput
  // bersama; ketikan yang belum terbaca menahan kirim.
  const [creditLimitValid, setCreditLimitValid] = useState(true);
  // S3 (§18G): peringatan lembut duplikat — sama seperti pemasok.
  const [dupWarnings, setDupWarnings] = useState<SimilarPartyMatch[] | null>(null);

  async function submit() {
    if (!requireFilled(form.code, "Kode dan nama pelanggan wajib diisi.") || !requireFilled(form.name, "Kode dan nama pelanggan wajib diisi.")) {
      return;
    }
    if (!creditLimitValid) {
      toast.error("Limit kredit belum terbaca — periksa kembali nominalnya.");
      return;
    }
    if (dupWarnings === null) {
      setBusy(true);
      const check = await checkPartySimilarityAction({
        kind: "customer",
        name: form.name,
        phone: form.phone || null,
        taxId: form.taxId || null,
        excludeId: customer?.id,
      });
      setBusy(false);
      if (check.ok && check.data.length > 0) {
        setDupWarnings(check.data);
        return;
      }
      setDupWarnings([]);
    }
    await doSave();
  }

  async function doSave() {
    setBusy(true);
    const result = await saveCustomerAction({
      id: customer?.id,
      code: form.code,
      name: form.name,
      phone: form.phone,
      email: form.email,
      address: form.address,
      groupId: form.groupId || null,
      creditLimit: form.creditLimit,
      taxId: form.taxId,
      paymentTermDays: form.paymentTermDays.trim() === "" ? null : Number(form.paymentTermDays),
      attributes: customValues,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(customer ? "Pelanggan diperbarui." : "Pelanggan disimpan.");
    if (!customer) {
      setForm({
        code: "", name: "", phone: "", email: "", address: "",
        groupId: "", creditLimit: "0", taxId: "", paymentTermDays: "",
      });
      setCustomValues({});
    }
    setDupWarnings(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      {onOpenChange ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={
            customer
              ? "inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              : "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          }
        >
          {customer ? <Save className="size-3" /> : <Plus className="size-3.5" />}
          {customer ? "Ubah" : "Pelanggan baru"}
        </button>
      )}
      {open ? (
        <Modal title={customer ? "Ubah pelanggan" : "Pelanggan baru"} onClose={() => setOpen(false)} onSubmit={submit} busy={busy}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Kode"><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className={fieldClass} /></Field>
            <Field label="Nama"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} /></Field>
            <Field label="Telepon"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={fieldClass} /></Field>
            <Field label="Email"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={fieldClass} /></Field>
            <Field label="Grup pelanggan">
              <select value={form.groupId} onChange={(event) => setForm({ ...form, groupId: event.target.value })} className={fieldClass}>
                <option value="">Tanpa grup</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Limit kredit">
              <MoneyInput
                value={form.creditLimit}
                onChange={(value) => setForm({ ...form, creditLimit: value })}
                onValidityChange={setCreditLimitValid}
                aria-label="Limit kredit"
                className="h-9 px-2.5 text-[12px]"
              />
            </Field>
            <Field label="NPWP / NIK"><input value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} className={`${fieldClass} num`} /></Field>
            <Field label="Termin pembayaran (hari)"><input value={form.paymentTermDays} onChange={(event) => setForm({ ...form, paymentTermDays: event.target.value })} inputMode="numeric" className={`${fieldClass} num text-right`} /></Field>
            <Field label="Alamat" className="sm:col-span-2"><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className={fieldClass} /></Field>
            <CustomFieldInputs
              definitions={customFields}
              values={customValues}
              onChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
            />
          </div>
          {dupWarnings && dupWarnings.length > 0 ? (
            <DuplicateWarning
              matches={dupWarnings}
              busy={busy}
              onKeepSaving={doSave}
              onBack={() => setDupWarnings(null)}
            />
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

/**
 * S3 (§18G): kotak peringatan kemiripan pihak di formulir — menampilkan
 * pihak yang mirip beserta alasannya; menyimpan tetap dimungkinkan.
 */
function DuplicateWarning({
  matches,
  busy,
  onKeepSaving,
  onBack,
}: {
  matches: SimilarPartyMatch[];
  busy: boolean;
  onKeepSaving: () => void;
  onBack: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-tone-amber/40 bg-tone-amber-soft px-3 py-2">
      <p className="text-[11px] font-semibold text-tone-amber">
        Kemungkinan duplikat — pihak berikut sudah ada dan mirip:
      </p>
      <ul className="mt-1 list-disc pl-4 text-[11px] text-tone-amber">
        {matches.slice(0, 5).map((match) => (
          <li key={match.id}>
            {match.name} ({match.code}){match.isActive ? "" : " — Nonaktif"}: {match.reasons.join(", ")}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onKeepSaving}
          disabled={busy}
          className="h-8 rounded-md bg-tone-amber px-2.5 text-[11px] font-medium text-white hover:bg-tone-amber/90 disabled:opacity-50"
        >
          Tetap simpan
        </button>
        <button
          type="button"
          onClick={onBack}
          className="h-8 rounded-md border border-tone-amber/40 px-2.5 text-[11px] hover:bg-tone-amber-soft"
        >
          Kembali periksa
        </button>
      </div>
    </div>
  );
}

/**
 * G3 (UX4-01): aksi baris daftar pihak kini SATU menu ⋯ (RowMenu
 * bersama, pola Produk) — sebelumnya tombol "Ubah" dari form + dua
 * tombol permanen "Nonaktifkan" + "Hapus" di setiap baris. Ubah
 * membuka form yang sama dalam mode terkendali; Hapus tetap
 * ber-ConfirmDialog menyebut nama pihak.
 */
function usePartyRowActions(kind: "supplier" | "customer", id: string, name: string, isActive: boolean) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const label = kind === "supplier" ? "pemasok" : "pelanggan";
  const Label = kind === "supplier" ? "Pemasok" : "Pelanggan";

  async function toggle() {
    setBusy(true);
    const result =
      kind === "supplier"
        ? await toggleSupplierAction({ id, isActive: !isActive })
        : await toggleCustomerAction({ id, isActive: !isActive });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(isActive ? `${Label} dinonaktifkan.` : `${Label} diaktifkan.`);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = kind === "supplier" ? await deleteSupplierAction(id) : await deleteCustomerAction(id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${Label} dihapus.`);
    router.refresh();
  }

  return { busy, confirming, setConfirming, toggle, remove, label, Label, name, isActive };
}

function PartyRowMenu({
  actions,
  onEdit,
}: {
  actions: ReturnType<typeof usePartyRowActions>;
  onEdit: () => void;
}) {
  return (
    <>
      <RowMenu
        label={`Aksi untuk ${actions.label} ${actions.name}`}
        items={[
          { key: "edit", label: "Ubah" },
          { key: "toggle", label: actions.isActive ? "Nonaktifkan" : "Aktifkan", disabled: actions.busy },
          { key: "delete", label: "Hapus", danger: true, disabled: actions.busy },
        ]}
        onAction={(key) => {
          if (key === "edit") onEdit();
          if (key === "toggle") void actions.toggle();
          if (key === "delete") actions.setConfirming(true);
        }}
      />
      <ConfirmDialog
        open={actions.confirming}
        title={`Hapus ${actions.label} "${actions.name}"?`}
        description={`${actions.Label} yang sudah bertransaksi tidak bisa dihapus — server akan menolaknya. Penghapusan ini permanen.`}
        confirmLabel={`Hapus ${actions.label}`}
        danger
        busy={actions.busy}
        onConfirm={() => void actions.remove()}
        onCancel={() => actions.setConfirming(false)}
      />
    </>
  );
}

export function SupplierRowActions({
  supplier,
  customFields = [],
}: {
  supplier: SupplierInput & { isActive: boolean };
  customFields?: CustomFieldDefinition[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const actions = usePartyRowActions("supplier", supplier.id, supplier.name, supplier.isActive);
  return (
    <div className="flex items-center justify-end gap-1">
      <SupplierForm supplier={supplier} customFields={customFields} open={editOpen} onOpenChange={setEditOpen} />
      <PartyRowMenu actions={actions} onEdit={() => setEditOpen(true)} />
    </div>
  );
}

export function CustomerRowActions({
  customer,
  groups,
  customFields = [],
}: {
  customer: CustomerInput & { isActive: boolean };
  groups: Group[];
  customFields?: CustomFieldDefinition[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const actions = usePartyRowActions("customer", customer.id, customer.name, customer.isActive);
  return (
    <div className="flex items-center justify-end gap-1">
      <CustomerForm groups={groups} customer={customer} customFields={customFields} open={editOpen} onOpenChange={setEditOpen} />
      <PartyRowMenu actions={actions} onEdit={() => setEditOpen(true)} />
    </div>
  );
}
