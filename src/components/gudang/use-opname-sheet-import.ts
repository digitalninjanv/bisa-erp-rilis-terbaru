"use client";

import { useState, type RefObject } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import type { OpnameCountRow } from "@/lib/opname-count";
import { loadOpnameProductsAction } from "@/server/actions/inventory/produk";

export function useOpnameSheetImport(warehouseId: string, fileInputRef: RefObject<HTMLInputElement | null>, onLoaded: (rows: OpnameCountRow[]) => void) {
  const [importing, setImporting] = useState(false);
  async function importCountSheet(file: File) {
    if (!warehouseId) {
      toast.error("Pilih gudang terlebih dahulu.");
      return;
    }
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("File tidak memiliki lembar kerja.");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });

      let headerIndex = -1;
      let skuCol = -1;
      let nameCol = -1;
      let qtyCol = -1;
      for (let index = 0; index < Math.min(matrix.length, 15); index += 1) {
        const cells = (matrix[index] as unknown[]).map((cell) => String(cell ?? "").trim().toLowerCase());
        const qty = cells.findIndex((cell) => cell === "fisik" || cell.startsWith("fisik"));
        const sku = cells.findIndex((cell) => cell === "sku" || cell === "kode" || cell === "kode barang");
        const name = cells.findIndex(
          (cell) => cell === "nama produk" || cell === "nama" || cell === "produk",
        );
        if (qty >= 0 && (sku >= 0 || name >= 0)) {
          headerIndex = index;
          skuCol = sku;
          nameCol = name;
          qtyCol = qty;
          break;
        }
      }
      if (headerIndex < 0) {
        throw new Error("Kolom Fisik dan SKU/Nama Produk tidak ditemukan. Gunakan file ekspor dari halaman ini.");
      }

      const bySku = new Map<string, string>();
      const byName = new Map<string, string>();
      for (const row of matrix.slice(headerIndex + 1)) {
        if (!Array.isArray(row)) continue;
        const qty = String(row[qtyCol] ?? "").trim();
        if (!qty) continue;
        const sku = skuCol >= 0 ? String(row[skuCol] ?? "").trim().toUpperCase() : "";
        const name = nameCol >= 0 ? String(row[nameCol] ?? "").trim().toLowerCase() : "";
        if (sku) bySku.set(sku, qty);
        else if (name) byName.set(name, qty);
      }
      if (bySku.size === 0 && byName.size === 0) {
        throw new Error("Tidak ada baris dengan kolom Fisik terisi.");
      }

      const loaded = await loadOpnameProductsAction({ warehouseId });
      if (!loaded.ok) throw new Error(loaded.message);
      let applied = 0;
      const nextRows: OpnameCountRow[] = loaded.data.rows.map((row) => {
        const counted =
          bySku.get(row.sku.trim().toUpperCase()) ??
          byName.get(row.name.trim().toLowerCase()) ??
          "";
        if (counted) applied += 1;
        return {
          productId: row.productId,
          name: row.name,
          sku: row.sku,
          system: row.system,
          counted,
          unitCost: row.costPrice,
          unitName: row.unitName,
          packagings: row.packagings,
          components: {},
        };
      });
      onLoaded(nextRows);
      toast.success(
        `${applied} baris terisi dari Excel. ${nextRows.length - applied} baris lain dikosongkan.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membaca file Excel.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return { importing, importCountSheet };
}
