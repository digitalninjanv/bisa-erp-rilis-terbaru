"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSearch, Play } from "lucide-react";
import { toast } from "sonner";
import {
  executeCoaMigrationAction,
  previewCoaMigrationAction,
} from "@/server/actions/accounting/migrasi-coa";
import type { CoaMigrationPreview, CoaMigrationResult } from "@/server/coa-migration";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

/**
 * A-27 B7 — Panel pemilik migrasi bagan akun: dry-run dulu (laporan
 * perubahan, akun kustom tak terpetakan, akun templat baru, bentrok
 * kode), lalu eksekusi yang menuntut DUA konfirmasi eksplisit —
 * centang pernyataan paham di panel + dialog konfirmasi — mengikuti
 * pola persetujuan repo untuk tindakan berdampak luas.
 */
export function CoaMigrationPanel({ companyName }: { companyName: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<CoaMigrationPreview | null>(null);
  const [result, setResult] = useState<CoaMigrationResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [askExecute, setAskExecute] = useState(false);
  const [busy, setBusy] = useState<"preview" | "execute" | null>(null);

  async function runPreview() {
    setBusy("preview");
    const res = await previewCoaMigrationAction();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setPreview(res.data);
    setResult(null);
    setConfirmed(false);
  }

  async function runExecute() {
    if (!preview) return;
    setAskExecute(false);
    setBusy("execute");
    const res = await executeCoaMigrationAction({ confirm: true });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setResult(res.data);
    toast.success(
      `Migrasi selesai: ${res.data.renamedCount} akun di-renumber, ${res.data.createdCount} akun templat dibuat. Saldo per akun terverifikasi identik.`,
    );
    router.refresh();
    await runPreview();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runPreview}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <FileSearch className="size-4" />
            {busy === "preview" ? "Memeriksa…" : "Jalankan dry-run"}
          </button>
          <p className="max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
            Dry-run hanya membaca bagan akun perusahaan ini dan menyusun laporan — tidak ada satu
            pun data yang diubah. Eksekusi hanya tersedia sesudah dry-run dan hanya bila tidak ada
            bentrok kode.
          </p>
        </div>
      </div>

      {result ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/10 p-4 text-[12px] leading-relaxed">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
          <p>
            Migrasi terakhir berhasil: <strong>{result.renamedCount} akun</strong> berubah kode,{" "}
            <strong>{result.createdCount} akun templat</strong> dibuat,{" "}
            <strong>{result.unmappedCount} akun kustom</strong> dibiarkan apa adanya. Neraca saldo
            per akun terverifikasi identik sebelum dan sesudah migrasi.
          </p>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-4">
          {!preview.needsMigration ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-[12px] leading-relaxed">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
              <p>
                Bagan akun perusahaan ini sudah mengikuti templat 5 digit — tidak ada akun yang
                perlu di-renumber dan tidak ada akun templat yang hilang. Tidak ada yang perlu
                dimigrasi.
              </p>
            </div>
          ) : null}

          {preview.conflicts.length > 0 ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-destructive">
                <AlertTriangle className="size-4" />
                Bentrok kode — eksekusi ditolak sampai diputuskan manual
              </div>
              <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
                Kode tujuan sudah dipakai akun lain di perusahaan ini. Ganti kode akun penghalang
                (atau akun lamanya) lewat halaman Bagan akun, lalu jalankan dry-run lagi.
              </p>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Akun lama</th>
                    <th className="py-1 pr-3 font-medium">Kode tujuan</th>
                    <th className="py-1 font-medium">Sudah dipakai oleh</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.conflicts.map((item) => (
                    <tr key={item.oldCode} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 pr-3">
                        <span className="num font-medium">{item.oldCode}</span> — {item.oldName}
                      </td>
                      <td className="num py-1.5 pr-3">
                        {item.newCode} — {item.newName}
                      </td>
                      <td className="py-1.5">{item.blockingName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {preview.renames.length > 0 ? (
            <section className="rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-[13px] font-semibold">
                  Akun yang akan berubah kode ({preview.renames.length})
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  Id akun, saldo, dan seluruh jurnalnya tetap — hanya kode, nama baku, induk, kelas
                  kas/bank, dan tag templat yang diterapkan.
                </p>
              </header>
              <div className="max-h-96 overflow-y-auto px-4">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Kode lama</th>
                      <th className="py-2 pr-3 font-medium">Nama saat ini</th>
                      <th className="py-2 pr-3 font-medium">Kode baru</th>
                      <th className="py-2 font-medium">Nama templat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.renames.map((item) => (
                      <tr key={item.accountId} className="border-b border-border/60 last:border-0">
                        <td className="num py-1.5 pr-3 font-medium">{item.oldCode}</td>
                        <td className="py-1.5 pr-3">{item.oldName}</td>
                        <td className="num py-1.5 pr-3 font-medium">{item.newCode}</td>
                        <td className="py-1.5">{item.newName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {preview.missingTemplate.length > 0 ? (
            <section className="rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-[13px] font-semibold">
                  Akun templat baru yang akan dibuat ({preview.missingTemplate.length})
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  Akun-akun ini belum ada di perusahaan ini (misalnya Cadangan Kerugian Piutang dan
                  header grup) — dibuat sebagai akun baru bersaldo nol, bukan hasil renumber.
                </p>
              </header>
              <div className="max-h-64 overflow-y-auto px-4 py-2">
                <ul className="grid grid-cols-1 gap-x-6 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
                  {preview.missingTemplate.map((item) => (
                    <li key={item.code} className="flex items-baseline gap-2 py-1">
                      <span className="num font-medium">{item.code}</span>
                      <span>{item.name}</span>
                      {item.isHeader ? (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          header
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {preview.unmapped.length > 0 ? (
            <section className="rounded-lg border border-border bg-card">
              <header className="border-b border-border px-4 py-3">
                <h2 className="text-[13px] font-semibold">
                  Akun kustom — dibiarkan apa adanya ({preview.unmapped.length})
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  Akun buatan perusahaan yang tidak ada di tabel mapping maupun templat. Kode dan
                  seluruh isinya tidak diubah oleh migrasi.
                </p>
              </header>
              <ul className="px-4 py-2 text-[12px]">
                {preview.unmapped.map((item) => (
                  <li key={item.id} className="flex items-baseline gap-2 py-1">
                    <span className="num font-medium">{item.code}</span>
                    <span>{item.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {preview.canExecute ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>
                  Saya memahami bagan akun {companyName} akan di-renumber ke skema 5 digit dalam
                  satu transaksi, akun templat yang hilang akan dibuat, dan akun kustom tidak
                  diubah. Laporan yang sudah diterbitkan untuk periode lalu tidak diterbitkan
                  ulang dengan kode baru.
                </span>
              </label>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setAskExecute(true)}
                  disabled={!confirmed || busy !== null}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="size-4" />
                  {busy === "execute" ? "Mengeksekusi…" : "Eksekusi migrasi"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={askExecute && preview !== null}
        title={`Eksekusi migrasi bagan akun ${companyName} sekarang?`}
        description={
          preview
            ? `${preview.renames.length} akun akan berubah kode ke skema 5 digit dan ${preview.missingTemplate.length} akun templat baru akan dibuat. Saldo setiap akun tidak berubah (jurnal mereferensikan id akun, bukan kode) dan hasil verifikasi saldo di dalam transaksi harus identik — bila tidak, seluruh migrasi batal. Tindakan ini tidak dapat dibatalkan dari halaman ini.`
            : undefined
        }
        confirmLabel="Eksekusi migrasi"
        danger
        busy={busy === "execute"}
        onConfirm={() => void runExecute()}
        onCancel={() => setAskExecute(false)}
      />
    </div>
  );
}
