"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPlus, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/money-input";
import { QtyInput } from "@/components/qty-input";
import { DateField } from "@/components/date-field";
import { formatIDR } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  convertPurchaseRequestAction,
  createPurchaseRequestAction,
  decidePurchaseRequestAction,
} from "@/server/actions/purchase-requests";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { Modal } from "@/components/blocks/modal";

export type PrProductOption = { id: string; sku: string; name: string; costPrice: string };
export type PrEmployeeOption = { id: string; code: string; name: string };
export type PrDepartmentOption = { id: string; name: string };
export type PrSupplierOption = { id: string; code: string; name: string };

type DraftLine = { productId: string; qty: string; estimatedPrice: string; reason: string };

export function PurchaseRequestForm({
  products,
  employees,
  departments,
}: {
  products: PrProductOption[];
  employees: PrEmployeeOption[];
  departments: PrDepartmentOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ productId: products[0]?.id ?? "", qty: "1", estimatedPrice: products[0]?.costPrice ?? "0", reason: "" }]);
  const [busy, setBusy] = useState(false);

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function pickProduct(index: number, productId: string) {
    const product = products.find((row) => row.id === productId);
    updateLine(index, { productId, estimatedPrice: product?.costPrice ?? "0" });
  }

  const total = lines.reduce((acc, line) => acc + (Number(line.qty) || 0) * (Number(line.estimatedPrice) || 0), 0);

  async function submit() {
    const clean = lines.filter((line) => line.productId && Number(line.qty) > 0);
    if (clean.length === 0) return toast.error("Tambahkan minimal satu baris produk dengan jumlah > 0.");
    setBusy(true);
    const result = await createPurchaseRequestAction({
      requesterEmployeeId: employeeId || null,
      departmentId: departmentId || null,
      date,
      notes: notes.trim() || undefined,
      lines: clean.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        estimatedPrice: line.estimatedPrice || "0",
        reason: line.reason.trim() || undefined,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Permintaan ${result.data.number} diajukan dan menunggu pengesahan.`);
    setOpen(false);
    router.push(`/app/gudang/purchase-request/${result.data.id}`);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={products.length === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <ClipboardPlus className="size-3.5" /> Permintaan baru
      </button>
      {open ? (
        <Modal
          title="Permintaan pembelian baru"
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          wide
          submitLabel="Ajukan PR"
          busyLabel="Mengajukan…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Permintaan pembelian formal. Permintaan yang disahkan pengguna lain dapat dikonversi menjadi satu PO.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="space-y-1">
                <span className={labelClass}>Tanggal</span>
                {/* A-25 U3: DateField bersama (tampilan dd/mm/yyyy, nilai ISO) menggantikan input tanggal native. */}
                <DateField value={date} onChange={setDate} aria-label="Tanggal" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Peminta (karyawan)</span>
                <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={fieldClass}>
                  <option value="">— Saya sendiri —</option>
                  {employees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.code} · {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Departemen</span>
                <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={fieldClass}>
                  <option value="">— Tanpa departemen —</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 sm:col-span-3">
                <span className={labelClass}>Catatan</span>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="Opsional" />
              </label>
            </div>
            <div className="space-y-2 px-5 pb-2">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-[1fr_70px_120px_1fr_28px] items-end gap-1.5">
                  <label className="space-y-1">
                    {index === 0 ? <span className={labelClass}>Produk / jasa</span> : null}
                    <select value={line.productId} onChange={(event) => pickProduct(index, event.target.value)} className={fieldClass}>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} · {product.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    {index === 0 ? <span className={labelClass}>Jumlah</span> : null}
                    {/* G2 (FRM-03): QtyInput bersama menggantikan type="number" mentah. */}
                    <QtyInput value={line.qty} onChange={(value) => updateLine(index, { qty: value })} min="0" aria-label="Jumlah" className="h-9 px-2.5 text-[12px]" />
                  </label>
                  <label className="space-y-1">
                    {index === 0 ? <span className={labelClass}>Perkiraan harga</span> : null}
                    <MoneyInput value={line.estimatedPrice} onChange={(value) => updateLine(index, { estimatedPrice: value })} aria-label="Perkiraan harga" className="h-9 px-2 text-[12px]" />
                  </label>
                  <label className="space-y-1">
                    {index === 0 ? <span className={labelClass}>Alasan</span> : null}
                    <input value={line.reason} onChange={(event) => updateLine(index, { reason: event.target.value })} className={fieldClass} placeholder="Kebutuhan baris ini" />
                  </label>
                  <button
                    type="button"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    disabled={lines.length === 1}
                    className="inline-flex h-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    aria-label="Hapus baris"
                  >
                    <Minus className="size-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setLines((current) => [...current, { productId: products[0]?.id ?? "", qty: "1", estimatedPrice: products[0]?.costPrice ?? "0", reason: "" }])}
                  className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-muted"
                >
                  <Plus className="size-3" /> Tambah baris
                </button>
                <span className="text-[12px] text-muted-foreground">
                  Total perkiraan: <span className="num font-semibold text-foreground">{formatIDR(total)}</span>
                </span>
              </div>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

export function PurchaseRequestDecisionButtons({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // FIX-GDG Tahap 4 (GDG2-09): catatan/alasan lewat dialog bersama.
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  async function decide(approve: boolean, note: string) {
    setBusy(true);
    const result = await decidePurchaseRequestAction({ requestId: id, approve, note: note || undefined });
    setBusy(false);
    setDecision(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(approve ? `Permintaan ${number} disahkan.` : `Permintaan ${number} ditolak.`);
    router.refresh();
  }

  return (
    <span className="inline-flex gap-1">
      <button type="button" onClick={() => setDecision("approve")} disabled={busy} className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] hover:bg-tone-green-soft hover:text-tone-green disabled:opacity-40">
        Sahkan
      </button>
      <button type="button" onClick={() => setDecision("reject")} disabled={busy} className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40">
        Tolak
      </button>
      <ConfirmDialog
        open={decision === "approve"}
        title={`Sahkan permintaan ${number}?`}
        description="Permintaan yang disahkan dapat diteruskan menjadi pesanan pembelian."
        confirmLabel="Sahkan permintaan"
        busy={busy}
        reason={{ label: "Catatan pengesahan (opsional)", minLength: 0 }}
        onConfirm={(note) => void decide(true, note)}
        onCancel={() => setDecision(null)}
      />
      <ConfirmDialog
        open={decision === "reject"}
        title={`Tolak permintaan ${number}?`}
        description="Pengajuan berhenti di sini; alasan tampil agar pengaju tahu sebabnya."
        confirmLabel="Tolak permintaan"
        danger
        busy={busy}
        reason={{ label: "Alasan penolakan", minLength: 3 }}
        onConfirm={(note) => void decide(false, note)}
        onCancel={() => setDecision(null)}
      />
    </span>
  );
}

export function PurchaseRequestConvertForm({
  id,
  number,
  suppliers,
}: {
  id: string;
  number: string;
  suppliers: PrSupplierOption[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  async function convert() {
    if (!supplierId) return toast.error("Pilih pemasok untuk PO.");
    setBusy(true);
    const result = await convertPurchaseRequestAction({ requestId: id, supplierId, date });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Permintaan ${number} terkonversi menjadi PO ${result.data.number}.`);
    router.push(`/app/gudang/pembelian/${result.data.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1">
        <span className={labelClass}>Pemasok PO</span>
        <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className={`${fieldClass} min-w-[200px]`}>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.code} · {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className={labelClass}>Tanggal PO</span>
        {/* A-25 U3: DateField bersama menggantikan input tanggal native. */}
        <DateField value={date} onChange={setDate} aria-label="Tanggal PO" />
      </label>
      <button
        type="button"
        onClick={convert}
        disabled={busy || suppliers.length === 0}
        className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Mengonversi…" : "Konversi menjadi PO"}
      </button>
    </div>
  );
}

