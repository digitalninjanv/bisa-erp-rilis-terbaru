"use client";

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { useBarcodeScannerCapture } from "@/components/pos/use-barcode-scanner";
import type { ProductOption } from "@/components/pos/terminal-types";

/** Pindai barcode global: cari kode, lalu masukkan produk/kemasan ke keranjang. */
export function useGlobalBarcodeScan(params: {
  scanBarcode: (code: string) => Promise<ProductOption | null>;
  addProduct: (product: ProductOption, packagingId?: string | null) => void;
  setSearch: Dispatch<SetStateAction<string>>;
  searchRef: RefObject<HTMLInputElement | null>;
  enabled: boolean;
}) {
  const { scanBarcode, addProduct, setSearch, searchRef, enabled } = params;

  const handleScan = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const product = await scanBarcode(trimmed);
      if (!product) {
        toast.error(`Produk dengan barcode/SKU "${trimmed}" tidak ditemukan.`);
        setSearch("");
        searchRef.current?.focus();
        return;
      }
      addProduct(product, product.matchedPackagingId ?? null);
    },
    [scanBarcode, addProduct, setSearch, searchRef],
  );

  useBarcodeScannerCapture({
    enabled,
    onScan: (code) => {
      void handleScan(code);
    },
    isIgnoredTarget: (target) => target === searchRef.current,
  });

  return handleScan;
}
