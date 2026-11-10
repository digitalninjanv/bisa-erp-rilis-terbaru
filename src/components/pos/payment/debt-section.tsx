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
              <div className="space-y-2 rounded-md border border-tone-amber/50 bg-tone-amber-soft/50 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-tone-amber">
                    Penjualan utang · <span className="num">{formatIDR(debtAmount)}</span>
                  </p>
                  <span className="text-[10px] text-muted-foreground">{debtMethod.name}</span>
                </div>

                {customer ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5">
                    <span className="min-w-0 text-[12px]">
                      <span className="font-medium">{customer.name}</span>
                      {customer.phone ? (
                        <span className="num text-muted-foreground"> · {customer.phone}</span>
                      ) : null}
                      {customer.creditLimit > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          Batas kredit {formatIDR(customer.creditLimit)} — server menolak bila
                          piutang terbuka + penjualan ini melewatinya.
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCustomer(null)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      Ganti
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={customerQuery}
                        onChange={(event) => setCustomerQuery(event.target.value)}
                        placeholder="Cari pelanggan (nama / telepon)…"
                        aria-label="Cari pelanggan untuk penjualan utang"
                        className="h-9 w-full rounded border border-input bg-background pl-7 pr-2 text-[12px] outline-none focus:border-ring"
                      />
                    </div>
                    {customerSearching ? (
                      <p className="text-[11px] text-muted-foreground">Mencari pelanggan…</p>
                    ) : customerResults.length > 0 ? (
                      <ul className="divide-y divide-border/70 rounded-md border border-border bg-background">
                        {customerResults.map((option) => (
                          <li key={option.id}>
                            <button
                              type="button"
                              onClick={() => setCustomer(option)}
                              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-muted"
                            >
                              <span className="min-w-0 truncate">
                                {option.name}
                                {option.phone ? (
                                  <span className="num text-muted-foreground"> · {option.phone}</span>
                                ) : null}
                              </span>
                              {option.creditLimit > 0 ? (
                                <span className="num shrink-0 text-[10px] text-muted-foreground">
                                  Limit {formatIDR(option.creditLimit)}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Pelanggan tidak ditemukan — tambah cepat di bawah.
                      </p>
                    )}
                    {quickAddOpen ? (
                      <div className="space-y-1.5 rounded-md border border-dashed border-border bg-background p-2">
                        <input
                          value={quickName}
                          onChange={(event) => setQuickName(event.target.value)}
                          placeholder="Nama pelanggan (wajib)"
                          aria-label="Nama pelanggan baru"
                          autoFocus
                          className="h-9 w-full rounded border border-input bg-background px-2 text-[12px]"
                        />
                        <div className="flex gap-1.5">
                          <input
                            value={quickPhone}
                            onChange={(event) => setQuickPhone(event.target.value)}
                            placeholder="Telepon (opsional)"
                            aria-label="Telepon pelanggan baru"
                            inputMode="tel"
                            className="num h-9 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[12px]"
                          />
                          <button
                            type="button"
                            onClick={quickAddCustomer}
                            disabled={quickBusy}
                            className="h-8 shrink-0 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {quickBusy ? "Menyimpan…" : "Simpan & pilih"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuickAddOpen(false)}
                            className="h-8 shrink-0 rounded-md border border-border px-2 text-[12px] hover:bg-muted"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setQuickAddOpen(true)}
                        className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-tone-amber hover:bg-tone-amber-soft"
                      >
                        <UserPlus className="size-3.5" /> Tambah pelanggan cepat
                      </button>
                    )}
                  </div>
                )}

                <label className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium">Tanggal jatuh tempo</span>
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
