"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  CreditCard,
  PauseCircle,
  QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/money";
import { receiptHref } from "@/lib/pos/receipt-links";
import { formatMoneyText } from "@/lib/money-input";
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
  bank: "bg-tone-green-soft text-tone-green",
  credit: "bg-tone-amber-soft text-tone-amber",
};

/** Label pendek untuk tombol metode cepat; nama penuh tetap di title. */
function quickMethodLabel(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.length <= 9 ? first : `${first.slice(0, 8)}…`;
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
  // Default minimalis: hanya metode aktif (biasanya Tunai) yang tampil;
  // metode lain dibuka lewat tombol "Metode lain".
  const [methodsExpanded, setMethodsExpanded] = useState(false);
  const isDebtMethod = Boolean(debtMethod && singleMethod === debtMethod.id);
  const activeMethodName = isDebtMethod ? "Utang" : (single?.name ?? "Pilih metode");
  const activeMethodType = isDebtMethod ? "credit" : (single?.type ?? null);
  // Dua metode alternatif tercepat: kasir bisa pindah Tunai ↔ QRIS/Bank
  // tanpa membuka panel "Metode lain".
  const quickMethods = methods.filter((method) => method.id !== singleMethod).slice(0, 2);
  return (
      <>
        <div className="overflow-hidden rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] shadow-sm">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--pos-border-strong)] bg-[var(--pos-header)] px-3 py-2 text-[var(--pos-header-fg)]">
            <div>
              <h2 className="text-base font-bold text-slate-900">Pembayaran</h2>
            </div>
            <div role="group" className="flex shrink-0 rounded-lg border border-[var(--pos-border-strong)] bg-slate-200 p-0.5" aria-label="Mode pembayaran">
              <button
                type="button"
                onClick={() => setMode("single")}
                aria-pressed={mode === "single"}
                className={cn(
                  "min-h-10 rounded-md px-3 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === "single" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950",
                )}
              >
                Tunggal
              </button>
              <button
                type="button"
                onClick={() => setMode("mixed")}
                aria-pressed={mode === "mixed"}
                className={cn(
                  "min-h-10 rounded-md px-3 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === "mixed" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950",
                )}
              >
                Campuran
              </button>
            </div>
          </div>

          <div className="space-y-3 bg-[var(--pos-header)] p-3">
            {mode === "single" ? (
              <>
                {!methodsExpanded ? (
                  <div className="flex items-stretch gap-2">
                    <div
                      className={cn(
                        "flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border-2 px-3 py-2.5 text-sm font-bold",
                        activeMethodType
                          ? "border-[var(--pos-action)] bg-[var(--pos-action-soft)] text-[var(--pos-action-text)]"
                          : "border-[var(--pos-border-strong)] bg-background text-slate-700",
                      )}
                    >
                      <span className="truncate">{activeMethodName}</span>
                      {activeMethodType &&
                      paymentMethodTypeLabel(activeMethodType).toLowerCase() !==
                        activeMethodName.toLowerCase() ? (
                        <span
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[11px] uppercase",
                            methodTone[activeMethodType] ?? "bg-muted",
                          )}
                        >
                          {paymentMethodTypeLabel(activeMethodType)}
                        </span>
                      ) : null}
                    </div>
                    {quickMethods.map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => setSingleMethod(method.id)}
                        title={method.name}
                        aria-label={`Pilih ${method.name}`}
                        className="flex min-h-12 w-16 shrink-0 items-center justify-center rounded-md border border-input bg-background px-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{quickMethodLabel(method.name)}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setMethodsExpanded(true)}
                      aria-label="Metode pembayaran lain"
                      title="Metode pembayaran lain"
                      className="flex min-h-12 w-12 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <CreditCard className="size-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Pilih metode
                      </span>
                      <button
                        type="button"
                        onClick={() => setMethodsExpanded(false)}
                        className="min-h-9 rounded px-2 text-xs font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Tutup
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {methods.map((method) => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => {
                            setSingleMethod(method.id);
                            setMethodsExpanded(false);
                          }}
                          aria-pressed={singleMethod === method.id}
                          className={cn(
                            "flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            singleMethod === method.id
                              ? "border-[var(--pos-action)] bg-[var(--pos-action-soft)] text-foreground ring-1 ring-inset ring-[var(--pos-action)]"
                              : "border-[var(--pos-border-strong)] bg-background text-slate-700 hover:bg-slate-100",
                          )}
                        >
                          <span>{method.name}</span>
                          {/* POS2-22/23: label tipe dari pemetaan Bahasa
                              Indonesia bersama (bukan teks mentah tipe),
                              ukuran mengikuti lantai label bersama 10px.
                              Label yang sama dengan nama metode (Tunai,
                              QRIS) tidak diulang agar panel minimalis. */}
                          {paymentMethodTypeLabel(method.type).toLowerCase() !==
                          method.name.toLowerCase() ? (
                            <span className={cn("rounded px-1.5 py-0.5 text-[11px] uppercase", methodTone[method.type] ?? "bg-muted")}>
                              {paymentMethodTypeLabel(method.type)}
                            </span>
                          ) : null}
                        </button>
                      ))}
                      {/* POS-1 (D-19): pilihan Utang — metode kredit tampil
                          khusus di sini, bukan di daftar metode lunas. */}
                      {debtMethod ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSingleMethod(debtMethod.id);
                            setMethodsExpanded(false);
                          }}
                          aria-pressed={singleMethod === debtMethod.id}
                          title={debtMethod.name}
                          className={cn(
                            "flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            singleMethod === debtMethod.id
                              ? "border-[var(--pos-action)] bg-[var(--pos-action-soft)] text-foreground ring-1 ring-inset ring-[var(--pos-action)]"
                              : "border-[var(--pos-border-strong)] bg-background text-slate-700 hover:bg-slate-100",
                          )}
                        >
                          <span>Utang</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[11px] uppercase", methodTone.credit)}>
                            tempo
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
                {single?.type === "cash" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-foreground">Uang diterima</span>
                      {/* A-28 UI-1 (UX-B04): Diterima memakai MoneyInput
                          bersama — tampil terformat id-ID saat ketik.
                          Nilai yang disimpan tetap string kanonik yang
                          dibaca Number(...) oleh rencana pembayaran &
                          checkout persis seperti angka mentah lama.
                          Id tetap menjadi target pintasan F4. */}
                      <MoneyInput
                        id={tenderedInputId}
                        aria-label="Uang diterima"
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
                        placeholder={total > 0 ? `Pas: ${formatMoneyText(String(total))}` : "0"}
                        className="h-12 border border-[var(--pos-border-strong)] bg-white text-base font-bold text-slate-950 focus:border-[var(--pos-action)]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-foreground">Kembalian</span>
                      <div
                        className={cn(
                          "num flex h-12 items-center justify-end rounded-md border px-3 text-base font-extrabold",
                          change < 0
                            ? "border-destructive/60 bg-tone-red-soft text-tone-red"
                            : "border-tone-green/40 bg-tone-green-soft text-tone-green",
                        )}
                      >
                        {change < 0 ? `−${formatIDR(Math.abs(change))}` : formatIDR(change)}
                      </div>
                    </label>
                    {/* POS-1: chip uang diterima cepat — mengisi kolom
                        Diterima; kembalian terhitung seperti biasa. */}
                    <div className="col-span-2">
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
                        <p className="mt-2 text-xs font-medium text-destructive">
                          Uang diterima kurang {formatIDR(total - tenderedAmount)}.
                        </p>
                      ) : null}
                      <ChangeBreakdown amount={change} />
                    </div>
                  </div>
                ) : null}

                {isCreditSingle ? (
                  <p className="rounded-md bg-tone-amber-soft px-3 py-2 text-sm leading-5 text-tone-amber">
                    Seluruh tagihan {formatIDR(total)} menjadi utang — lengkapi pelanggan &amp;
                    tanggal jatuh tempo pada bagian Utang di bawah.
                  </p>
                ) : null}

                {single?.type === "qris" ? (
                  <div className="rounded-md border border-[var(--pos-border-strong)] bg-white p-3">
                    {qrisImage ? (
                      <div className="mx-auto w-48 max-w-full overflow-hidden rounded-md bg-white p-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrisImage} alt="QRIS toko" className="h-auto w-full" />
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <QrCode className="size-4" /> Gambar QRIS belum diunggah.
                        <a href="/app/pengaturan" className="font-semibold underline underline-offset-2">Atur</a>
                      </p>
                    )}
                    {single.instructions ? (
                      <p className="mt-2 text-center text-xs text-muted-foreground">{single.instructions}</p>
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
                  <div className="space-y-2 rounded-md border border-[var(--pos-border-strong)] bg-white p-2">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-1 py-2 text-sm leading-5">
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
                        <span className="font-medium">Pembayaran sudah diterima</span> — dana{" "}
                        {single?.name} terkonfirmasi masuk sebelum transaksi disimpan.
                      </span>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-semibold text-foreground">
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
                        className="num h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                      />
                    </label>
                  </div>
                ) : null}

                {/* A-21 Tahap R3-A (R3-01): fee metode tunggal —
                    nilai awal konfigurasi, dapat diubah kasir. */}
                {methodFeeEligible(single) ? (
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
                ) : null}

              </>
            ) : (
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
            )}

            <ReturnCreditSection creditMethod={creditMethod} credit={credit} />

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
        <div className="sticky bottom-0 z-10 grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-sm">
          <button
            type="button"
            onClick={checkout}
            disabled={payDisabled}
            className="flex h-12 items-center justify-center gap-2 rounded-md bg-[var(--pos-action)] text-[15px] font-bold text-[var(--pos-action-fg)] shadow-sm transition-colors hover:bg-[var(--pos-action-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-600 disabled:shadow-none disabled:opacity-100"
          >
            {payLabel}
          </button>
          <button
            type="button"
            onClick={() => setHoldOpen(true)}
            disabled={cart.length === 0}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-[var(--pos-border-strong)] bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100"
            title="Tahan pesanan"
          >
            <PauseCircle className="size-4" /> Tahan
          </button>
        </div>
      </>
  );
}
