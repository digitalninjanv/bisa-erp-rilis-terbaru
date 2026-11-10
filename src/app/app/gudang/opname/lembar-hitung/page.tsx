import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getSettings,
  listProducts,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { formatDate, todayISO } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { applySignatureLabels, paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Lembar Hitung Opname" };
export const dynamic = "force-dynamic";

/**
 * FIX-GDG Tahap 4 (GDG2-01) — lembar hitung kertas untuk dibawa ke rak.
 * Sengaja TANPA angka stok sistem (hitung buta): petugas menulis hasil
 * hitung fisiknya di kolom Fisik, hasilnya baru dibandingkan di layar
 * tinjau form opname. Daftar produknya sama dengan mode "muat semua"
 * (produk aktif terlacak, maks 1.000).
 */
export default async function OpnameCountSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string; autoprint?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouses, settings] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
    ]);
    const warehouseId =
      warehouses.find((row) => row.id === query.warehouse)?.id ??
      pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId);
    const warehouse = warehouses.find((row) => row.id === warehouseId);
    if (!warehouse) return null;

    const rows: { id: string; name: string; sku: string }[] = [];
    let page = 1;
    for (;;) {
      const result = await listProducts(tx, {
        companyId: ctx.company.id,
        warehouseId,
        page,
        pageSize: 200,
      });
      for (const row of result.rows) {
        if (!row.trackStock) continue;
        rows.push({ id: row.id, name: row.name, sku: row.sku });
        if (rows.length >= 1000) break;
      }
      if (rows.length >= 1000 || page * result.pageSize >= result.total) break;
      page += 1;
    }
    return { warehouse, rows, settings, truncated: rows.length >= 1000 };
  });

  if (!data) notFound();
  const { warehouse, rows, settings, truncated } = data;
  const printSettings = toPrintSettings(settings);
  const today = todayISO();
  const reference = `LH-${warehouse.code}-${today}`;
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(reference) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Lembar Hitung Opname
          </p>
          <h1 className="mt-1 text-lg font-semibold">{warehouse.name}</h1>
          <p className="text-[12px] text-muted-foreground">
            {rows.length} produk terlacak{truncated ? " (dibatasi 1.000 pertama)" : ""} — tanpa angka
            sistem, untuk hitung buta di rak.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/gudang/opname"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            Kembali ke opname
          </Link>
          <ReceiptPrint auto={query.autoprint === "1"} />
        </div>
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
          <PrintHeader
            settings={printSettings}
            companyName={settings?.legalName ?? "Bisa Minimarket"}
            address={settings?.address}
            phone={settings?.phone}
            variant="document"
            title="Lembar Hitung Stok Opname"
            number={reference}
            dateLabel={formatDate(today)}
          />

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div>
              <span className="block text-black/60">Gudang</span>
              <span className="font-medium">{warehouse.name}</span>
            </div>
            <div>
              <span className="block text-black/60">Tanggal hitung</span>
              <span className="font-medium">{formatDate(today)}</span>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-5">
            Tulis jumlah fisik hasil hitung di kolom Fisik. Lembar ini sengaja tidak memuat angka
            stok sistem — selisih baru dibandingkan saat hasil hitung dimasukkan ke form opname.
          </p>

          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="border-y border-black/60 text-left">
                <th className="w-8 py-1.5 pr-2 font-semibold">No</th>
                <th className="py-1.5 pr-2 font-semibold">Produk</th>
                <th className="w-40 py-1.5 pr-2 font-semibold">Fisik</th>
                <th className="w-32 py-1.5 font-semibold">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="border-b border-black/15 align-top">
                  <td className="num py-2 pr-2">{index + 1}</td>
                  <td className="py-2 pr-2">
                    <p className="font-medium">{row.name}</p>
                    <p className="num text-[10px] text-black/60">{row.sku}</p>
                  </td>
                  <td className="py-2 pr-2" />
                  <td className="py-2" />
                </tr>
              ))}
            </tbody>
          </table>

          <PrintFooter
            settings={printSettings}
            documentNumber={reference}
            variant="document"
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
            signatures={applySignatureLabels(printSettings, "opname", [
              { label: "Dihitung oleh", name: "Petugas gudang" },
              { label: "Diperiksa oleh", name: "Kepala gudang / Pemilik" },
            ])}
          />
        </PrintShell>
      </div>
    </div>
  );
}
