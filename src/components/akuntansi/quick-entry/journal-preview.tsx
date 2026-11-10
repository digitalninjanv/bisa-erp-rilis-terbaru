/**
 * A-26 Q7 (K-07): pecahan `quick-entry-modal.tsx` per bagian form
 * Catat Transaksi. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya.
 */
"use client";

import { BalanceIndicator } from "@/components/akuntansi/balance-indicator";
import { d, formatIDR } from "@/lib/money";
import type { QuickEntryPreview } from "@/lib/quick-entry";
import type { FormState } from "./form-state";

/** Pratinjau jurnal otomatis + alokasi FIFO (rel kanan form). */
export function JournalPreview(props: {
  preview: QuickEntryPreview | null;
  form: FormState;
}) {
  const { preview, form } = props;
  return (
        <aside className="h-fit rounded-lg border border-border bg-muted/40 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pratinjau Jurnal
          </p>
          {preview && d(form.amount || "0").gt(0) ? (
            <>
              <table className="mt-2 w-full text-[11px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 font-medium">Akun</th>
                    <th className="py-1 text-right font-medium">Debit</th>
                    <th className="py-1 text-right font-medium">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line, index) => (
                    <tr key={index} className="border-t border-border/60">
                      <td className="py-1 pr-1">{line.label}</td>
                      <td className="num py-1 text-right">{d(line.debit).gt(0) ? formatIDR(line.debit) : "—"}</td>
                      <td className="num py-1 text-right">{d(line.credit).gt(0) ? formatIDR(line.credit) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1">Total</td>
                    <td className="num py-1 text-right">{formatIDR(preview.totalDebit)}</td>
                    <td className="num py-1 text-right">{formatIDR(preview.totalCredit)}</td>
                  </tr>
                </tbody>
              </table>
              <p className={`mt-1.5 text-[11px] font-medium ${preview.balanced ? "text-tone-green" : "text-destructive"}`}>
                <BalanceIndicator
                  balanced={preview.balanced}
                  difference={d(preview.totalDebit).minus(d(preview.totalCredit))}
                  variant="sentence"
                  suffix="jurnal dibuat otomatis saat Posting."
                />
              </p>
              {preview.allocations.length > 0 ? (
                <div className="mt-2 border-t border-border/60 pt-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Alokasi FIFO
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[11px]">
                    {preview.allocations.map((allocation, index) => (
                      <li key={index} className="flex justify-between gap-2">
                        <span className="num">{allocation.number ?? "Dokumen"}</span>
                        <span className="num">{formatIDR(allocation.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Isi jumlah untuk melihat jurnal yang akan dibuat. Jurnal dibuat otomatis — periksa akun sebelum
              memposting.
            </p>
          )}
        </aside>
  );
}
