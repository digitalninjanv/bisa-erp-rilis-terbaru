import type { Dispatch, SetStateAction } from "react";
import {
  AlertTriangle,
  PauseCircle,
  QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/money";
import { formatMoneyText } from "@/lib/money-input";
import { MoneyInput } from "@/components/money-input";
import { paymentMethodTypeLabel } from "@/lib/format";
import type { QuoteResultPublic } from "@/server/pos";
import type { CartItem, CustomerOption, Method, PaymentEntry } from "@/components/pos/terminal-types";
import type { ReturnCreditApi } from "@/components/pos/use-return-credit";
import { CashChips } from "./payment/cash-chips";
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

// FIX-ARS Tahap 5 (ARS2-01): panel pembayaran — kartu pembayaran
// (tunggal/campuran, konfirmasi non-tunai & referensi, kredit retur,
// panel utang, status quote, Bayar/Tahan); JSX dipindah apa adanya
// dari PosTerminal, seluruh keadaan diterima sebagai props bertipe.
export function PaymentPanel(props: {
  companyName: string;
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
  lastSale: { id: string; number: string } | null;
}) {
  const {
    companyName,
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
  } = props;
  return (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div>
              <h2 className="text-[13px] font-semibold">Pembayaran</h2>
              <p className="text-[10px] text-muted-foreground">{companyName}</p>
            </div>
            <div className="flex rounded-md border border-border p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={cn("rounded px-2 py-1", mode === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                Tunggal
              </button>
              <button
                type="button"
                onClick={() => setMode("mixed")}
                className={cn("rounded px-2 py-1", mode === "mixed" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                Campuran
              </button>
            </div>
          </div>

          <div className="space-y-2 p-3">
            {mode === "single" ? (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {methods.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setSingleMethod(method.id)}
                      className={cn(
                        "flex items-center justify-between gap-1 rounded-md border px-2 py-2 text-[12px] font-medium transition-colors",
                        singleMethod === method.id
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span>{method.name}</span>
                      {/* POS2-22/23: label tipe dari pemetaan Bahasa
                          Indonesia bersama (bukan teks mentah tipe),
                          ukuran mengikuti lantai label bersama 10px. */}
                      <span className={cn("rounded px-1 py-0.5 text-[10px] uppercase", methodTone[method.type] ?? "bg-muted")}>
                        {paymentMethodTypeLabel(method.type)}
                      </span>
                    </button>
                  ))}
                  {/* POS-1 (D-19): pilihan Utang — metode kredit tampil
                      khusus di sini, bukan di daftar metode lunas. */}
                  {debtMethod ? (
                    <button
                      type="button"
                      onClick={() => setSingleMethod(debtMethod.id)}
                      title={debtMethod.name}
                      className={cn(
                        "flex items-center justify-between gap-1 rounded-md border px-2 py-2 text-[12px] font-medium transition-colors",
                        singleMethod === debtMethod.id
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span>Utang</span>
                      <span className={cn("rounded px-1 py-0.5 text-[10px] uppercase", methodTone.credit)}>
                        tempo
                      </span>
                    </button>
                  ) : null}
                </div>

                {single?.type === "cash" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Diterima</span>
                      {/* A-28 UI-1 (UX-B04): Diterima memakai MoneyInput
                          bersama — tampil terformat id-ID saat ketik.
                          Nilai yang disimpan tetap string kanonik yang
                          dibaca Number(...) oleh rencana pembayaran &
                          checkout persis seperti angka mentah lama.
                          Id tetap menjadi target pintasan F4. */}
                      <MoneyInput
                        id="pos-tendered-input"
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
                        placeholder={formatMoneyText(String(total))}
                        className="text-sm font-semibold"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kembalian</span>
                      <div className="num flex h-9 items-center justify-end rounded-md bg-muted px-2 text-sm font-semibold text-tone-teal">
                        {formatIDR(change)}
                      </div>
                    </label>
                    {/* POS-1: chip uang diterima cepat — mengisi kolom
                        Diterima; kembalian terhitung seperti biasa. */}
                    <div className="col-span-2">
                      <CashChips
                        pasValue={total}
                        disabled={total <= 0}
                        onPick={(value) =>
                          setEntries((current) => ({
                            ...current,
                            [singleMethod]: {
                              amount: String(total),
                              tendered: String(value),
                              reference: current[singleMethod]?.reference ?? "",
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {isCreditSingle ? (
                  <p className="rounded-md bg-tone-amber-soft px-2 py-1.5 text-[11px] leading-4 text-tone-amber">
                    Seluruh tagihan {formatIDR(total)} menjadi utang — lengkapi pelanggan &amp;
                    tanggal jatuh tempo pada bagian Utang di bawah.
                  </p>
                ) : null}

                {single?.type === "qris" ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/40 p-2">
                    {qrisImage ? (
                      <div className="mx-auto w-40 overflow-hidden rounded bg-white p-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrisImage} alt="QRIS toko" className="h-auto w-full" />
                      </div>
                    ) : (
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <QrCode className="size-3.5" /> Gambar QRIS belum diunggah.
                        <a href="/app/pengaturan" className="underline">Atur</a>
                      </p>
                    )}
                    {single.instructions ? (
                      <p className="mt-1.5 text-center text-[10px] text-muted-foreground">{single.instructions}</p>
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
                  <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2">
                    <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-4">
                      <input
                        type="checkbox"
                        checked={nonCashConfirmed}
                        onChange={(event) =>
                          setNonCashConfirmedFor(
                            event.target.checked ? { methodId: singleMethod, total } : null,
                          )
                        }
                        className="mt-0.5 size-4 shrink-0 accent-tone-teal"
                      />
                      <span>
                        <span className="font-medium">Pembayaran sudah diterima</span> — dana{" "}
                        {single?.name} terkonfirmasi masuk sebelum transaksi disimpan.
                      </span>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                        className="num h-9 w-full rounded border border-input bg-background px-2 text-[12px]"
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
              <p className="flex items-start gap-1.5 rounded-md bg-tone-amber-soft px-2 py-1.5 text-[11px] leading-4 text-tone-amber">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Ada produk bernomor seri yang belum lengkap — isi semua nomor seri pada baris
                  keranjang sebelum membayar.
                </span>
              </p>
            ) : cart.length > 0 && quoteError ? (
              <div className="flex items-start justify-between gap-2 rounded-md bg-tone-red-soft px-2 py-1.5 text-[11px] leading-4 text-tone-red">
                <span className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Perhitungan gagal: {quoteError}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setQuoteNonce((value) => value + 1)}
                  className="shrink-0 font-semibold underline"
                >
                  Coba lagi
                </button>
              </div>
            ) : nonCashNeedsConfirm && !nonCashConfirmed && quote ? (
              <p className="flex items-start gap-1.5 rounded-md bg-tone-amber-soft px-2 py-1.5 text-[11px] leading-4 text-tone-amber">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Centang “Pembayaran sudah diterima” pada panel {single?.name} agar tombol Bayar
                  aktif.
                </span>
              </p>
            ) : null}

            <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
              <button
                type="button"
                onClick={checkout}
                disabled={payDisabled}
                className="flex h-11 items-center justify-center gap-2 rounded-md bg-tone-teal text-sm font-semibold text-white transition-colors hover:bg-tone-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {payLabel}
              </button>
              <button
                type="button"
                onClick={() => setHoldOpen(true)}
                disabled={cart.length === 0}
                className="flex h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-40"
                title="Tahan pesanan"
              >
                <PauseCircle className="size-4" /> Tahan
              </button>
            </div>

            {!sessionOpen ? (
              <a
                href="/app/pos/sesi"
                className="block rounded-md bg-tone-amber-soft px-2 py-1.5 text-center text-[11px] text-tone-amber"
              >
                Sesi kas belum dibuka — buka sesi untuk mulai menjual.
              </a>
            ) : null}

            {lastSale ? (
              <a
                href={`/app/pos/nota/${lastSale.id}?autoprint=1&salinan=1`}
                className="block text-center text-[11px] text-muted-foreground underline"
              >
                Cetak ulang {lastSale.number}
              </a>
            ) : null}
          </div>
        </div>
  );
}
