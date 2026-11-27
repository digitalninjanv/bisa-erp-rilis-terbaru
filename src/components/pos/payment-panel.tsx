"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  Banknote,
  Check,
  CreditCard,
  Landmark,
  MoreHorizontal,
  PauseCircle,
  QrCode,
  Split,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/money";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { receiptHref } from "@/lib/pos/receipt-links";
import { MoneyInput } from "@/components/money-input";
import { paymentMethodTypeLabel } from "@/lib/format";
import type { QuoteResultPublic } from "@/server/pos";
import type { CartItem, CustomerOption, Method, PaymentEntry } from "@/components/pos/terminal-types";
import type { ReturnCreditApi } from "@/components/pos/use-return-credit";
import { CashChips, ChangeBreakdown } from "./payment/cash-chips";
import { FeeEntryField, methodFeeEligible } from "./payment/fee-field";
import { MixedEntries } from "./payment/mixed-entries";
import { ReturnCreditSection } from "./payment/credit-section";
import { DebtSection } from "./payment/debt-section";

// A-26 Q7 (K-07): fee, chip tunai, baris campuran, kredit retur &
// bagian utang dipecah ke folder payment/; berkas ini orkestrator
// panel (kepala, mode Tunggal, alasan Bayar, tombol Bayar/Tahan).
export { configuredFeeValue, methodFeeEligible } from "./payment/fee-field";

// FIX-POS Tahap 4 (POS2-23): nada metode memakai token bersama
// --tone-* (nilai identik dengan hex lokal lama untuk cash/qris/
// credit) — bukan peta warna mentah per berkas lagi.
const methodTone: Record<string, string> = {
  cash: "bg-tone-teal-soft text-tone-teal",
  qris: "bg-tone-plum-soft text-tone-plum",
  bank: "bg-tone-blue-soft text-tone-blue",
  credit: "bg-tone-amber-soft text-tone-amber",
};

// Warna isi tombol metode aktif; semuanya lolos 4.5:1 dengan teks putih.
const methodActiveTone: Record<string, string> = {
  cash: "border-[var(--pos-action)] bg-[var(--pos-action)] text-[var(--pos-action-fg)]",
  qris: "border-violet-800 bg-violet-700 text-white",
  bank: "border-blue-800 bg-blue-700 text-white",
  credit: "border-amber-800 bg-amber-700 text-white",
};

function MethodIcon({ type, className }: { type: string | null | undefined; className?: string }) {
  const Icon =
    type === "cash"
      ? Banknote
      : type === "qris"
        ? QrCode
        : type === "bank"
          ? Landmark
          : type === "credit"
            ? Wallet
            : CreditCard;
  return <Icon aria-hidden="true" className={className} />;
}

// FIX-ARS Tahap 5 (ARS2-01): panel pembayaran — kartu pembayaran
// (tunggal/campuran, konfirmasi non-tunai & referensi, kredit retur,
// panel utang, status quote, Bayar/Tahan); JSX dipindah apa adanya
// dari PosTerminal, seluruh keadaan diterima sebagai props bertipe.
export function PaymentPanel(props: {
  companyName: string;
  tenderedInputId?: string;
  mode: "single" | "mixed";
  setMode: Dispatch<SetStateAction<"single" | "mixed">>;
  methods: Method[];
  single: Method | undefined;
  singleMethod: string;
  setSingleMethod: Dispatch<SetStateAction<string>>;
  entries: Record<string, PaymentEntry>;
  setEntries: Dispatch<SetStateAction<Record<string, PaymentEntry>>>;
  total: number;
  change: number;
  /** Total kekurangan uang tunai yang benar-benar diserahkan (0 = aman). */
  cashShortfall?: number;
  isCreditSingle: boolean;
  debtMethod: { id: string; name: string } | null;
  debtActive: boolean;
  debtAmount: number;
  qrisImage: string | null;
  nonCashNeedsConfirm: boolean;
  nonCashConfirmed: boolean;
  setNonCashConfirmedFor: Dispatch<SetStateAction<{ methodId: string; total: number } | null>>;
  creditMethod: { id: string; name: string } | null;
  credit: ReturnCreditApi;
  customer: CustomerOption | null;
  setCustomer: Dispatch<SetStateAction<CustomerOption | null>>;
  customerQuery: string;
  setCustomerQuery: Dispatch<SetStateAction<string>>;
  customerResults: CustomerOption[];
  customerSearching: boolean;
  quickAddOpen: boolean;
  setQuickAddOpen: Dispatch<SetStateAction<boolean>>;
  quickName: string;
  setQuickName: Dispatch<SetStateAction<string>>;
  quickPhone: string;
  setQuickPhone: Dispatch<SetStateAction<string>>;
  quickBusy: boolean;
  quickAddCustomer: () => Promise<void>;
  dueDate: string;
  setDueDate: Dispatch<SetStateAction<string>>;
  outstanding: number;
  mixedPlan: { appliedTotal: number; changeTotal: number; overpaid: string[] };
  fillDebtRemainder: () => void;
  cart: CartItem[];
  serialIncomplete: boolean;
  quoteError: string | null;
  quote: QuoteResultPublic | null;
  setQuoteNonce: Dispatch<SetStateAction<number>>;
  payDisabled: boolean;
  payLabel: string;
  checkout: () => Promise<void>;
  setHoldOpen: Dispatch<SetStateAction<boolean>>;
  sessionOpen: boolean;
  lastSale: { id: string; number: string; receiptToken?: string } | null;
  canReprint?: boolean;
  onReopenLastSale?: () => void;
}) {
  const {
    tenderedInputId = "pos-tendered-input",
    mode,
    setMode,
    methods,
    single,
    singleMethod,
    setSingleMethod,
    entries,
    setEntries,
    total,
    change,
    cashShortfall = 0,
    isCreditSingle,
    debtMethod,
    debtActive,
    debtAmount,
    qrisImage,
    nonCashNeedsConfirm,
    nonCashConfirmed,
    setNonCashConfirmedFor,
    creditMethod,
    credit,
    customer,
    setCustomer,
    customerQuery,
    setCustomerQuery,
    customerResults,
    customerSearching,
    quickAddOpen,
    setQuickAddOpen,
    quickName,
    setQuickName,
    quickPhone,
    setQuickPhone,
    quickBusy,
    quickAddCustomer,
    dueDate,
    setDueDate,
    outstanding,
    mixedPlan,
    fillDebtRemainder,
    cart,
    serialIncomplete,
    quoteError,
    quote,
    setQuoteNonce,
    payDisabled,
    payLabel,
    checkout,
    setHoldOpen,
    sessionOpen,
    lastSale,
    canReprint = false,
    onReopenLastSale,
  } = props;
  const tenderedAmount = Number(entries[singleMethod]?.tendered ?? 0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const isDebtMethod = Boolean(debtMethod && singleMethod === debtMethod.id);
  const activeMethodName = isDebtMethod ? "Utang" : (single?.name ?? "Pilih metode");
  // Tunai dan QRIS adalah dua jalur tersibuk; metode lain (bank, utang)
  // tetap tersedia tetapi tidak memenuhi panel pada layar 1366/1536.
  const methodRank = (method: Method) =>
    method.type === "cash" ? 0 : method.type === "qris" ? 1 : 2;
  const orderedMethods = [...methods].sort((a, b) => methodRank(a) - methodRank(b));
  const quickMethods = orderedMethods.slice(0, 2);
  const extraMethods = orderedMethods.slice(2);
  const extraCount = extraMethods.length + (debtMethod ? 1 : 0);
  const hasOptions = mode === "single" || extraCount > 0 || Boolean(creditMethod);
  return (
      <>
        <div className="overflow-hidden rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] shadow-[var(--shadow-card)]">
          <div className="flex min-h-[56px] items-center justify-between gap-3 bg-[var(--pos-command)] px-4 py-2 text-[var(--pos-command-fg)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--pos-command-muted)]">
                Pembayaran
              </p>
              <p className="num text-[22px] font-extrabold leading-tight text-[var(--pos-gold-soft)]">
                {formatIDR(total)}
              </p>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOptionsOpen(true)}
                aria-expanded={optionsOpen}
                aria-haspopup="dialog"
                aria-label="Opsi pembayaran lain"
                title="Opsi pembayaran lain"
                disabled={!hasOptions}
                className="grid size-11 shrink-0 place-items-center rounded-md border border-white/20 bg-white/10 text-[var(--pos-command-fg)] transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MoreHorizontal className="size-5" />
              </button>
              <span className="max-w-[120px] truncate rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold text-[var(--pos-command-fg)]">
                {mode === "mixed" ? "Campuran" : activeMethodName}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 bg-[var(--pos-surface-alt)] p-2.5">
            {mode === "single" ? (
              <>
                <div role="group" aria-label="Metode pembayaran" className="grid grid-cols-2 gap-2">
                  {quickMethods.map((method) => {
                    const active = singleMethod === method.id;
                    const typeLabel = paymentMethodTypeLabel(method.type);
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => {
                          setSingleMethod(method.id);
                          setOptionsOpen(false);
                        }}
                        title={method.name}
                        aria-pressed={active}
                        className={cn(
                          "flex min-h-[52px] items-center gap-2.5 rounded-lg border-2 px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] focus-visible:ring-offset-2",
                          active
                            ? methodActiveTone[method.type] ?? methodActiveTone.cash
                            : "border-[var(--pos-border-strong)] bg-[var(--pos-panel)] text-[var(--pos-ink)] hover:border-[var(--pos-command)] hover:bg-[var(--pos-panel)]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-9 shrink-0 place-items-center rounded-md",
                            active
                              ? "bg-white/15 text-white"
                              : cn(methodTone[method.type] ?? "bg-[var(--pos-tray)] text-[var(--pos-muted)]"),
                          )}
                        >
                          <MethodIcon type={method.type} className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{method.name}</span>
                          {typeLabel.toLowerCase() !== method.name.toLowerCase() ? (
                            <span
                              className={cn(
                                "block truncate text-[11px] font-medium uppercase tracking-wide",
                                active ? "text-white" : "text-[var(--pos-muted)]",
                              )}
                            >
                              {typeLabel}
                            </span>
                          ) : null}
                        </span>
                        {active ? <Check aria-hidden="true" className="ml-auto size-4 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>

                {single?.type === "cash" ? (
                  <div className="space-y-2.5 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] p-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="space-y-1">
                        <span className="text-xs font-bold uppercase tracking-wide text-[var(--pos-muted)]">
                          Uang diterima
                        </span>
                        {/* A-28 UI-1 (UX-B04): Diterima memakai MoneyInput
                            bersama — tampil terformat id-ID saat ketik.
                            Nilai yang disimpan tetap string kanonik yang
                            dibaca Number(...) oleh rencana pembayaran &
                            checkout persis seperti angka mentah lama.
                            Id tetap menjadi target pintasan F4. */}
                        <MoneyInput
                          id={tenderedInputId}
                          aria-label="Uang diterima; kosongkan untuk uang pas"
                          value={entries[singleMethod]?.tendered ?? ""}
                          onChange={(canonical) =>
                            setEntries((current) => ({
                              ...current,
                              [singleMethod]: {
                                amount: String(total),
                                tendered: canonical,
                                reference: current[singleMethod]?.reference ?? "",
                              },
                            }))
                          }
                          placeholder="0"
                          className="h-14 border-2 border-[var(--pos-border-strong)] bg-[var(--pos-panel)] text-lg font-extrabold text-[var(--pos-ink)] placeholder:font-semibold placeholder:text-[var(--pos-muted)] focus:border-[var(--pos-action)]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-bold uppercase tracking-wide text-[var(--pos-muted)]">
                          Kembalian
                        </span>
                        <div
                          className={cn(
                            "num flex h-14 items-center justify-end rounded-md border-2 px-3 text-lg font-extrabold",
                            change < 0
                              ? "border-destructive/60 bg-tone-red-soft text-tone-red"
                              : "border-tone-green/50 bg-tone-green-soft text-[#065f46]",
                          )}
                        >
                          {change < 0 ? `−${formatIDR(Math.abs(change))}` : formatIDR(change)}
                        </div>
                      </label>
                    </div>
                    {/* POS-1: chip uang diterima cepat — mengisi kolom
                        Diterima; kembalian terhitung seperti biasa. */}
                    <CashChips
                      total={total}
                      tendered={tenderedAmount}
                      disabled={total <= 0}
                      onChange={(value) =>
                        setEntries((current) => ({
                          ...current,
                          [singleMethod]: {
                            amount: String(total),
                            tendered: value > 0 ? String(value) : "",
                            reference: current[singleMethod]?.reference ?? "",
                          },
                        }))
                      }
                    />
                    {tenderedAmount > 0 && tenderedAmount < total ? (
                      <p className="text-xs font-medium text-destructive">
                        Uang diterima kurang {formatIDR(total - tenderedAmount)}.
                      </p>
                    ) : null}
                    <ChangeBreakdown amount={change} />
                  </div>
                ) : null}

                {isCreditSingle ? (
                  <p className="rounded-md bg-tone-amber-soft px-3 py-2 text-sm leading-5 text-tone-amber">
                    Seluruh tagihan {formatIDR(total)} menjadi utang — lengkapi pelanggan &amp;
                    tanggal jatuh tempo pada bagian Utang di bawah.
                  </p>
                ) : null}

                {single?.type === "qris" ? (
                  <div className="rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] p-3">
                    {qrisImage ? (
                      <div className="mx-auto w-44 max-w-full overflow-hidden rounded-md border border-[var(--pos-border)] bg-white p-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrisImage} alt="QRIS toko" className="h-auto w-full" />
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-[var(--pos-muted)]">
                        <QrCode className="size-4" /> Gambar QRIS belum diunggah.
                        <a href="/app/pengaturan" className="font-semibold text-[var(--pos-action)] underline underline-offset-2">Atur</a>
                      </p>
                    )}
                    {single.instructions ? (
                      <p className="mt-2 text-center text-xs text-[var(--pos-muted)]">{single.instructions}</p>
                    ) : null}
                  </div>
                ) : null}

                {/* FIX-POS Tahap 4 (POS2-05): metode tunggal non-tunai
                    wajib melewati konfirmasi penerimaan eksplisit dan
                    menyediakan field referensi terstruktur. Panel tampil
                    sesudah blok QRIS agar kasir menampilkan kode lebih
                    dulu, baru mengonfirmasi. Referensi diteruskan apa
                    adanya ke checkout (kontrak domain sudah menyimpannya
                    per pembayaran dan nota mencetaknya — POS2-14);
                    jurnal tidak berubah. */}
                {nonCashNeedsConfirm ? (
                  <div className="space-y-2 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] p-3">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-1 text-sm leading-5">
                      <input
                        type="checkbox"
                        checked={nonCashConfirmed}
                        onChange={(event) =>
                          setNonCashConfirmedFor(
                            event.target.checked ? { methodId: singleMethod, total } : null,
                          )
                        }
                        className="mt-0.5 size-5 shrink-0 accent-tone-teal"
                      />
                      <span>
                        <span className="font-semibold">Pembayaran sudah diterima</span> — dana{" "}
                        {single?.name} terkonfirmasi masuk sebelum transaksi disimpan.
                      </span>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-bold uppercase tracking-wide text-[var(--pos-muted)]">
                        No. referensi / kode persetujuan (opsional)
                      </span>
                      <input
                        value={entries[singleMethod]?.reference ?? ""}
                        onChange={(event) =>
                          setEntries((current) => ({
                            ...current,
                            [singleMethod]: {
                              amount: current[singleMethod]?.amount ?? "",
                              tendered: current[singleMethod]?.tendered ?? "",
                              reference: event.target.value,
                              fee: current[singleMethod]?.fee,
                            },
                          }))
                        }
                        placeholder="Contoh: nomor referensi QRIS / persetujuan EDC"
                        aria-label={`Nomor referensi pembayaran ${single?.name ?? ""}`}
                        className="num h-11 w-full rounded-md border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-3 text-sm text-[var(--pos-ink)]"
                      />
                    </label>
                  </div>
                ) : null}

              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--pos-ink)]">
                    <Split className="size-4 text-[var(--pos-action)]" />
                    Pembayaran campuran
                  </span>
                  <button
                    type="button"
                    onClick={() => setMode("single")}
                    className="min-h-11 rounded-md px-2 text-xs font-semibold text-[var(--pos-action)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]"
                  >
                    Kembali ke tunggal
                  </button>
                </div>
                <div className="rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] p-3">
                  <MixedEntries
                    methods={methods}
                    entries={entries}
                    setEntries={setEntries}
                    total={total}
                    debtMethod={debtMethod}
                    fillDebtRemainder={fillDebtRemainder}
                    outstanding={outstanding}
                    change={change}
                    mixedPlan={mixedPlan}
                  />
                </div>
              </>
            )}

            {hasOptions ? (
              <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
                <DialogContent className="max-h-[85dvh] max-w-md overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Opsi pembayaran lain</DialogTitle>
                    <DialogDescription>
                      Metode lain, pembayaran campuran, kredit retur, dan biaya MDR.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    {extraCount > 0 ? (
                      <div>
                        <p className="text-xs font-semibold text-[var(--pos-ink)]">
                          Metode lain ({extraCount})
                        </p>
                        <div role="group" aria-label="Metode pembayaran lainnya" className="mt-1.5 grid grid-cols-2 gap-2">
                          {extraMethods.map((method) => (
                            <button
                              key={method.id}
                              type="button"
                              onClick={() => {
                                setSingleMethod(method.id);
                                setOptionsOpen(false);
                              }}
                              aria-pressed={singleMethod === method.id}
                              title={method.name}
                              className={cn(
                                "flex min-h-11 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]",
                                singleMethod === method.id
                                  ? methodActiveTone[method.type] ?? methodActiveTone.cash
                                  : "border-[var(--pos-border-strong)] bg-[var(--pos-panel)] text-[var(--pos-ink)] hover:bg-[var(--pos-tray)]",
                              )}
                            >
                              <span className="truncate">{method.name}</span>
                              <MethodIcon type={method.type} className="size-4 shrink-0" />
                            </button>
                          ))}
                          {debtMethod ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSingleMethod(debtMethod.id);
                                setOptionsOpen(false);
                              }}
                              aria-pressed={singleMethod === debtMethod.id}
                              title={debtMethod.name}
                              className={cn(
                                "flex min-h-11 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]",
                                singleMethod === debtMethod.id
                                  ? methodActiveTone.credit
                                  : "border-[var(--pos-border-strong)] bg-[var(--pos-panel)] text-[var(--pos-ink)] hover:bg-[var(--pos-tray)]",
                              )}
                            >
                              <span className="truncate">Utang <span className="text-[11px] uppercase tracking-wide opacity-80">Tempo</span></span>
                              <Wallet className="size-4 shrink-0" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {mode === "single" && methodFeeEligible(single) ? (
                      <div className="rounded-md border border-[var(--pos-border)] bg-[var(--pos-surface-alt)] p-2.5">
                        <p className="mb-1.5 text-xs font-semibold text-[var(--pos-ink)]">
                          Biaya MDR {single?.name}
                        </p>
                        <FeeEntryField
                          method={single!}
                          base={total}
                          entry={entries[singleMethod]}
                          onFee={(fee) =>
                            setEntries((current) => ({
                              ...current,
                              [singleMethod]: {
                                ...(current[singleMethod] ?? { amount: "", tendered: "", reference: "" }),
                                fee,
                              },
                            }))
                          }
                        />
                      </div>
                    ) : null}
                    {mode === "single" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("mixed");
                          setOptionsOpen(false);
                        }}
                        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--pos-border-strong)] px-3 text-xs font-semibold text-[var(--pos-muted)] transition-colors hover:border-[var(--pos-command)] hover:bg-[var(--pos-surface-alt)] hover:text-[var(--pos-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]"
                      >
                        <Split className="size-4" />
                        Bayar dengan beberapa metode
                      </button>
                    ) : null}
                    {credit.appliedCredit ? null : (
                      <ReturnCreditSection creditMethod={creditMethod} credit={credit} />
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}

            {credit.appliedCredit ? (
              <ReturnCreditSection creditMethod={creditMethod} credit={credit} />
            ) : null}

            <DebtSection
              debtMethod={debtMethod}
              debtActive={debtActive}
              debtAmount={debtAmount}
              customer={customer}
              setCustomer={setCustomer}
              customerQuery={customerQuery}
              setCustomerQuery={setCustomerQuery}
              customerResults={customerResults}
              customerSearching={customerSearching}
              quickAddOpen={quickAddOpen}
              setQuickAddOpen={setQuickAddOpen}
              quickName={quickName}
              setQuickName={setQuickName}
              quickPhone={quickPhone}
              setQuickPhone={setQuickPhone}
              quickBusy={quickBusy}
              quickAddCustomer={quickAddCustomer}
              dueDate={dueDate}
              setDueDate={setDueDate}
            />

            {/* FIX-POS Tahap 4 (POS2-01): alasan Bayar belum aktif
                tampil PERSISTEN menempel di panel pembayaran — bukan
                toast yang hilang. Kegagalan quote membawa jalannya
                sendiri untuk mencoba lagi. */}
            {cart.length > 0 && serialIncomplete ? (
              <p className="flex items-start gap-2 rounded-md bg-tone-amber-soft px-3 py-2 text-sm leading-5 text-tone-amber">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Ada produk bernomor seri yang belum lengkap — isi semua nomor seri pada baris
                  keranjang sebelum membayar.
                </span>
              </p>
            ) : cart.length > 0 && quoteError ? (
              <div className="flex items-start justify-between gap-2 rounded-md bg-tone-red-soft px-3 py-2 text-sm leading-5 text-tone-red">
                <span className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Perhitungan gagal: {quoteError}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setQuoteNonce((value) => value + 1)}
                  className="min-h-10 shrink-0 font-semibold underline underline-offset-2"
                >
                  Coba lagi
                </button>
              </div>
            ) : cashShortfall > 0.004 ? (
              <p className="flex items-start gap-2 rounded-md bg-tone-red-soft px-3 py-2 text-sm leading-5 text-tone-red">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Uang tunai yang diserahkan kurang{" "}
                  <span className="num font-semibold">{formatIDR(cashShortfall)}</span>. Lengkapi
                  nominal Diterima sebelum menekan Bayar.
                </span>
              </p>
            ) : nonCashNeedsConfirm && !nonCashConfirmed && quote ? (
              <p className="flex items-start gap-2 rounded-md bg-tone-amber-soft px-3 py-2 text-sm leading-5 text-tone-amber">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Centang “Pembayaran sudah diterima” pada panel {single?.name} agar tombol Bayar
                  aktif.
                </span>
              </p>
            ) : null}

            {!sessionOpen ? (
              <a
                href="/app/pos/sesi"
                className="flex min-h-11 items-center justify-center rounded-md bg-tone-amber-soft px-3 text-center text-sm font-medium text-tone-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Sesi kas belum dibuka · Buka sesi
              </a>
            ) : null}

            {lastSale && (canReprint || lastSale.receiptToken) ? (
              onReopenLastSale ? (
                <button
                  type="button"
                  onClick={onReopenLastSale}
                  className="flex min-h-11 w-full items-center justify-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Cetak / lihat nota {lastSale.number}
                </button>
              ) : (
                <a
                  href={receiptHref(lastSale.id, {
                    autoprint: true,
                    printToken: lastSale.receiptToken,
                    copy: !lastSale.receiptToken,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center justify-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Cetak / lihat nota {lastSale.number}
                </a>
              )
            ) : null}
          </div>
        </div>

        {/* Footer sengaja di luar kartu: sticky terhadap scrollport
            panel kanan, sehingga tombol Bayar tetap terlihat walau
            daftar baris atau detail pembayaran panjang. */}
        {/* Footer berada di bawah panel pembayaran tanpa menumpuk konten di atasnya */}
        <div className="sticky bottom-0 z-10 grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_-18px_rgb(28_25_23/0.45)]">
          <button
            type="button"
            onClick={checkout}
            disabled={payDisabled}
            className="flex h-14 items-center justify-center gap-2 rounded-md bg-[var(--pos-action)] text-base font-bold text-[var(--pos-action-fg)] shadow-sm transition-colors hover:bg-[var(--pos-action-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none disabled:opacity-100"
          >
            {payLabel}
          </button>
          <button
            type="button"
            onClick={() => setHoldOpen(true)}
            disabled={cart.length === 0}
            className="flex h-14 items-center justify-center gap-2 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-4 text-sm font-semibold text-[var(--pos-ink)] hover:bg-[var(--pos-tray)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-100 disabled:text-stone-500 disabled:opacity-100"
            title="Tahan pesanan"
          >
            <PauseCircle className="size-4" /> Tahan
          </button>
        </div>
      </>
  );
}
