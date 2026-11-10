import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { QuoteResultPublic } from "@/server/pos";
import { quoteAction } from "@/server/actions/pos";
import { computeLocalOfflineQuote } from "@/lib/pos-offline";
import type { RoundDirection } from "@/lib/money";
import type { CartItem, ProductOption } from "@/components/pos/terminal-types";

// FIX-ARS Tahap 5 (ARS2-01): hook quote — perhitungan keranjang
// terdebounce dengan sidik jari (signature) keadaan, status sibuk/gagal
// eksplisit, dan penomoran urut anti-basi; diekstrak apa adanya dari
// PosTerminal tanpa mengubah waktu debounce maupun kondisi penerapan.
export function useQuote(params: {
  cart: CartItem[];
  selectedWarehouse: string;
  groupId: string;
  reservationId: string | null;
  cartSignature: string;
  serialIncomplete: boolean;
  setCache: Dispatch<SetStateAction<Record<string, ProductOption>>>;
  /**
   * A-24 T6 (temuan T6-01): bahan quote LOKAL offline. Bila panggilan
   * quote server melempar (transportasi gagal total — jaringan putus
   * atau server mati) dan bahan ini aktif, quote dihitung lokal dari
   * katalog terminal (lib/pos-offline.ts) agar tombol Bayar tetap
   * hidup dan penjualan dapat diantrekan. Putusan domain server
   * ({ ok: false }) TIDAK pernah digantikan quote lokal.
   */
  offlineQuote?: {
    enabled: boolean;
    catalog: Record<string, ProductOption>;
    group: {
      roundingStep: number;
      roundingDirection: RoundDirection;
      roundCashTotal: boolean;
    } | null;
    taxRate: number;
    companyRoundingMode: string;
  } | null;
}) {
  const {
    cart,
    selectedWarehouse,
    groupId,
    reservationId,
    cartSignature,
    serialIncomplete,
    setCache,
    offlineQuote,
  } = params;
  // FIX-POS Tahap 4 (POS2-01): hasil quote disimpan BERSAMA sidik
  // jari (signature) keadaan yang menghasilkannya. Quote hanya
  // berlaku bila signature-nya sama persis dengan keadaan saat ini —
  // total basi dari keranjang/gudang/kelompok lama tidak pernah bisa
  // tertera di tombol Bayar. Kegagalan quote menjadi state eksplisit
  // (quoteError), bukan sekadar toast yang hilang.
  const [quoteResult, setQuoteResult] = useState<{
    signature: string;
    data: QuoteResultPublic;
  } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const quoteSeq = useRef(0);

  useEffect(() => {
    if (cart.length === 0) return;
    // Baris serial yang belum lengkap tidak di-quote — server pasti
    // menolaknya. Nilai `serialIncomplete` diturunkan saat render di
    // atas (quote sudah terbaca null di sana); di sini cukup berhenti
    // tanpa menjadwalkan quote baru, bukan toast berulang.
    if (serialIncomplete) return;
    const seq = ++quoteSeq.current;
    // POS2-01: signature ditangkap saat quote DIMINTA; hasil hanya
    // diterapkan sebagai quote berlaku bila keadaan belum berubah.
    const signature = cartSignature;
    const timer = setTimeout(() => {
      setQuoting(true);
      void (async () => {
        // POS-ERR-01: state "Menghitung…" selalu dipulihkan, termasuk
        // saat server action melempar (jaringan putus).
        let result: Awaited<ReturnType<typeof quoteAction>>;
        try {
          result = await quoteAction({
            warehouseId: selectedWarehouse,
            groupId: groupId || null,
            reservationId: reservationId ?? undefined,
            lines: cart.map((line) => ({
              productId: line.productId,
              // S4: satuan baris ikut — qty adalah qty input kemasan itu.
              packagingId: line.packagingId ?? null,
              qty: line.qty,
              discountType: line.discountType ?? null,
              discountValue: line.discountValue ?? 0,
              serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
            })),
          });
        } catch {
          if (seq !== quoteSeq.current) return;
          setQuoting(false);
          // A-24 T6 (T6-01): quote server tak terjangkau sama sekali
          // (lemparan transportasi) + mode offline perusahaan aktif →
          // quote lokal dari katalog terminal, supaya penjualan dapat
          // diantrekan; server menilai ulang harga/stok saat sinkron
          // dan selisih menjadi konflik peninjauan, bukan posting
          // senyap. Produk di luar katalog lokal → tetap gagal jujur.
          const fallback = offlineQuote?.enabled
            ? computeLocalOfflineQuote({
                lines: cart.map((line) => ({
                  productId: line.productId,
                  packagingId: line.packagingId ?? null,
                  qty: line.qty,
                  discountType: line.discountType ?? null,
                  discountValue: line.discountValue ?? 0,
                  serialNumbers: line.serialNumbers?.filter((value) => value.trim()),
                })),
                catalog: Object.fromEntries(
                  Object.entries(offlineQuote.catalog).map(([id, p]) => [
                    id,
                    {
                      name: p.name,
                      sku: p.sku,
                      salePrice: p.salePrice,
                      stock: p.stock,
                      trackStock: p.trackStock ?? true,
                      trackSerial: p.trackSerial ?? false,
                      // S4: kemasan katalog lokal untuk quote baris berkemasan.
                      packagings: (p.packagings ?? []).map((pack) => ({
                        id: pack.id,
                        name: pack.name,
                        isi: pack.isi,
                        salePrice: pack.salePrice,
                      })),
                    },
                  ]),
                ),
                group: offlineQuote.group,
                taxRate: offlineQuote.taxRate,
                companyRoundingMode: offlineQuote.companyRoundingMode,
              })
            : null;
          if (fallback) {
            setQuoteError(null);
            setQuoteResult({ signature, data: fallback });
            return;
          }
          // POS2-01: kegagalan menjadi banner persisten di panel
          // pembayaran (dengan tombol Coba lagi), bukan toast sesaat.
          setQuoteResult(null);
          setQuoteError("Gagal menghitung keranjang. Periksa koneksi lalu coba lagi.");
          return;
        }
        if (seq !== quoteSeq.current) return;
        setQuoting(false);
        if (!result.ok) {
          setQuoteResult(null);
          setQuoteError(result.message);
          return;
        }
        setQuoteError(null);
        setQuoteResult({ signature, data: result.data });
        setCache((current) => {
          const next = { ...current };
          for (const line of result.data.lines) {
            next[line.productId] = {
              id: line.productId,
              name: line.name,
              sku: line.sku,
              barcode: null,
              // S4: unitPrice baris BERKEMASAN adalah harga per
              // satuan dasar turunan (harga kemasan ÷ isi) — bukan
              // harga master produk; menimpakannya merusak harga
              // satuan dasar di cache. Hanya baris satuan dasar yang
              // menyegarkan salePrice cache seperti sebelumnya.
              salePrice: line.packagingId
                ? (next[line.productId]?.salePrice ?? String(line.unitPrice))
                : String(line.unitPrice),
              stock: line.stock,
              trackStock: line.trackStock,
              trackSerial: line.trackSerial,
              unitCode: next[line.productId]?.unitCode ?? "PCS",
              packagings: next[line.productId]?.packagings ?? [],
            };
          }
          return next;
        });
      })();
    }, 180);
    return () => clearTimeout(timer);
  }, [
    cart,
    selectedWarehouse,
    groupId,
    cartSignature,
    quoteNonce,
    serialIncomplete,
    reservationId,
    offlineQuote,
    setCache,
  ]);

  const quote =
    cart.length === 0 || serialIncomplete || !quoteResult || quoteResult.signature !== cartSignature
      ? null
      : quoteResult.data;

  const quoteLine = useCallback(
    (productId: string, packagingId?: string | null) =>
      quote?.lines.find(
        (line) =>
          line.productId === productId && (line.packagingId ?? null) === (packagingId ?? null),
      ) ?? null,
    [quote],
  );

  // FIX-POS Tahap 4 (POS2-01): status kesiapan quote yang eksplisit.
  // Bayar hanya aktif bila quote TERAKHIR berhasil dan masih segar
  // (signature cocok, tidak sedang dihitung ulang, tidak gagal).
  // Label tombol selalu jujur tentang alasannya — tidak pernah ada
  // "Bayar Rp 0" yang dapat diklik.
  const quotePending = cart.length > 0 && !serialIncomplete && !quoteError && quote === null;
  const quoteBusy = quoting || quotePending;

  return { quote, quoting, quoteError, quotePending, quoteBusy, quoteLine, setQuoteResult, setQuoteNonce };
}
