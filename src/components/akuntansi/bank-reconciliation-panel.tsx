/**
 * A-26 Q7 (K-07): form & dialog impor mutasi dipindah ke
 * `bank-reconciliation/import-form.tsx` dan di-re-export dari sini —
 * impor "@/components/akuntansi/bank-reconciliation-panel" yang
 * sudah ada tetap sah dengan nama & tipe identik.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Link2, Link2Off, Sparkles, Wand2 } from "lucide-react";
import {
  autoMatchAction,
  createJournalFromLineAction,
  matchLineAction,
  unmatchLineAction,
} from "@/server/actions/bank-reconciliation";
import { d, formatIDR } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parseStatementAmount } from "@/lib/statement-csv";
import {
  groupContraAccounts,
  type ContraAccountOption,
  type ContraModels,
} from "@/lib/reconciliation-form";
import { inputClass, labelClass, selectClass } from "@/components/akuntansi/field-classes";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { EmptyState } from "@/components/blocks/empty-state";

export { ImportStatementDialog, ImportStatementForm } from "./bank-reconciliation/import-form";

export type StatementRow = {
  id: string;
  date: string;
  description: string;
  debit: string;
  credit: string;
  matchedJournalLineId: string | null;
  matchedEntryNumber: string | null;
  matchedEntryDate: string | null;
};

export type BookCandidate = {
  id: string;
  entryNumber: string;
  date: string;
  description: string | null;
  debit: string;
  credit: string;
};

export function AutoMatchButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // A-22 K3: hasil pencocokan otomatis menetap di bawah tombol sampai
  // dijalankan lagi — bukan toast sesaat.
  const [outcome, setOutcome] = useState<
    | { kind: "ok"; matchedCount: number; ambiguousCount: number; unmatchedCount: number }
    | { kind: "error"; message: string }
    | null
  >(null);

  async function run() {
    setBusy(true);
    setOutcome(null);
    const result = await autoMatchAction({ accountId });
    setBusy(false);
    if (!result.ok) {
      setOutcome({ kind: "error", message: result.message });
      return;
    }
    setOutcome({ kind: "ok", ...result.data });
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Sparkles className="size-3.5" />
        {busy ? "Mencocokkan…" : "Cocokkan otomatis"}
      </button>
      {outcome ? (
        <p
          role={outcome.kind === "error" ? "alert" : undefined}
          className={cn(
            "basis-full pb-1 text-[11px]",
            outcome.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {outcome.kind === "error"
            ? `Pencocokan otomatis gagal: ${outcome.message}`
            : `Hasil pencocokan otomatis terakhir: ${outcome.matchedCount} tertaut, ${outcome.ambiguousCount} ambigu (perlu manual), ${outcome.unmatchedCount} belum ada pasangan.`}
        </p>
      ) : null}
    </>
  );
}

function candidatesFor(row: StatementRow, candidates: BookCandidate[]): BookCandidate[] {
  // T4R-7: perbandingan nominal memakai Decimal, bukan Number() float —
  // nominal ekstrem (> 2^53) tidak boleh menyembunyikan kandidat yang sah.
  const debit = d(row.debit);
  const credit = d(row.credit);
  return candidates.filter((candidate) =>
    debit.gt(0)
      ? d(candidate.debit).eq(debit) && d(candidate.credit).isZero()
      : d(candidate.credit).eq(credit) && d(candidate.debit).isZero(),
  );
}

/** Select akun lawan berkelompok (A-22 K3): kas/bank, beban, pendapatan,
 * kewajiban, aset, dst. — semua akun tetap terjangkau, hanya disusun. */
function GroupedAccountSelect({
  value,
  onChange,
  accounts,
}: {
  value: string;
  onChange: (value: string) => void;
  accounts: ContraAccountOption[];
}) {
  const groups = groupContraAccounts(accounts);
  return (
    <select
      className={selectClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Pilih akun…</option>
      {groups.map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} — {account.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function StatementLinesTable({
  rows,
  bookCandidates,
  contraAccounts,
  models,
  canManage,
}: {
  rows: StatementRow[];
  bookCandidates: BookCandidate[];
  contraAccounts: ContraAccountOption[];
  models: ContraModels;
  canManage: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<"match" | "journal">("match");
  const [journalLineId, setJournalLineId] = useState("");
  const [contraAccountId, setContraAccountId] = useState("");
  const [journalDate, setJournalDate] = useState("");
  const [journalDesc, setJournalDesc] = useState("");
  // A-21 (R3-12): baris lawan kedua opsional — potongan yang dipotong
  // bank dari mutasi neto (mis. PPh final atas bunga bank).
  const [secondEnabled, setSecondEnabled] = useState(false);
  const [secondAccountId, setSecondAccountId] = useState("");
  const [secondAmount, setSecondAmount] = useState("");
  // A-28 Tahap 4 (H-PGT-01): nominal potongan memakai MoneyInput
  // bersama; string kanonisnya dibaca parseStatementAmount & aksi
  // server persis seperti teks mentah sebelumnya.
  const [secondValid, setSecondValid] = useState(true);
  const [busy, setBusy] = useState(false);
  // A-22 K3: pesan hasil/error aksi baris menetap — di dalam panel yang
  // terbuka (panelError) atau di atas tabel untuk aksi satu-klik tanpa
  // panel (tableNotice). Keduanya bertahan sampai tindakan berikutnya.
  const [panelError, setPanelError] = useState<string | null>(null);
  const [tableNotice, setTableNotice] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [modelNote, setModelNote] = useState<string | null>(null);

  function open(row: StatementRow, nextMode: "match" | "journal") {
    setOpenId(row.id);
    setMode(nextMode);
    setJournalLineId(candidatesFor(row, bookCandidates)[0]?.id ?? "");
    setContraAccountId(contraAccounts[0]?.id ?? "");
    setJournalDate(row.date);
    setJournalDesc(row.description);
    setSecondEnabled(false);
    setSecondAccountId(contraAccounts[1]?.id ?? contraAccounts[0]?.id ?? "");
    setSecondAmount("");
    setPanelError(null);
    setModelNote(null);
  }

  /** A-22 K3 (pola Bank Matching Odoo 19): tepat satu usulan pasangan →
   * tombolnya adalah aksinya. Satu klik menautkan ke jurnal yang
   * disebut namanya di tombol; pilihan lain tetap lewat panel. */
  async function quickMatch(row: StatementRow, candidate: BookCandidate) {
    setBusy(true);
    setTableNotice(null);
    const result = await matchLineAction({ statementLineId: row.id, journalLineId: candidate.id });
    setBusy(false);
    if (!result.ok) {
      setTableNotice({ kind: "error", text: `Gagal menautkan mutasi: ${result.message}` });
      return;
    }
    setTableNotice({
      kind: "ok",
      text: `Mutasi "${row.description}" tertaut ke jurnal ${candidate.entryNumber}.`,
    });
    router.refresh();
  }

  async function doMatch(row: StatementRow) {
    if (!journalLineId) {
      setPanelError("Pilih baris jurnal pasangannya.");
      return;
    }
    setBusy(true);
    setPanelError(null);
    const result = await matchLineAction({ statementLineId: row.id, journalLineId });
    setBusy(false);
    if (!result.ok) {
      setPanelError(result.message);
      return;
    }
    setTableNotice({ kind: "ok", text: `Mutasi "${row.description}" tertaut ke jurnal.` });
    setOpenId(null);
    router.refresh();
  }

  async function doUnmatch(row: StatementRow) {
    setBusy(true);
    setTableNotice(null);
    const result = await unmatchLineAction({ statementLineId: row.id });
    setBusy(false);
    if (!result.ok) {
      setTableNotice({ kind: "error", text: `Gagal melepas tautan: ${result.message}` });
      return;
    }
    setTableNotice({ kind: "ok", text: `Tautan mutasi "${row.description}" dilepas.` });
    router.refresh();
  }

  async function doCreateJournal(row: StatementRow) {
    if (!contraAccountId) {
      setPanelError("Pilih akun lawan untuk jurnal baru.");
      return;
    }
    if (secondEnabled && (!secondAccountId || !secondAmount.trim())) {
      setPanelError("Isi akun dan nominal potongan, atau matikan opsi potongan bank.");
      return;
    }
    if (secondEnabled && !secondValid) {
      setPanelError("Nominal potongan belum terbaca — periksa kembali nominalnya.");
      return;
    }
    setBusy(true);
    setPanelError(null);
    const result = await createJournalFromLineAction({
      statementLineId: row.id,
      contraAccountId,
      secondContraAccountId: secondEnabled ? secondAccountId : undefined,
      secondContraAmount: secondEnabled ? secondAmount.trim() : undefined,
      date: journalDate || undefined,
      description: journalDesc || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setPanelError(result.message);
      return;
    }
    setTableNotice({
      kind: "ok",
      text: `Jurnal ${result.data.number} dibuat dari mutasi "${row.description}" dan baris mutasi tertaut.`,
    });
    setOpenId(null);
    router.refresh();
  }

  /** Model lawan cepat (K3 butir 4): pengisi form dari panel yang sama,
   * memakai mekanisme jurnal multi-baris yang sudah ada — bukan jalur
   * posting baru. */
  function applyModel(kind: "fee" | "interest" | "interestTax") {
    setPanelError(null);
    if (kind === "fee" && models.bankFee) {
      setContraAccountId(models.bankFee.id);
      setModelNote(
        `Model "Biaya admin bank": akun lawan diisi ${models.bankFee.code} — ${models.bankFee.name}. Nominal jurnal otomatis sebesar mutasi.`,
      );
    }
    if (kind === "interest" && models.otherIncome) {
      setContraAccountId(models.otherIncome.id);
      setModelNote(
        `Model "Bunga bank": akun lawan diisi ${models.otherIncome.code} — ${models.otherIncome.name}. Nominal jurnal otomatis sebesar mutasi.`,
      );
    }
    if (kind === "interestTax" && models.otherIncome) {
      setContraAccountId(models.otherIncome.id);
      setSecondEnabled(true);
      if (models.taxDeduction) {
        setSecondAccountId(models.taxDeduction.id);
        setModelNote(
          `Model "PPh atas bunga": akun lawan diisi pendapatan bunga ${models.otherIncome.code} — ${models.otherIncome.name}, dan potongan diisi ${models.taxDeduction.code} — ${models.taxDeduction.name}. Tinggal isi nominal potongannya.`,
        );
      } else {
        setSecondAccountId("");
        setModelNote(
          `Model "PPh atas bunga": akun lawan diisi pendapatan bunga ${models.otherIncome.code} — ${models.otherIncome.name} dan opsi potongan dinyalakan. Akun potongan belum dapat diputuskan otomatis (belum ada akun beban/aset bernama PPh/pajak) — pilih akun potongannya, lalu isi nominalnya.`,
        );
      }
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Belum ada baris mutasi"
        description="Belum ada baris mutasi pada filter ini. Impor CSV mutasi bank untuk memulai."
        icon={<FileUp className="size-5" />}
        className="py-8"
      />
    );
  }

  return (
    <>
      {tableNotice ? (
        <p
          role={tableNotice.kind === "error" ? "alert" : undefined}
          className={cn(
            "border-b border-border px-4 py-2 text-[11px]",
            tableNotice.kind === "error"
              ? "bg-destructive/5 text-destructive"
              : "bg-tone-green-soft/60 text-tone-green",
          )}
        >
          {tableNotice.text}
        </p>
      ) : null}
      <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Keterangan</th>
            <th className="text-right">Debit</th>
            <th className="text-right">Kredit</th>
            <th>Status</th>
            {canManage ? <th className="text-right">Aksi</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const candidates = candidatesFor(row, bookCandidates);
            const isOpen = openId === row.id;
            const isDebit = d(row.debit).gt(0);
            const amount = isDebit ? d(row.debit) : d(row.credit);
            const secondValue = secondEnabled ? parseStatementAmount(secondAmount) : null;
            return [
              <tr key={row.id} className="align-top">
                <td className="num whitespace-nowrap text-[12px]">{formatDate(row.date)}</td>
                <td className="text-[12px]">{row.description}</td>
                <td className="num whitespace-nowrap text-right text-[12px]">
                  {Number(row.debit) > 0 ? formatIDR(row.debit) : "—"}
                </td>
                <td className="num whitespace-nowrap text-right text-[12px]">
                  {Number(row.credit) > 0 ? formatIDR(row.credit) : "—"}
                </td>
                <td className="whitespace-nowrap">
                  {row.matchedJournalLineId ? (
                    <span className="inline-flex items-center rounded-full bg-tone-green-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-tone-green">
                      Tertaut {row.matchedEntryNumber ?? ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-tone-amber-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-tone-amber">
                      Belum tertaut
                    </span>
                  )}
                </td>
                {canManage ? (
                  <td className="whitespace-nowrap">
                    {row.matchedJournalLineId ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doUnmatch(row)}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <Link2Off className="size-3" /> Lepas
                      </button>
                    ) : (
                      <div className="flex gap-1">
                        {candidates.length === 1 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void quickMatch(row, candidates[0])}
                            title="Satu-satunya baris jurnal belum tertaut dengan nominal sama persis — klik untuk langsung menautkan. Tautan dapat dilepas lagi kapan pun dari tombol Lepas."
                            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            <Link2 className="size-3" /> Tautkan ke {candidates[0].entryNumber}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => open(row, "match")}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            <Link2 className="size-3" /> Tautkan
                            {candidates.length > 1 ? ` (${candidates.length} usulan)` : ""}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => open(row, "journal")}
                          className="rounded border border-border px-2 py-1 text-[11px] transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Buat jurnal
                        </button>
                      </div>
                    )}
                  </td>
                ) : null}
              </tr>,
              isOpen && canManage ? (
                <tr key={`${row.id}-panel`} className="border-b border-border bg-muted/30">
                  <td colSpan={6} className="px-3 py-3">
                    {mode === "match" ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="min-w-64 flex-1 space-y-1">
                            <span className={labelClass}>
                              Baris jurnal pasangan (nominal sama persis)
                            </span>
                            <select
                              className={selectClass}
                              value={journalLineId}
                              onChange={(event) => setJournalLineId(event.target.value)}
                            >
                              {candidates.length === 0 ? (
                                <option value="">Tidak ada baris jurnal belum tertaut dengan nominal ini</option>
                              ) : (
                                candidates.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.entryNumber} · {formatDate(candidate.date)} ·{" "}
                                    {formatIDR(Number(candidate.debit) > 0 ? candidate.debit : candidate.credit)} ·{" "}
                                    {candidate.description ?? ""}
                                  </option>
                                ))
                              )}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={busy || !journalLineId}
                            onClick={() => void doMatch(row)}
                            className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                          >
                            Simpan tautan
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenId(null)}
                            className="h-8 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
                          >
                            Batal
                          </button>
                        </div>
                        {candidates.length > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            {candidates.length} usulan pasangan: baris jurnal belum tertaut dengan
                            nominal sama persis dengan mutasi ini.
                          </p>
                        ) : null}
                        {panelError ? (
                          <p role="alert" className="text-[11px] font-medium text-destructive">
                            {panelError}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* A-22 K3: mutasi & selisih selalu terlihat sebelum posting. */}
                        <div className="rounded-md border border-border bg-card px-3 py-2 text-[11px]">
                          <p>
                            Mutasi {isDebit ? "masuk (debit)" : "keluar (kredit)"} sebesar{" "}
                            <span className="font-semibold">{formatIDR(amount)}</span> — baris bank
                            pada jurnal akan persis sebesar ini.
                          </p>
                          {!secondEnabled ? (
                            <p className="mt-0.5 text-muted-foreground">
                              Akun lawan dicatat {formatIDR(amount)} — selisih terhadap mutasi
                              Rp 0.
                            </p>
                          ) : secondValue && secondValue.gt(0) ? (
                            <p className="mt-0.5 text-muted-foreground">
                              Akun lawan utama dicatat bruto{" "}
                              {formatIDR(amount.plus(secondValue))} (mutasi + potongan{" "}
                              {formatIDR(secondValue)}); potongan menjadi baris sendiri di sisi
                              yang sama dengan baris bank — selisih terhadap mutasi Rp 0.
                            </p>
                          ) : secondAmount.trim() ? (
                            <p className="mt-0.5 text-destructive">
                              Nominal potongan belum terbaca — gunakan angka, mis. 50.000.
                            </p>
                          ) : (
                            <p className="mt-0.5 text-muted-foreground">
                              Isi nominal potongan untuk melihat jurnal brutonya.
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                            <Wand2 className="size-3.5" /> Model cepat:
                          </span>
                          <button
                            type="button"
                            disabled={!models.bankFee}
                            title={
                              models.bankFee
                                ? `Isi akun lawan dengan ${models.bankFee.code} — ${models.bankFee.name} (pemetaan bank_fee)`
                                : "Akun biaya bank (pemetaan bank_fee) belum diatur di Pengaturan"
                            }
                            onClick={() => applyModel("fee")}
                            className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            Biaya admin bank
                          </button>
                          <button
                            type="button"
                            disabled={!models.otherIncome}
                            title={
                              models.otherIncome
                                ? `Isi akun lawan dengan ${models.otherIncome.code} — ${models.otherIncome.name} (pemetaan other_income)`
                                : "Akun pendapatan lain-lain (pemetaan other_income) belum diatur di Pengaturan"
                            }
                            onClick={() => applyModel("interest")}
                            className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            Bunga bank
                          </button>
                          <button
                            type="button"
                            disabled={!models.otherIncome}
                            title={
                              models.otherIncome
                                ? "Isi akun lawan dengan pendapatan bunga dan nyalakan baris potongan PPh (mekanisme multi-baris yang sama)"
                                : "Akun pendapatan lain-lain (pemetaan other_income) belum diatur di Pengaturan"
                            }
                            onClick={() => applyModel("interestTax")}
                            className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            PPh atas bunga
                          </button>
                          {modelNote ? (
                            <span className="basis-full text-[11px] text-muted-foreground">
                              {modelNote}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="min-w-52 flex-1 space-y-1">
                            <span className={labelClass}>Akun lawan</span>
                            <GroupedAccountSelect
                              value={contraAccountId}
                              onChange={setContraAccountId}
                              accounts={contraAccounts}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className={labelClass}>Tanggal jurnal</span>
                            <DateField
                              value={journalDate}
                              onChange={setJournalDate}
                              aria-label="Tanggal jurnal"
                              className="w-36"
                            />
                          </label>
                          <div className="basis-full space-y-2">
                            <label className="flex items-center gap-2 text-[12px]">
                              <input
                                type="checkbox"
                                checked={secondEnabled}
                                onChange={(event) => setSecondEnabled(event.target.checked)}
                                className="size-3.5"
                              />
                              Ada potongan bank pada mutasi ini (baris lawan kedua)
                            </label>
                            {secondEnabled ? (
                              <div className="flex flex-wrap items-end gap-2">
                                <label className="min-w-52 flex-1 space-y-1">
                                  <span className={labelClass}>Akun potongan</span>
                                  <GroupedAccountSelect
                                    value={secondAccountId}
                                    onChange={setSecondAccountId}
                                    accounts={contraAccounts}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <span className={labelClass}>Nominal potongan</span>
                                  <MoneyInput
                                    value={secondAmount}
                                    onChange={setSecondAmount}
                                    onValidityChange={setSecondValid}
                                    aria-label="Nominal potongan"
                                    className="h-9 w-40 px-2.5 text-[12px]"
                                  />
                                </label>
                                <p className="basis-full text-[11px] text-muted-foreground">
                                  Untuk mutasi neto yang dipotong bank — mis. bunga bruto dipotong PPh
                                  final: akun lawan utama dicatat bruto (neto mutasi + potongan), baris
                                  bank tetap persis sebesar mutasi.
                                </p>
                              </div>
                            ) : null}
                          </div>
                          <label className="min-w-52 flex-1 space-y-1">
                            <span className={labelClass}>Keterangan jurnal</span>
                            <input
                              className={inputClass}
                              value={journalDesc}
                              onChange={(event) => setJournalDesc(event.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={busy || !contraAccountId}
                            onClick={() => void doCreateJournal(row)}
                            className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                          >
                            Buat jurnal
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenId(null)}
                            className="h-8 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
                          >
                            Batal
                          </button>
                        </div>
                        {panelError ? (
                          <p role="alert" className="text-[11px] font-medium text-destructive">
                            {panelError}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
