/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — hook pencarian produk
 * terminal (kisi berpaginasi, debounce, jalur pindai barcode).
 * Urutan state/efek & perilaku identik dengan berkas asal.
 */
"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { searchProductsAction } from "@/server/actions/pos";
import type { ProductOption } from "@/components/pos/terminal-types";

// POS-1: ukuran halaman kisi produk terminal — sama dengan limit
// searchProductsAction agar satu halaman = satu panggilan server.
const PRODUCT_PAGE_SIZE = 24;

export function useProductSearch(params: {
  initialProducts: ProductOption[];
  selectedWarehouse: string;
  setCache: Dispatch<SetStateAction<Record<string, ProductOption>>>;
}) {
  const { initialProducts, selectedWarehouse, setCache } = params;
  const [results, setResults] = useState<ProductOption[]>(initialProducts);
  const [search, setSearch] = useState("");
  // POS-1: kisi produk berpaginasi — `results` selalu berisi halaman
  // aktif untuk kata cari saat ini (halaman 1 = initialProducts dari
  // server); halaman berikutnya diambil per 24 lewat offset.
  const products = results;
  const [page, setPage] = useState(1);
  const [pageFull, setPageFull] = useState(initialProducts.length >= PRODUCT_PAGE_SIZE);
  const [searching, setSearching] = useState(false);

  const searchSeq = useRef(0);

  // POS-SRCH-01: pencarian menilai stok dari gudang yang sedang dipilih
  // kasir (sama seperti quote/checkout), bukan gudang default.
  // POS-1: pencarian selalu per halaman (24) lewat offset server; hasil
  // yang kembali menggantikan halaman aktif dan menandai apakah masih
  // ada halaman berikutnya (halaman penuh = mungkin masih ada).
  const runSearch = useCallback(
    async (term: string, pageNum: number): Promise<ProductOption[]> => {
      const seq = ++searchSeq.current;
      const result = await searchProductsAction(
        term,
        selectedWarehouse,
        (pageNum - 1) * PRODUCT_PAGE_SIZE,
      );
      if (!result.ok) {
        toast.error(result.message);
        return [];
      }
      const mapped: ProductOption[] = result.data.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        categoryId: (p as { categoryId?: string | null }).categoryId ?? null,
        categoryName: (p as { categoryName?: string | null }).categoryName ?? null,
        salePrice: p.salePrice,
        stock: "stock" in p ? Number((p as { stock?: string }).stock ?? 0) : 0,
        trackStock: (p as { trackStock?: boolean }).trackStock ?? true,
        unitCode: (p as { unitCode?: string | null }).unitCode ?? "PCS",
        // S4: kemasan aktif + kemasan yang cocok dengan pindaian.
        packagings: (p as { packagings?: ProductOption["packagings"] }).packagings ?? [],
        matchedPackagingId:
          (p as { matchedPackagingId?: string | null }).matchedPackagingId ?? null,
      }));
      if (seq === searchSeq.current) {
        setResults(mapped);
        setPage(pageNum);
        setPageFull(mapped.length >= PRODUCT_PAGE_SIZE);
        setCache((current) => {
          const next = { ...current };
          for (const item of mapped) next[item.id] = item;
          return next;
        });
      }
      return mapped;
    },
    [selectedWarehouse, setCache],
  );

  // POS-ERR-01: kegagalan jaringan tidak boleh membiarkan indikator
  // "Mencari produk…" menggantung — state sibuk selalu dipulihkan.
  const searchProducts = useCallback(
    async (term: string, pageNum: number) => {
      setSearching(true);
      try {
        await runSearch(term, pageNum);
      } catch {
        toast.error("Pencarian produk gagal. Periksa koneksi lalu coba lagi.");
      } finally {
        setSearching(false);
      }
    },
    [runSearch],
  );

  // POS-SCAN-01: scanner mengirim kode + Enter jauh lebih cepat daripada
  // debounce 220 ms, jadi jalur barcode menjalankan pencarian segar dan
  // hanya menambahkan kecocokan persis (barcode, lalu SKU) — tidak pernah
  // menebak produk pertama dari hasil pencarian sebelumnya.
  // S4: barcode kemasan juga kecocokan persis — produk ditemukan
  // membawa matchedPackagingId dan pemanggil menambahkan baris
  // KEMASAN itu, bukan 1 Pcs (mode gagal klasik satuan kemasan).
  const scanBarcode = useCallback(
    async (code: string): Promise<ProductOption | null> => {
      setSearching(true);
      try {
        const fresh = await runSearch(code, 1);
        return (
          fresh.find((p) => p.barcode === code) ??
          fresh.find((p) => p.matchedPackagingId) ??
          fresh.find((p) => p.sku === code) ??
          null
        );
      } catch {
        toast.error("Pencarian barcode gagal. Periksa koneksi lalu coba lagi.");
        return null;
      } finally {
        setSearching(false);
      }
    },
    [runSearch],
  );

  // POS-1: setiap perubahan kata cari ATAU gudang (searchProducts
  // terbentuk ulang saat gudang berubah) memuat ulang dari halaman 1 —
  // filter tidak pernah mewarisi nomor halaman lama.
  useEffect(() => {
    const timer = setTimeout(() => {
      void searchProducts(search, 1);
    }, 220);
    return () => clearTimeout(timer);
  }, [search, searchProducts]);

  const goToPage = useCallback(
    (next: number) => {
      if (next < 1 || searching) return;
      void searchProducts(search, next);
    },
    [search, searchProducts, searching],
  );

  return { search, setSearch, products, page, pageFull, searching, scanBarcode, goToPage };
}
