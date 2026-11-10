import Link from "next/link";
import { Fragment } from "react";
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  PackageCheck,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { getInventoryValuation } from "@/server/reports";
import { getWarehouseDashboardData } from "@/server/catalog";
import { getOpnameReminders } from "@/server/inventory";
import { listExpiringBatches } from "@/server/batches";
import { getCompanySettingsRow } from "@/server/settings";
import { requirePermissionPage } from "@/lib/session";
import { formatIDR, formatNumber, formatQty } from "@/lib/money";
import { formatDate, formatDateTime, movementReferenceHref, todayISO, stockMovementTypeLabel } from "@/lib/format";
import { groupMovementsByDocument } from "@/lib/gudang/movement-groups";
import { PageHeader } from "@/components/blocks/page-header";
import { ForbiddenBanner } from "@/components/blocks/forbidden-banner";
import { StatCard } from "@/components/blocks/stat-card";
import { EmptyState } from "@/components/blocks/empty-state";
import { WorkQueue, type WorkQueueItem } from "@/components/blocks/work-queue";

export const metadata = { title: "Ringkasan gudang" };
export const dynamic = "force-dynamic";

export default async function WarehouseDashboard({
  searchParams,
}: {
  searchParams: Promise<{ forbidden?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    // A-28 Tahap 2 (H-GDG-02): jendela peringatan kedaluwarsa dari
    // pengaturan perusahaan (bawaan skema 30 hari), bukan angka mati.
    const settingsRow = await getCompanySettingsRow(tx, ctx.company.id);
    const expiryWarningDays = settingsRow?.expiryWarningDays ?? 30;
    const [valuation, dashboard, expiring, opnameReminders] = await Promise.all([
      getInventoryValuation(tx, ctx.company.id),
      getWarehouseDashboardData(tx, ctx.company.id),
      // G8/D-7: batches already expired or expiring within the
      // configured warning window.
      listExpiringBatches(tx, ctx.company.id, expiryWarningDays),
      // A-24 T3 (G3): pengingat opname jatuh tempo dari frekuensi
      // hitung berkonfigurasi per perusahaan (Pengaturan → lokasi).
      getOpnameReminders(tx, ctx.company.id, todayISO()),
    ]);

    return {
      valuation,
      ...dashboard,
      expiring,
      opnameReminders,
      expiryWarningDays,
    };
  });

  // A-25 U3: antrean kerja beranda memakai WorkQueue bersama —
  // item bernilai nol tidak dirender sama sekali (pola §3.4),
  // menggantikan seksi pengingat opname khusus + panel lipat
  // kedaluwarsa yang dulu selalu tampil (AUDIT-UI-A25 GDG-11,
  // POLA-08/09). Angka-angkanya dari data yang sama dengan halaman.
  const expiredCount = data.expiring.filter((row) => (row.expiryDate ?? "") < todayISO()).length;
  const queueItems: WorkQueueItem[] = [
    {
      key: "opname",
      label: "Opname jatuh tempo",
      count: data.opnameReminders.length,
      headline: `${formatNumber(data.opnameReminders.length)} cakupan menunggu opname`,
      detail: data.opnameReminders
        .slice(0, 2)
        .map(
          (reminder) =>
            `${reminder.scopeType === "warehouse" ? "" : "Kategori "}${reminder.scopeName}${
              reminder.status.daysOverdue > 0 ? ` — lewat ${reminder.status.daysOverdue} hari` : ""
            }`,
        )
        .join(" · "),
      href: "/app/gudang/opname?tab=tugas",
      actionLabel: "Tangani tugas opname",
      tone: "amber",
      icon: <ClipboardCheck className="size-4" />,
    },
    {
      key: "low-stock",
      label: "Stok menipis",
      count: data.lowCount,
      headline: `${formatNumber(data.lowCount)} produk di bawah stok minimum`,
      detail: "Periksa dan buat pesanan pembelian sebelum kehabisan.",
      href: "/app/gudang/produk?lowStock=1",
      actionLabel: "Lihat produk menipis",
      tone: "red",
      icon: <TriangleAlert className="size-4" />,
    },
    {
      key: "expiring",
      label: "Kedaluwarsa & mendekati",
      count: data.expiring.length,
      headline:
        expiredCount > 0
          ? `${formatNumber(expiredCount)} batch sudah kedaluwarsa`
          : `${formatNumber(data.expiring.length)} batch mendekati kedaluwarsa`,
      detail: "Batch kedaluwarsa tidak bisa dijual; keluarkan lewat penyesuaian stok.",
      href: "#kedaluwarsa",
      actionLabel: "Lihat daftar batch",
      tone: expiredCount > 0 ? "red" : "amber",
      icon: <PackageCheck className="size-4" />,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Ringkasan persediaan"
        description="Pantau nilai stok, barang menipis, dokumen terbaru, dan pergerakan stok lintas gudang."
        actions={
          <>
            <Link href="/app/gudang/penerimaan" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90">
              <PackageCheck className="size-3.5" /> Terima barang
            </Link>
            <Link href="/app/gudang/opname" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted">
              <ClipboardCheck className="size-3.5" /> Opname
            </Link>
          </>
        }
      />

      {params.forbidden ? (
        <div className="mb-3">
          <ForbiddenBanner permission={params.forbidden} />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Nilai persediaan" value={formatIDR(data.valuation.totalValue)} hint="Harga pokok rata-rata" icon={Boxes} tone="amber" />
        <StatCard label="Potensi jual" value={formatIDR(data.valuation.totalPotential)} hint="Jika seluruh stok terjual" icon={Warehouse} tone="teal" />
        <StatCard label="SKU aktif" value={formatNumber(data.productCount)} hint={`${formatQty(data.valuation.totalQty)} unit tercatat`} icon={Warehouse} tone="plum" />
        <StatCard label="Stok menipis" value={formatNumber(data.lowCount)} hint="Di bawah stok minimum" icon={TriangleAlert} tone={data.lowCount > 0 ? "red" : "green"} />
      </div>

      {/* A-25 U3: antrean kerja resmi — menggantikan seksi pengingat
          opname khusus di bawah ini dulu. Yang nol tidak dirender. */}
      <WorkQueue title="Antrean kerja" items={queueItems} className="mt-4" />

      {/* Tabel batch bermasalah hanya tampil bila memang ada
          (GDG-11: kini ditunjuk kartu antrean di atas, bukan lipatan
          yang mudah terlewat); keadaan nol tidak dirender sama
          sekali (POLA-08). */}
      {data.expiring.length === 0 ? null : (
      <section id="kedaluwarsa" className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Kedaluwarsa & mendekati kedaluwarsa</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Batch kedaluwarsa tidak bisa dijual; keluarkan lewat penyesuaian stok.</p>
          </div>
        </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Gudang</th>
                  <th>Batch</th>
                  <th>Kedaluwarsa</th>
                  <th className="text-right">Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.expiring.slice(0, 15).map((row) => {
                  const expired = (row.expiryDate ?? "") < todayISO();
                  return (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/app/gudang/produk/${row.productId}`} className="text-[12px] font-medium hover:underline">
                          {row.productName}
                        </Link>
                        <p className="num text-[10px] text-muted-foreground">{row.productSku}</p>
                      </td>
                      <td className="text-[11px]">{row.warehouseName}</td>
                      <td className="num text-[11px] font-medium">{row.batchNumber ?? "Tanpa batch"}</td>
                      <td className="num text-[11px]">{row.expiryDate ? formatDate(row.expiryDate) : "—"}</td>
                      <td className="num text-right font-medium">{formatQty(row.qty)}</td>
                      <td>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            expired ? "bg-tone-red-soft text-destructive" : "bg-tone-amber-soft text-tone-amber"
                          }`}
                        >
                          {expired ? "Kedaluwarsa" : `≤${data.expiryWarningDays} hari`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        {data.expiring.length > 15 ? (
          <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            Menampilkan 15 dari {data.expiring.length} batch. Buka detail produk untuk daftar lengkap per produk.
          </p>
        ) : null}
      </section>
      )}

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Pergerakan stok terbaru</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Semua dokumen otomatis memperbarui kartu stok</p>
            </div>
            <Link href="/app/gudang/pergerakan" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
              Semua <ArrowRight className="size-3" />
            </Link>
          </div>
          {data.movements.length === 0 ? (
            <EmptyState title="Belum ada pergerakan" description="Penerimaan, penjualan, dan penyesuaian akan muncul di sini." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produk</th>
                    <th>Gudang</th>
                    <th>Jenis</th>
                    <th className="text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {/* A-28 UI-4 (UX-C03, sisa GDG-08): baris terkelompok
                      per dokumen asal — baris kepala grup membawa waktu
                      + nomor referensi TERTAUT ke dokumennya lewat
                      movementReferenceHref (pola yang sama dengan
                      daftar Pergerakan stok); jenis tetap per baris
                      karena satu dokumen dapat memuat jenis campuran
                      (mis. transfer keluar + masuk). */}
                  {groupMovementsByDocument(data.movements).map((group) => {
                    const href = movementReferenceHref(group.referenceType, group.referenceId);
                    const head = group.rows[0];
                    return (
                      <Fragment key={group.key}>
                        <tr className="bg-muted/40">
                          <td colSpan={4} className="py-1.5">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="num text-[11px] text-muted-foreground">
                                {head ? formatDateTime(head.createdAt) : ""}
                              </span>
                              {group.referenceNumber ? (
                                href ? (
                                  <Link href={href} className="num text-[11px] font-medium text-primary hover:underline">
                                    {group.referenceNumber}
                                  </Link>
                                ) : (
                                  <span className="num text-[11px] font-medium">{group.referenceNumber}</span>
                                )
                              ) : (
                                <span className="text-[11px] text-muted-foreground">Tanpa dokumen asal</span>
                              )}
                              {group.rows.length > 1 ? (
                                <span className="text-[10px] text-muted-foreground">{group.rows.length} baris</span>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <p className="text-[12px] font-medium">{row.productName ?? "—"}</p>
                              <p className="num text-[10px] text-muted-foreground">{row.sku}</p>
                            </td>
                            <td className="text-[11px]">{row.warehouseName ?? "—"}</td>
                            <td className="text-[11px]">{stockMovementTypeLabel(row.movementType)}</td>
                            <td className={`num text-right font-medium ${Number(row.qty) < 0 ? "text-destructive" : "text-tone-green"}`}>
                              {Number(row.qty) > 0 ? "+" : ""}
                              {formatQty(row.qty)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Gudang aktif</h2>
            </div>
            <ul className="divide-y divide-border/70">
              {data.warehouses.map((row) => (
                <li key={row.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-[12px] font-medium">{row.name}</p>
                    <p className="num text-[10px] text-muted-foreground">{row.code} · {row.type}</p>
                  </div>
                  {row.isDefault ? (
                    <span className="rounded-full bg-tone-green-soft px-2 py-0.5 text-[10px] font-semibold text-tone-green">Utama</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {/* A-25 U3 (POLA-08): kartu dokumen terakhir tidak lagi
              dirender sebagai daftar kosong — tanpa dokumen, kartu
              hilang dari rel. */}
          {data.receipts.length + data.docs.length === 0 ? null : (
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-[13px] font-semibold">Dokumen terakhir</h2>
            </div>
            <ul className="divide-y divide-border/70">
              {[...data.receipts.map((r) => ({ ...r, kind: "Penerimaan" })), ...data.docs.map((d) => ({ ...d, kind: docLabel(d.type) }))]
                .slice(0, 7)
                .map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <p className="num text-[11px] font-medium">{doc.number}</p>
                      <p className="text-[10px] text-muted-foreground">{doc.kind} · {formatDate(doc.date)}</p>
                    </div>
                    <span className="num text-[11px] font-medium">{formatIDR(doc.total)}</span>
                  </li>
                ))}
            </ul>
          </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function docLabel(type: string) {
  return (
    {
      adjustment: "Penyesuaian",
      opname: "Opname",
      transfer: "Transfer",
      purchase_return: "Retur pembelian",
    }[type] ?? type
  );
}
