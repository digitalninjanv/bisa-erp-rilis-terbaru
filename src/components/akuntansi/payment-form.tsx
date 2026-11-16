"use client";

import { useState } from "react";
import { newUuid } from "@/lib/uuid";
import { useRouter } from "next/navigation";
import { Banknote, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { d, formatIDR } from "@/lib/money";
import { showPostingWarnings } from "@/lib/notify-warnings";
import { AccountCombobox, type ComboboxAccount } from "./account-combobox";
import { MoneyInput } from "@/components/money-input";
import { PercentInput } from "@/components/percent-input";
import { DateField } from "@/components/date-field";
import { todayISO } from "@/lib/format";
import { payReceivableAction, voidReceivablePaymentAction } from "@/server/actions/pos";
import {
  payExpensePayableAction,
  payPayableAction,
  voidPayablePaymentAction,
  writeOffExpensePayableAction,
  writeOffOpeningBalanceAction,
  writeOffPayableAction,
  writeOffReceivableAction,
} from "@/server/actions/accounting/pembayaran";
import {
  payOpeningBalanceAction,
  voidOpeningPaymentAction,
} from "@/server/actions/accounting/saldo-awal";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { Modal } from "@/components/blocks/modal";
import { WITHHOLDING_CORE_NOTE, partialSettlement, paymentAccountLabel } from "@/lib/payment-settlement";

type Account = {
  id: string;
  code: string;
  name: string;
  // A-21 Tahap R3-A (R3-01): konfigurasi fee metode pemilik akun
  // (dari listPaymentAccounts) — menentukan nilai awal fee di form.
  feeEnabled?: boolean;
  feeType?: string;
  feeValue?: string;
};

/** T4-5b: jenis "opening-*" melayani dokumen saldo awal (D-14).
 * A-21 (R3-11): "expense-payable" melayani dokumen beban terutang. */
export type PaymentKind =
  | "receivable"
  | "payable"
  | "opening-payable"
  | "opening-receivable"
  | "expense-payable";

/** A-21 (R3-02): dokumen kredit pihak yang masih tersedia untuk
 * pihak pemilik dokumen ini — ditawarkan sebagai sumber dana. */
export type PartyCreditOption = {
  id: string;
  number: string;
  remaining: number;
  originLabel?: string | null;
};

export function PaymentForm({
  kind,
  id,
  number,
  outstanding,
  accounts,
  credits = [],
  withholdingEnabled = false,
  canWriteOff = false,
  writeOffMaxAmount = "0",
}: {
  kind: PaymentKind;
  id: string;
  number: string;
  outstanding: number;
  accounts: Account[];
  credits?: PartyCreditOption[];
  /** A-21 Tahap R3-A (R3-06): saklar potongan pajak per perusahaan
   * (D-25) — mati = field potongan tidak tampil sama sekali. */
  withholdingEnabled?: boolean;
  /** A-22 K4 (Pola 5): izin accounting.manage pemakai — salah satu
   * syarat menawarkan penutupan sisa sebagai write-off di dialog. */
  canWriteOff?: boolean;
  /** A-22 K4 (Pola 5): ambang write-off perusahaan (string desimal);
   * "0" = fitur mati. Syarat & penjaga penuh tetap di domain A-21. */
  writeOffMaxAmount?: string;
}) {
  const router = useRouter();
  const comboboxAccounts: ComboboxAccount[] = accounts.map((row) => ({ ...row, type: "asset" }));
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(outstanding));
  const [amountValid, setAmountValid] = useState(true);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  // A-21 (R3-08): nomor referensi/bukti (no. transfer, cek, VA) —
  // kolom khusus di party_payments, bukan lagi dititipkan di catatan.
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  // A-21 Tahap R3-A (R3-01): fee pembayaran — nilai awal dari
  // konfigurasi metode pemilik akun terpilih; pengguna dapat mengubah
  // (feeDirty) dan nilai itulah yang dikirim & dibekukan di dokumen.
  const [fee, setFee] = useState("");
  const [feeDirty, setFeeDirty] = useState(false);
  // A-21 Tahap R3-A (R3-06): potongan pajak (withholding) — nominal
  // awal terhitung dari tarif yang dipilih; nominal final yang
  // diputuskan pengguna (bisa diubah) adalah yang dikirim & dijurnal.
  const [whType, setWhType] = useState("pph23");
  const [whRate, setWhRate] = useState("");
  const [whAmount, setWhAmount] = useState("");
  const [whAmountDirty, setWhAmountDirty] = useState(false);
  // POS1-05: kunci idempotensi per pembukaan modal — klik ganda atau
  // pengiriman ulang formulir yang sama mengembalikan pembayaran
  // pertama; membuka modal lagi berarti pembayaran baru.
  const [paymentKey, setPaymentKey] = useState("");
  // A-21 (R3-02): sumber dana — "cash" (akun kas/bank, boleh lebih
  // bayar → kelebihan menjadi kredit pihak) atau id dokumen kredit
  // pihak yang dipakai (dibatasi sisa tagihan & sisa kredit).
  const [funding, setFunding] = useState<string>("cash");
  // A-22 K4 (Pola 5): keputusan EKSPLISIT atas sisa pembayaran parsial
  // — "open" (biarkan terbuka, perilaku lama) atau "writeoff" (tutup
  // sisa lewat aksi write-off A-21 yang sama persis, sesudah pembayaran
  // tercatat). Pilihan hanya ditawarkan bila partialSettlement menilai
  // jalurnya sah untuk dokumen ini.
  const [settleChoice, setSettleChoice] = useState<"open" | "writeoff">("open");
  const [writeOffReason, setWriteOffReason] = useState("");
  const isReceivable = kind === "receivable" || kind === "opening-receivable";
  const isOpening = kind === "opening-payable" || kind === "opening-receivable";
  const isExpense = kind === "expense-payable";
  const selectedCredit = credits.find((credit) => credit.id === funding) ?? null;
  const amountDecimal = d(amount || "0");
  const excessAmount = amountDecimal.gt(outstanding) ? amountDecimal.minus(outstanding) : null;
  const selectedAccount = accounts.find((row) => row.id === accountId) ?? null;
  const feeActive = Boolean(!selectedCredit && selectedAccount?.feeEnabled && selectedAccount.feeType !== "none");
  const defaultFee = !feeActive
    ? d(0)
    : selectedAccount!.feeType === "percent"
      ? amountDecimal.mul(d(selectedAccount!.feeValue ?? 0)).div(100).toDecimalPlaces(2)
      : d(selectedAccount!.feeValue ?? 0);
  const feeValue = feeDirty ? fee : defaultFee.toFixed(2);
  const feeDecimal = feeActive ? d(feeValue || "0") : d(0);
  // Potongan hanya untuk pembayaran KELUAR (utang/beban/saldo awal
  // utang), saklar perusahaan aktif, dan sumber dana kas/bank.
  const withholdingVisible = Boolean(withholdingEnabled) && !isReceivable && !selectedCredit;
  const whDefaultAmount = whRate
    ? amountDecimal.mul(d(whRate || "0")).div(100).toDecimalPlaces(2)
    : d(0);
  const whAmountValue = whAmountDirty ? whAmount : whRate ? whDefaultAmount.toFixed(2) : "";
  const whDecimal = withholdingVisible ? d(whAmountValue || "0") : d(0);
  // A-22 K4 (Pola 5): keadaan sisa dari nominal yang sedang diketik —
  // keputusan murni di lib/payment-settlement (teruji unit).
  const settlement = partialSettlement({
    outstanding,
    amount,
    canWriteOff,
    writeOffMaxAmount,
  });
  const totalCreditRemaining = credits.reduce((sum, credit) => sum + credit.remaining, 0);

  async function submit() {
    if (!amountValid) {
      toast.error("Nominal pembayaran tidak terbaca. Periksa bidang nominal.");
      return;
    }
    if (!amountDecimal.gt(0)) {
      toast.error("Nominal pembayaran harus lebih dari nol.");
      return;
    }
    if (selectedCredit) {
      if (amountDecimal.gt(d(outstanding).plus("0.005"))) {
        toast.error("Pembayaran dari kredit tidak boleh melebihi sisa tagihan.");
        return;
      }
      if (amountDecimal.gt(d(selectedCredit.remaining).plus("0.005"))) {
        toast.error(`Nominal melebihi sisa kredit ${selectedCredit.number} (${formatIDR(selectedCredit.remaining)}).`);
        return;
      }
    } else if (!accountId) {
      toast.error("Pilih akun kas atau bank.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Pilih tanggal pembayaran.");
      return;
    }
    // A-22 K4 (Pola 5): pilihan tutup-sisa divalidasi SEBELUM pembayaran
    // diposting — alasan write-off wajib (penjaga domain A-21: ≥ 3
    // karakter) agar pengguna tidak membayar dulu baru gagal di alasan.
    const wantsWriteOff =
      settlement.kind === "partial" && settlement.writeOffEligible && settleChoice === "writeoff";
    if (wantsWriteOff && writeOffReason.trim().length < 3) {
      toast.error("Alasan write-off wajib diisi (minimal 3 karakter) — tercatat di dokumen penutup sisa.");
      return;
    }
    const fundingInput = selectedCredit
      ? { creditId: selectedCredit.id }
      : { accountId };
    // Fee hanya dikirim bila metode akun berfee aktif; selain itu
    // domain memakai bawaan konfigurasi (0) — persis perilaku lama.
    const feeInput = feeActive ? { fee: feeValue } : {};
    // Potongan hanya dikirim bila terlihat & nominalnya terisi > 0;
    // nominal yang dikirim adalah keputusan final pengguna.
    const withholdingInput =
      withholdingVisible && whDecimal.gt(0)
        ? {
            withholdingType: whType,
            withholdingRate: whRate || undefined,
            withholdingAmount: whAmountValue,
          }
        : {};
    setBusy(true);
    const result =
      kind === "receivable"
        ? await payReceivableAction({ saleId: id, amount, ...fundingInput, ...feeInput, date, notes: notes || undefined, reference: reference.trim() || undefined, idempotencyKey: paymentKey || undefined })
        : kind === "payable"
          ? await payPayableAction({ receiptId: id, idempotencyKey: paymentKey, amount, ...fundingInput, ...feeInput, ...withholdingInput, date, notes: notes || undefined, reference: reference.trim() || undefined })
          : kind === "expense-payable"
            ? await payExpensePayableAction({ expenseId: id, idempotencyKey: paymentKey, amount, ...fundingInput, ...feeInput, ...withholdingInput, date, notes: notes || undefined, reference: reference.trim() || undefined })
            : await payOpeningBalanceAction({ openingId: id, idempotencyKey: paymentKey, amount, ...fundingInput, ...feeInput, ...withholdingInput, date, notes: notes || undefined, reference: reference.trim() || undefined });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const creditNote =
      "creditNumber" in result.data && result.data.creditNumber
        ? ` Kelebihan menjadi kredit ${isReceivable ? "pelanggan" : "pemasok"} ${result.data.creditNumber}.`
        : "";
    // A-22 K4 (Pola 5): tutup sisa sebagai write-off SESUDAH pembayaran
    // tercatat — memanggil aksi write-off A-21 yang sama persis dengan
    // tombol "Write-off sisa" (sisa dokumen saat aksi berjalan adalah
    // sisa sesudah pembayaran ini, persis yang dipilih pengguna).
    let writeOffNote = "";
    if (wantsWriteOff) {
      setBusy(true);
      const woResult =
        kind === "receivable"
          ? await writeOffReceivableAction({ saleId: id, reason: writeOffReason.trim() })
          : kind === "payable"
            ? await writeOffPayableAction({ receiptId: id, reason: writeOffReason.trim() })
            : kind === "expense-payable"
              ? await writeOffExpensePayableAction({ expenseId: id, reason: writeOffReason.trim() })
              : await writeOffOpeningBalanceAction({ openingId: id, reason: writeOffReason.trim() });
      setBusy(false);
      if (!woResult.ok) {
        toast.error(
          `Pembayaran tersimpan, tetapi penutupan sisa sebagai write-off gagal: ${woResult.message} Sisa masih terbuka — tutup dari tombol "Write-off sisa" pada dokumen.`,
        );
        setOpen(false);
        router.refresh();
        return;
      }
      showPostingWarnings(woResult.data.warnings);
      writeOffNote = " Sisa ditutup sebagai write-off.";
    }
    toast.success(`${isReceivable ? "Penerimaan" : "Pembayaran"} untuk ${number} tersimpan.${creditNote}${writeOffNote}`);
    showPostingWarnings(result.data.warnings);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPaymentKey(newUuid());
          setFee("");
          setFeeDirty(false);
          setWhType("pph23");
          setWhRate("");
          setWhAmount("");
          setWhAmountDirty(false);
          setSettleChoice("open");
          setWriteOffReason("");
          setOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium transition-colors hover:bg-muted"
      >
        {isReceivable ? <CreditCard className="size-3" /> : <Banknote className="size-3" />}
        {isReceivable ? "Terima" : "Bayar"}
      </button>

      {open ? (
        <Modal
          title={`${isReceivable ? "Penerimaan piutang" : "Pembayaran utang"}${isOpening ? " (saldo awal)" : isExpense ? " (beban terutang)" : ""} · ${number}`}
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Simpan pembayaran"
          busyLabel="Memproses…"
        >
            <p className="mt-0.5 text-[11px] text-muted-foreground">Sisa tagihan {formatIDR(outstanding)}.</p>
            {!selectedCredit && excessAmount ? (
              <p className="mt-0.5 text-[11px] font-medium text-tone-amber">
                Kelebihan {formatIDR(excessAmount.toNumber())} menjadi kredit {isReceivable ? "pelanggan" : "pemasok"} (uang muka) yang dapat dipakai untuk dokumen berikutnya.
              </p>
            ) : null}
            {selectedCredit ? (
              <p className="mt-0.5 text-[11px] font-medium text-tone-teal">
                Memakai kredit {selectedCredit.number} — sisa kredit {formatIDR(selectedCredit.remaining)}. Pembayaran ini tanpa jurnal kas.
              </p>
            ) : null}
            {/* A-22 K4 (Pola 5): banner kredit tersedia — kredit pihak
                ditawarkan MENONJOL di dialog dokumen berikutnya (ala
                banner biru Odoo), bukan hanya sebagai opsi redup di
                pemilih Sumber dana. Tombolnya memakai jalur sumber
                kredit yang sudah ada (memilih kredit terbesar & menjepit
                nominal ke batas sahnya). */}
            {credits.length > 0 && !selectedCredit ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-tone-teal/40 bg-tone-teal-soft px-2.5 py-2">
                <p className="min-w-0 flex-1 text-[11px] leading-4">
                  <span className="font-semibold">Kredit tersedia untuk pihak ini:</span>{" "}
                  {credits.length} dokumen · total sisa {formatIDR(totalCreditRemaining)}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const best = [...credits].sort((a, b) => b.remaining - a.remaining)[0];
                    if (!best) return;
                    setFunding(best.id);
                    if (amountDecimal.gt(Math.min(outstanding, best.remaining))) {
                      setAmount(String(Math.min(outstanding, best.remaining)));
                    }
                  }}
                  className="h-8 shrink-0 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Pakai kredit
                </button>
              </div>
            ) : null}
            <div className="mt-3 space-y-2">
              <label className="block space-y-1">
                <span className={labelClass}>Nominal</span>
                <MoneyInput
                  value={amount}
                  onChange={setAmount}
                  onValidityChange={setAmountValid}
                  aria-label="Nominal pembayaran"
                  className="h-9 text-[12px]"
                />
              </label>
              {/* A-22 K4 (Pola 5): pembayaran parsial memaksa keputusan
                  eksplisit atas sisa — ala Payment Difference Odoo
                  (Keep open vs Mark as fully paid). "Tandai lunas"
                  hanya DITAWARKAN bila jalur write-off A-21 sah untuk
                  sisa ini; bila tidak, tampil alasannya (bukan opsi
                  mati). Keputusan dieksekusi submit() sesudah
                  pembayaran tercatat. */}
              {settlement.kind === "partial" ? (
                <div className="space-y-1.5 rounded-md border border-border p-2">
                  <span className={labelClass}>
                    Penyelesaian sisa {formatIDR(settlement.remainder.toNumber())}
                  </span>
                  <div className="grid gap-1.5">
                    <button
                      type="button"
                      aria-pressed={settleChoice === "open"}
                      onClick={() => setSettleChoice("open")}
                      className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
                        settleChoice === "open"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <span className="block text-[12px] font-semibold">Biarkan terbuka</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                        Sisa tetap {isReceivable ? "menjadi piutang pelanggan" : "menjadi utang ke pemasok"} dan
                        dapat dilunasi pada pembayaran berikutnya.
                      </span>
                    </button>
                    {settlement.writeOffEligible ? (
                      <button
                        type="button"
                        aria-pressed={settleChoice === "writeoff"}
                        onClick={() => setSettleChoice("writeoff")}
                        className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
                          settleChoice === "writeoff"
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <span className="block text-[12px] font-semibold">Tandai lunas — tutup sisa sebagai write-off</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                          Sisa {formatIDR(settlement.remainder.toNumber())} ditutup sesudah pembayaran ini
                          tercatat{kind === "payable" || kind === "opening-payable" || kind === "expense-payable" ? " sebagai pendapatan lain-lain" : " sebagai beban piutang tak tertagih"}.
                        </span>
                      </button>
                    ) : null}
                  </div>
                  {settlement.writeOffEligible && settleChoice === "writeoff" ? (
                    <label className="block space-y-1">
                      <span className={labelClass}>Alasan write-off (wajib)</span>
                      <input
                        value={writeOffReason}
                        onChange={(event) => setWriteOffReason(event.target.value)}
                        className={fieldClass}
                        placeholder="Tercatat di dokumen penutup sisa"
                        aria-label="Alasan write-off sisa"
                      />
                    </label>
                  ) : null}
                  {!settlement.writeOffEligible && settlement.writeOffBlockedReason ? (
                    <p className="text-[11px] leading-4 text-muted-foreground">{settlement.writeOffBlockedReason}</p>
                  ) : null}
                </div>
              ) : null}
              {credits.length > 0 ? (
                <label className="block space-y-1">
                  <span className={labelClass}>Sumber dana</span>
                  <select
                    value={funding}
                    onChange={(event) => setFunding(event.target.value)}
                    className={fieldClass}
                    aria-label="Sumber dana pembayaran"
                  >
                    <option value="cash">{isReceivable ? "Kas / bank (penerimaan baru)" : "Kas / bank"}</option>
                    {credits.map((credit) => (
                      <option key={credit.id} value={credit.id}>
                        Kredit {credit.number} {credit.originLabel ? `(${credit.originLabel})` : ""} — sisa {formatIDR(credit.remaining)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!selectedCredit ? (
                <label className="block space-y-1">
                  {/* A-22 K4 (UX-09 audit): label mengikuti arah uang —
                      piutang "Masuk ke", utang/beban "Bayar dari". */}
                  <span className={labelClass}>{paymentAccountLabel(kind)}</span>
                  <AccountCombobox
                    accounts={comboboxAccounts}
                    value={accountId}
                    onChange={setAccountId}
                    aria-label="Akun kas atau bank pembayaran"
                  />
                </label>
              ) : null}
              {feeActive ? (
                <label className="block space-y-1">
                  <span className={labelClass}>
                    Biaya (fee/MDR) — tarif metode{" "}
                    {selectedAccount!.feeType === "percent" ? `${selectedAccount!.feeValue}%` : formatIDR(selectedAccount!.feeValue ?? 0)}
                  </span>
                  <MoneyInput
                    value={feeValue}
                    onChange={(value) => {
                      setFee(value);
                      setFeeDirty(true);
                    }}
                    aria-label="Biaya fee pembayaran"
                    className="h-9 text-[12px]"
                  />
                  <span className="block text-[11px] text-muted-foreground">
                    {isReceivable
                      ? `Yang masuk akun: ${formatIDR(amountDecimal.minus(feeDecimal).toNumber())} (neto sesudah fee). Hak pelanggan tetap ${formatIDR(amountDecimal.toNumber())}.`
                      : `Total keluar akun: ${formatIDR(amountDecimal.plus(feeDecimal).toNumber())} (nominal + fee). Pemasok menerima ${formatIDR(amountDecimal.toNumber())} penuh.`}
                  </span>
                </label>
              ) : null}
              {withholdingVisible ? (
                <div className="space-y-2 rounded-md border border-border p-2">
                  <span className={labelClass}>Potongan pajak (withholding)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className={labelClass}>Jenis</span>
                      <select
                        value={whType}
                        onChange={(event) => setWhType(event.target.value)}
                        className={fieldClass}
                        aria-label="Jenis potongan pajak"
                      >
                        <option value="pph23">PPh 23</option>
                        <option value="pph42">PPh 4(2)</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className={labelClass}>Tarif (%)</span>
                      {/* Validasi 3 (F-02): PercentInput bersama menggantikan
                          input mentah — nilai kanonis desimal yang sama
                          untuk perhitungan d(whRate) di bawah. */}
                      <PercentInput
                        value={whRate}
                        onChange={setWhRate}
                        placeholder="Opsional"
                        aria-label="Tarif potongan pajak"
                        className="h-9 text-[12px]"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className={labelClass}>Nominal potongan</span>
                    <MoneyInput
                      value={whAmountValue}
                      onChange={(value) => {
                        setWhAmount(value);
                        setWhAmountDirty(true);
                      }}
                      aria-label="Nominal potongan pajak"
                      className="h-9 text-[12px]"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      {whDecimal.gt(0)
                        ? `Kas yang keluar: ${formatIDR(amountDecimal.plus(feeDecimal).minus(whDecimal).toNumber())} (nominal + fee − potongan). Utang berkurang sebesar nominal penuh; potongan menjadi utang PPh yang disetor terpisah.`
                        : `Kosongkan bila pembayaran ini tidak dipotong pajak. ${WITHHOLDING_CORE_NOTE}`}
                    </span>
                  </label>
                </div>
              ) : null}
              <label className="block space-y-1">
                <span className={labelClass}>Tanggal pembayaran</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal pembayaran" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Referensi / no. bukti</span>
                <input value={reference} onChange={(event) => setReference(event.target.value)} className={fieldClass} placeholder="Opsional — mis. no. transfer/VA" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Catatan</span>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="Opsional" />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * A-21 Tahap R3-A (R3-07): tombol "Write-off sisa" pada dokumen
 * piutang/utang. Hanya dirender halaman bila ambang perusahaan > 0
 * dan sisa dokumen tidak melebihi ambang; izin `accounting.manage`
 * dan seluruh penjaga ditegakkan ulang di aksi & domain. Alasan wajib
 * diminta lewat dialog bersama (G1/FRM-02) — pola yang sama seperti
 * tombol Batalkan. Hasilnya baris pembayaran beralasan yang dapat
 * dibatalkan lewat tombol Batalkan biasa di riwayat.
 */
export function WriteOffButton({
  kind,
  id,
  number,
  outstanding,
  open: controlledOpen,
  onOpenChange,
}: {
  kind: "receivable" | "payable" | "expense-payable" | "opening";
  id: string;
  number: string;
  outstanding: number;
  /**
   * G3 (UX4-01): mode terkendali — pemicu dipegang pemanggil (menu
   * baris ⋯ daftar piutang/utang); tanpa props ini tombol merender
   * pemicunya sendiri seperti sebelumnya.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  async function run(reason: string) {
    setBusy(true);
    const result =
      kind === "receivable"
        ? await writeOffReceivableAction({ saleId: id, reason })
        : kind === "payable"
          ? await writeOffPayableAction({ receiptId: id, reason })
          : kind === "expense-payable"
            ? await writeOffExpensePayableAction({ expenseId: id, reason })
            : await writeOffOpeningBalanceAction({ openingId: id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    showPostingWarnings(result.data.warnings);
    toast.success(`Sisa ${number} ditutup sebagai write-off (${result.data.number}).`);
    router.refresh();
  }

  return (
    <>
      {onOpenChange ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="inline-flex h-8 items-center rounded border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="Tutup sisa sebagai write-off (berizin, wajib alasan)"
        >
          {busy ? "…" : "Write-off sisa"}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Tutup sisa ${number} sebagai write-off?`}
        description={`Sisa sebesar ${formatIDR(outstanding)} pada dokumen ${number} akan ditutup sebagai write-off. Alasan tercatat di dokumen.`}
        confirmLabel="Tulis-off sisa"
        danger
        busy={busy}
        reason={{ label: "Alasan write-off", minLength: 3 }}
        onConfirm={(reason) => void run(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export function PartyPaymentVoidButton({
  paymentId,
  number,
  kind,
  opening = false,
  asMenu = false,
}: {
  paymentId: string;
  number: string;
  kind: "receivable" | "payable";
  /** T4-5b: pembayaran milik dokumen saldo awal memakai action saldo awal. */
  opening?: boolean;
  /**
   * G3 (UX4-01): tampil sebagai menu ⋯ berisi satu item destruktif —
   * dipakai daftar riwayat pembayaran agar tidak ada tombol
   * "Batalkan" permanen per baris.
   */
  asMenu?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const label = kind === "receivable" ? "penerimaan piutang" : "pembayaran utang";

  async function remove(reason: string) {
    setBusy(true);
    const result = opening
      ? await voidOpeningPaymentAction({ paymentId, reason })
      : kind === "receivable"
        ? await voidReceivablePaymentAction({ paymentId, reason })
        : await voidPayablePaymentAction({ paymentId, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Pembayaran dibatalkan dan jurnal pembalik dibuat.");
    router.refresh();
  }

  return (
    <>
      {asMenu ? (
        <RowMenu
          label={`Aksi untuk pembayaran ${number}`}
          items={[{ key: "void", label: "Batalkan pembayaran", danger: true, disabled: busy }]}
          onAction={(key) => {
            if (key === "void") setOpen(true);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {busy ? "…" : "Batalkan"}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Batalkan ${label} ${number}?`}
        description="Jurnal pembalik akan dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan pembayaran"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

