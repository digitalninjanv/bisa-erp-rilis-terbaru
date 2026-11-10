"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { createOrdersFromRecommendationsAction } from "@/server/actions/purchasing";
import { formatIDR, formatQty } from "@/lib/money";
import { DataList } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";

export type RecommendationRow = {
  productId: string;
  sku: string;
  name: string;
  totalStock: string;
  minStock: string;
  suggestedQty: string;
  /** S6: petunjuk "≈ X Dus" dari kemasan bawaan beli (display-only). */
  suggestedPackaging: string | null;
  costPrice: string;
  supplierId: string | null;
  supplierName: string | null;
};

type CreatedOrder = { id: string; number: string; supplierName: string | null };
type SkippedRow = { productId: string; sku: string; name: string };

export function PurchaseRecommendations({ rows }: { rows: RecommendationRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.filter((row) => row.supplierId).map((row) => row.productId)),
  );
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedOrder[] | null>(null);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [noLongerLow, setNoLongerLow] = useState<SkippedRow[]>([]);

  function toggle(productId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((row) => row.productId)) : new Set());
  }

  async function createOrders() {
    if (selected.size === 0) {
      toast.error("Pilih minimal satu produk.");
      return;
    }
    setBusy(true);
    const result = await createOrdersFromRecommendationsAction({
      productIds: [...selected],
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setCreated(result.data.orders);
    setSkipped(result.data.skipped);
    setNoLongerLow(result.data.noLongerLow);
    if (result.data.orders.length > 0) {
      toast.success(`${result.data.orders.length} PO draft dibuat dari rekomendasi.`);
    }
    if (result.data.skipped.length > 0) {
      toast.warning(
        `${result.data.skipped.length} produk belum memiliki pemasok utama sehingga belum dibuatkan PO.`,
      );
    }
    if (result.data.noLongerLow.length > 0) {
      toast.info(
        `${result.data.noLongerLow.length} produk tidak lagi menipis sehingga tidak dibuatkan PO.`,
      );
    }
    router.refresh();
  }

  if (rows.length === 0) {
    // A-25 U3 (GDG-06): keadaan kosong bukan lagi satu kalimat di
    // kotak dashed polos — EmptyState v2 compact menyatakan keadaan
    // sehatnya secara eksplisit. Data "mendekati minimum" tidak
    // dikarang: fungsi baca hanya mengembalikan produk yang sudah
    // mencapai/di bawah minimum, jadi tidak ada daftar konteks lain
    // yang bisa ditampilkan dari data yang diteruskan ke sini.
    return (
      <EmptyState
        size="compact"
        title="Tidak ada produk yang menipis saat ini"
        description="Semua stok berada di atas stok minimumnya. Rekomendasi pembelian akan muncul di sini begitu ada produk yang mencapai atau turun di bawah stok minimumnya."
        icon={<PackageCheck className="size-4" />}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* A-25 U3 (GDG-06): rekomendasi tampil sebagai daftar DataList
          bersama — kepala kartu (SectionTitle bare) membawa konteks
          jumlah produk menipis + satu tombol utama Buat PO; catatan
          cara hitung saran menjadi footerNote. */}
      <DataList
        headerActions={
          <>
            <span className="mr-auto text-[12px] text-muted-foreground">
              {rows.length} produk mencapai atau di bawah stok minimum
            </span>
            <button
              type="button"
              onClick={createOrders}
              disabled={busy || selected.size === 0}
              className="h-8 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Membuat PO…" : `Buat PO dari rekomendasi (${selected.size})`}
            </button>
          </>
        }
        footerNote={
          <>
            Saran pesan mengisi stok sampai <strong>2× stok minimum</strong> (target = 2 × minimum − stok
            saat ini). PO dibuat sebagai <strong>draft</strong>, satu PO per pemasok utama.
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua"
                    checked={selected.size === rows.length}
                    onChange={(event) => toggleAll(event.target.checked)}
                  />
                </th>
                <th>Produk</th>
                <th className="text-right">Stok total</th>
                <th className="text-right">Stok minimum</th>
                <th className="text-right">Saran pesan</th>
                <th className="text-right">Harga pokok</th>
                <th>Pemasok utama</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Pilih ${row.name}`}
                      checked={selected.has(row.productId)}
                      onChange={(event) => toggle(row.productId, event.target.checked)}
                    />
                  </td>
                  <td>
                    <p className="font-medium">{row.name}</p>
                    <p className="num text-[10px] text-muted-foreground">{row.sku}</p>
                  </td>
                  <td className="num text-right">{formatQty(row.totalStock)}</td>
                  <td className="num text-right text-muted-foreground">{formatQty(row.minStock)}</td>
                  <td className="num text-right font-medium">
                    {formatQty(row.suggestedQty)}
                    {row.suggestedPackaging ? (
                      <span className="block text-[10px] font-normal text-muted-foreground">{row.suggestedPackaging}</span>
                    ) : null}
                  </td>
                  <td className="num text-right text-muted-foreground">{formatIDR(row.costPrice)}</td>
                  <td className="text-[12px]">
                    {row.supplierName ?? (
                      <span className="text-destructive">Belum ada — tetapkan di data produk</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>

      {created !== null ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <h3 className="text-[12px] font-semibold">Hasil pembuatan PO</h3>
          {created.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[12px]">
              {created.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/app/gudang/pembelian/${order.id}`}
                    className="num font-medium text-primary hover:underline"
                  >
                    {order.number}
                  </Link>{" "}
                  — draft untuk {order.supplierName ?? "pemasok"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Tidak ada PO yang dibuat dari pilihan ini.
            </p>
          )}
          {skipped.length > 0 ? (
            <div className="mt-3">
              <p className="text-[12px] font-medium">Belum dibuatkan PO — belum ada pemasok utama:</p>
              <ul className="mt-1 list-disc pl-5 text-[12px] text-muted-foreground">
                {skipped.map((row) => (
                  <li key={row.productId}>
                    {row.name} <span className="num text-[10px]">({row.sku})</span> — tetapkan pemasok
                    utama di data produk, lalu buat PO secara manual.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {noLongerLow.length > 0 ? (
            <div className="mt-3">
              <p className="text-[12px] font-medium">Tidak dibuatkan PO — stok sudah pulih:</p>
              <ul className="mt-1 list-disc pl-5 text-[12px] text-muted-foreground">
                {noLongerLow.map((row) => (
                  <li key={row.productId}>
                    {row.name} <span className="num text-[10px]">({row.sku})</span> — stok produk ini
                    sudah di atas stok minimum saat PO dibuat, jadi tidak lagi menipis.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
