/**
 * A-26 Q7 (K-07): pecahan `quick-entry-modal.tsx` per bagian form
 * Catat Transaksi. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya.
 */
"use client";

import { QUICK_ENTRY_KIND_LABELS, type QuickEntryKind } from "@/lib/quick-entry";
import { KIND_TABS, type FormState } from "./form-state";

/** Tab jenis transaksi di kepala form. */
export function KindTabs(props: {
  form: FormState;
  switchKind: (kind: QuickEntryKind) => void;
}) {
  const { form, switchKind } = props;
  return (
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5" role="tablist" aria-label="Jenis transaksi">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={form.kind === tab.kind}
            onClick={() => switchKind(tab.kind)}
            className={`flex flex-col items-start gap-1.5 rounded-md border px-2.5 py-2 text-left text-[11px] font-medium ${
              form.kind === tab.kind
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card transition-colors hover:bg-muted"
            }`}
          >
            <tab.icon className="size-4" />
            {QUICK_ENTRY_KIND_LABELS[tab.kind]}
          </button>
        ))}
      </div>
  );
}
