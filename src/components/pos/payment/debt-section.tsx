/**
 * A-26 Q7 (K-07): pecahan `payment-panel.tsx` per bagian panel
 * pembayaran. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya (pola ARS2-01).
 */
"use client";

import type { Dispatch, SetStateAction } from "react";
import { Search, UserPlus } from "lucide-react";
import { formatIDR } from "@/lib/money";
import type { CustomerOption } from "@/components/pos/terminal-types";
import { DateField } from "@/components/date-field";

            {/* POS-1 (D-19): bagian utang — pelanggan wajib ditangkap
                (pilih dari daftar atau tambah cepat) dan jatuh tempo
                wajib ada agar piutang tercatat & tertagih benar. */}
export function DebtSection(props: {
  debtMethod: { id: string; name: string } | null;
  debtActive: boolean;
  debtAmount: number;
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
}) {
  const { debtMethod, debtActive, debtAmount, customer, setCustomer, customerQuery, setCustomerQuery, customerResults, customerSearching, quickAddOpen, setQuickAddOpen, quickName, setQuickName, quickPhone, setQuickPhone, quickBusy, quickAddCustomer, dueDate, setDueDate } = props;
  if (!debtMethod || !debtActive) return null;
  return (
              <div className="space-y-3 rounded-md border border-tone-amber/50 bg-tone-amber-soft/50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-tone-amber">
                    Penjualan utang · <span className="num">{formatIDR(debtAmount)}</span>
                  </p>
                  <span className="text-xs text-muted-foreground">{debtMethod.name}</span>
                </div>

                {customer ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold">{customer.name}</span>
                      {customer.phone ? (
                        <span className="num text-muted-foreground"> · {customer.phone}</span>
                      ) : null}
                      {customer.creditLimit > 0 ? (
                        <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                          Plafon {formatIDR(customer.creditLimit)}
                          {(customer.currentDebt ?? 0) > 0 ? (
                            <> · Utang berjalan: <span className="num font-semibold text-destructive">{formatIDR(customer.currentDebt ?? 0)}</span></>
                          ) : null}
                          {" "}· Sisa limit: <span className="num font-semibold text-foreground">{formatIDR(customer.remainingCredit ?? (customer.creditLimit - (customer.currentDebt ?? 0)))}</span>
                        </span>
                      ) : customer.creditLimitUnlimited === false ? (
                        <span className="mt-1 block text-xs font-medium leading-4 text-destructive">
                          Kredit tidak diizinkan untuk pelanggan ini. Atur limit di master pelanggan
                          bila supervisor menyetujui.
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCustomer(null)}
                      className="min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Ganti
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={customerQuery}
                        onChange={(event) => setCustomerQuery(event.target.value)}
                        placeholder="Cari pelanggan (nama / telepon)…"
                        aria-label="Cari pelanggan untuk penjualan utang"
                        className="h-12 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      />
                    </div>
                    {customerSearching ? (
                      <p className="text-sm text-muted-foreground">Mencari pelanggan…</p>
                    ) : customerResults.length > 0 ? (
                      <ul className="divide-y divide-border/70 rounded-md border border-border bg-background">
                        {customerResults.map((option) => (
                          <li key={option.id}>
                            <button
                              type="button"
                              onClick={() => setCustomer(option)}
                              className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="min-w-0 truncate">
                                {option.name}
                                {option.phone ? (
                                  <span className="num text-muted-foreground"> · {option.phone}</span>
                                ) : null}
                              </span>
                              {option.creditLimit > 0 ? (
                                <span className="num shrink-0 text-xs text-muted-foreground">
                                  Limit {formatIDR(option.creditLimit)}
                                  {(option.currentDebt ?? 0) > 0 ? ` (sisa ${formatIDR(option.remainingCredit ?? (option.creditLimit - (option.currentDebt ?? 0)))})` : ""}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Pelanggan tidak ditemukan — tambah cepat di bawah.
                      </p>
                    )}
                    {quickAddOpen ? (
                      <div className="space-y-2 rounded-md border border-dashed border-border bg-background p-3">
                        <input
                          value={quickName}
                          onChange={(event) => setQuickName(event.target.value)}
                          placeholder="Nama pelanggan (wajib)"
                          aria-label="Nama pelanggan baru"
                          autoFocus
                          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={quickPhone}
                            onChange={(event) => setQuickPhone(event.target.value)}
                            placeholder="Telepon (opsional)"
                            aria-label="Telepon pelanggan baru"
                            inputMode="tel"
                            className="num col-span-2 h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                          />
                          <button
                            type="button"
                            onClick={quickAddCustomer}
                            disabled={quickBusy}
                            className="h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          >
                            {quickBusy ? "Menyimpan…" : "Simpan & pilih"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuickAddOpen(false)}
                            className="h-11 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setQuickAddOpen(true)}
                        className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold text-tone-amber hover:bg-tone-amber-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <UserPlus className="size-3.5" /> Tambah pelanggan cepat
                      </button>
                    )}
                  </div>
                )}

                <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">Tanggal jatuh tempo</span>
                  <DateField
                    value={dueDate}
                    onChange={setDueDate}
                    aria-label="Tanggal jatuh tempo utang"
                    className="w-[150px]"
                  />
                </label>
              </div>
  );
}
