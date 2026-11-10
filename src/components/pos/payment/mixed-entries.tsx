/**
 * A-26 Q7 (K-07): pecahan `payment-panel.tsx` per bagian panel
 * pembayaran. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya (pola ARS2-01).
 */
"use client";

import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/money";
import { MoneyInput } from "@/components/money-input";
import type { Method, PaymentEntry } from "@/components/pos/terminal-types";
import { CashChips } from "./cash-chips";
import { FeeEntryField, methodFeeEligible } from "./fee-field";

/** Mode Campuran: baris nominal per metode + baris Utang + sisa/kembalian. */
export function MixedEntries(props: {
  methods: Method[];
  entries: Record<string, PaymentEntry>;
  setEntries: Dispatch<SetStateAction<Record<string, PaymentEntry>>>;
  total: number;
  debtMethod: { id: string; name: string } | null;
  fillDebtRemainder: () => void;
  outstanding: number;
  change: number;
  mixedPlan: { appliedTotal: number; changeTotal: number; overpaid: string[] };
}) {
  const { methods, entries, setEntries, total, debtMethod, fillDebtRemainder, outstanding, change, mixedPlan } = props;
  return (
              <div className="space-y-1.5">
                {methods.map((method) => (
                  <div key={method.id} className="space-y-1">
                  <div className="grid grid-cols-[1fr_86px_74px] items-center gap-1.5">
                    <span className="truncate text-[11px]">{method.name}</span>
                    {/* A-28 UI-1 (UX-B04): nominal campuran memakai
                        MoneyInput bersama (terformat id-ID saat ketik).
                        Nilai tersimpan = string kanonik; semua pembaca
                        (rencana campuran, fee, checkout) memakai
                        Number(...) sehingga semantiknya identik dengan
                        angka mentah lama. */}
                    <MoneyInput
                      value={entries[method.id]?.amount ?? ""}
                      aria-label={`Nominal pembayaran ${method.name}`}
                      onChange={(canonical) =>
                        setEntries((current) => ({
                          ...current,
                          [method.id]: {
                            amount: canonical,
                            tendered: current[method.id]?.tendered ?? "",
                            reference: current[method.id]?.reference ?? "",
                            fee: current[method.id]?.fee,
                          },
                        }))
                      }
                      placeholder="0"
                      className="h-9 px-1.5 text-[11px]"
                    />
                    {method.type === "cash" ? (
                      <MoneyInput
                        value={entries[method.id]?.tendered ?? ""}
                        aria-label={`Uang diterima untuk ${method.name}`}
                        onChange={(canonical) =>
                          setEntries((current) => ({
                            ...current,
                            [method.id]: {
                              amount: current[method.id]?.amount ?? "",
                              tendered: canonical,
                              reference: current[method.id]?.reference ?? "",
                            },
                          }))
                        }
                        placeholder="Diterima"
                        className="h-9 px-1.5 text-[10px]"
                      />
                    ) : (
                      <span className="text-right text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                  {/* POS-1: chip uang diterima cepat untuk baris tunai
                      campuran — "Uang Pas" = pas sebesar nominal baris. */}
                  {method.type === "cash" ? (
                    <CashChips
                      pasValue={Number(entries[method.id]?.amount ?? 0)}
                      disabled={total <= 0}
                      onPick={(value) =>
                        setEntries((current) => ({
                          ...current,
                          [method.id]: {
                            amount: current[method.id]?.amount ?? "",
                            tendered: String(value),
                            reference: current[method.id]?.reference ?? "",
                          },
                        }))
                      }
                    />
                  ) : null}
                  {/* FIX-POS Tahap 4 (POS2-05): referensi terstruktur
                      untuk baris non-tunai campuran yang nominalnya
                      terisi — diteruskan ke checkout seperti mode
                      tunggal dan tercetak pada nota (POS2-14). */}
                  {method.type !== "cash" &&
                  method.type !== "credit" &&
                  Number(entries[method.id]?.amount ?? 0) > 0 ? (
                    <input
                      value={entries[method.id]?.reference ?? ""}
                      onChange={(event) =>
                        setEntries((current) => ({
                          ...current,
                          [method.id]: {
                            amount: current[method.id]?.amount ?? "",
                            tendered: current[method.id]?.tendered ?? "",
                            reference: event.target.value,
                            fee: current[method.id]?.fee,
                          },
                        }))
                      }
                      placeholder={`Referensi ${method.name} (opsional)`}
                      aria-label={`Referensi pembayaran ${method.name}`}
                      className="num h-9 w-full rounded border border-input bg-background px-2 text-[11px]"
                    />
                  ) : null}
                  {/* A-21 Tahap R3-A (R3-01): fee per baris metode campuran. */}
                  {methodFeeEligible(method) && Number(entries[method.id]?.amount ?? 0) > 0 ? (
                    <FeeEntryField
                      method={method}
                      base={Number(entries[method.id]?.amount ?? 0)}
                      entry={entries[method.id]}
                      onFee={(fee) =>
                        setEntries((current) => ({
                          ...current,
                          [method.id]: {
                            ...(current[method.id] ?? { amount: "", tendered: "", reference: "" }),
                            fee,
                          },
                        }))
                      }
                    />
                  ) : null}
                  </div>
                ))}
                {/* POS-1 (D-19): baris Utang campuran — nominal utang
                    adalah sisa tagihan; tombol Sisa mengisinya otomatis. */}
                {debtMethod ? (
                  <div className="grid grid-cols-[1fr_86px_74px] items-center gap-1.5">
                    <span className="truncate text-[11px]">
                      Utang <span className="text-muted-foreground">({debtMethod.name})</span>
                    </span>
                    <MoneyInput
                      value={entries[debtMethod.id]?.amount ?? ""}
                      aria-label="Nominal pembayaran Utang"
                      onChange={(canonical) =>
                        setEntries((current) => ({
                          ...current,
                          [debtMethod.id]: {
                            amount: canonical,
                            tendered: "",
                            reference: current[debtMethod.id]?.reference ?? "",
                          },
                        }))
                      }
                      placeholder="0"
                      className="h-9 px-1.5 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={fillDebtRemainder}
                      className="h-8 rounded-md border border-border px-1 text-[10px] font-medium hover:bg-muted"
                    >
                      Sisa tagihan
                    </button>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-border pt-1.5 text-[11px]">
                  <span className="text-muted-foreground">Sisa</span>
                  <span className={cn("num font-semibold", outstanding > 0 ? "text-destructive" : "text-tone-teal")}>
                    {formatIDR(outstanding)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Kembalian</span>
                  <span className="num font-semibold">{formatIDR(change)}</span>
                </div>
                {mixedPlan.overpaid.map((name) => (
                  <p
                    key={name}
                    className="flex items-start gap-1.5 rounded-md bg-tone-amber-soft px-2 py-1.5 text-[11px] leading-4 text-tone-amber"
                  >
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>
                      Pembayaran {name} melebihi sisa tagihan — kelebihan non-tunai tidak
                      dapat dikembalikan sebagai kembalian.
                    </span>
                  </p>
                ))}
              </div>
  );
}
