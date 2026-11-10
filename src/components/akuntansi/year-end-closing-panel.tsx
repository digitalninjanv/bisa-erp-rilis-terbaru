"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookCheck, Lock } from "lucide-react";
import { toast } from "sonner";
import { formatIDR, formatIDRSigned } from "@/lib/money";
import {
  lockYearPeriodsAction,
  postYearEndClosingAction,
} from "@/server/actions/accounting/periode";

type ClosingPreview = {
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
  alreadyClosed: boolean;
  closingJournal: { id: string; number: string } | null;
  retainedEarningsAccountId: string | null;
  accounts: { accountId: string; code: string; name: string; type: string; balance: number }[];
};

/**
 * FIX-P1 Tahap 5 (AK5-04 + AK1-05): panel Tutup Buku Tahunan di halaman
 * Periode. Pratinjau angka dihitung server; posting jurnal penutup
 * wajib konfirmasi eksplisit berisi ringkasannya. Mengunci 12 periode
 * adalah tombol & konfirmasi TERPISAH — tidak pernah otomatis.
 */
export function YearEndClosingPanel({
  year,
  canManage,
  allLocked,
  hasPeriods,
  equityAccounts,
  preview,
}: {
  year: number;
  canManage: boolean;
  allLocked: boolean;
  hasPeriods: boolean;
  equityAccounts: { id: string; code: string; name: string }[];
  preview: ClosingPreview;
}) {
  const router = useRouter();
  const [retainedId, setRetainedId] = useState(
    preview.retainedEarningsAccountId ?? equityAccounts[0]?.id ?? "",
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmingLock, setConfirmingLock] = useState(false);
  const [busy, setBusy] = useState(false);

  const retained = equityAccounts.find((row) => row.id === retainedId);
  const hasActivity = preview.accounts.length > 0;

  async function postClosing() {
    if (!retainedId) {
      toast.error("Pilih dulu akun laba ditahan tujuan pemindahan laba bersih.");
      return;
    }
    setBusy(true);
    const result = await postYearEndClosingAction({ year, retainedEarningsAccountId: retainedId });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Tutup buku ${year} terposting sebagai jurnal ${result.data.number}.`);
    setConfirming(false);
    router.refresh();
  }

  async function lockYear() {
    setBusy(true);
    const result = await lockYearPeriodsAction({ year });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      result.data.locked > 0
        ? `${result.data.locked} periode tahun ${year} dikunci.`
        : `Semua periode tahun ${year} sudah terkunci.`,
    );
    setConfirmingLock(false);
    router.refresh();
  }

  return (
    <section className="mt-3 rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <BookCheck className="size-3.5 text-muted-foreground" /> Tutup buku tahun {year}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Satu jurnal penutup bertanggal 31 Desember {year} menolkan semua akun pendapatan, HPP, dan
          beban tahun itu; laba/rugi bersih dipindahkan ke akun laba ditahan. Jurnal penutup dapat
          dibalik dari halaman detail jurnalnya selama periode Desember masih terbuka.
        </p>
      </div>

      <div className="grid gap-2.5 px-4 py-3 sm:grid-cols-3">
        <div className="rounded-md border border-border px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total pendapatan {year}</p>
          <p className="num mt-0.5 text-[14px] font-semibold">{formatIDR(preview.totalRevenue)}</p>
        </div>
        <div className="rounded-md border border-border px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total HPP + beban {year}</p>
          <p className="num mt-0.5 text-[14px] font-semibold">{formatIDR(preview.totalExpense)}</p>
        </div>
        <div className="rounded-md border border-border px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{preview.netProfit >= 0 ? "Laba bersih" : "Rugi bersih"} {year}</p>
          <p className={`num mt-0.5 text-[14px] font-semibold ${preview.netProfit >= 0 ? "text-tone-green" : "text-destructive"}`}>
            {formatIDRSigned(preview.netProfit)}
          </p>
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        {preview.alreadyClosed ? (
          <p className="text-[12px]">
            Buku tahun {year} sudah ditutup
            {preview.closingJournal ? (
              <>
                {" "}oleh jurnal{" "}
                <Link href={`/app/akuntansi/jurnal/${preview.closingJournal.id}`} className="num font-medium underline">
                  {preview.closingJournal.number}
                </Link>
              </>
            ) : null}
            . Untuk menutup ulang, balik jurnal penutup itu terlebih dahulu.
          </p>
        ) : !hasActivity ? (
          <p className="text-[12px] text-muted-foreground">
            Tidak ada saldo pendapatan atau beban pada tahun {year} — tidak ada yang perlu ditutup.
          </p>
        ) : canManage ? (
          confirming ? (
            <div className="rounded-md border border-tone-red/30 bg-tone-red-soft px-3 py-2.5 text-[12px] leading-5">
              <p className="font-semibold">Posting jurnal penutup tahun {year}?</p>
              <p>
                {preview.accounts.length} akun pendapatan/HPP/beban akan dinolkan per 31 Desember {year}, dan{" "}
                {preview.netProfit >= 0 ? "laba" : "rugi"} bersih {formatIDR(Math.abs(preview.netProfit))} dipindahkan
                ke {retained ? `${retained.code} · ${retained.name}` : "akun laba ditahan"}.
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={postClosing}
                  disabled={busy}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? "Memposting…" : "Ya, posting jurnal penutup"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Akun laba ditahan
                </span>
                <select
                  value={retainedId}
                  onChange={(event) => setRetainedId(event.target.value)}
                  className="h-9 min-w-[240px] rounded-md border border-input bg-background px-2 text-[12px]"
                >
                  {equityAccounts.map((row) => (
                    <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <BookCheck className="size-3.5" /> Tutup buku tahun {year}
              </button>
              <span className="pb-1 text-[11px] text-muted-foreground">
                Bawaan dari pemetaan &ldquo;equity&rdquo;; dapat diganti sebelum posting.
              </span>
            </div>
          )
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Anda tidak memiliki izin mengelola periode untuk menjalankan tutup buku.
          </p>
        )}

        {/* Kunci tahun: aksi terpisah dengan konfirmasinya sendiri. */}
        {canManage && hasPeriods ? (
          <div className="mt-3 border-t border-border pt-3">
            {allLocked ? (
              <p className="text-[12px] text-muted-foreground">Ke-12 periode tahun {year} sudah terkunci.</p>
            ) : confirmingLock ? (
              <div className="rounded-md border border-tone-plum/30 bg-tone-plum-soft px-3 py-2.5 text-[12px] leading-5">
                <p className="font-semibold">Kunci seluruh periode tahun {year}?</p>
                <p>
                  Sesudah dikunci, tidak ada posting apa pun ke tahun {year}. Membuka kembali periode
                  terkunci hanya dapat dilakukan owner dengan alasan tertulis. Langkah ini terpisah dari
                  tutup buku dan tidak berjalan otomatis.
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={lockYear}
                    disabled={busy}
                    className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "Mengunci…" : `Ya, kunci 12 periode ${year}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingLock(false)}
                    disabled={busy}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingLock(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
              >
                <Lock className="size-3.5" /> Kunci 12 periode tahun {year}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
