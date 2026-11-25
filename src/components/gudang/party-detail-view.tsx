import Link from "next/link";
import type { PartyDetail } from "@/server/master-data";
import { formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { statusLabel } from "@/components/blocks/status-badge";
import { AuditHistorySection } from "@/components/blocks/audit-history";

/**
 * S3 (§18D): halaman detail pihak — profil master, saldo berjalan dari
 * subledger yang sama dengan daftar Piutang/Utang, riwayat transaksi,
 * dan riwayat perubahan dari audit_log.
 *
 * A-25 U3 (GDG-02): halaman ini sekarang BERAKSI, bukan kartu kosong —
 * saldo menautkan ke pembayaran di Piutang & Utang (tersaring nama
 * pihak ini), form PO terpasang untuk pemasok (`createSection`), dan
 * ubah profil memakai form master yang sama dengan daftar
 * (`editForm`) — semua memakai aksi/tautan yang sudah ada, tidak ada
 * aksi baru yang dikarang. Status selalu diterjemahkan
 * (statusLabel), nomor dokumen tertaut ke dokumennya, dan seksi
 * kosong memakai EmptyState ringkas (POLA-08/12).
 */
export function PartyDetailView({
  detail,
  editForm,
  createSection,
}: {
  detail: PartyDetail;
  editForm?: React.ReactNode;
  createSection?: React.ReactNode;
}) {
  const isSupplier = detail.kind === "supplier";
  const party = detail.party;
  const label = isSupplier ? "Pemasok" : "Pelanggan";
  const hasOutstanding = Number(detail.outstanding) > 0;
  const ledgerHref = `/app/akuntansi/piutang-utang?tab=${isSupplier ? "utang" : "piutang"}&q=${encodeURIComponent(party.name)}`;

  const profileRows: [string, string][] = [
    ["Kode", party.code],
    ["Nama", party.name],
    ["Telepon", party.phone ?? "—"],
    ["Email", party.email ?? "—"],
    ["Alamat", party.address ?? "—"],
    ["NPWP / NIK", party.taxId ?? "—"],
    ["Termin pembayaran", party.paymentTermDays != null ? `${party.paymentTermDays} hari` : "—"],
  ];
  if (isSupplier) {
    profileRows.push([
      "Rekening pembayaran",
      party.bankAccountNumber
        ? `${party.bankName ?? ""} ${party.bankAccountNumber}${party.bankAccountName ? ` a.n. ${party.bankAccountName}` : ""}`.trim()
        : "—",
    ]);
  } else {
    profileRows.push([
      "Batas kredit",
      party.creditLimit && Number(party.creditLimit) > 0
        ? formatIDR(party.creditLimit)
        : party.creditLimitUnlimited === false
          ? "Kredit tidak diizinkan"
          : "Tanpa batas",
    ]);
  }
  profileRows.push(["Status", party.isActive ? "Aktif" : "Nonaktif"]);
  if (party.notes) profileRows.push(["Catatan", party.notes]);

  return (
    <div>
      <PageHeader
        eyebrow={`Gudang · ${label}`}
        title={party.name}
        description={`${party.code} — profil, saldo berjalan, riwayat transaksi, dan riwayat perubahan.`}
        actions={
          <>
            {editForm}
            <Link
              href="/app/gudang/pemasok"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              Kembali ke daftar pihak
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="h-fit rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Profil</h2>
          <dl className="space-y-2">
            {profileRows.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt className="text-[11px] text-muted-foreground">{key}</dt>
                <dd className="text-right text-[12px] font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              {isSupplier ? "Utang berjalan (subledger)" : "Piutang berjalan (subledger)"}
            </p>
            <p className="num text-[18px] font-semibold">{formatIDR(detail.outstanding)}</p>
            {detail.supplierCreditRemaining && Number(detail.supplierCreditRemaining) > 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Sisa kredit pemasok (klaim retur):{" "}
                <span className="num font-medium text-foreground">{formatIDR(detail.supplierCreditRemaining)}</span>
              </p>
            ) : null}
            {/* A-25 U3 (GDG-02): dari saldo langsung ke pekerjaannya —
                dialog bayar/terima yang sama seperti antrean
                Piutang & Utang, tersaring ke pihak ini. */}
            <div className="mt-3 space-y-1.5">
              <Link
                href={ledgerHref}
                className={
                  hasOutstanding
                    ? "flex h-9 items-center justify-center rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90"
                    : "flex h-9 items-center justify-center rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted"
                }
              >
                {isSupplier
                  ? hasOutstanding
                    ? "Bayar utang"
                    : "Lihat utang & pembayaran"
                  : hasOutstanding
                    ? "Terima pembayaran"
                    : "Lihat piutang & pembayaran"}
              </Link>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Membuka Piutang &amp; Utang tersaring ke {party.name} — pembayaran dicatat di sana
                dengan dialog yang sama seperti antrean kerja akuntansi.
              </p>
            </div>
          </div>
        </section>

        <div className="space-y-4">
          {createSection}
          {isSupplier ? (
            <>
              <HistorySection
                title="Penerimaan barang"
                empty="Belum ada penerimaan dari pemasok ini."
                headers={["Nomor", "Tanggal", "Status bayar", "Total"]}
                rows={detail.receipts.map((row) => ({
                  href: `/app/gudang/penerimaan/${row.id}`,
                  cells: [
                    row.number,
                    formatDate(row.date),
                    row.status === "void" ? "Dibatalkan" : statusLabel(row.paymentStatus),
                    formatIDR(row.total),
                  ],
                }))}
              />
              <HistorySection
                title="Pesanan pembelian (PO)"
                empty="Belum ada PO untuk pemasok ini."
                headers={["Nomor", "Tanggal", "Status", "Total"]}
                rows={detail.purchaseOrders.map((row) => ({
                  href: `/app/gudang/pembelian/${row.id}`,
                  cells: [row.number, formatDate(row.date), statusLabel(row.status), formatIDR(row.total)],
                }))}
              />
              <HistorySection
                title="Retur pembelian"
                empty="Belum ada retur ke pemasok ini."
                headers={["Nomor", "Tanggal", "Status", "Nilai retur"]}
                rows={detail.supplierReturns.map((row) => ({
                  href: `/app/gudang/retur-pembelian/${row.id}`,
                  cells: [row.number, formatDate(row.date), statusLabel(row.status), formatIDR(row.totalValue)],
                }))}
              />
            </>
          ) : (
            <HistorySection
              title="Penjualan"
              empty="Belum ada penjualan ke pelanggan ini."
              headers={["Nomor", "Tanggal", "Status bayar", "Total"]}
              rows={detail.sales.map((row) => ({
                href: `/app/pos/nota/${row.id}?salinan=1`,
                cells: [
                  row.number,
                  formatDate(row.date),
                  row.status === "void" ? "Dibatalkan" : statusLabel(row.paymentStatus),
                  formatIDR(row.total),
                ],
              }))}
            />
          )}

          <HistorySection
            title="Dokumen saldo awal"
            empty="Tidak ada dokumen saldo awal untuk pihak ini."
            headers={["Nomor", "Tanggal", "Jatuh tempo", "Status", "Sisa"]}
            rows={detail.openings.map((row) => ({
              cells: [
                row.number,
                formatDate(row.date),
                formatDate(row.dueDate),
                statusLabel(row.status),
                formatIDR(Number(row.amount) - Number(row.paidAmount)),
              ],
            }))}
          />
          <HistorySection
            title={isSupplier ? "Pembayaran utang" : "Penerimaan piutang"}
            empty="Belum ada pembayaran tercatat untuk pihak ini."
            headers={["Nomor", "Tanggal", "Status", "Jumlah"]}
            rows={detail.payments.map((row) => ({
              cells: [row.number, formatDate(row.date), statusLabel(row.status), formatIDR(row.amount)],
            }))}
          />

          <AuditHistorySection
            rows={detail.auditTrail}
            emptyDescription="Perubahan master pihak ini akan tercatat di sini."
          />
        </div>
      </div>
    </div>
  );
}

function HistorySection({
  title,
  empty,
  headers,
  rows,
}: {
  title: string;
  empty: string;
  headers: string[];
  rows: { href?: string; cells: string[] }[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-3 py-2.5 text-[13px] font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <div className="p-3">
          <EmptyState size="compact" title={empty} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={header} className={index === headers.length - 1 ? "text-right" : undefined}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.cells.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`text-[12px] ${cellIndex === row.cells.length - 1 ? "num text-right font-medium" : ""} ${
                        cellIndex === 0 ? "num" : ""
                      }`}
                    >
                      {cellIndex === 0 && row.href ? (
                        <Link href={row.href} className="font-medium text-primary hover:underline">
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
