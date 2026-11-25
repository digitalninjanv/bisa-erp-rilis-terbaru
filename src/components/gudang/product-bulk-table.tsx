"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  applyBulkEditProductsAction,
  previewBulkEditProductsAction,
} from "@/server/actions/master-data";
import type {
  BulkPreview,
  BulkProductOperation,
  BulkProductSelection,
} from "@/server/master-data";
import { formatIDR, formatQty } from "@/lib/money";
import { formatMargin, marginPercent, marginToneClass } from "@/lib/margin";
import { ProductRowActions } from "@/components/gudang/product-row-actions";
import { fieldClass } from "@/components/blocks/field-classes";
import { Modal } from "@/components/blocks/modal";
import { DataTableFloatingBar } from "@/components/blocks/data-table";

export type BulkTableRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryName: string | null;
  unitCode: string | null;
  costPrice: string;
  salePrice: string;
  minStock: string;
  stock: number;
  isActive: boolean;
  /** Satuan Kemasan S1: kemasan AKTIF produk (nama + isi ke satuan dasar). */
  packagings?: { name: string; isi: string }[];
};

type ProductSortKey = "nama" | "harga" | "stok";

/** G3 (TBL-02): kepala kolom terurut daftar produk — pola yang sama
 * dengan daftar pihak (tautan pengalih arah + aria-sort). */
function SortTh({
  label,
  sortKey,
  sort,
  href,
  className,
}: {
  label: string;
  sortKey: ProductSortKey;
  sort: { key: ProductSortKey; dir: "asc" | "desc" };
  href: string;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} className={className}>
      <Link href={href} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Urutkan per ${label.toLowerCase()}`}>
        {label}
        {active ? (
          sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />
        ) : null}
      </Link>
    </th>
  );
}

type OpKind =
  | "salePercent"
  | "saleNominal"
  | "costPercent"
  | "costNominal"
  | "category"
  | "unit"
  | "activate"
  | "deactivate"
  | "minStock";

/**
 * S3 (§18B/E): tabel produk dengan pemilihan massal + panel ubah massal
 * dua langkah (pratinjau server → konfirmasi → terapkan). Pemilihan bisa
 * per baris halaman ini atau seluruh hasil filter yang sedang aktif.
 */
export function ProductBulkTable({
  rows,
  canManage,
  canSeeCost,
  categories,
  units,
  filter,
  totalFiltered,
  sort,
  sortHrefs,
}: {
  rows: BulkTableRow[];
  canManage: boolean;
  canSeeCost: boolean;
  categories: { id: string; label: string }[];
  units: { id: string; code: string; name: string }[];
  filter: { q?: string; categoryId?: string; lowStock?: boolean };
  totalFiltered: number;
  /** G3 (TBL-02): urutan aktif + href pengalih per kolom terurut,
   * dihitung halaman (server) — sorting terjadi di fungsi baca. */
  sort: { key: "nama" | "harga" | "stok"; dir: "asc" | "desc" };
  sortHrefs: Record<"nama" | "harga" | "stok", string>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const [opKind, setOpKind] = useState<OpKind>("salePercent");
  const [value, setValue] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneSummary, setDoneSummary] = useState<string | null>(null);

  const selectionCount = allFiltered ? totalFiltered : selected.size;
  const pageAllChecked = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const selection: BulkProductSelection = useMemo(
    () =>
      allFiltered
        ? { mode: "filter", q: filter.q, categoryId: filter.categoryId, lowStock: filter.lowStock }
        : { mode: "ids", ids: [...selected] },
    [allFiltered, filter, selected],
  );

  function toggleRow(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  function buildOperation(): BulkProductOperation | null {
    switch (opKind) {
      case "salePercent":
        return value.trim() ? { kind: "price", target: "salePrice", mode: "percent", value: value.trim() } : null;
      case "saleNominal":
        return value.trim() ? { kind: "price", target: "salePrice", mode: "nominal", value: value.trim() } : null;
      case "costPercent":
        return value.trim() ? { kind: "price", target: "costPrice", mode: "percent", value: value.trim() } : null;
      case "costNominal":
        return value.trim() ? { kind: "price", target: "costPrice", mode: "nominal", value: value.trim() } : null;
      case "category":
        return { kind: "category", categoryId: categoryId || null };
      case "unit":
        return unitId ? { kind: "unit", unitId } : null;
      case "activate":
        return { kind: "active", isActive: true };
      case "deactivate":
        return { kind: "active", isActive: false };
      case "minStock":
        return value.trim() ? { kind: "minStock", value: value.trim() } : null;
    }
  }

  async function runPreview() {
    const operation = buildOperation();
    if (!operation) {
      toast.error("Lengkapi nilai operasi terlebih dahulu.");
      return;
    }
    setBusy(true);
    const result = await previewBulkEditProductsAction({ selection, operation });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setPreview(result.data);
  }

  async function runApply() {
    const operation = buildOperation();
    if (!operation || !preview) return;
    setBusy(true);
    const result = await applyBulkEditProductsAction({ selection, operation, confirm: true });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const skippedNote =
      result.data.skipped.length > 0
        ? ` ${result.data.skipped.length} produk dilewati: ${result.data.skipped
            .slice(0, 3)
            .map((row) => `${row.sku} (${row.reason})`)
            .join("; ")}${result.data.skipped.length > 3 ? "; …" : ""}`
        : "";
    setDoneSummary(
      `${result.data.appliedCount} produk diubah, ${result.data.unchangedCount} sudah sesuai (tidak diubah).${skippedNote}`,
    );
    toast.success("Ubah massal diterapkan.");
    setSelected(new Set());
    setAllFiltered(false);
    router.refresh();
  }

  function closePanel() {
    setPanelOpen(false);
    setPreview(null);
    setDoneSummary(null);
    setValue("");
  }

  return (
    <>
      {canManage && selectionCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
          <span className="text-[12px] font-medium">
            {allFiltered
              ? `Semua hasil filter dipilih (${totalFiltered} produk)`
              : `${selected.size} produk dipilih`}
          </span>
          {!allFiltered && totalFiltered > selected.size ? (
            <button
              type="button"
              onClick={() => setAllFiltered(true)}
              className="text-[11px] font-medium text-primary underline underline-offset-2"
            >
              Pilih semua hasil filter ({totalFiltered})
            </button>
          ) : null}
          {allFiltered ? (
            <button
              type="button"
              onClick={() => setAllFiltered(false)}
              className="text-[11px] font-medium text-primary underline underline-offset-2"
            >
              Kembali ke pilihan per baris
            </button>
          ) : null}
          <span className="flex-1" />
          {!allFiltered && selected.size > 0 ? (
            <Link
              href={`/app/gudang/produk/label?ids=${encodeURIComponent([...selected].join(","))}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium hover:bg-muted"
            >
              <Printer className="size-3.5" />
              Cetak label ({selected.size})
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setDoneSummary(null);
              setPanelOpen(true);
            }}
            className="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Ubah massal
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set());
              setAllFiltered(false);
            }}
            className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[11px] hover:bg-muted"
          >
            Bersihkan pilihan
          </button>
        </div>
      ) : null}

      {/* A-24 T3 (SIS-08): di bawah lg daftar tampil sebagai kartu —
          tabel lebar hanya untuk desktop. Barcode penuh tidak
          dicetak di kartu kecil (kebisingan audit); SKU tetap ada. */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="data-table">
          <thead>
            <tr>
              {canManage ? (
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua produk di halaman ini"
                    checked={allFiltered || pageAllChecked}
                    disabled={allFiltered}
                    onChange={(event) => togglePage(event.target.checked)}
                  />
                </th>
              ) : null}
              <SortTh label="Produk" sortKey="nama" sort={sort} href={sortHrefs.nama} />
              <th>Kategori</th>
              <th>Satuan</th>
              {canSeeCost ? <th className="text-right">HPP</th> : null}
              {canSeeCost ? <th className="text-right">Margin</th> : null}
              <SortTh label="Harga jual" sortKey="harga" sort={sort} href={sortHrefs.harga} className="text-right" />
              <SortTh label="Stok" sortKey="stok" sort={sort} href={sortHrefs.stok} className="text-right" />
              <th className="text-right">Min.</th>
              <th>Status</th>
              {canManage ? <th className="text-right">Aksi</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.id}>
                {canManage ? (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Pilih ${product.name}`}
                      checked={allFiltered || selected.has(product.id)}
                      disabled={allFiltered}
                      onChange={(event) => toggleRow(product.id, event.target.checked)}
                    />
                  </td>
                ) : null}
                <td>
                  <Link href={`/app/gudang/produk/${product.id}`} className="text-[12px] font-medium hover:underline">
                    {product.name}
                  </Link>
                  <p className="num text-[10px] text-muted-foreground">
                    {product.sku}
                    {product.barcode ? ` · ${product.barcode}` : ""}
                  </p>
                </td>
                <td className="text-[12px]">{product.categoryName ?? "—"}</td>
                <td className="text-[11px]">
                  {product.unitCode ?? "—"}
                  {product.packagings && product.packagings.length > 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      {product.packagings
                        .map((row) => `${row.name} ×${formatQty(row.isi)}`)
                        .join(" · ")}
                    </p>
                  ) : null}
                </td>
                {canSeeCost ? <td className="num text-right text-[12px]">{formatIDR(product.costPrice)}</td> : null}
                {canSeeCost ? (
                  <td className={`num text-right text-[12px] font-medium ${marginToneClass(marginPercent(product.costPrice, product.salePrice))}`}>
                    {formatMargin(marginPercent(product.costPrice, product.salePrice))}
                  </td>
                ) : null}
                <td className="num text-right text-[12px] font-medium">{formatIDR(product.salePrice)}</td>
                <td className={`num text-right text-[12px] font-medium ${product.stock <= Number(product.minStock) ? "text-destructive" : ""}`}>
                  {formatQty(product.stock)}
                </td>
                <td className="num text-right text-[11px] text-muted-foreground">{formatQty(product.minStock)}</td>
                <td>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${product.isActive ? "bg-tone-green-soft text-tone-green" : "bg-muted text-muted-foreground"}`}>
                    {product.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                {canManage ? (
                  <td>
                    <ProductRowActions id={product.id} name={product.name} isActive={product.isActive} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border/70 lg:hidden">
        {rows.map((product) => (
          <div key={product.id} className="flex gap-2.5 px-3 py-3">
            {canManage ? (
              <input
                type="checkbox"
                aria-label={`Pilih ${product.name}`}
                checked={allFiltered || selected.has(product.id)}
                disabled={allFiltered}
                onChange={(event) => toggleRow(product.id, event.target.checked)}
                className="mt-0.5"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/app/gudang/produk/${product.id}`}
                  className="text-[13px] font-medium leading-5 hover:underline"
                >
                  {product.name}
                </Link>
                <span
                  className={`num shrink-0 text-[13px] font-semibold ${
                    product.stock <= Number(product.minStock) ? "text-destructive" : ""
                  }`}
                >
                  {formatQty(product.stock)}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    stok · min {formatQty(product.minStock)}
                  </span>
                </span>
              </div>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">
                {product.sku}
                {product.categoryName ? ` · ${product.categoryName}` : ""}
                {product.unitCode ? ` · ${product.unitCode}` : ""}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {canSeeCost ? (
                  <span className="num text-[11px] text-muted-foreground">
                    HPP {formatIDR(product.costPrice)}
                  </span>
                ) : null}
                <span className="num text-[11px] font-medium">
                  Jual {formatIDR(product.salePrice)}
                </span>
                {canSeeCost ? (
                  <span className={`num text-[11px] font-medium ${marginToneClass(marginPercent(product.costPrice, product.salePrice))}`}>
                    Margin {formatMargin(marginPercent(product.costPrice, product.salePrice))}
                  </span>
                ) : null}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    product.isActive
                      ? "bg-tone-green-soft text-tone-green"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {product.isActive ? "Aktif" : "Nonaktif"}
                </span>
                {canManage ? (
                  <span className="ml-auto">
                    <ProductRowActions id={product.id} name={product.name} isActive={product.isActive} />
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {panelOpen ? (
        <Modal
          title={`Ubah massal — ${selectionCount} produk ${allFiltered ? "(semua hasil filter)" : "terpilih"}`}
          onClose={closePanel}
          busy={busy}
          wide
          footer={(
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" onClick={closePanel} className="h-8 rounded-md border border-border px-3 text-[12px] hover:bg-muted">
                {doneSummary ? "Selesai" : "Batal"}
              </button>
              {!doneSummary ? (
                preview ? (
                  <button
                    type="button"
                    onClick={runApply}
                    disabled={busy || preview.changedCount === 0}
                    className="h-8 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {busy ? "Menerapkan…" : `Terapkan ke ${preview.changedCount} produk`}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={busy}
                    className="h-8 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {busy ? "Menghitung…" : "Pratinjau"}
                  </button>
                )
              ) : null}
            </div>
          )}
        >
            <p className="mb-3 text-[11px] text-muted-foreground">
              Langkah 1: pilih operasi. Langkah 2: periksa pratinjau nilai sebelum → sesudah, lalu terapkan.
              Baris bermasalah dilewati dan dilaporkan, tidak menggagalkan baris lain.
            </p>
            <div className="max-h-[60vh] overflow-y-auto">
              {doneSummary ? (
                <p className="rounded-md bg-tone-green-soft px-3 py-2 text-[12px] text-tone-green">{doneSummary}</p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Operasi</span>
                      <select
                        value={opKind}
                        onChange={(event) => {
                          setOpKind(event.target.value as OpKind);
                          setPreview(null);
                        }}
                        className={fieldClass}
                      >
                        <option value="salePercent">Harga jual — persen (%)</option>
                        <option value="saleNominal">Harga jual — nominal (Rp)</option>
                        {canSeeCost ? <option value="costPercent">Harga beli — persen (%)</option> : null}
                        {canSeeCost ? <option value="costNominal">Harga beli — nominal (Rp)</option> : null}
                        <option value="category">Ubah kategori</option>
                        <option value="unit">Ubah satuan</option>
                        <option value="activate">Aktifkan</option>
                        <option value="deactivate">Nonaktifkan</option>
                        <option value="minStock">Set stok minimum</option>
                      </select>
                    </label>
                    {opKind === "category" ? (
                      <label className="block space-y-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kategori tujuan</span>
                        <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPreview(null); }} className={fieldClass}>
                          <option value="">— Tanpa kategori —</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>{category.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : opKind === "unit" ? (
                      <label className="block space-y-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Satuan tujuan</span>
                        <select value={unitId} onChange={(event) => { setUnitId(event.target.value); setPreview(null); }} className={fieldClass}>
                          <option value="">Pilih satuan…</option>
                          {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>{unit.code} — {unit.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : opKind === "activate" || opKind === "deactivate" ? (
                      <p className="self-end text-[12px] text-muted-foreground">
                        {opKind === "activate" ? "Semua produk terpilih akan diaktifkan." : "Semua produk terpilih akan dinonaktifkan."}
                      </p>
                    ) : (
                      <label className="block space-y-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {opKind === "minStock" ? "Stok minimum baru" : opKind.endsWith("Percent") ? "Persen (negatif = turun)" : "Nominal Rp (negatif = turun)"}
                        </span>
                        <input
                          value={value}
                          onChange={(event) => { setValue(event.target.value); setPreview(null); }}
                          inputMode="decimal"
                          placeholder={opKind === "minStock" ? "mis. 10" : opKind.endsWith("Percent") ? "mis. 5 atau -2.5" : "mis. 1000 atau -500"}
                          className={`${fieldClass} num text-right`}
                        />
                      </label>
                    )}
                  </div>

                  {preview ? (
                    <div className="mt-4 space-y-3">
                      <p className="text-[12px]">
                        <strong>{preview.changedCount}</strong> produk akan berubah ·{" "}
                        <strong>{preview.unchangedCount}</strong> sudah sesuai ·{" "}
                        <strong className={preview.errorCount > 0 ? "text-destructive" : ""}>{preview.errorCount}</strong> bermasalah (dilewati)
                        {preview.totalSelected !== preview.changedCount + preview.unchangedCount + preview.errorCount
                          ? ` · total terpilih ${preview.totalSelected}`
                          : ""}
                      </p>
                      {preview.changes.length > 0 ? (
                        <table className="data-table">
                          <thead>
                            <tr><th>Produk</th><th>Perubahan</th><th className="text-right">Sebelum</th><th className="text-right">Sesudah</th></tr>
                          </thead>
                          <tbody>
                            {preview.changes.map((row) => (
                              <tr key={row.id}>
                                <td className="text-[12px]">{row.name}<p className="num text-[10px] text-muted-foreground">{row.sku}</p></td>
                                <td className="text-[11px]">{row.changes.map((change) => change.label).join(", ")}</td>
                                <td className="num text-right text-[11px]">{row.changes.map((change) => change.before).join(", ")}</td>
                                <td className="num text-right text-[11px] font-medium">{row.changes.map((change) => change.after).join(", ")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                      {preview.changes.length < preview.changedCount ? (
                        <p className="text-[11px] text-muted-foreground">Menampilkan {preview.changes.length} dari {preview.changedCount} perubahan.</p>
                      ) : null}
                      {preview.packagingNote ? (
                        <p className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">{preview.packagingNote}</p>
                      ) : null}
                      {preview.errors.length > 0 ? (
                        <div className="rounded-md bg-destructive/10 px-3 py-2">
                          <p className="text-[11px] font-semibold text-destructive">Baris bermasalah (akan dilewati):</p>
                          <ul className="mt-1 list-disc pl-4 text-[11px] text-destructive">
                            {preview.errors.map((row) => (
                              <li key={row.id}>{row.sku} — {row.name}: {row.reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
        </Modal>
      ) : null}

      {canManage ? (
        <DataTableFloatingBar
          selectedCount={selectionCount}
          totalCount={allFiltered ? totalFiltered : undefined}
          onClearSelection={() => {
            setSelected(new Set());
            setAllFiltered(false);
          }}
        >
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setDoneSummary(null);
              setPanelOpen(true);
            }}
            className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ubah massal
          </button>
          {!allFiltered && totalFiltered > selected.size ? (
            <button
              type="button"
              onClick={() => setAllFiltered(true)}
              className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              Pilih semua filter ({totalFiltered})
            </button>
          ) : null}
        </DataTableFloatingBar>
      ) : null}
    </>
  );
}

