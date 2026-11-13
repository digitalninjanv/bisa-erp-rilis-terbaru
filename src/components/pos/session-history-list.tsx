import Link from "next/link";
import { d, formatIDR, toDb } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/blocks/status-badge";

/**
 * Baris riwayat sesi kasir (A-8.3) — bentuk data persis seperti yang
 * dikembalikan listCashSessionHistory di server/reports.ts. Dipakai
 * bersama oleh pratinjau di /app/pos/sesi dan halaman penuh
 * /app/pos/sesi/riwayat agar angka yang dibaca pemilik selalu sama.
 */
export type SessionHistoryRowData = {
  id: string;
  userName: string | null;
  branchName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  status: string;
  openingCash: string;
  totalIn: string;
  totalOut: string;
  expectedCash: string;
  countedCash: string | null;
  difference: string | null;
  transactionCount: number;
  nonCashSalesTotal?: string;
  longOpen?: boolean;
};

export function cashMovementLabel(type: string): string {
  return (
    {
      opening: "Modal awal",
      sale: "Penjualan tunai",
      refund: "Refund",
      deposit: "Setor ke bank",
      withdrawal: "Tarik dari bank",
      adjustment: "Penyesuaian",
    }[type] ?? type
  );
}

// FIX-POS Tahap 4 (POS2-23): badge status sesi memakai StatusBadge
// bersama (token --tone-*) — label khas sesi dipertahankan lewat prop
// label agar makna "Masih terbuka" tidak berubah bagi kasir.
export function SessionStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge status={status} label={status === "open" ? "Masih terbuka" : "Ditutup"} />
  );
}

/**
 * Selisih penutupan selalu terbaca sebagai teks, bukan hanya warna:
 * nol = "Pas", negatif = "Kurang Rp X", positif = "Lebih Rp X".
 */
export function DifferenceText({ difference }: { difference: string | null }) {
  if (difference == null) return <span className="text-muted-foreground">—</span>;
  const value = d(difference);
  if (value.isZero()) {
    return <span className="font-medium text-tone-green">Pas</span>;
  }
  if (value.isNegative()) {
    return (
      <span className="font-medium whitespace-nowrap text-destructive">
        Kurang {formatIDR(toDb(value.abs()))}
      </span>
    );
  }
  return (
    <span className="font-medium whitespace-nowrap text-tone-amber">
      Lebih {formatIDR(difference)}
    </span>
  );
}

export function SessionHistoryTable({ rows }: { rows: SessionHistoryRowData[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Kasir</th>
            <th scope="col">Dibuka</th>
            <th scope="col">Ditutup</th>
            <th scope="col" className="text-right">Transaksi</th>
            <th scope="col" className="text-right">Non-tunai</th>
            <th scope="col" className="text-right">Modal awal</th>
            <th scope="col" className="text-right">
              Masuk
              <span className="block text-[10px] font-normal text-muted-foreground">
                jual + tarik bank
              </span>
            </th>
            <th scope="col" className="text-right">
              Keluar
              <span className="block text-[10px] font-normal text-muted-foreground">
                refund + setor bank
              </span>
            </th>
            <th scope="col" className="text-right">Seharusnya</th>
            <th scope="col" className="text-right">Dihitung</th>
            <th scope="col" className="text-right">Selisih</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link
                  href={`/app/pos/sesi/riwayat/${row.id}`}
                  className="text-[12px] font-medium text-foreground hover:underline"
                >
                  {row.userName ?? "Kasir"}
                </Link>
                {row.branchName ? (
                  <span className="block text-[11px] text-muted-foreground">{row.branchName}</span>
                ) : null}
              </td>
              <td className="num text-[11px] whitespace-nowrap text-muted-foreground">
                {formatDateTime(row.openedAt)}
              </td>
              <td className="num text-[11px] whitespace-nowrap text-muted-foreground">
                {row.status === "open" ? (
                  <span className="font-medium text-tone-teal">Masih terbuka</span>
                ) : row.closedAt ? (
                  formatDateTime(row.closedAt)
                ) : (
                  "—"
                )}
              </td>
              <td className="num text-right">{row.transactionCount}</td>
              <td className="num text-right">{formatIDR(row.nonCashSalesTotal ?? "0")}</td>
              <td className="num text-right">{formatIDR(row.openingCash)}</td>
              <td className="num text-right">{formatIDR(row.totalIn)}</td>
              <td className="num text-right">{formatIDR(row.totalOut)}</td>
              <td className="num text-right font-medium">{formatIDR(row.expectedCash)}</td>
              <td className="num text-right">
                {row.countedCash != null ? formatIDR(row.countedCash) : "—"}
              </td>
              <td className="num text-right">
                <DifferenceText difference={row.difference} />
                {row.difference != null && row.totalIn && d(row.totalIn).gt(0) ? (
                  <span className="block text-[10px] text-muted-foreground">
                    {d(row.difference).div(d(row.totalIn)).mul(100).toFixed(1)}%
                  </span>
                ) : null}
              </td>
              <td>
                <SessionStatusBadge status={row.status} />
                {row.longOpen ? (
                  <span className="block text-[10px] font-medium text-destructive">Terbuka &gt;24 jam</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
