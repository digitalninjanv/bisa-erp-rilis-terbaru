/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — hook pencarian produk
 * terminal (kisi berpaginasi, debounce, jalur pindai barcode).
 * Urutan state/efek & perilaku identik dengan berkas asal.
 */
"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { searchProductsAction } from "@/server/actions/pos";
import { cartProductsAction } from "@/server/actions/pos-cart";
import type { CartItem, ProductOption } from "@/components/pos/terminal-types";
import { findLocalProductMatch, mergeProductCache } from "@/lib/pos/product-cache";

type CatalogProduct = Extract<Awaited<ReturnType<typeof searchProductsAction>>, { ok: true }>["data"][number];

function productOption(p: CatalogProduct): ProductOption {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    categoryId: p.categoryId ?? null,
    categoryName: p.categoryName ?? null,
    salePrice: p.salePrice,
    stock: Number(p.stock ?? 0),
    trackStock: p.trackStock ?? true,
    trackSerial: p.trackSerial,
    unitCode: p.unitCode ?? "PCS",
    // S4: kemasan aktif + kemasan yang cocok dengan pindaian.
    packagings: p.packagings ?? [],
    matchedPackagingId: p.matchedPackagingId ?? null,
  };
}

// POS-1: ukuran halaman kisi produk terminal — sama dengan limit
// searchProductsAction agar satu halaman = satu panggilan server.
const PRODUCT_PAGE_SIZE = 24;

export function useProductSearch(params: {
  initialProducts: ProductOption[];
  cart: CartItem[];
  cache: Record<string, ProductOption>;
  initialWarehouse: string;
  selectedWarehouse: string;
  selectedCategory: string;
  checkoutInFlight: RefObject<boolean>;
  idempotencyKey: RefObject<string>;
  setCache: Dispatch<SetStateAction<Record<string, ProductOption>>>;
}) {
  const { initialProducts, initialWarehouse, selectedWarehouse, selectedCategory, setCache, checkoutInFlight, idempotencyKey } = params;
  const cartProductIds = useRef<string[]>([]);
  useEffect(() => {
    cartProductIds.current = params.cart.map((line) => line.productId);
  }, [params.cart]);
  const [results, setResults] = useState<ProductOption[]>(initialProducts);
  const [resultsFor, setResultsFor] = useState({ term: "", warehouse: initialWarehouse, category: "" });
  const [search, setSearch] = useState("");
  // POS-1: kisi produk berpaginasi — `results` selalu berisi halaman
  // aktif untuk kata cari saat ini (halaman 1 = initialProducts dari
  // server); halaman berikutnya diambil per 24 lewat offset.
  const products = results;
  const resultsCurrent = resultsFor.term === search && resultsFor.warehouse === selectedWarehouse && resultsFor.category === selectedCategory;
  const [page, setPage] = useState(1);
  const [pageFull, setPageFull] = useState(initialProducts.length >= PRODUCT_PAGE_SIZE);
  const [searching, setSearching] = useState(false);

  const missingProductIds = [...new Set(params.cart.map((line) => line.productId))]
    .filter((id) => params.cache[id]?.trackSerial === undefined).sort().join(",");
  useEffect(() => {
    if (!missingProductIds) return;
    let cancelled = false;
    void cartProductsAction({ warehouseId: selectedWarehouse, productIds: missingProductIds.split(",") })
      .then((result) => {
        if (cancelled || !result.ok) return;
        setCache((current) =>
          mergeProductCache(current, result.data.map(productOption), cartProductIds.current),
        );
      }).catch(() => {
        if (!cancelled) toast.error("Data produk keranjang belum dapat dipulihkan. Periksa koneksi lalu muat ulang.");
      });
    return () => { cancelled = true; };
  }, [missingProductIds, selectedWarehouse, setCache]);

  const searchSeq = useRef(0);
  const initialCatalog = useRef(true);

  // POS-SRCH-01: pencarian menilai stok dari gudang yang sedang dipilih
  // kasir (sama seperti quote/checkout), bukan gudang default.
  // POS-1: pencarian selalu per halaman (24) lewat offset server; hasil
  // yang kembali menggantikan halaman aktif dan menandai apakah masih
  // ada halaman berikutnya (halaman penuh = mungkin masih ada).
  const runSearch = useCallback(
    async (term: string, pageNum: number, categoryId = selectedCategory, updateCatalog = true): Promise<ProductOption[]> => {
      const seq = updateCatalog ? ++searchSeq.current : null;
      const result = await searchProductsAction(
        term,
        selectedWarehouse,
        (pageNum - 1) * PRODUCT_PAGE_SIZE,
        categoryId,
        !updateCatalog,
      );
      if (!result.ok) {
        toast.error(result.message);
        return [];
      }
      const mapped = result.data.map(productOption);
      if (seq !== null && seq === searchSeq.current) {
        setResults(mapped);
        setResultsFor({ term, warehouse: selectedWarehouse, category: categoryId });
        setPage(pageNum);
        setPageFull(mapped.length >= PRODUCT_PAGE_SIZE);
        setCache((current) => {
          return mergeProductCache(current, mapped, cartProductIds.current);
        });
      }
      return mapped;
    },
    [selectedWarehouse, selectedCategory, setCache],
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
// debounce 220 ms. Jika katalog lokal sudah sinkron dengan gudang aktif
// dan barang cocok serta stok tersedia, langsung kembalikan tanpa menunggu
// roundtrip server (quoteAction tetap memvalidasi stok & harga aktual).
// S4: barcode kemasan juga kecocokan persis — produk ditemukan
// membawa matchedPackagingId dan pemanggil menambahkan baris
// KEMASAN itu, bukan 1 Pcs (mode gagal klasik satuan kemasan).
const scanBarcode = useCallback(
  async (code: string): Promise<ProductOption | null> => {
    if (checkoutInFlight.current) return null;
    const attempt = idempotencyKey.current;
    const localPool = [...new Map([...Object.values(params.cache), ...params.initialProducts].map((item) => [item.id, item])).values()];
    if (resultsFor.warehouse === selectedWarehouse) {
      const fastHit = findLocalProductMatch(localPool, code);
      if (fastHit && (!fastHit.trackStock || fastHit.stock > 0)) {
        return fastHit;
      }
    }
    setSearching(true);
    try {
      // Pindai barcode selalu lintas kategori — filter chip tidak
      // boleh membuat barang yang dipindai tidak ditemukan.
      const fresh = await runSearch(code, 1, "", false);
      if (checkoutInFlight.current || attempt !== idempotencyKey.current) return null;
      const matched =
        fresh.find((p) => p.barcode === code) ??
        fresh.find((p) => p.matchedPackagingId) ??
        fresh.find((p) => p.sku === code) ??
        null;
      if (matched) return matched;
      // Fallback cache lokal (offline atau produk sudah tersimpan di memori terminal)
      return findLocalProductMatch(localPool, code);
    } catch {
      const local = findLocalProductMatch(localPool, code);
      if (local) return local;
      toast.error("Pencarian barcode gagal. Periksa koneksi lalu coba lagi.");
      return null;
    } finally {
      setSearching(false);
    }
  },
  [runSearch, checkoutInFlight, idempotencyKey, params.cache, params.initialProducts, resultsFor.warehouse, selectedWarehouse],
);

  // POS-1: setiap perubahan kata cari ATAU gudang (searchProducts
  // terbentuk ulang saat gudang berubah) memuat ulang dari halaman 1 —
  // filter tidak pernah mewarisi nomor halaman lama.
  useEffect(() => {
    if (initialCatalog.current && !search && !selectedCategory && selectedWarehouse === initialWarehouse) return;
    initialCatalog.current = false;
    const timer = setTimeout(() => {
      void searchProducts(search, 1);
    }, 220);
    return () => clearTimeout(timer);
  }, [initialWarehouse, search, searchProducts, selectedCategory, selectedWarehouse]);

  const goToPage = useCallback(
    (next: number) => {
      if (next < 1 || searching) return;
      void searchProducts(search, next);
    },
    [search, searchProducts, searching],
  );

  return { search, setSearch, products, page, pageFull, searching, resultsCurrent, scanBarcode, goToPage };
}
