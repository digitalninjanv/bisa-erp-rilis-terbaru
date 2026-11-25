"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Power, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deletePosPromotionAction,
  savePosPromotionAction,
  togglePosPromotionAction,
} from "@/server/actions/pos-promotions";
import type { PosPromotionRow } from "@/server/pos";
import { formatIDR } from "@/lib/money";
import { useActionRunner } from "@/components/use-action-runner";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { fieldClass } from "@/components/blocks/field-classes";

type ProductOption = { id: string; sku: string; name: string };

export function PromotionsManager({
  rows,
  products,
}: {
  rows: PosPromotionRow[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const formTitleId = useId();
  const nameId = useId();
  const typeId = useId();
  const valueId = useId();
  const minSubtotalId = useId();
  const productIdField = useId();
  const activeId = useId();

  const { busy, run } = useActionRunner();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"percent" | "nominal">("percent");
  const [value, setValue] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("0");
  const [productId, setProductId] = useState("");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PosPromotionRow | null>(null);

  function resetForm() {
    setEditingId(null);
    setName("");
    setType("percent");
    setValue("");
    setMinSubtotal("0");
    setProductId("");
    setActive(true);
    setFormError(null);
  }

  function startEdit(row: PosPromotionRow) {
    setEditingId(row.id);
    setName(row.name);
    setType(row.type);
    setValue(String(Number(row.value)));
    setMinSubtotal(String(Number(row.minSubtotal)));
    setProductId(row.productId ?? "");
    setActive(row.active);
    setFormError(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const trimmedName = name.trim();
    const numericVal = Number(value);
    const numericMin = Number(minSubtotal || "0");
    if (trimmedName.length < 2) {
      setFormError("Nama promo minimal 2 karakter.");
      return;
    }
    if (!Number.isFinite(numericVal) || numericVal <= 0) {
      setFormError("Nilai promo harus lebih dari 0.");
      return;
    }
    if (type === "percent" && numericVal > 100) {
      setFormError("Promo persen tidak boleh lebih dari 100%.");
      return;
    }
    if (!Number.isFinite(numericMin) || numericMin < 0) {
      setFormError("Minimal subtotal tidak boleh negatif.");
      return;
    }
    const result = await run(
      savePosPromotionAction({
        ...(editingId ? { id: editingId } : {}),
        name: trimmedName,
        type,
        value: value.trim(),
        minSubtotal: minSubtotal.trim() || "0",
        productId: productId || null,
        active,
      }),
    );
    if (result === null) return;
    toast.success(editingId ? "Promo diperbarui." : "Promo dibuat.");
    resetForm();
    router.refresh();
  }

  async function onToggle(row: PosPromotionRow) {
    const result = await run(togglePosPromotionAction({ id: row.id, active: !row.active }));
    if (result === null) return;
    toast.success(!row.active ? "Promo diaktifkan." : "Promo dinonaktifkan.");
    router.refresh();
  }

  async function onDeleteConfirm() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const result = await run(deletePosPromotionAction({ id: target.id }));
    if (result === null) return;
    toast.success(`Promo "${target.name}" dihapus.`);
    if (editingId === target.id) resetForm();
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="h-fit rounded-lg border border-border bg-card p-4">
        <h2 id={formTitleId} className="text-[13px] font-semibold">
          {editingId ? "Ubah promo POS" : "Tambah promo POS"}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Berlaku otomatis sebagai pilihan satu-klik di kasir Web maupun Desktop saat syarat terpenuhi.
        </p>

        <form onSubmit={onSubmit} aria-labelledby={formTitleId} className="mt-3 space-y-3" noValidate>
          {formError ? (
            <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="space-y-1">
            <label htmlFor={nameId} className="block text-[11px] font-medium">
              Nama promo <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input
              id={nameId}
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="Contoh: Promo Akhir Pekan -10%"
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label htmlFor={typeId} className="block text-[11px] font-medium">
                Jenis diskon
              </label>
              <select
                id={typeId}
                name="type"
                value={type}
                onChange={(event) => setType(event.target.value as "percent" | "nominal")}
                className={fieldClass}
              >
                <option value="percent">Persen (%)</option>
                <option value="nominal">Nominal / unit (Rp)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor={valueId} className="block text-[11px] font-medium">
                Nilai ({type === "percent" ? "%" : "Rp"}) <span aria-hidden="true" className="text-destructive">*</span>
              </label>
              <input
                id={valueId}
                name="value"
                type="text"
                inputMode="decimal"
                required
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder={type === "percent" ? "10" : "2000"}
                className={`${fieldClass} num text-right`}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={minSubtotalId} className="block text-[11px] font-medium">
              Minimal belanja keranjang (Rp)
            </label>
            <input
              id={minSubtotalId}
              name="minSubtotal"
              type="text"
              inputMode="decimal"
              value={minSubtotal}
              onChange={(event) => {
                setMinSubtotal(event.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="0"
              className={`${fieldClass} num text-right`}
            />
            <p className="text-[10px] text-muted-foreground">
              Isi 0 jika promo berlaku untuk belanja nominal berapa pun.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor={productIdField} className="block text-[11px] font-medium">
              Target produk
            </label>
            <select
              id={productIdField}
              name="productId"
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={fieldClass}
            >
              <option value="">Semua produk di keranjang</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              id={activeId}
              name="active"
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <label htmlFor={activeId} className="text-[12px]">
              Promo aktif
            </label>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="size-3.5" />
              {busy ? "Menyimpan…" : editingId ? "Simpan perubahan" : "Simpan promo"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] hover:bg-muted"
              >
                Batal ubah
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Daftar promo</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {rows.length} promo tercatat · promo tidak menimpa diskon manual kasir
            </p>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              size="compact"
              title="Belum ada promo POS"
              description="Tambahkan aturan promo persen atau nominal di samping agar kasir dapat menerapkannya langsung saat checkout."
              icon={<Tag className="size-4" />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Nama promo</th>
                  <th scope="col">Target</th>
                  <th scope="col" className="text-right">Nilai</th>
                  <th scope="col" className="text-right">Min. belanja</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.name}</td>
                    <td className="text-[11px] text-muted-foreground">
                      {row.productName ? `${row.productName} (${row.productSku})` : "Semua produk"}
                    </td>
                    <td className="num text-right font-medium">
                      {row.type === "percent" ? `${Number(row.value)}%` : formatIDR(row.value)}
                    </td>
                    <td className="num text-right text-muted-foreground">
                      {Number(row.minSubtotal) > 0 ? formatIDR(row.minSubtotal) : "—"}
                    </td>
                    <td>
                      <StatusBadge status={row.active ? "active" : "inactive"} />
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="h-7 rounded border border-border px-2 text-[11px] hover:bg-muted"
                        >
                          Ubah
                        </button>
                        <button
                          type="button"
                          onClick={() => void onToggle(row)}
                          disabled={busy}
                          aria-label={`${row.active ? "Nonaktifkan" : "Aktifkan"} ${row.name}`}
                          className="grid size-7 place-items-center rounded border border-border hover:bg-muted disabled:opacity-40"
                        >
                          <Power className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          disabled={busy}
                          aria-label={`Hapus ${row.name}`}
                          className="grid size-7 place-items-center rounded border border-border text-destructive hover:bg-destructive/10 disabled:opacity-40"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus promo POS?"
        description={
          deleteTarget
            ? `Promo "${deleteTarget.name}" akan dihapus permanen dan tidak lagi tersedia di kasir.`
            : undefined
        }
        confirmLabel="Ya, hapus promo"
        cancelLabel="Batal"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void onDeleteConfirm()}
      />
    </div>
  );
}
