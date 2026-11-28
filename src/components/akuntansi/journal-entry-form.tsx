"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newUuid } from "@/lib/uuid";
import { useRouter } from "next/navigation";
import { Plus, Save, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { showPostingWarnings } from "@/lib/notify-warnings";
import { d, formatIDR } from "@/lib/money";
import {
  appendJournalLines,
  autoBalanceAdjacent,
  computeBalancing,
  initialJournalLines,
  journalBalanceState,
  journalSubmitBlockReason,
  summarizeJournalLines,
  type JournalLineDraft,
} from "@/lib/journal-form";
import { postManualJournalAction, saveJournalDraftAction } from "@/server/actions/accounting/jurnal";
import { periodStatusForDate, type PeriodStatusRow } from "@/lib/period-status";
import { AccountCombobox, type ComboboxAccount } from "./account-combobox";
import { BalanceIndicator } from "./balance-indicator";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { DocumentForm } from "@/components/blocks/document-form";
import { ErrorSummary, type FormErrorItem } from "@/components/blocks/error-summary";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";

type Account = ComboboxAccount;
type Line = JournalLineDraft;

const EMPTY_LINE: Line = { accountId: "", debit: "", credit: "" };

export function JournalEntryForm({
  accounts,
  today,
  mappedAccounts,
  periods = [],
  currentYear,
  customers = [],
  suppliers = [],
  copyFrom,
  initialDescription = "",
  initialLines,
}: {
  accounts: Account[];
  today: string;
  /** account_mappings perusahaan (kunci → id akun) untuk pola cepat. */
  mappedAccounts: Partial<Record<string, string>>;
  /** FIX-P1 Tahap 5 (AK5-03): baris periode fiskal dari server. */
  periods?: PeriodStatusRow[];
  currentYear?: number;
  /** A-21 (R3-09): daftar pihak untuk tag baris akun kontrol. */
  customers?: { id: string; name: string }[];
  suppliers?: { id: string; name: string }[];
  /** Nomor jurnal sumber saat pengguna menekan Duplikat. */
  copyFrom?: string;
  initialDescription?: string;
  initialLines?: Line[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState(initialDescription);
  const [lines, setLines] = useState<Line[]>(() =>
    initialLines && initialLines.length > 0
      ? initialLines.map((line) => ({ ...line }))
      : initialJournalLines(),
  );
  const [invalidAmounts, setInvalidAmounts] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrorItem[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  // AK-P3-02: one idempotency key per form session (same pattern as the
  // POS terminal) — a network retry or double submit replays this key and
  // the server returns the already-posted journal instead of duplicating it.
  const idempotencyKey = useRef(newUuid());

  // A-8.4: totals & keseimbangan dihitung fungsi murni bersama
  // (Decimal end-to-end) agar perilakunya teruji unit.
  const summary = useMemo(() => summarizeJournalLines(lines), [lines]);
  const totals = {
    debit: summary.totalDebit,
    credit: summary.totalCredit,
    difference: summary.difference,
    balanced: summary.balanced,
  };
  // A-25 U2 (§4.1.7): keadaan tampilan indikator — form kosong itu
  // NETRAL, bukan "belum seimbang"; alarm hanya untuk unbalanced.
  const balanceState = journalBalanceState(summary);

  const filledLines = lines.filter(
    (line) => line.accountId && (d(line.debit || "0").gt(0) || d(line.credit || "0").gt(0)),
  );
  const isDirty =
    description.trim() !== "" ||
    lines.some((line) => line.accountId !== "" || line.debit !== "" || line.credit !== "");

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Alasan tombol Posting nonaktif, selalu terlihat di samping tombol —
  // bukan lagi tombol mati yang misterius.
  const blockReason = journalSubmitBlockReason({
    filledCount: summary.filledCount,
    balanced: summary.balanced,
    hasInvalidAmounts: invalidAmounts.size > 0,
    difference: summary.difference.toString(),
  });
  const balancing = useMemo(() => computeBalancing(lines), [lines]);

  // AK5-03: status efektif periode untuk tanggal terpilih. Tahun acuan
  // mengikuti server (prop currentYear) agar jendela materialisasi
  // otomatis dinilai sama di klien dan di server.
  const periodStatus = periodStatusForDate(periods, date, currentYear ?? new Date().getFullYear());
  const periodWarning =
    periodStatus === "closed"
      ? "Periode bulan tanggal ini sudah ditutup — posting akan ditolak. Pilih tanggal di periode terbuka atau buka kembali periodenya dari Akuntansi → Periode."
      : periodStatus === "locked"
        ? "Periode bulan tanggal ini sudah dikunci — posting akan ditolak. Hanya owner yang dapat membuka kembali periode terkunci."
        : periodStatus === "missing"
          ? "Periode tahun tanggal ini belum dibuat, sehingga dianggap tertutup — posting akan ditolak. Owner dapat membuat periode tahun ini dari Akuntansi → Periode."
          : null;

  function update(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  // R3-09: jenis pihak mengikuti akun kontrol yang dipilih — akun
  // piutang terpetakan menag pelanggan, akun utang terpetakan menag
  // pemasok, akun lain tidak menawarkan tag. Ganti akun mengganti
  // jenisnya dan mengosongkan pilihan pihak yang tidak lagi cocok.
  function partyTypeForAccount(accountId: string): "customer" | "supplier" | null {
    if (accountId && mappedAccounts.receivable === accountId) return "customer";
    if (accountId && mappedAccounts.payable === accountId) return "supplier";
    return null;
  }

  function changeAccount(index: number, accountId: string) {
    const partyType = partyTypeForAccount(accountId);
    setLines((current) =>
      current.map((line, i) =>
        i === index
          ? {
              ...line,
              accountId,
              partyType: partyType ?? undefined,
              partyId: partyType && line.partyType === partyType ? line.partyId : undefined,
            }
          : line,
      ),
    );
  }

  function trackValidity(key: string, valid: boolean) {
    setInvalidAmounts((current) => {
      if (valid === !current.has(key)) return current;
      const next = new Set(current);
      if (valid) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * Setelah nominal diisi (blur), isi otomatis baris penyeimbang yang
   * berdekatan bila akunnya sudah dipilih — alur dua baris jadi satu
   * ketikan. Tidak menyentuh baris lain; pengguna tetap bisa menimpa.
   */
  function autoBalance(index: number, side: "debit" | "credit") {
    setLines((current) => autoBalanceAdjacent(current, index, side));
  }

  const applyBalancing = useCallback(() => {
    const fix = computeBalancing(lines);
    if (!fix) return;
    const patch =
      fix.side === "debit" ? { debit: fix.amount, credit: "" } : { credit: fix.amount, debit: "" };
    setLines((current) => {
      const next = current.map((line) => ({ ...line }));
      const blank = (line: Line) =>
        !d(line.debit || "0").gt(0) && !d(line.credit || "0").gt(0);
      // Utamakan baris yang akunnya sudah dipilih tetapi nominalnya
      // kosong; lalu baris yang benar-benar kosong; terakhir baris baru.
      let index = next.findIndex((line) => line.accountId && blank(line));
      if (index < 0) index = next.findIndex((line) => !line.accountId && blank(line));
      if (index >= 0) {
        next[index] = { ...next[index], ...patch };
        return next;
      }
      return [...next, { ...EMPTY_LINE, ...patch }];
    });
    toast.info("Nominal penyeimbang terisi — pastikan akun baris penyeimbang sudah dipilih.");
  }, [lines]);

  // Ergonomi keyboard enterprise: Alt+B untuk menyeimbangkan debit/kredit
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.altKey || (e.ctrlKey && e.shiftKey)) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        applyBalancing();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyBalancing]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (index === lines.length - 1) {
        setLines((current) => appendJournalLines(current));
      }
    }
  }

  async function submit() {
    const errs: FormErrorItem[] = [];
    if (periodWarning) {
      errs.push({ field: "journal-date", message: periodWarning });
    }
    if (invalidAmounts.size > 0) {
      errs.push({ field: "journal-lines", message: "Ada nominal yang tidak terbaca. Periksa bidang yang ditandai." });
    }
    if (filledLines.length < 2) {
      errs.push({ field: "journal-lines", message: "Isi minimal dua baris jurnal berpasangan." });
    }
    if (!totals.balanced) {
      errs.push({ field: "journal-lines", message: `Debit dan kredit belum sama. Selisih ${formatIDR(totals.difference)}.` });
    }
    if (errs.length > 0) {
      setFormErrors(errs);
      toast.error(errs[0].message);
      return;
    }
    setFormErrors([]);
    setBusy(true);
    const result = await postManualJournalAction({
      date,
      // Keterangan opsional: server memberi teks bawaan bila kosong.
      description: description.trim() || "Jurnal umum",
      idempotencyKey: idempotencyKey.current,
      lines: filledLines.map((line) => ({
        accountId: line.accountId,
        debit: d(line.debit || "0").gt(0) ? line.debit : undefined,
        credit: d(line.credit || "0").gt(0) ? line.credit : undefined,
        // R3-09: tag hanya dikirim bila pihak benar-benar dipilih.
        description: line.description?.trim() || undefined,
        partyType: line.partyId ? line.partyType : undefined,
        partyId: line.partyId || undefined,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      setFormErrors([{ message: result.message }]);
      toast.error(result.message);
      return;
    }
    if ("pendingApproval" in result.data && result.data.pendingApproval) {
      toast.info(
        `Jurnal ${result.data.number} menunggu persetujuan pengguna lain sebelum masuk buku besar.`,
      );
      router.push(`/app/akuntansi/jurnal/${result.data.id}`);
      router.refresh();
      return;
    }
    toast.success(`Jurnal ${result.data.number} diposting.`);
    showPostingWarnings(result.data.warnings);
    // Spesifikasi UX: sesudah simpan langsung masuk ke histori jurnal
    // (dengan filter tanggal/akun/user), bukan halaman detail.
    router.push("/app/akuntansi/jurnal");
    router.refresh();
  }

  async function saveDraft() {
    const errs: FormErrorItem[] = [];
    if (invalidAmounts.size > 0) {
      errs.push({ field: "journal-lines", message: "Ada nominal yang tidak terbaca. Periksa bidang yang ditandai." });
    }
    if (filledLines.length < 2) {
      errs.push({ field: "journal-lines", message: "Isi minimal dua baris jurnal berpasangan." });
    }
    if (!totals.balanced) {
      errs.push({ field: "journal-lines", message: `Debit dan kredit belum sama. Selisih ${formatIDR(totals.difference)}.` });
    }
    if (errs.length > 0) {
      setFormErrors(errs);
      toast.error(errs[0].message);
      return;
    }
    setFormErrors([]);
    setSavingDraft(true);
    const result = await saveJournalDraftAction({
      date,
      description: description.trim() || "Jurnal umum",
      idempotencyKey: idempotencyKey.current,
      lines: filledLines.map((line) => ({
        accountId: line.accountId,
        debit: d(line.debit || "0").gt(0) ? line.debit : undefined,
        credit: d(line.credit || "0").gt(0) ? line.credit : undefined,
        description: line.description?.trim() || undefined,
        partyType: line.partyId ? line.partyType : undefined,
        partyId: line.partyId || undefined,
      })),
    });
    setSavingDraft(false);
    if (!result.ok) {
      setFormErrors([{ message: result.message }]);
      toast.error(result.message);
      return;
    }
    toast.success(`Draf ${result.data.number} disimpan. Review lalu posting dari halaman detail.`);
    router.push(`/app/akuntansi/jurnal/${result.data.id}`);
    router.refresh();
  }

  // Pintasan enterprise: Ctrl/Cmd+Enter memposting, Ctrl/Cmd+S menyimpan
  // draf. Keduanya tetap melewati validasi form & server yang sama.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (cancelOpen) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (!busy && !savingDraft) void submit();
        return;
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!busy && !savingDraft) void saveDraft();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, savingDraft, cancelOpen, lines, date, description, invalidAmounts]);

  // A-25 U2: form memakai DocumentForm bersama — slot ringkasan,
  // panduan terlipat, dan bilah aksi terpaku disusun di sini lalu
  // diteruskan ke bingkai; editor baris tetap anak bingkai.
  const totalsRows = (
    <dl className="mt-2 space-y-1 text-[11px]">
      <div className="flex justify-between"><dt>Debit</dt><dd className="num font-medium">{formatIDR(totals.debit)}</dd></div>
      <div className="flex justify-between"><dt>Kredit</dt><dd className="num font-medium">{formatIDR(totals.credit)}</dd></div>
      <div className="flex justify-between border-t border-current/10 pt-1"><dt>Selisih</dt><dd className="num font-semibold">{formatIDR(totals.difference)}</dd></div>
    </dl>
  );

  // §4.1.7: keadaan kosong NETRAL — bukan spanduk merah "Belum
  // seimbang — selisih Rp 0". Merah hanya untuk unbalanced sungguhan
  // (ada baris terisi dan selisih ≠ 0); teal untuk seimbang.
  const summaryPanel =
    balanceState === "empty" ? (
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-[11px] font-semibold text-muted-foreground">Keseimbangan</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Belum ada baris terisi. Total debit dan kredit dibandingkan di sini begitu Anda mulai
          mengisi baris.
        </p>
        {totalsRows}
      </div>
    ) : (
      <div
        className={`rounded-lg border px-4 py-3 ${
          balanceState === "balanced"
            ? "border-tone-teal/30 bg-tone-teal-soft"
            : "border-tone-red/30 bg-tone-red-soft"
        }`}
      >
        <p className="text-[11px] font-semibold">
          <BalanceIndicator
            balanced={totals.balanced}
            difference={totals.difference}
            variant="sentence"
            suffix="siap diposting"
          />
        </p>
        {balanceState === "unbalanced" ? (
          <p className="mt-1 text-[11px]">
            Jurnal belum bisa disimpan. Gunakan tombol &ldquo;Samakan selisih&rdquo; atau
            sesuaikan nominal baris.
          </p>
        ) : null}
        {totalsRows}
      </div>
    );

  const guidePanel = (
    <>
      {/* FIX-R2 Tahap 2 (RD2U-15): daftar memakai penanda daftar
          semantik, bukan glyph "•" yang diketik manual. */}
      <ul className="list-disc space-y-0.5 pl-4">
        <li>Formulir mulai dengan tiga baris; tombol Tambah baris menambah dua baris sekaligus.</li>
        <li>Debit menambah aset/beban, kredit menambah liabilitas/ekuitas/pendapatan.</li>
        <li>Saat Anda selesai mengisi nominal, baris berdekatan yang akunnya sudah dipilih akan terisi otomatis sebagai penyeimbang.</li>
        <li>Baris akun Piutang/Utang dapat ditag ke pelanggan/pemasok agar penyesuaian teratribusi ke pihaknya.</li>
        <li>Keterangan boleh dikosongkan. Jurnal posted tidak bisa diedit; koreksi memakai jurnal pembalik.</li>
        <li>Pastikan periode fiskal masih terbuka.</li>
      </ul>
    </>
  );

  const actionsBar = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setLines((current) => appendJournalLines(current))}
          className="inline-flex h-11 items-center gap-1.5 rounded border border-border px-2.5 text-[11px] transition-colors hover:bg-muted lg:h-8"
        >
          <Plus className="size-3.5" /> Tambah 2 baris
        </button>
        <button
          type="button"
          onClick={applyBalancing}
          disabled={!balancing}
          title={balancing ? "Isi nominal penyeimbang pada sisi yang kurang (Alt+B)" : "Tidak ada selisih untuk disamakan"}
          className="inline-flex h-11 items-center gap-1.5 rounded border border-border px-2.5 text-[11px] transition-colors hover:bg-muted disabled:opacity-40 lg:h-8"
        >
          <Scale className="size-3.5" />
          {balancing ? `Samakan selisih ${formatIDR(balancing.amount)}` : "Samakan selisih"}
          <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground opacity-70 ml-0.5">(Alt+B)</span>
        </button>
      </div>
      <div className="flex flex-col items-end gap-1">
        {blockReason && !busy ? (
          <p className="text-[11px] text-muted-foreground" role="status">{blockReason}</p>
        ) : null}
        <p className="hidden text-[11px] text-muted-foreground sm:block">
          Ctrl/⌘+Enter posting · Ctrl/⌘+S draf
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (isDirty) setCancelOpen(true);
              else router.push("/app/akuntansi");
            }}
            className="inline-flex h-11 items-center rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted lg:h-8"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={busy || savingDraft || blockReason !== null}
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50 lg:h-8"
          >
            <Save className="size-3.5" /> {savingDraft ? "Menyimpan…" : "Simpan draf"}
            <span className="sr-only">(Ctrl atau Command + S)</span>
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || savingDraft || blockReason !== null}
            className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 lg:h-8"
          >
            <Save className="size-3.5" /> {busy ? "Memposting…" : "Posting jurnal"}
            <span className="sr-only">(Ctrl atau Command + Enter)</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
    {copyFrom ? (
      <div className="mb-3 rounded-md border border-tone-teal/30 bg-tone-teal-soft px-3 py-2 text-[11px] leading-4 text-tone-teal">
        Menyalin baris dari jurnal <span className="num font-semibold">{copyFrom}</span>. Tanggal diisi hari ini;
        ubah bila perlu. Tidak ada yang tersimpan sampai Anda memposting atau menyimpan draf.
      </div>
    ) : null}
    <DocumentForm
      header={
        <>
          <div className="grid gap-2 p-4 sm:grid-cols-[170px_minmax(0,1fr)]">
          <div id="journal-date" tabIndex={-1} className="space-y-1 outline-none">
            <label className="space-y-1">
              <span className={labelClass}>Tanggal</span>
              {/* A-25 U2: DateField bersama — tampilan selalu
                  dd/mm/yyyy, nilai state tetap ISO. */}
              <DateField value={date} onChange={setDate} aria-label="Tanggal" />
            </label>
            {/* FIX-P1 Tahap 5 (AK5-03): peringatan periode hidup mengikuti
                tanggal yang dipilih — semantiknya sama dengan penjaga
                server (assertPeriodOpen), jadi peringatan ini tidak
                pernah berjanji lebih longgar dari penegakan akhirnya. */}
            {periodWarning ? (
              <p role="alert" className="rounded-md border border-tone-red/30 bg-tone-red-soft px-2 py-1.5 text-[11px] leading-4 text-tone-red">
                {periodWarning}
              </p>
            ) : null}
          </div>
          <label className="space-y-1">
            <span className={labelClass}>Keterangan (opsional)</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={fieldClass}
              placeholder="Contoh: penyesuaian biaya listrik periode ini"
            />
          </label>
          </div>
        </>
      }
      summary={summaryPanel}
      guide={guidePanel}
      actions={actionsBar}
    >
      <div className="space-y-4">
        {formErrors.length > 0 ? (
          <div className="p-4 pb-0">
            <ErrorSummary errors={formErrors} />
          </div>
        ) : null}
        <div id="journal-lines" tabIndex={-1} className="outline-none">
          {/* A-22 K2 (UX-02): tabel penuh hanya di >=lg — di bawahnya
              editor menjadi kartu per baris (lihat blok sesudah tabel)
              agar kolom Debit/Kredit tidak terpotong di layar kecil. */}
          <div className="hidden w-full max-w-full overflow-x-auto lg:block">
          <table className="data-table data-table-dense w-full table-fixed">
            {/* Lebar kolom dikunci agar Akun tidak mendominasi dan
                Debit/Kredit simetris — input memenuhi selnya sendiri. */}
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[30%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
              <col className="w-[4%]" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="text-left">Akun</th>
                <th scope="col" className="text-left">Memo baris</th>
                <th scope="col" className="text-right">Debit</th>
                <th scope="col" className="text-right">Kredit</th>
                <th scope="col">
                  <span className="sr-only">Aksi baris</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td className="cell-wrap">
                    <AccountCombobox
                      accounts={accounts}
                      value={line.accountId}
                      onChange={(accountId) => changeAccount(index, accountId)}
                      aria-label={`Akun baris ${index + 1}`}
                      className="w-full"
                    />
                    {partyTypeForAccount(line.accountId) ? (
                      <select
                        value={line.partyId ?? ""}
                        onChange={(event) =>
                          update(index, { partyId: event.target.value || undefined })
                        }
                        aria-label={`Pihak baris ${index + 1}`}
                        className="mt-1 h-9 w-full rounded border border-input bg-background px-1.5 text-[11px]"
                      >
                        <option value="">
                          — pihak (opsional): {partyTypeForAccount(line.accountId) === "customer" ? "pelanggan" : "pemasok"} —
                        </option>
                        {(partyTypeForAccount(line.accountId) === "customer" ? customers : suppliers).map((party) => (
                          <option key={party.id} value={party.id}>
                            {party.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  <td className="align-middle">
                    <input
                      value={line.description ?? ""}
                      onChange={(event) => update(index, { description: event.target.value })}
                      aria-label={`Memo baris ${index + 1}`}
                      placeholder="Opsional"
                      className="h-9 w-full rounded border border-input bg-background px-2 text-[11px]"
                    />
                  </td>
                  <td className="align-middle">
                    <MoneyInput
                      value={line.debit}
                      onChange={(debit) => update(index, { debit, credit: "" })}
                      onValidityChange={(valid) => trackValidity(`${index}-debit`, valid)}
                      onBlur={() => autoBalance(index, "debit")}
                      onKeyDown={(event) => handleInputKeyDown(event, index)}
                      aria-label={`Debit baris ${index + 1}`}
                      className="h-9 w-full px-2 text-[12px]"
                    />
                  </td>
                  <td className="align-middle">
                    <MoneyInput
                      value={line.credit}
                      onChange={(credit) => update(index, { credit, debit: "" })}
                      onValidityChange={(valid) => trackValidity(`${index}-credit`, valid)}
                      onBlur={() => autoBalance(index, "credit")}
                      onKeyDown={(event) => handleInputKeyDown(event, index)}
                      aria-label={`Kredit baris ${index + 1}`}
                      className="h-9 w-full px-2 text-[12px] text-destructive"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setLines((current) => (current.length > 2 ? current.filter((_, i) => i !== index) : current))}
                      disabled={lines.length <= 2}
                      className="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                      aria-label={`Hapus baris ${index + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/40 text-[11px]">
                <td className="pl-5 text-left text-[11px] uppercase tracking-wide text-muted-foreground">Total</td>
                <td />
                <td className="num text-right font-semibold">{formatIDR(totals.debit)}</td>
                <td className={`num text-right font-semibold ${balanceState === "unbalanced" ? "text-destructive" : ""}`}>{formatIDR(totals.credit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* A-22 K2 (UX-02): mode kartu di bawah lg — satu kartu per
            baris jurnal (akun lebar penuh, memo, lalu Debit/Kredit
            berdampingan) memakai state & handler yang sama persis
            dengan tabel; tidak ada perbedaan data/validasi. Bilah
            total lengket di bawah area baris agar keseimbangan selalu
            terlihat tanpa menggulir jauh. */}
        <div className="lg:hidden">
          <div className="space-y-2 px-3 py-3">
            {lines.map((line, index) => (
              <div key={index} className="rounded-md border border-border/80 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Baris {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines((current) => (current.length > 2 ? current.filter((_, i) => i !== index) : current))}
                    disabled={lines.length <= 2}
                    className="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    aria-label={`Hapus baris ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <AccountCombobox
                  accounts={accounts}
                  value={line.accountId}
                  onChange={(accountId) => changeAccount(index, accountId)}
                  aria-label={`Akun baris ${index + 1}`}
                  className="w-full"
                />
                {partyTypeForAccount(line.accountId) ? (
                  <select
                    value={line.partyId ?? ""}
                    onChange={(event) =>
                      update(index, { partyId: event.target.value || undefined })
                    }
                    aria-label={`Pihak baris ${index + 1}`}
                    className="mt-2 h-9 w-full rounded border border-input bg-background px-1.5 text-[11px]"
                  >
                    <option value="">
                      — pihak (opsional): {partyTypeForAccount(line.accountId) === "customer" ? "pelanggan" : "pemasok"} —
                    </option>
                    {(partyTypeForAccount(line.accountId) === "customer" ? customers : suppliers).map((party) => (
                      <option key={party.id} value={party.id}>
                        {party.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <label className="mt-2 block space-y-1">
                  <span className={labelClass}>Memo baris</span>
                  <input
                    value={line.description ?? ""}
                    onChange={(event) => update(index, { description: event.target.value })}
                    aria-label={`Memo baris ${index + 1}`}
                    placeholder="Opsional"
                    className="h-9 w-full rounded border border-input bg-background px-2 text-[11px]"
                  />
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className={labelClass}>Debit</span>
                    <MoneyInput
                      value={line.debit}
                      onChange={(debit) => update(index, { debit, credit: "" })}
                      onValidityChange={(valid) => trackValidity(`${index}-debit`, valid)}
                      onBlur={() => autoBalance(index, "debit")}
                      onKeyDown={(event) => handleInputKeyDown(event, index)}
                      aria-label={`Debit baris ${index + 1}`}
                      className="h-9 px-1.5 text-[11px]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Kredit</span>
                    <MoneyInput
                      value={line.credit}
                      onChange={(credit) => update(index, { credit, debit: "" })}
                      onValidityChange={(valid) => trackValidity(`${index}-credit`, valid)}
                      onBlur={() => autoBalance(index, "credit")}
                      onKeyDown={(event) => handleInputKeyDown(event, index)}
                      aria-label={`Kredit baris ${index + 1}`}
                      className="h-9 px-1.5 text-[11px] text-destructive"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-card/95 px-4 py-2 backdrop-blur">
            <span className="text-[11px]">
              Debit <span className="num font-semibold">{formatIDR(totals.debit)}</span>
            </span>
            <span className="text-[11px]">
              Kredit <span className={`num font-semibold ${balanceState === "unbalanced" ? "text-destructive" : ""}`}>{formatIDR(totals.credit)}</span>
            </span>
            {/* A-25 U2 (§4.1.7): kosong = penanda netral "Debit =
                Kredit" redup; BalanceIndicator berwarna hanya saat
                ada baris terisi. */}
            <span
              className={`ml-auto text-[11px] font-semibold ${
                balanceState === "empty"
                  ? "text-muted-foreground"
                  : balanceState === "balanced"
                    ? "text-tone-teal"
                    : "text-destructive"
              }`}
            >
              {balanceState === "empty" ? (
                "Debit = Kredit"
              ) : (
                <BalanceIndicator balanced={totals.balanced} difference={totals.difference} />
              )}
            </span>
          </div>
        </div>
        </div>
      </div>

    </DocumentForm>
    <ConfirmDialog
      open={cancelOpen}
      title="Batalkan jurnal ini?"
      description="Baris dan keterangan yang sudah diketik akan hilang. Simpan sebagai draf bila masih ingin melanjutkannya nanti."
      confirmLabel="Ya, batalkan"
      cancelLabel="Lanjut mengisi"
      danger
      onConfirm={() => {
        setCancelOpen(false);
        router.push("/app/akuntansi");
      }}
      onCancel={() => setCancelOpen(false)}
    />
    </>
  );
}
