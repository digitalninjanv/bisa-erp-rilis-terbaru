"use client";

import { Plus, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/money-input";
import { inputClass } from "@/components/blocks/field-classes";
import type { PackagingInput } from "@/lib/packaging";

/**
 * Program Satuan Kemasan S1 — editor baris kemasan pada formulir produk.
 * Satu baris = satu kemasan (Dus/Pak/Slop/…): isi dinyatakan LANGSUNG ke
 * satuan dasar produk, harga jual kemasan berdiri sendiri (bukan
 * isi × harga satuan dasar), barcode per kemasan opsional. Baris
 * tersimpan yang dihapus dari daftar menjadi permintaan hapus di
 * server — kemasan yang sudah terpakai ditolak di sana dengan pesan
 * untuk menonaktifkan saja (penjaga di lib/packaging).
 */
export type PackagingRowState = PackagingInput & { key: string };

export function toRowState(row: PackagingInput, key: string): PackagingRowState {
  return {
    ...row,
    buyPrice: row.buyPrice ?? "",
    salePrice: row.salePrice ?? "",
    barcode: row.barcode ?? "",
    key,
  };
}

export function PackagingEditor({
  rows,
  onRowsChange,
  baseUnitLabel,
  allowCost,
  priceLocked,
  onMoneyValidity,
}: {
  rows: PackagingRowState[];
  onRowsChange: (rows: PackagingRowState[]) => void;
  /** Label satuan dasar produk ("Pcs") untuk contoh terhitung per baris. */
  baseUnitLabel: string;
  allowCost: boolean;
  priceLocked: boolean;
  onMoneyValidity: (key: string, valid: boolean) => void;
}) {
  function patch(key: string, changes: Partial<PackagingRowState>) {
    onRowsChange(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function addRow() {
    onRowsChange([
      ...rows,
      {
        key: `new-${Date.now()}-${rows.length}`,
        name: "",
        isi: "",
        buyPrice: "",
        salePrice: "",
        barcode: "",
        isDefaultPurchase: false,
        isDefaultSale: false,
        isActive: true,
      },
    ]);
  }

  function removeRow(key: string) {
    onRowsChange(rows.filter((row) => row.key !== key));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Kemasan (satuan lain)
        </p>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium hover:bg-muted"
        >
          <Plus className="size-3.5" /> Tambah kemasan
        </button>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Barang datang per dus/pak tetapi dijual per {baseUnitLabel}? Daftarkan kemasannya di sini.
        Stok selalu tersimpan dalam satuan dasar — isi dinyatakan langsung ke satuan dasar (1 Dus =
        40 {baseUnitLabel}, bukan berantai lewat Pak). Harga jual kemasan berdiri sendiri, bukan
        otomatis isi × harga satuan. Kemasan yang sudah terpakai tidak dapat dihapus; nonaktifkan
        saja.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          Belum ada kemasan — produk ini dibeli &amp; dijual hanya dalam satuan dasar.
        </p>
      ) : (
        rows.map((row) => (
          <div key={row.key} className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_90px_1fr_auto]">
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Nama kemasan
                </span>
                <input
                  value={row.name}
                  onChange={(event) => patch(row.key, { name: event.target.value })}
                  className={inputClass}
                  placeholder="Dus"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Isi
                </span>
                <input
                  value={row.isi}
                  onChange={(event) => patch(row.key, { isi: event.target.value })}
                  inputMode="numeric"
                  className={`${inputClass} num text-right`}
                  placeholder="40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Barcode kemasan
                </span>
                <input
                  value={row.barcode ?? ""}
                  onChange={(event) => patch(row.key, { barcode: event.target.value })}
                  className={inputClass}
                  placeholder="Opsional"
                />
              </label>
              <div className="flex items-end pb-0.5">
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  title={row.id ? "Hapus kemasan (yang sudah terpakai akan ditolak — nonaktifkan saja)" : "Hapus baris"}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="size-3.5" /> Hapus
                </button>
              </div>
            </div>
            <div className={`grid gap-2 ${allowCost ? "sm:grid-cols-2" : ""}`}>
              {allowCost ? (
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Harga beli per kemasan
                  </span>
                  <MoneyInput
                    value={row.buyPrice ?? ""}
                    onChange={(value) => patch(row.key, { buyPrice: value })}
                    onValidityChange={(valid) => onMoneyValidity(`pkg-${row.key}-buy`, valid)}
                    disabled={priceLocked}
                    aria-label="Harga beli per kemasan"
                    className="h-9 px-2.5 text-[12px]"
                  />
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Harga jual per kemasan
                </span>
                <MoneyInput
                  value={row.salePrice ?? ""}
                  onChange={(value) => patch(row.key, { salePrice: value })}
                  onValidityChange={(valid) => onMoneyValidity(`pkg-${row.key}-sale`, valid)}
                  disabled={priceLocked}
                  aria-label="Harga jual per kemasan"
                  className="h-9 px-2.5 text-[12px]"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={row.isDefaultPurchase}
                  onChange={(event) => patch(row.key, { isDefaultPurchase: event.target.checked })}
                />
                Bawaan beli
              </label>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={row.isDefaultSale}
                  onChange={(event) => patch(row.key, { isDefaultSale: event.target.checked })}
                />
                Bawaan jual
              </label>
              <label className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={row.isActive}
                  onChange={(event) => patch(row.key, { isActive: event.target.checked })}
                />
                Aktif
              </label>
              {row.name.trim() && row.isi.trim() ? (
                <span className="text-[11px] text-muted-foreground">
                  1 {row.name.trim()} = {row.isi.trim()} {baseUnitLabel}
                </span>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
