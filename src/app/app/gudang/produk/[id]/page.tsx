import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes, History, Printer, Warehouse } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { units as unitTable } from "@/db/schema";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import {
  getProduct,
  getSettings,
  listCategories,
  listProductPackagings,
  listSuppliers,
  listUnits,
  listWarehouses,
  stockByProduct,
} from "@/server/catalog";
import { getStockCard } from "@/server/reports";
import { listEntityAuditTrail } from "@/server/audit";
import { listBatches } from "@/server/batches";
import { SERIAL_STATUS_LABELS, getProductSerialCard } from "@/server/serials";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { d, formatIDR, formatQty } from "@/lib/money";
import { packagingBreakdownLabel } from "@/lib/packaging";
import { formatDate, formatDateTime, stockMovementTypeLabel, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { StatCard } from "@/components/blocks/stat-card";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { ProductForm } from "@/components/gudang/product-form";
import { AuditHistorySection } from "@/components/blocks/audit-history";
import { CustomFieldValueList } from "@/components/gudang/custom-field-inputs";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wh?: string; page?: string; auditPage?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const product = await getProduct(tx, ctx.company.id, id);
    if (!product) return null;
    const [settings, warehouses, categories, units, suppliers] = await Promise.all([
      getSettings(tx, ctx.company.id),
      listWarehouses(tx, ctx.company.id),
      listCategories(tx, ctx.company.id),
      listUnits(tx, ctx.company.id),
      listSuppliers(tx, ctx.company.id),
    ]);
    // GD-P2-5: the stock card is per warehouse — the picker selects one
    // (default warehouse preselected) and its balance never mixes others.
    const cardWarehouse =
      warehouses.find((row) => row.id === query.wh) ??
      warehouses.find((row) => row.isDefault) ??
      warehouses[0];
    const card = cardWarehouse
      ? await getStockCard(tx, ctx.company.id, id, {
          warehouseId: cardWarehouse.id,
          page: Number(query.page ?? 1),
          pageSize: 50,
        })
      : null;
    const perWarehouse: { id: string; name: string; qty: number }[] = [];
    for (const warehouse of warehouses) {
      const map = await stockByProduct(tx, ctx.company.id, warehouse.id, [id]);
      perWarehouse.push({ id: warehouse.id, name: warehouse.name, qty: map.get(id) ?? 0 });
    }
    // G8/D-7: batch breakdown for tracked products (rows with stock left;
    // empty batch rows are history, not a stock position).
    const batches = product.trackBatch
      ? (await listBatches(tx, ctx.company.id, id)).filter((row) => Number(row.qty) > 0)
      : [];
    // SIM-2 S7B-2 Batch 5: kartu seri untuk produk track_serial.
    const serialCard = product.trackSerial
      ? await getProductSerialCard(tx, ctx.company.id, id)
      : [];
    // T5-2: listUnits only offers active units; a product whose unit was
    // deactivated must still show and keep that unit in its edit form.
    let formUnits = units.map((row) => ({ ...row, isActive: true }));
    if (product.unitId && !formUnits.some((row) => row.id === product.unitId)) {
      const [currentUnit] = await tx
        .select({
          id: unitTable.id,
          code: unitTable.code,
          name: unitTable.name,
          isActive: unitTable.isActive,
        })
        .from(unitTable)
        .where(and(eq(unitTable.companyId, ctx.company.id), eq(unitTable.id, product.unitId)))
        .limit(1);
      if (currentUnit) formUnits = [...formUnits, currentUnit];
    }
    const customFields = customFieldDefinitionsFor(settings?.customFields, "product");
    // REM-03: riwayat perubahan master produk dari audit_log.
    const audit = await listEntityAuditTrail(tx, ctx.company.id, "product", id, {
      page: Number(query.auditPage ?? 1),
      pageSize: 20,
    });
    // Satuan Kemasan S1: daftar kemasan produk untuk seksi Kemasan &
    // formulir ubah (domain catalog/packaging, satu sumber).
    const packagings = await listProductPackagings(tx, ctx.company.id, id);
    return { product, warehouses, categories, units, formUnits, suppliers, perWarehouse, card, cardWarehouse, batches, serialCard, customFields, audit, packagings };
  });

  if (!data) notFound();
  const { product } = data;
  const totalStock = data.perWarehouse.reduce((acc, row) => acc + row.qty, 0);

  return (
    <div>
      <Link href="/app/gudang/produk" className="mb-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Kembali ke produk
      </Link>

      <PageHeader
        eyebrow={product.sku}
        title={product.name}
        description={[product.barcode, product.notes].filter(Boolean).join(" · ") || "Detail produk dan kartu stok."}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/app/gudang/produk/label?ids=${product.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              <Printer className="size-3.5" /> Cetak label
            </Link>
            {can(ctx, "inventory.manage") ? (
              <ProductForm
                product={{
                  id: product.id,
                  name: product.name,
                  sku: product.sku,
                  barcode: product.barcode,
                  categoryId: product.categoryId,
                  unitId: product.unitId,
                  supplierId: product.supplierId,
                  costPrice: product.costPrice,
                  salePrice: product.salePrice,
                  minStock: product.minStock,
                  trackStock: product.trackStock,
                  trackBatch: product.trackBatch,
                  trackSerial: product.trackSerial,
                  isTaxExempt: product.isTaxExempt,
                  isActive: product.isActive,
                  notes: product.notes,
                  attributes: product.attributes ?? null,
                  packagings: data.packagings,
                }}
                categories={data.categories}
                units={data.formUnits}
                suppliers={data.suppliers}
                allowCost={can(ctx, "inventory.cost")}
                allowPrice={can(ctx, "inventory.price")}
                customFields={data.customFields}
              />
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Stok total"
          value={formatQty(totalStock)}
          hint={
            packagingBreakdownLabel(
              totalStock,
              data.packagings.filter((pack) => pack.isActive),
              data.formUnits.find((u) => u.id === product.unitId)?.name ?? "Pcs",
            ) ?? "Semua gudang"
          }
          icon={Boxes}
          tone="teal"
        />
        <StatCard label="Harga jual" value={formatIDR(product.salePrice)} hint="Harga dasar" tone="plum" />
        {can(ctx, "inventory.cost") ? (
          <StatCard label="Harga pokok" value={formatIDR(product.costPrice)} hint={`Nilai stok ${formatIDR(totalStock * Number(product.costPrice))}`} tone="amber" />
        ) : (
          <StatCard label="Minimum stok" value={formatQty(product.minStock)} hint="Batas peringatan" tone="amber" />
        )}
        <StatCard label="Status" value={product.isActive ? "Aktif" : "Nonaktif"} hint="Master produk" tone={product.isActive ? "green" : "neutral"} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold">Kartu stok</h2>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {data.card?.total ?? 0} pergerakan{data.cardWarehouse ? ` · ${data.cardWarehouse.name}` : ""}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
            {data.warehouses.map((row) => (
              <Link
                key={row.id}
                href={`/app/gudang/produk/${id}?wh=${row.id}`}
                className={`rounded-full px-2.5 py-1 text-[11px] ${data.cardWarehouse?.id === row.id ? "bg-foreground text-background" : "border border-border bg-card text-muted-foreground hover:bg-muted"}`}
              >
                {row.name}
              </Link>
            ))}
          </div>
          {!data.card || data.card.total === 0 ? (
            <EmptyState title="Belum ada pergerakan" description="Penerimaan atau penjualan di gudang ini akan muncul di kartu stok." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Jenis</th>
                      <th>Referensi</th>
                      <th className="text-right">Masuk/Keluar</th>
                      <th className="text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.card.page > 1 || !d(data.card.openingBalance).isZero() ? (
                      <tr className="bg-muted/20">
                        <td colSpan={4} className="text-[11px] font-medium text-muted-foreground">Saldo awal halaman</td>
                        <td className="num text-right font-medium">{formatQty(data.card.openingBalance)}</td>
                      </tr>
                    ) : null}
                    {data.card.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="num whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                        <td className="text-[11px]">{stockMovementTypeLabel(row.movementType)}</td>
                        <td className="num text-[11px] text-muted-foreground">{row.referenceNumber ?? row.reason ?? "—"}</td>
                        <td className={`num text-right font-medium ${d(row.qty).isNegative() ? "text-destructive" : "text-tone-green"}`}>
                          {d(row.qty).gt(0) ? "+" : ""}
                          {formatQty(row.qty)}
                        </td>
                        <td className="num text-right">{formatQty(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={data.card.page}
                pageSize={data.card.pageSize}
                total={data.card.total}
                basePath={`/app/gudang/produk/${id}`}
                params={{ wh: data.cardWarehouse?.id, auditPage: query.auditPage }}
              />
            </>
          )}
        </section>

        <aside className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Warehouse className="size-3.5 text-muted-foreground" /> Stok per gudang
            </h2>
            <ul className="mt-2 space-y-2">
              {data.perWarehouse.map((row) => {
                // S3: pecahan kemasan terbesar sebagai bantuan baca
                // (display-only; angka dasar di kanan tidak berubah).
                const breakdown = packagingBreakdownLabel(
                  row.qty,
                  data.packagings.filter((pack) => pack.isActive),
                  data.formUnits.find((u) => u.id === product.unitId)?.name ?? "Pcs",
                );
                return (
                <li key={row.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">{row.name}</span>
                  {/* A-25 U3 (GDG-12): nol di gudang yang memang tidak
                      menyimpan produk ini adalah keadaan normal
                      (redup), bukan galat merah. Merah hanya untuk
                      stok negatif; kuning untuk menipis (0 < qty ≤
                      minimum). */}
                  <span
                    className={`num font-semibold ${
                      row.qty < 0
                        ? "text-destructive"
                        : row.qty === 0
                          ? "font-normal text-muted-foreground"
                          : row.qty <= Number(product.minStock)
                            ? "text-tone-amber"
                            : ""
                    }`}
                  >
                    {formatQty(row.qty)}
                    {breakdown ? (
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {breakdown}
                      </span>
                    ) : null}
                  </span>
                </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 text-[12px]">
            <h2 className="text-[13px] font-semibold">Informasi</h2>
            <dl className="mt-2 space-y-1.5">
              {/* SKU tinggal di sini; barcode sudah tampil pada
                  deskripsi kepala halaman (GDG-12: rel tidak
                  mengulang identitas yang sama). */}
              <Row label="SKU" value={product.sku} />
              <Row label="Kategori" value={data.categories.find((c) => c.id === product.categoryId)?.name ?? "—"} />
              <Row label="Satuan" value={data.formUnits.find((u) => u.id === product.unitId)?.code ?? "—"} />
              <Row label="Pemasok" value={data.suppliers.find((s) => s.id === product.supplierId)?.name ?? "—"} />
              <Row label="Lacak stok" value={product.trackStock ? "Ya" : "Tidak"} />
              <Row label="Lacak batch" value={product.trackBatch ? "Ya" : "Tidak"} />
              <CustomFieldValueList definitions={data.customFields} values={product.attributes} />
            </dl>
          </div>
        </aside>
      </div>

      {/* Satuan Kemasan S1: kemasan adalah konversi tetap ke satuan
          dasar; stok tidak pernah disimpan dalam kemasan. */}
      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Kemasan</h2>
          <span className="text-[11px] text-muted-foreground">
            Isi dinyatakan langsung ke satuan dasar ({data.formUnits.find((u) => u.id === product.unitId)?.code ?? "satuan dasar"}). Ubah lewat tombol Ubah produk.
          </span>
        </div>
        {data.packagings.length === 0 ? (
          <EmptyState title="Belum ada kemasan" description="Produk ini dibeli & dijual hanya dalam satuan dasar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kemasan</th>
                  <th className="text-right">Isi</th>
                  {can(ctx, "inventory.cost") ? <th className="text-right">Harga beli</th> : null}
                  <th className="text-right">Harga jual</th>
                  <th>Barcode</th>
                  <th>Bawaan</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.packagings.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.name}</td>
                    <td className="num text-right">{formatQty(row.isi)}</td>
                    {can(ctx, "inventory.cost") ? (
                      <td className="num text-right">{row.buyPrice ? formatIDR(row.buyPrice) : "—"}</td>
                    ) : null}
                    <td className="num text-right">{row.salePrice ? formatIDR(row.salePrice) : "—"}</td>
                    <td className="num text-[11px]">{row.barcode ?? "—"}</td>
                    <td className="text-[11px]">
                      {[row.isDefaultPurchase ? "Beli" : null, row.isDefaultSale ? "Jual" : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="text-[11px]">{row.isActive ? "Aktif" : "Nonaktif"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {product.trackBatch ? (
        <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Stok per batch</h2>
            <span className="text-[11px] text-muted-foreground">
              Penjualan mengambil kedaluwarsa paling awal (FEFO); batch kedaluwarsa tidak bisa dijual.
            </span>
          </div>
          {data.batches.length === 0 ? (
            <EmptyState title="Belum ada batch" description="Batch muncul setelah penerimaan pertama produk ini." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Gudang</th>
                    <th>Batch</th>
                    <th>Kedaluwarsa</th>
                    <th className="text-right">Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.batches.map((row) => {
                    const status = batchStatus(row.expiryDate);
                    return (
                      <tr key={row.id}>
                        <td className="text-[11px]">{data.warehouses.find((w) => w.id === row.warehouseId)?.name ?? "—"}</td>
                        <td className="num text-[11px] font-medium">{row.batchNumber ?? "Tanpa batch"}</td>
                        <td className="num text-[11px]">{row.expiryDate ? formatDate(row.expiryDate) : "—"}</td>
                        <td className="num text-right font-medium">{formatQty(row.qty)}</td>
                        <td>
                          {status ? (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                status.tone === "red"
                                  ? "bg-tone-red-soft text-destructive"
                                  : "bg-tone-amber-soft text-tone-amber"
                              }`}
                            >
                              {status.label}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">Baik</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {product.trackSerial ? (
        <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Kartu nomor seri</h2>
            <span className="text-[11px] text-muted-foreground">
              {data.serialCard.filter((row) => row.status === "in_stock").length} unit di stok dari {data.serialCard.length} seri terdaftar.
            </span>
          </div>
          {data.serialCard.length === 0 ? (
            <EmptyState title="Belum ada nomor seri" description="Seri muncul setelah penerimaan pertama produk ini dengan daftar nomor seri." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nomor seri</th>
                    <th>Gudang</th>
                    <th>Status</th>
                    <th>Riwayat terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {data.serialCard.map((row) => {
                    const last = row.movements[row.movements.length - 1];
                    return (
                      <tr key={row.id}>
                        <td className="num text-[11px] font-medium">{row.serialNumber}</td>
                        <td className="text-[11px]">{data.warehouses.find((w) => w.id === row.warehouseId)?.name ?? "—"}</td>
                        <td className="text-[11px]">{SERIAL_STATUS_LABELS[row.status] ?? row.status}</td>
                        <td className="text-[11px] text-muted-foreground">
                          {last
                            ? `${last.kind}${last.referenceNumber ? ` · ${last.referenceNumber}` : ""} · ${formatDateTime(last.createdAt)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <div className="mt-3">
        <AuditHistorySection
          rows={data.audit.rows}
          emptyDescription="Perubahan master produk ini akan tercatat di sini."
          headerClassName="border-b border-border px-4 py-3"
          footer={
            <Pagination
              page={data.audit.page}
              pageSize={data.audit.pageSize}
              total={data.audit.total}
              basePath={`/app/gudang/produk/${id}`}
              params={{ wh: data.cardWarehouse?.id, page: query.page }}
              pageParam="auditPage"
            />
          }
        />
      </div>
    </div>
  );
}

/** Expiry badge for a batch row: expired beats near-expiry; no date is fine. */
function batchStatus(expiryDate: string | null): { label: string; tone: "red" | "amber" } | null {
  if (!expiryDate) return null;
  const today = todayISO();
  if (expiryDate < today) return { label: "Kedaluwarsa", tone: "red" };
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 30);
  if (expiryDate <= cutoff.toISOString().slice(0, 10)) return { label: "≤30 hari", tone: "amber" };
  return null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num truncate font-medium">{value}</dd>
    </div>
  );
}
