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
      receivable: "Penerimaan piutang",
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

export function SessionHistoryTable({
  rows,
  showOpenExpected = false,
}: {
  rows: SessionHistoryRowData[];
  showOpenExpected?: boolean;
}) {
  return (
    <>
    <div className="hidden lg:block">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Kasir</th>
            <th scope="col">
              Waktu
              <span className="block text-[10px] font-normal text-muted-foreground">buka / tutup</span>
            </th>
            <th scope="col" className="text-right">
              Transaksi
              <span className="block text-[10px] font-normal text-muted-foreground">non-tunai</span>
            </th>
            <th scope="col" className="text-right">Modal awal</th>
            <th scope="col" className="text-right">
              Mutasi
              <span className="block text-[10px] font-normal text-muted-foreground">masuk / keluar</span>
            </th>
            <th scope="col" className="text-right">Seharusnya</th>
            <th scope="col" className="text-right">Dihitung</th>
            <th scope="col" className="text-right">Selisih</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const maskOpen = row.status === "open" && !showOpenExpected;
            return (
            <tr key={row.id}>
              <td>
                {maskOpen ? (
                  <span className="text-[12px] font-medium text-foreground">
                    {row.userName ?? "Kasir"}
                  </span>
                ) : (
                  <Link
                    href={`/app/pos/sesi/riwayat/${row.id}`}
                    className="text-[12px] font-medium text-foreground hover:underline"
                  >
                    {row.userName ?? "Kasir"}
                  </Link>
                )}
                {row.branchName ? (
                  <span className="block text-[11px] text-muted-foreground">{row.branchName}</span>
                ) : null}
                <span className="mt-1 block">
                  <SessionStatusBadge status={row.status} />
                </span>
                {row.longOpen ? (
                  <span className="mt-0.5 block text-[10px] font-medium text-destructive">
                    Terbuka &gt;24 jam
                  </span>
                ) : null}
              </td>
              <td className="num text-[11px] whitespace-nowrap text-muted-foreground">
                <span className="block">{formatDateTime(row.openedAt)}</span>
                <span className="block">
                  {row.status === "open" ? (
                    <span className="font-medium text-tone-teal">Masih terbuka</span>
                  ) : row.closedAt ? (
                    formatDateTime(row.closedAt)
                  ) : (
                    "—"
                  )}
                </span>
              </td>
              <td className="num text-right">
                <span className="block">{row.transactionCount}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {formatIDR(row.nonCashSalesTotal ?? "0")}
                </span>
              </td>
              <td className="num text-right">{formatIDR(row.openingCash)}</td>
              <td className="num text-right text-[11px]">
                <span className="block">+{formatIDR(row.totalIn)}</span>
                <span className="block text-muted-foreground">−{formatIDR(row.totalOut)}</span>
              </td>
              <td className="num text-right font-medium">
                {maskOpen ? "—" : formatIDR(row.expectedCash)}
              </td>
              <td className="num text-right">
                {maskOpen ? "—" : row.countedCash != null ? formatIDR(row.countedCash) : "—"}
              </td>
              <td className="num text-right">
                {maskOpen ? "—" : <DifferenceText difference={row.difference} />}
                {!maskOpen && row.difference != null && row.totalIn && d(row.totalIn).gt(0) ? (
                  <span className="block text-[10px] text-muted-foreground">
                    {d(row.difference).div(d(row.totalIn)).mul(100).toFixed(1)}%
                  </span>
                ) : null}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <div className="divide-y divide-border/70 lg:hidden">
      {rows.map((row) => {
        const maskOpen = row.status === "open" && !showOpenExpected;
        return (
        <div key={row.id} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            {maskOpen ? (
              <span className="text-[12px] font-medium text-foreground">
                {row.userName ?? "Kasir"}
              </span>
            ) : (
              <Link
                href={`/app/pos/sesi/riwayat/${row.id}`}
                className="inline-flex min-h-11 min-w-11 items-center text-[12px] font-medium text-primary hover:underline"
              >
                {row.userName ?? "Kasir"}
              </Link>
            )}
            <SessionStatusBadge status={row.status} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {row.branchName ? `${row.branchName} · ` : ""}
            {formatDateTime(row.openedAt)}
            {row.closedAt ? ` — ${formatDateTime(row.closedAt)}` : ""}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Transaksi</dt>
              <dd className="num">{row.transactionCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Non-tunai</dt>
              <dd className="num">{formatIDR(row.nonCashSalesTotal ?? "0")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Seharusnya</dt>
              <dd className="num">{maskOpen ? "—" : formatIDR(row.expectedCash)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Dihitung</dt>
              <dd className="num">
                {maskOpen ? "—" : row.countedCash != null ? formatIDR(row.countedCash) : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Selisih</dt>
              <dd>{maskOpen ? "—" : <DifferenceText difference={row.difference} />}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Modal</dt>
              <dd className="num">{formatIDR(row.openingCash)}</dd>
            </div>
          </dl>
          {row.longOpen ? (
            <p className="mt-1 text-[10px] font-medium text-destructive">Terbuka &gt;24 jam</p>
          ) : null}
        </div>
        );
      })}
    </div>
    </>
  );
}
