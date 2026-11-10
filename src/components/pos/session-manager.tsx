"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { formatIDR } from "@/lib/money";
import { MoneyInput } from "@/components/money-input";
import { IDR_CASH_DENOMINATIONS, denominationTotal } from "@/lib/pos/denominations";
import {
  cashMovementAction,
  closeSessionAction,
  openSessionAction,
} from "@/server/actions/pos";

type Summary = {
  id: string;
  openedAt: string;
  openingCash: number;
  expected: number;
  sales: number;
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
}: {
  session: Summary | null;
  // A-28 Tahap 1 (H-POS-02): toleransi selisih perusahaan (Rp) —
  // hanya untuk petunjuk & kewajiban alasan di formulir; penegakan
  // sesungguhnya di server (closeCashSession).
  differenceTolerance?: number;
}) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("500000");
  // A-28 Tahap 1 (H-POS-01/03): tutup sesi dua langkah ala hitung buta
  // opname — langkah "hitung" berisi grid denominasi TANPA kas
  // seharusnya/selisih; angka perbandingan baru tampil di langkah
  // "tinjau" sesudah hitungan dikunci.
  const [closeStep, setCloseStep] = useState<"hitung" | "tinjau">("hitung");
  const [denomCounts, setDenomCounts] = useState<Record<string, string>>({});
  const [differenceReason, setDifferenceReason] = useState("");
  const [notes, setNotes] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveNotes, setMoveNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // A-28 Tahap 4 (H-PGT-01): modal awal & nominal mutasi memakai
  // MoneyInput bersama (sisa kas sesi dari Tahap 1); nilai kanonis
  // yang dikirim ke aksi sama seperti angka mentah sebelumnya.
  const [openingValid, setOpeningValid] = useState(true);
  const [moveValid, setMoveValid] = useState(true);

  async function open() {
    if (!openingValid) {
      toast.error("Modal awal belum terbaca — periksa kembali nominalnya.");
      return;
    }
    setBusy("open");
    const result = await openSessionAction({ openingCash });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Sesi kas dibuka.");
    router.refresh();
  }

  async function close() {
    setBusy("close");
    const result = await closeSessionAction({
      sessionId: session!.id,
      countedCash: String(denominationTotal(denomCounts)),
      notes: notes || undefined,
      differenceReason: differenceReason.trim() || undefined,
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Sesi kas ditutup.");
    setDenomCounts({});
    setDifferenceReason("");
    setNotes("");
    setCloseStep("hitung");
    router.refresh();
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
    setBusy(type);
    const result = await cashMovementAction({
      sessionId: session!.id,
      type,
      amount,
      notes: moveNotes || undefined,
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(type === "deposit" ? "Setoran ke bank dicatat." : "Penarikan dari bank dicatat.");
    setMoveAmount("");
    setMoveNotes("");
    router.refresh();
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
            <span className="block text-[11px] font-medium text-muted-foreground">Modal awal</span>
            <MoneyInput
              value={openingCash}
              onChange={setOpeningCash}
              onValidityChange={setOpeningValid}
              aria-label="Modal awal"
              className="w-40 font-semibold"
            />
          </label>
          <button
            type="button"
            onClick={open}
            disabled={busy === "open"}
            className="h-9 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "open" ? "Membuka…" : "Buka sesi"}
          </button>
        </div>
      </div>
    );
  }

  const countedTotal = denominationTotal(denomCounts);
  const difference = countedTotal - session.expected;
  const reasonRequired = Math.abs(difference) > differenceTolerance;

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
              <p className="mt-0.5 text-[11px] text-muted-foreground">Dibuka {session.openedAt.slice(0, 16).replace("T", " ")}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-tone-teal-soft px-2.5 py-1 text-[11px] font-semibold text-tone-teal">
              <span className="size-1.5 rounded-full bg-tone-teal" /> Terbuka
            </span>
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
                            className="num h-9 w-16 rounded-md border border-input bg-background px-2 text-right text-[12px]"
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
                    onClick={() => setCloseStep("tinjau")}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-4 text-[12px] font-semibold text-background hover:bg-foreground/90"
                  >
                    Kunci hitungan &amp; tinjau
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <dl className="grid max-w-xl grid-cols-3 gap-3">
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground">Kas seharusnya</dt>
                    <dd className="num mt-0.5 text-[14px] font-semibold">{formatIDR(session.expected)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-muted-foreground">Uang dihitung</dt>
                    <dd className="num mt-0.5 text-[14px] font-semibold">{formatIDR(countedTotal)}</dd>
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
                        ? `Alasan selisih (wajib — melewati toleransi ${formatIDR(differenceTolerance)})`
                        : "Alasan selisih (opsional)"}
                    </span>
                    <input
                      value={differenceReason}
                      onChange={(event) => setDifferenceReason(event.target.value)}
                      placeholder="Mis. kembalian berlebih ke pelanggan"
                      aria-label="Alasan selisih kas"
                      className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12px]"
                    />
                  </label>
                  <input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Catatan penutupan (opsional)"
                    aria-label="Catatan penutupan sesi"
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-input bg-background px-2.5 text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => setCloseStep("hitung")}
                    className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted"
                  >
                    Ubah hitungan
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy === "close" || (reasonRequired && differenceReason.trim() === "")}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-4 text-[12px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
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
          <div className="max-h-[320px] overflow-x-auto overflow-y-auto">
            {session.movements.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">Belum ada mutasi.</p>
            ) : (
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
                        {row.createdAt.slice(0, 16).replace("T", " ")}
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
            )}
          </div>
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
            />
          </div>
          <input
            value={moveNotes}
            onChange={(event) => setMoveNotes(event.target.value)}
            placeholder="Catatan"
            aria-label="Catatan setor atau tarik bank"
            className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12px]"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => move("deposit")}
              disabled={busy === "deposit"}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-tone-teal text-[11px] font-medium text-white hover:bg-tone-teal/90 disabled:opacity-50"
            >
              <ArrowDownToLine className="size-3.5" /> Setor ke Bank
            </button>
            <button
              type="button"
              onClick={() => move("withdrawal")}
              disabled={busy === "withdrawal"}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border text-[11px] font-medium hover:bg-muted disabled:opacity-50"
            >
              <ArrowUpFromLine className="size-3.5" /> Tarik dari Bank
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function movementLabel(type: string) {
  return (
    {
      opening: "Modal awal",
      sale: "Penjualan",
      refund: "Refund",
      deposit: "Setor ke bank",
      withdrawal: "Tarik dari bank",
      adjustment: "Penyesuaian",
    }[type] ?? type
  );
}
