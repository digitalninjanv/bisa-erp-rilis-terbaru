/**
 * A-26 Q7 (K-07): pecahan `payment-panel.tsx` per bagian panel
 * pembayaran. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya (pola ARS2-01).
 */
"use client";

import { Wallet } from "lucide-react";
import { formatIDR } from "@/lib/money";
import type { ReturnCreditApi } from "@/components/pos/use-return-credit";

/** Bagian Pakai Kredit Retur (nota retur pelanggan sebagai pembayaran). */
export function ReturnCreditSection(props: {
  creditMethod: { id: string; name: string } | null;
  credit: ReturnCreditApi;
}) {
  const { creditMethod, credit } = props;
  const {
    appliedCredit,
    removeCredit,
    creditOpen,
    setCreditOpen,
    creditNumber,
    setCreditNumber,
    lookupCredit,
    creditBusy,
    creditInfo,
    creditAmount,
    setCreditAmount,
    applyCredit,
  } = credit;
  if (!creditMethod) return null;
  return (
              <div className="rounded-md border border-dashed border-border p-2">
                {appliedCredit ? (
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="min-w-0">
                      Kredit retur <span className="num font-medium">{appliedCredit.reference}</span>
                      {" · "}
                      <span className="num font-semibold">{formatIDR(Number(appliedCredit.amount))}</span>
                    </span>
                    <button
                      type="button"
                      onClick={removeCredit}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      Hapus
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setCreditOpen((value) => !value)}
                      className="flex w-full items-center justify-between text-[12px] font-medium"
                    >
                      <span className="flex items-center gap-1.5">
                        <Wallet className="size-3.5" /> Pakai Kredit Retur
                      </span>
                      <span className="text-[10px] text-muted-foreground">{creditOpen ? "Tutup" : "Buka"}</span>
                    </button>
                    {creditOpen ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex gap-1.5">
                          <input
                            value={creditNumber}
                            onChange={(event) => setCreditNumber(event.target.value)}
                            placeholder="Nomor retur, mis. RTN-2026-00001"
                            aria-label="Nomor dokumen retur untuk kredit pelanggan"
                            className="num h-9 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[12px]"
                          />
                          <button
                            type="button"
                            onClick={lookupCredit}
                            disabled={creditBusy}
                            className="h-8 shrink-0 rounded-md border border-border px-2.5 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
                          >
                            {creditBusy ? "Memeriksa…" : "Periksa"}
                          </button>
                        </div>
                        {creditInfo ? (
                          <>
                            <dl className="space-y-1 text-[11px]">
                              <div className="flex items-center justify-between">
                                <dt className="text-muted-foreground">Nota asal</dt>
                                <dd className="num font-medium">{creditInfo.saleNumber}</dd>
                              </div>
                              <div className="flex items-center justify-between">
                                <dt className="text-muted-foreground">Total kredit</dt>
                                <dd className="num">{formatIDR(creditInfo.total)}</dd>
                              </div>
                              <div className="flex items-center justify-between">
                                <dt className="text-muted-foreground">Sudah terpakai</dt>
                                <dd className="num">{formatIDR(creditInfo.used)}</dd>
                              </div>
                              <div className="flex items-center justify-between">
                                <dt className="text-muted-foreground">Sisa kredit</dt>
                                <dd className="num font-semibold">{formatIDR(creditInfo.available)}</dd>
                              </div>
                            </dl>
                            <div className="flex gap-1.5">
                              <input
                                value={creditAmount}
                                onChange={(event) => setCreditAmount(event.target.value)}
                                placeholder="Nominal dipakai"
                                aria-label="Nominal kredit retur yang dipakai"
                                inputMode="numeric"
                                className="num h-9 min-w-0 flex-1 rounded border border-input bg-background px-2 text-right text-[12px]"
                              />
                              <button
                                type="button"
                                onClick={applyCredit}
                                className="h-8 shrink-0 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                Gunakan
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
  );
}
