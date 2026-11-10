"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { formatIDR } from "@/lib/money";
import {
  seedMissingPeriodsAction,
  setPeriodStatusAction,
} from "@/server/actions/accounting/periode";
import { StatusBadge } from "@/components/blocks/status-badge";
import { DataList } from "@/components/blocks/data-list";
import { RowMenu } from "@/components/blocks/row-menu";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function PeriodManager({
  periods,
  year,
  canManage,
  canUnlockLocked = false,
  summaries = {},
}: {
  periods: { id: string; month: number; status: string }[];
  year: number;
  canManage: boolean;
  /** AK-P2-01: hanya owner yang melihat tombol buka untuk periode terkunci. */
  canUnlockLocked?: boolean;
  /**
   * FIX-P1 Tahap 5 (AK5-04): ringkasan isi per bulan dari server —
   * dialog konfirmasi tutup/kunci menampilkannya sebelum eksekusi,
   * menggantikan eksekusi satu klik tanpa pemeriksaan.
   */
  summaries?: Record<number, { entries: number; debit: number }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ month: number; status: "closed" | "locked" } | null>(null);
  const [reopening, setReopening] = useState<number | null>(null);

  function requestStatus(month: number, status: "open" | "closed" | "locked", currentStatus?: string) {
    if (status === "open") {
      // WF-001: membuka kembali periode tertutup/terkunci wajib izin owner & alasan tertulis
      if (currentStatus === "locked" || currentStatus === "closed") {
        setReopening(month);
        return;
      }
      void setStatus(month, status);
      return;
    }
    setConfirming({ month, status });
  }

  async function setStatus(month: number, status: "open" | "closed" | "locked", reason?: string) {
    setBusy(`${month}:${status}`);
    const result = await setPeriodStatusAction({ year, month, status, reason });
    setBusy(null);
    setConfirming(null);
    setReopening(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      status === "open" ? `Periode ${MONTHS[month - 1]} dibuka.` : status === "closed" ? `Periode ${MONTHS[month - 1]} ditutup.` : `Periode ${MONTHS[month - 1]} dikunci.`,
    );
    router.refresh();
  }

  async function seed() {
    setBusy("seed");
    const result = await seedMissingPeriodsAction({ year });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Periode ${year} dilengkapi.`);
    router.refresh();
  }

  const byMonth = new Map(periods.map((row) => [row.month, row]));

  return (
    /* A-25 U4: panel memakai DataList bersama — judul kartunya yang
       menggandakan judul halaman ("Periode fiskal {tahun}") hilang
       (POLA-02); kalimat panduannya menjadi catatan kaki daftar, dan
       tombol "Lengkapi 12 bulan" menjadi aksi kepala kartu.
       G3 (UX4-09): density compact — daftar periode termasuk yang
       terukur 53px pada Validasi UI/UX 4. */
    <DataList density="compact"
      headerActions={
        canManage ? (
          <button
            type="button"
            onClick={seed}
            disabled={busy === "seed"}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            <PlusCircle className="size-3.5" /> Lengkapi 12 bulan
          </button>
        ) : undefined
      }
      footerNote="Jurnal hanya bisa diposting pada periode terbuka. Tutup periode setelah rekonsiliasi selesai; kunci sesudah audit internal — membukanya kembali hanya untuk owner dengan alasan tertulis."
    >

      {/* FIX-P1 Tahap 5 (AK5-04): konfirmasi tutup/kunci berisi
          ringkasan isi periode — tidak ada lagi penutupan satu klik. */}
      {confirming ? (
        <div className="border-b border-border bg-tone-amber-soft px-4 py-3 text-[12px] leading-5 text-tone-amber">
          <p className="font-semibold">
            {confirming.status === "closed" ? "Tutup" : "Kunci"} periode {MONTHS[confirming.month - 1]} {year}?
          </p>
          <p>
            Periode ini berisi{" "}
            <span className="num font-semibold">{summaries[confirming.month]?.entries ?? 0} jurnal</span>{" "}
            terposting dengan total debit{" "}
            <span className="num font-semibold">{formatIDR(summaries[confirming.month]?.debit ?? 0)}</span>.
            Sesudah {confirming.status === "closed" ? "ditutup" : "dikunci"}, semua posting ke bulan ini
            ditolak{confirming.status === "locked" ? " dan membukanya kembali hanya dapat dilakukan owner dengan alasan tertulis" : ""}.
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void setStatus(confirming.month, confirming.status)}
              disabled={busy !== null}
              className="inline-flex h-8 items-center rounded-md bg-tone-amber px-3 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Memproses…" : confirming.status === "closed" ? "Ya, tutup periode" : "Ya, kunci periode"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={busy !== null}
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Batal
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Bulan</th>
              <th>Status</th>
              <th className="text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((label, index) => {
              const month = index + 1;
              const row = byMonth.get(month);
              const status = row?.status ?? "missing";
              return (
                <tr key={month}>
                  <td className="text-[12px] font-medium">{label}</td>
                  <td>
                    {/* FIX-R2 Tahap 2 (RD2U-02): pill status periode manual
                        diganti StatusBadge bersama (label setempat
                        dipertahankan lewat prop label). */}
                    <StatusBadge
                      status={status}
                      label={status === "open" ? "Terbuka" : status === "closed" ? "Ditutup" : status === "locked" ? "Dikunci" : "Belum ada"}
                    />
                  </td>
                  <td>
                    {/* A-25 U4 (AKT-11): dua tombol permanen per baris
                        (24 tombol untuk 12 bulan) menjadi SATU menu ⋯
                        per baris. Isi menunya persis transisi yang sah
                        dari status baris itu — sama seperti tombol
                        lamanya: dari terbuka (Tutup/Kunci), dari
                        tertutup (Buka/Kunci — close→lock memang
                        transisi sah di domain), dari terkunci hanya
                        Buka untuk owner. */}
                    <div className="flex items-center justify-end gap-1">
                      {canManage && row ? (
                        (() => {
                          const items = [
                            ...(status === "closed" || (status === "locked" && canUnlockLocked)
                              ? [{ key: "open", label: "Buka", disabled: busy !== null }]
                              : []),
                            ...(status === "open"
                              ? [{ key: "closed", label: "Tutup", disabled: busy !== null }]
                              : []),
                            ...(status !== "locked"
                              ? [{ key: "locked", label: "Kunci", disabled: busy !== null }]
                              : []),
                          ];
                          return items.length > 0 ? (
                            <RowMenu
                              label={`Aksi periode ${label} ${year}`}
                              items={items}
                              onAction={(key) => {
                                if (key === "open") requestStatus(month, "open", status);
                                else if (key === "closed" || key === "locked") requestStatus(month, key);
                              }}
                            />
                          ) : null;
                        })()
                      ) : null}
                      {!row && canManage ? (
                        <span className="text-[11px] text-muted-foreground">Klik “Lengkapi 12 bulan”</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={reopening !== null}
        title={reopening !== null ? `Buka kembali periode ${MONTHS[reopening - 1]} ${year}?` : ""}
        description="Periode ini sudah ditutup/dikunci. Membukanya kembali memerlukan otorisasi pemilik (owner), dan alasan tertulis tercatat dalam riwayat audit."
        confirmLabel="Buka periode"
        danger
        busy={busy !== null}
        reason={{ label: "Alasan membuka kembali", minLength: 3 }}
        onConfirm={(reason) => {
          if (reopening !== null) void setStatus(reopening, "open", reason);
        }}
        onCancel={() => setReopening(null)}
      />
    </DataList>
  );
}
