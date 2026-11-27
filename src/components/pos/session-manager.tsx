"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { formatIDR } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { newUuid } from "@/lib/uuid";
import { MoneyInput } from "@/components/money-input";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { IDR_CASH_DENOMINATIONS, denominationTotal } from "@/lib/pos/denominations";
import { getBrowserOfflineStorage, getOrCreateDeviceId } from "@/lib/pos-offline";
import {
  cashMovementAction,
  closeSessionAction,
  openSessionAction,
  prepareSessionCloseAction,
} from "@/server/actions/pos-sessions";

type Summary = {
  id: string;
  openedAt: string;
  openingCash: number;
  sales: number;
  receivableIn?: number;
  nonCashSales?: number;
  refunds: number;
  deposits: number;
  withdrawals: number;
  transactionCount: number;
  movements: {
    id: string;
    type: string;
    amount: number;
    notes: string | null;
    createdAt: string;
  }[];
};

export function SessionManager({
  session,
  differenceTolerance = 0,
  heldCount = 0,
  branches = [],
  canViewXReport = false,
  companyId = "",
  userId = "",
  posOfflineEnabled = false,
}: {
  session: Summary | null;
  differenceTolerance?: number;
  heldCount?: number;
  branches?: { id: string; name: string }[];
  canViewXReport?: boolean;
  companyId?: string;
  userId?: string;
  posOfflineEnabled?: boolean;
}) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("500000");
  const [branchId, setBranchId] = useState(() =>
    branches.length === 1 ? branches[0].id : "",
  );
  // A-28 Tahap 1 (H-POS-01/03): tutup sesi dua langkah ala hitung buta
  // opname — langkah "hitung" berisi grid denominasi TANPA kas
  // seharusnya/selisih; angka perbandingan baru tampil di langkah
  // "tinjau" sesudah hitungan dikunci.
  const [closeStep, setCloseStep] = useState<"hitung" | "tinjau">("hitung");
  const [closePreview, setClosePreview] = useState<{
    token: string;
    counted: string;
    expected: string;
    difference: string;
    tolerance: string;
  } | null>(null);
  const [denomCounts, setDenomCounts] = useState<Record<string, string>>({});
  const [differenceReason, setDifferenceReason] = useState("");
  const [notes, setNotes] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveNotes, setMoveNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [closedSessionId, setClosedSessionId] = useState<string | null>(null);
  // A-28 Tahap 4 (H-PGT-01): modal awal & nominal mutasi memakai
  // MoneyInput bersama (sisa kas sesi dari Tahap 1); nilai kanonis
  // yang dikirim ke aksi sama seperti angka mentah sebelumnya.
  const [openingValid, setOpeningValid] = useState(true);
  const [moveValid, setMoveValid] = useState(true);
  // Satu kunci per niat mutasi; dipertahankan sampai sukses agar retry
  // setelah respons hilang tidak menggandakan setoran/penarikan.
  const moveKeyRef = useRef<string | null>(null);
  const [offlineQueued, setOfflineQueued] = useState(0);

  useEffect(() => {
    if (!posOfflineEnabled || !companyId || !userId) return;
    let active = true;
    void (async () => {
      try {
        const storage = getBrowserOfflineStorage({
          companyId,
          userId,
          terminalId: getOrCreateDeviceId(),
        });
        const items = await storage.list();
        if (active) setOfflineQueued(items.length);
      } catch {
        // IndexedDB tidak tersedia — tidak ada antrean lokal yang bisa dibaca.
      }
    })();
    return () => {
      active = false;
    };
  }, [posOfflineEnabled, companyId, userId]);

  async function open() {
    if (!openingValid) {
      toast.error("Modal awal belum terbaca — periksa kembali nominalnya.");
      return;
    }
    setBusy("open");
    try {
      const result = await openSessionAction({
        openingCash,
        branchId: branchId || null,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Sesi kas dibuka.");
      router.refresh();
    } catch {
      toast.error("Koneksi gagal. Periksa jaringan lalu coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  async function lockCountAndReview() {
    setBusy("prepare");
    try {
      const result = await prepareSessionCloseAction({
        sessionId: session!.id,
        countedCash: String(denominationTotal(denomCounts)),
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setClosePreview(result.data);
      setCloseStep("tinjau");
    } catch {
      toast.error("Hitungan belum dapat dikunci. Periksa koneksi lalu coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (offlineQueued > 0) {
      toast.error(
        `Masih ada ${offlineQueued} transaksi offline di perangkat ini. Sinkronkan dulu dari terminal sebelum menutup sesi.`,
      );
      return;
    }
    if (!closePreview) {
      toast.error("Kunci hitungan fisik terlebih dahulu.");
      setCloseStep("hitung");
      return;
    }
    setBusy("close");
    try {
      const result = await closeSessionAction({
        sessionId: session!.id,
        countedCash: closePreview.counted,
        countToken: closePreview.token,
        notes: notes || undefined,
        differenceReason: differenceReason.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Sesi kas ditutup.");
      setClosedSessionId(session!.id);
      setDenomCounts({});
      setClosePreview(null);
      setDifferenceReason("");
      setNotes("");
      setCloseStep("hitung");
      router.refresh();
    } catch {
      toast.error("Koneksi gagal. Sesi belum ditutup; periksa jaringan lalu coba lagi.");
    } finally {
      setBusy(null);
    }
  }

  async function move(type: "deposit" | "withdrawal") {
    if (!moveValid) {
      toast.error("Nominal belum terbaca — periksa kembali nominalnya.");
      return;
    }
    const amount = Number(moveAmount);
    if (!(amount > 0)) {
      toast.error("Nominal harus lebih dari nol.");
      return;
    }
    const idempotencyKey = moveKeyRef.current ?? newUuid();
    moveKeyRef.current = idempotencyKey;
    setBusy(type);
    try {
      const result = await cashMovementAction({
        sessionId: session!.id,
        type,
        amount,
        notes: moveNotes || undefined,
        idempotencyKey,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      moveKeyRef.current = null;
      toast.success(type === "deposit" ? "Setoran ke bank dicatat." : "Penarikan dari bank dicatat.");
      setMoveAmount("");
      setMoveNotes("");
      router.refresh();
    } catch {
      toast.error("Koneksi gagal. Mutasi belum tentu tercatat — periksa mutasi kas sebelum mengulang.");
    } finally {
      setBusy(null);
    }
  }

  if (!session) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Unlock className="size-4 text-muted-foreground" />
          <h2 className="text-[14px] font-semibold">Buka sesi kas</h2>
        </div>
        <p className="mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
          Masukkan uang modal awal di laci kas. Sesi mencatat semua transaksi tunai, setoran, dan penarikan
          sampai ditutup.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">Cabang</span>
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              aria-label="Cabang sesi kas"
              className="h-11 min-w-44 rounded-md border border-input bg-background px-2.5 text-[12px] lg:h-9"
            >
              <option value="">Tanpa cabang</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">Modal awal</span>
            <MoneyInput
              value={openingCash}
              onChange={setOpeningCash}
              onValidityChange={setOpeningValid}
              aria-label="Modal awal"
              className="h-11 w-40 font-semibold lg:h-9"
            />
          </label>
          <button
            type="button"
            onClick={open}
            disabled={busy === "open"}
            className="h-11 rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "open" ? "Membuka…" : "Buka sesi"}
          </button>
        </div>
      </div>
    );
  }

  const countedTotal = denominationTotal(denomCounts);
  // Angka pembanding hanya ada di preview yang dikembalikan server SESUDAH
  // hitungan fisik diserahkan. Sebelum itu komponen tidak menerima expected.
  const tolerance = closePreview ? Number(closePreview.tolerance) : differenceTolerance;
  const difference = closePreview ? Number(closePreview.difference) : 0;
  const reasonRequired = closePreview !== null && Math.abs(difference) > tolerance;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* A-25 U8 (temuan beku 390px): kolom grid diberi min-w-0 —
          tanpa itu lebar min-content tabel mutasi (baris "Penjualan"
          tidak bisa membungkus) memaksa kolom lebih lebar dari
          viewport ponsel dan halaman ikut melebar. */}
      <div className="min-w-0 space-y-3">
        <div className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold">Sesi kas berjalan</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Dibuka {formatDateTime(session.openedAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              {canViewXReport ? (
                <Link
                  href={`/app/pos/sesi/riwayat/${session.id}/cetak?x=1&autoprint=1`}
                  target="_blank"
                  className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
                >
                  Cetak X
                </Link>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-tone-teal-soft px-2.5 py-1 text-[11px] font-semibold text-tone-teal">
                <span className="size-1.5 rounded-full bg-tone-teal" /> Terbuka
              </span>
            </div>
          </div>

          {/* A-28 Tahap 1 (H-POS-01): ubin "Kas seharusnya" DIBUANG
              dari sesi berjalan — angka harapan tidak ditampilkan
              selama sesi terbuka agar hitungan tutup sesi benar-benar
              buta. Perbandingan seharusnya vs terhitung hanya muncul
              di langkah tinjau tutup sesi & di riwayat sesi tertutup. */}
          <dl className="grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-4">
            {[
              ["Modal awal", session.openingCash],
              ["Penjualan tunai", session.sales],
              ["Penerimaan piutang", session.receivableIn ?? 0],
              ["Penjualan non-tunai", session.nonCashSales ?? 0],
              ["Refund", session.refunds],
              ["Transaksi", session.transactionCount],
            ].map(([label, value]) => (
              <div key={label as string} className="px-4 py-3">
                <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
                <dd className="num mt-1 text-[14px] font-semibold">
                  {label === "Transaksi" ? (value as number) : formatIDR(value as number)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="px-4 py-3 text-[11px] text-muted-foreground">
            {session.transactionCount} transaksi · setor ke bank {formatIDR(session.deposits)} (kas laci
            berkurang) · tarik dari bank {formatIDR(session.withdrawals)} (kas laci bertambah)
          </div>

          <div className="border-t border-border p-4">
            <h3 className="text-[12px] font-semibold">Tutup sesi</h3>
            {heldCount > 0 ? (
              <div className="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="text-[12px] font-medium">
                      Ada {heldCount} pesanan tertahan di seluruh perusahaan. Pesanan kasir lain tidak menghalangi sesi ini; jika Anda memiliki pesanan tertahan, server akan memberi jumlah dan instruksi untuk menyelesaikannya.
                    </span>
                  </div>
                  <Link
                    href="/app/pos/ditahan"
                    className="inline-flex h-7 items-center rounded-md bg-amber-600 px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-amber-700"
                  >
                    Buka Pesanan Ditahan →
                  </Link>
                </div>
              </div>
            ) : null}
            {offlineQueued > 0 ? (
              <div className="mt-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12px] text-destructive">
                Ada <strong>{offlineQueued} transaksi offline</strong> di perangkat ini yang belum
                tersinkron. Buka terminal dan tekan <strong>Sinkronkan</strong> sebelum menutup
                sesi; jika konflik, minta supervisor menyelesaikan peninjauan.
              </div>
            ) : null}
            {closeStep === "hitung" ? (
              <div className="mt-2">
                <p className="max-w-lg text-[11px] leading-4 text-muted-foreground">
                  Hitung uang fisik di laci per pecahan secara <strong>buta</strong> — angka
                  pembanding dan selisih baru ditampilkan sesudah hitungan dikunci.
                </p>
                <div className="mt-3 grid max-w-xl gap-x-8 sm:grid-cols-2">
                  {IDR_CASH_DENOMINATIONS.map((denom) => {
                    const pieces = Number.parseInt(denomCounts[String(denom)] ?? "", 10);
                    return (
                      <div
                        key={denom}
                        className="flex items-center justify-between gap-2 border-b border-dashed border-border/70 py-1"
                      >
                        <span className="num text-[12px] font-medium">{formatIDR(denom)}</span>
                        <div className="flex items-center gap-2">
                          <span className="num w-24 text-right text-[11px] text-muted-foreground">
                            {Number.isFinite(pieces) && pieces > 0 ? formatIDR(denom * pieces) : "—"}
                          </span>
                          <input
                            value={denomCounts[String(denom)] ?? ""}
                            onChange={(event) =>
                              setDenomCounts((prev) => ({
                                ...prev,
                                [String(denom)]: event.target.value.replace(/[^0-9]/g, ""),
                              }))
                            }
                            inputMode="numeric"
                            placeholder="0"
                            aria-label={`Jumlah lembar pecahan ${formatIDR(denom)}`}
                            className="num h-11 w-16 rounded-md border border-input bg-background px-2 text-right text-[12px] lg:h-9"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-[12px]">
                    Total dihitung:{" "}
                    <span className="num text-[14px] font-semibold">{formatIDR(countedTotal)}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => void lockCountAndReview()}
                    disabled={busy === "prepare"}
                    className="inline-flex h-11 items-center gap-1.5 rounded-md bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
                  >
                    {busy === "prepare" ? "Mengunci…" : "Kunci hitungan & tinjau"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <dl className="grid max-w-xl grid-cols-3 gap-3">
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground">Kas seharusnya</dt>
                    <dd className="num mt-0.5 text-[14px] font-semibold">
                      {closePreview ? formatIDR(Number(closePreview.expected)) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground">Uang dihitung</dt>
                    <dd className="num mt-0.5 text-[14px] font-semibold">
                      {closePreview ? formatIDR(Number(closePreview.counted)) : formatIDR(countedTotal)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground">Selisih</dt>
                    <dd
                      className={`num mt-0.5 text-[14px] font-semibold ${difference === 0 ? "" : difference > 0 ? "text-tone-green" : "text-destructive"}`}
                    >
                      {formatIDR(difference)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="min-w-[220px] flex-1 space-y-1">
                    <span className="block text-[11px] font-medium text-muted-foreground">
                      {reasonRequired
                        ? `Alasan selisih (wajib — melewati toleransi ${formatIDR(tolerance)})`
                        : "Alasan selisih (opsional)"}
                    </span>
                    <input
                      value={differenceReason}
                      onChange={(event) => setDifferenceReason(event.target.value)}
                      placeholder="Mis. kembalian berlebih ke pelanggan"
                      aria-label="Alasan selisih kas"
                      className="h-11 w-full rounded-md border border-input bg-background px-2.5 text-[12px] lg:h-9"
                    />
                  </label>
                  <input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Catatan penutupan (opsional)"
                    aria-label="Catatan penutupan sesi"
                    className="h-11 min-w-[180px] flex-1 rounded-md border border-input bg-background px-2.5 text-[12px] lg:h-9"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Hitungan sudah dikunci. Koreksi hanya lewat selisih beralasan atau supervisor.
                  </span>
                  <button
                    type="button"
                    onClick={close}
                    disabled={
                      busy === "close" ||
                      !closePreview ||
                      offlineQueued > 0 ||
                      (reasonRequired && differenceReason.trim() === "")
                    }
                    className="inline-flex h-11 items-center gap-1.5 rounded-md bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
                  >
                    <Lock className="size-3.5" /> {busy === "close" ? "Menutup…" : "Tutup sesi"}
                  </button>
                </div>
                {reasonRequired ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Selisih dicatat ke akun selisih kas dan alasan tersimpan pada sesi &amp; audit.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Mutasi kas</h2>
          </div>
          {session.movements.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">Belum ada mutasi.</p>
          ) : (
            <>
              {/* Mobile/tablet: kartu label-nilai; Nominal tidak boleh
                  tersembunyi di balik scroll horizontal. */}
              <div className="divide-y divide-border/70 lg:hidden">
                {session.movements.map((row) => (
                  <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium capitalize">{movementLabel(row.type)}</p>
                      <p className="num mt-0.5 text-[11px] text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </p>
                      {row.notes ? (
                        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{row.notes}</p>
                      ) : null}
                    </div>
                    <span
                      className={`num shrink-0 text-right text-[13px] font-semibold ${
                        row.amount < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatIDR(row.amount)}
                    </span>
                  </div>
                ))}
              </div>

              <div
                className="hidden max-h-[320px] overflow-x-auto overflow-y-auto lg:block"
                tabIndex={0}
                role="region"
                aria-label="Mutasi kas"
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Jenis</th>
                      <th>Catatan</th>
                      <th className="text-right">Nominal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.movements.map((row) => (
                      <tr key={row.id}>
                        <td className="num whitespace-nowrap text-[11px] text-muted-foreground">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="text-[12px] capitalize">{movementLabel(row.type)}</td>
                        <td className="max-w-[220px] truncate text-[11px] text-muted-foreground">{row.notes ?? "—"}</td>
                        <td className={`num text-right font-medium ${row.amount < 0 ? "text-destructive" : ""}`}>
                          {formatIDR(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <aside className="min-w-0 space-y-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-[13px] font-semibold">Setor / tarik bank</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Setor ke Bank — uang keluar dari laci ke bank, kas laci berkurang. Tarik dari Bank — uang
            masuk ke laci dari bank, kas laci bertambah.
          </p>
          <div className="mt-3">
            <MoneyInput
              value={moveAmount}
              onChange={setMoveAmount}
              onValidityChange={setMoveValid}
              aria-label="Nominal setor atau tarik bank"
              className="h-11 lg:h-9"
            />
          </div>
          <input
            value={moveNotes}
            onChange={(event) => setMoveNotes(event.target.value)}
            placeholder="Catatan"
            aria-label="Catatan setor atau tarik bank"
            className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-2.5 text-[12px] lg:h-9"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => move("deposit")}
              disabled={busy === "deposit"}
              className="inline-flex h-11 items-center justify-center gap-1 rounded-md bg-tone-teal text-[12px] font-medium text-white hover:bg-tone-teal/90 disabled:opacity-50"
            >
              <ArrowDownToLine className="size-3.5" /> Setor ke Bank
            </button>
            <button
              type="button"
              onClick={() => move("withdrawal")}
              disabled={busy === "withdrawal"}
              className="inline-flex h-11 items-center justify-center gap-1 rounded-md border border-border text-[12px] font-medium hover:bg-muted disabled:opacity-50"
            >
              <ArrowUpFromLine className="size-3.5" /> Tarik dari Bank
            </button>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(closedSessionId)}
        title="Sesi ditutup"
        description="Cetak laporan Z sekarang agar rekonsiliasi kas langsung terdokumentasi."
        confirmLabel="Cetak Z"
        cancelLabel="Nanti"
        onCancel={() => setClosedSessionId(null)}
        onConfirm={() => {
          if (closedSessionId) {
            window.open(`/app/pos/sesi/riwayat/${closedSessionId}/cetak?autoprint=1`, "_blank");
          }
          setClosedSessionId(null);
        }}
      />
    </div>
  );
}

function movementLabel(type: string) {
  return (
    {
      opening: "Modal awal",
      sale: "Penjualan",
      receivable: "Penerimaan piutang",
      refund: "Refund",
      deposit: "Setor ke bank",
      withdrawal: "Tarik dari bank",
      adjustment: "Penyesuaian",
    }[type] ?? type
  );
}
