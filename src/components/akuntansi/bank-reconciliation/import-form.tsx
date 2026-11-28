/**
 * A-26 Q7 (K-07): pecahan `bank-reconciliation-panel.tsx` — form &
 * dialog impor mutasi bank (CSV). Nama ekspor, props, dan perilaku
 * identik dengan berkas asal; berkas panel me-re-export keduanya.
 */
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileUp } from "lucide-react";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { todayISO } from "@/lib/format";
import { importStatementAction } from "@/server/actions/bank-reconciliation";
import {
  STATEMENT_CSV_EXAMPLE,
  STATEMENT_CSV_EXAMPLE_FILENAME,
} from "@/lib/statement-csv";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ImportReport = {
  insertedRows: number;
  skippedRows: number;
  totalRows: number;
  errors: { row: number; message: string }[];
};

export function ImportStatementForm({
  accountId,
  bare = false,
}: {
  accountId: string;
  /** A-25 U4 (AKT-01): mode telanjang untuk dipakai di dalam dialog
   * "Impor mutasi" — tanpa kartu & kepala sendiri (dialog yang
   * memberi judul), agar impor tidak lagi mendominasi halaman. */
  bare?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("mutasi.csv");
  const [csvText, setCsvText] = useState("");
  const [endingBalance, setEndingBalance] = useState("");
  const [endingBalanceValid, setEndingBalanceValid] = useState(true);
  const [endingDate, setEndingDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  // A-22 K3 (UX-05): kegagalan impor menetap di panel ini sampai
  // tindakan berikutnya — bukan toast yang hilang dalam hitungan detik.
  const [failure, setFailure] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsvText(await file.text());
    setFailure(null);
  }

  function downloadExample() {
    const blob = new Blob([STATEMENT_CSV_EXAMPLE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = STATEMENT_CSV_EXAMPLE_FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (!csvText.trim()) {
      setFailure("Pilih berkas CSV atau tempel isi mutasi terlebih dahulu.");
      return;
    }
    if (endingBalance.trim() && !endingBalanceValid) {
      setFailure("Saldo akhir rekening koran belum terbaca. Periksa nominalnya.");
      return;
    }
    if (endingBalance.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(endingDate)) {
      setFailure("Isi tanggal cut-off saldo akhir rekening koran.");
      return;
    }
    setBusy(true);
    setFailure(null);
    setReport(null);
    const result = await importStatementAction({
      accountId,
      fileName,
      csvText,
      statementEndingBalance: endingBalance.trim() || undefined,
      statementEndDate: endingBalance.trim() ? endingDate : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setReport(result.data);
    setCsvText("");
    setEndingBalance("");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className={bare ? undefined : "rounded-lg border border-border bg-card"}>
      {bare ? null : (
        <div className="border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <FileUp className="size-4" /> Impor mutasi bank (CSV)
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Format: kolom <code>Tanggal;Keterangan;Debit;Kredit</code> (pemisah <code>;</code> atau{" "}
            <code>,</code>). Tanggal DD/MM/YYYY atau YYYY-MM-DD; nominal format Indonesia
            (1.250.000,00) diterima. Tempelan TANPA baris header juga diterima bila urutan kolomnya
            persis <code>Tanggal;Keterangan;Debit;Kredit</code>. Mengimpor berkas yang sama dua kali
            aman — baris yang sudah ada dilewati.
          </p>
        </div>
      )}
      <div className={bare ? "space-y-3" : "space-y-3 p-4"}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted">
            Pilih berkas CSV
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => void onFile(event.target.files?.[0])}
              className="sr-only"
            />
          </label>
          <span className="text-[11px] text-muted-foreground">{fileName}</span>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => {
              setCsvText(STATEMENT_CSV_EXAMPLE);
              setFileName(STATEMENT_CSV_EXAMPLE_FILENAME);
              setFailure(null);
            }}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            Pakai contoh
          </button>
          <button
            type="button"
            onClick={downloadExample}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            <Download className="size-3.5" /> Unduh contoh (.csv)
          </button>
        </div>
        <textarea
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={STATEMENT_CSV_EXAMPLE}
          rows={5}
          className="w-full rounded-md border border-input bg-background px-2 py-2 font-mono text-[11px] outline-none focus:ring-2 focus:ring-ring/40"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Saldo akhir rekening koran (opsional)
            </span>
            <MoneyInput
              value={endingBalance}
              onChange={setEndingBalance}
              onValidityChange={setEndingBalanceValid}
              aria-label="Saldo akhir rekening koran"
              className="h-9 px-2.5 text-[12px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Saldo per tanggal</span>
            <DateField value={endingDate} onChange={setEndingDate} aria-label="Tanggal saldo akhir rekening koran" />
          </label>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Isi saldo akhir dari rekening koran agar halaman rekonsiliasi dapat membandingkan saldo buku
          per tanggal yang sama dan menandai berkas impor sebagai selesai.
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Mengimpor…" : "Impor mutasi"}
        </button>
        {failure ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive"
          >
            <p className="font-semibold">Impor gagal.</p>
            <p className="mt-0.5">{failure}</p>
          </div>
        ) : null}
        {report ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px]">
            <p>
              Hasil impor terakhir: {report.insertedRows} masuk · {report.skippedRows} duplikat
              dilewati · {report.errors.length} baris bermasalah · dari {report.totalRows} baris
              data.
            </p>
            {report.errors.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-destructive">
                {report.errors.map((error) => (
                  <li key={error.row}>
                    Baris {error.row}: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A-25 U4 (AKT-01): impor mutasi adalah pekerjaan sesekali — ia pindah
 * ke dialog "Impor mutasi" agar halaman rekonsiliasi dibuka langsung
 * pada pekerjaan hariannya (pencocokan berdampingan). Form impornya
 * persis komponen yang sama dalam mode telanjang.
 */
export function ImportStatementDialog({ accountId }: { accountId: string }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          />
        }
      >
        <FileUp className="size-3.5" /> Impor mutasi
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Impor mutasi bank (CSV)</DialogTitle>
          <DialogDescription>
            Kolom Tanggal;Keterangan;Debit;Kredit (pemisah ; atau ,). Tanggal DD/MM/YYYY atau
            YYYY-MM-DD; nominal format Indonesia diterima. Berkas yang sama boleh diimpor ulang —
            baris yang sudah ada dilewati. Saldo akhir koran opsional, tetapi diperlukan untuk
            membandingkan dengan saldo buku dan menandai rekonsiliasi selesai.
          </DialogDescription>
        </DialogHeader>
        <ImportStatementForm accountId={accountId} bare />
      </DialogContent>
    </Dialog>
  );
}
