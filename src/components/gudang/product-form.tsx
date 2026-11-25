"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { saveProductAction } from "@/server/actions/inventory/produk";
import { MoneyInput } from "@/components/money-input";
import { formatMargin, marginPercent, marginToneClass, priceForMargin } from "@/lib/margin";
import { QtyInput } from "@/components/qty-input";
import { useActionRunner } from "@/components/use-action-runner";
import {
  PackagingEditor,
  toRowState,
  type PackagingRowState,
} from "@/components/gudang/packaging-editor";
import type { PackagingInput } from "@/lib/packaging";
import { CustomFieldInputs } from "@/components/gudang/custom-field-inputs";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import { sortCategoryTree } from "@/lib/categories";
import { inputClass } from "@/components/blocks/field-classes";
import { Field } from "@/components/blocks/field";
import { ErrorSummary, type FormErrorItem } from "@/components/blocks/error-summary";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Option = { id: string; name: string };
// T5-3 (D-17): categories may be nested; the picker shows the tree.
type CategoryOption = { id: string; name: string; parentId?: string | null };
type UnitOption = { id: string; name: string; code: string; isActive?: boolean };

export type ProductInput = {
  id?: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  unitId: string | null;
  supplierId: string | null;
  costPrice: string;
  salePrice: string;
  minStock: string;
  trackStock: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  isTaxExempt?: boolean;
  isActive: boolean;
  notes: string | null;
  attributes?: Record<string, string> | null;
  /** Satuan Kemasan S1: daftar kemasan produk (absen = formulir tidak mengelola kemasan). */
  packagings?: PackagingInput[];
};

export function ProductForm({
  product,
  categories,
  units,
  suppliers,
  allowCost,
  allowPrice = true,
  customFields = [],
}: {
  product?: ProductInput;
  categories: CategoryOption[];
  units: UnitOption[];
  suppliers: Option[];
  allowCost: boolean;
  // FIX-GDG Tahap 3 (GDG3-11): tanpa izin inventory.price, field harga
  // produk yang SUDAH ada dikunci (server menolak perubahan harga juga);
  // produk baru tetap dapat diberi harga awal oleh inventory.manage.
  allowPrice?: boolean;
  customFields?: CustomFieldDefinition[];
}) {
  const priceLocked = Boolean(product) && !allowPrice;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // G2 (FRM-05): busy + pemeriksaan hasil kini helper submit bersama.
  const { busy, run } = useActionRunner();
  const [formErrors, setFormErrors] = useState<FormErrorItem[]>([]);
  const [form, setForm] = useState({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    categoryId: product?.categoryId ?? "",
    unitId: product?.unitId ?? "",
    supplierId: product?.supplierId ?? "",
    costPrice: product?.costPrice ?? "0",
    salePrice: product?.salePrice ?? "0",
    minStock: product?.minStock ?? "0",
    trackStock: product?.trackStock ?? true,
    trackBatch: product?.trackBatch ?? false,
    trackSerial: product?.trackSerial ?? false,
    isTaxExempt: product?.isTaxExempt ?? false,
    isActive: product?.isActive ?? true,
    notes: product?.notes ?? "",
  });
  const isDirty =
    form.name !== (product?.name ?? "") ||
    form.sku !== (product?.sku ?? "") ||
    form.barcode !== (product?.barcode ?? "") ||
    form.categoryId !== (product?.categoryId ?? "") ||
    form.unitId !== (product?.unitId ?? "") ||
    form.supplierId !== (product?.supplierId ?? "") ||
    form.costPrice !== (product?.costPrice ?? "0") ||
    form.salePrice !== (product?.salePrice ?? "0") ||
    form.isTaxExempt !== (product?.isTaxExempt ?? false) ||
    form.notes !== (product?.notes ?? "");
  const [customValues, setCustomValues] = useState<Record<string, string>>(
    () => ({ ...(product?.attributes ?? {}) }),
  );
  const [packagingRows, setPackagingRows] = useState<PackagingRowState[]>(() =>
    (product?.packagings ?? []).map((row, index) => toRowState(row, row.id ?? `row-${index}`)),
  );
  // Kemasan hanya disinkronkan bila formulir memang memuatnya: formulir
  // buat-baru selalu; formulir ubah hanya bila halaman menyertakan
  // daftar kemasan produk (absen = jangan sentuh, jangan hapus).
  const packagingsManaged = !product || product.packagings !== undefined;
  // A-28 Tahap 4 (H-PGT-01): harga memakai MoneyInput bersama —
  // validitas ketikan per field menahan kirim sampai angka terbaca.
  const [invalidMoney, setInvalidMoney] = useState<Record<string, boolean>>({});
  const [targetMargin, setTargetMargin] = useState("");
  const currentMargin = marginPercent(form.costPrice, form.salePrice);
  const markMoney =
    (key: string) =>
    (valid: boolean) =>
      setInvalidMoney((prev) => ({ ...prev, [key]: !valid }));

  function applyTargetMargin() {
    if (priceLocked) return;
    const next = priceForMargin(form.costPrice, targetMargin);
    if (!next) {
      toast.error("Target margin harus antara 0 dan 99,99%.");
      return;
    }
    setForm((current) => ({ ...current, salePrice: next }));
    toast.success(`Harga jual dihitung untuk margin ${formatMargin(marginPercent(form.costPrice, next))}.`);
  }

  async function submit() {
    const errors: FormErrorItem[] = [];
    if (!form.name.trim()) errors.push({ field: "product-name", message: "Nama produk wajib diisi." });
    if (!form.sku.trim()) errors.push({ field: "product-sku", message: "SKU produk wajib diisi." });
    if (Object.values(invalidMoney).some(Boolean)) {
      errors.push({ message: "Harga belum terbaca — periksa kembali nominal harga." });
    }
    if (errors.length > 0) {
      setFormErrors(errors);
      toast.error(errors[0].message);
      return;
    }
    setFormErrors([]);
    let packagingPayload: PackagingInput[] | undefined;
    if (packagingsManaged) {
      const filled = packagingRows.filter(
        (row) => row.name.trim() || row.isi.trim() || (row.barcode ?? "").trim(),
      );
      if (filled.some((row) => !row.name.trim() || !row.isi.trim())) {
        toast.error("Baris kemasan belum lengkap — nama dan isi kemasan wajib diisi.");
        return;
      }
      packagingPayload = filled.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        name: row.name.trim(),
        isi: row.isi,
        buyPrice: row.buyPrice ? row.buyPrice : null,
        salePrice: row.salePrice ? row.salePrice : null,
        barcode: (row.barcode ?? "").trim() || null,
        isDefaultPurchase: row.isDefaultPurchase,
        isDefaultSale: row.isDefaultSale,
        isActive: row.isActive,
      }));
    }
    const result = await run(saveProductAction({
      id: product?.id,
      name: form.name,
      sku: form.sku,
      barcode: form.barcode || null,
      categoryId: form.categoryId || null,
      unitId: form.unitId || null,
      supplierId: form.supplierId || null,
      costPrice: form.costPrice,
      salePrice: form.salePrice,
      minStock: form.minStock,
      trackStock: form.trackStock,
      trackBatch: form.trackBatch,
      trackSerial: form.trackSerial,
      isTaxExempt: form.isTaxExempt,
      isActive: form.isActive,
      notes: form.notes || undefined,
      attributes: customValues,
      packagings: packagingPayload,
    }));
    if (result === null) return;
    toast.success(product ? "Produk diperbarui." : "Produk ditambahkan.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          product
            ? "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            : "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        }
      >
        {product ? <Save className="size-3.5" /> : <Plus className="size-3.5" />}
        {product ? "Ubah produk" : "Tambah produk"}
      </button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && isDirty) {
            setCancelConfirmOpen(true);
          } else {
            setOpen(next);
          }
        }}
      >
        <SheetContent side="right" className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>{product ? "Ubah produk" : "Produk baru"}</SheetTitle>
            <SheetDescription>
              Master data produk, SKU, barcode, harga jual, margin, dan pelacakan inventori.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <ErrorSummary errors={formErrors} className="mb-4" />
            <p className="mb-3 text-[11px] text-muted-foreground">SKU dan barcode harus unik di perusahaan ini.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nama produk" className="sm:col-span-2">
                <input
                  id="product-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className={inputClass}
                  placeholder="Contoh: Indomie Goreng 85g"
                />
              </Field>
              <Field label="SKU">
                <input id="product-sku" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} className={inputClass} placeholder="SKU-00001" />
              </Field>
              <Field label="Barcode">
                <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} className={inputClass} placeholder="899…" />
              </Field>
              <Field label="Kategori">
                <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className={inputClass}>
                  <option value="">Tanpa kategori</option>
                  {sortCategoryTree(categories.map((row) => ({ ...row, parentId: row.parentId ?? null }))).map((row) => (
                    <option key={row.id} value={row.id}>
                      {"— ".repeat(row.depth)}
                      {row.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Satuan">
                <select value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })} className={inputClass}>
                  <option value="">Tanpa satuan</option>
                  {units.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} ({row.code}){row.isActive === false ? " — nonaktif" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pemasok utama">
                <select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })} className={inputClass}>
                  <option value="">Tanpa pemasok</option>
                  {suppliers.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Stok minimum">
                {/* G2 (FRM-03): stok minimum kini QtyInput bersama. */}
                <QtyInput value={form.minStock} onChange={(value) => setForm({ ...form, minStock: value })} aria-label="Stok minimum" className="h-9 px-2.5 text-[12px]" />
              </Field>
              {allowCost ? (
                <Field label={product?.id ? "HPP Sistem (Moving Average)" : "Harga beli awal (HPP)"}>
                  <MoneyInput
                    value={form.costPrice}
                    onChange={(value) => setForm({ ...form, costPrice: value })}
                    onValidityChange={markMoney("cost")}
                    disabled={priceLocked || Boolean(product?.id)}
                    aria-label="Harga beli (HPP)"
                    className="h-9 px-2.5 text-[12px]"
                  />
                  <span className="block text-[10px] leading-4 text-muted-foreground">
                    {product?.id
                      ? "Dihitung otomatis oleh mutasi stok Moving Average (AVCO). Nilai historis dijaga oleh sistem."
                      : "Harga pokok awal produk sebelum ada mutasi penerimaan."}
                  </span>
                </Field>
              ) : null}
              <Field label="Harga jual">
                <MoneyInput
                  value={form.salePrice}
                  onChange={(value) => setForm({ ...form, salePrice: value })}
                  onValidityChange={markMoney("sale")}
                  disabled={priceLocked}
                  aria-label="Harga jual"
                  className="h-9 px-2.5 text-[12px]"
                />
                {priceLocked ? (
                  <span className="block text-[10px] leading-4 text-muted-foreground">
                    Harga terkunci: mengubah harga jual &amp; harga pokok memerlukan izin &ldquo;Ubah harga produk&rdquo; (manajer ke atas). Field lain tetap dapat diubah.
                  </span>
                ) : null}
              </Field>
              {allowCost ? (
                <Field label="Margin & target" className="sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[11px]">
                      Margin saat ini{" "}
                      <span className={`num text-[12px] font-semibold ${marginToneClass(currentMargin)}`}>
                        {formatMargin(currentMargin)}
                      </span>
                    </p>
                    <label className="flex items-center gap-1.5 text-[11px]">
                      Target
                      <input
                        value={targetMargin}
                        onChange={(event) => setTargetMargin(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyTargetMargin();
                          }
                        }}
                        disabled={priceLocked}
                        inputMode="decimal"
                        placeholder="20"
                        aria-label="Target margin (%)"
                        className="num h-8 w-16 rounded border border-input bg-background px-2 text-right text-[11px] outline-none focus:border-ring"
                      />
                      %
                    </label>
                    <button
                      type="button"
                      onClick={applyTargetMargin}
                      disabled={priceLocked || !targetMargin.trim()}
                      className="h-8 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-40"
                    >
                      Hitung harga jual
                    </button>
                    <span className="text-[10px] text-muted-foreground">
                      Harga jual = HPP ÷ (1 − target%).
                    </span>
                  </div>
                </Field>
              ) : null}
              <Field label="Catatan" className="sm:col-span-2">
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={2} className={inputClass} />
              </Field>
              {customFields.length > 0 ? (
                <div className="sm:col-span-2">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Kolom kustom
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CustomFieldInputs
                      definitions={customFields}
                      values={customValues}
                      onChange={(key, value) =>
                        setCustomValues((current) => ({ ...current, [key]: value }))
                      }
                    />
                  </div>
                </div>
              ) : null}
              {packagingsManaged ? (
                <div className="sm:col-span-2">
                  <PackagingEditor
                    rows={packagingRows}
                    onRowsChange={setPackagingRows}
                    baseUnitLabel={units.find((row) => row.id === form.unitId)?.code ?? "satuan dasar"}
                    allowCost={allowCost}
                    priceLocked={priceLocked}
                    onMoneyValidity={(key, valid) =>
                      setInvalidMoney((prev) => ({ ...prev, [key]: !valid }))
                    }
                  />
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={form.trackStock} onChange={(event) => setForm({ ...form, trackStock: event.target.checked })} />
                Lacak stok
              </label>
              <label className="flex items-start gap-2 text-[12px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.trackBatch}
                  onChange={(event) => setForm({ ...form, trackBatch: event.target.checked })}
                />
                <span>
                  Lacak batch & kedaluwarsa
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Penerimaan wajib nomor batch; penjualan mengambil batch kedaluwarsa paling awal (FEFO) dan batch kedaluwarsa tidak bisa dijual. Stok lama otomatis masuk kelompok “Tanpa batch”.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.trackSerial}
                  onChange={(event) => setForm({ ...form, trackSerial: event.target.checked })}
                />
                <span>
                  Lacak nomor seri
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Penerimaan wajib daftar nomor seri unik per unit; penjualan memilih seri yang tersedia dan seri yang sama tidak bisa keluar dua kali. Stok lama tanpa seri tidak bisa dijual per seri sampai diterima ulang dengan seri.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-[12px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.isTaxExempt}
                  onChange={(event) => setForm({ ...form, isTaxExempt: event.target.checked })}
                />
                <span>
                  Bebas PPN (Non-BKP)
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    Tarif PPN otomatis 0% di kasir untuk produk sembako/bebas pajak meskipun PPN perusahaan aktif.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                Produk aktif
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border bg-card px-5 py-3">
            <span className="text-[11px] text-muted-foreground">
              {form.name ? form.name : "Draf produk baru"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isDirty) setCancelConfirmOpen(true);
                  else setOpen(false);
                }}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Menyimpan…" : product ? "Simpan perubahan" : "Simpan produk"}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Batalkan perubahan produk?"
        confirmLabel="Ya, buang perubahan"
        cancelLabel="Lanjutkan mengedit"
        danger
        onCancel={() => setCancelConfirmOpen(false)}
        onConfirm={() => {
          setCancelConfirmOpen(false);
          setOpen(false);
        }}
        description="Perubahan informasi produk yang sudah Anda ketik belum tersimpan dan akan hilang."
      />
    </>
  );
}

