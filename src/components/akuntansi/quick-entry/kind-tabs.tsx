/**
 * A-26 Q7 (K-07): pecahan `quick-entry-modal.tsx` per bagian form
 * Catat Transaksi. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya.
 */
"use client";

import * as React from "react";
import { QUICK_ENTRY_KIND_LABELS, type QuickEntryKind } from "@/lib/quick-entry";
import { KIND_TABS, type FormState } from "./form-state";

/** Tab jenis transaksi di kepala form dengan navigasi keyboard WAI-ARIA (UI-006). */
export function KindTabs(props: {
  form: FormState;
  switchKind: (kind: QuickEntryKind) => void;
}) {
  const { form, switchKind } = props;

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let targetIndex = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      targetIndex = (currentIndex + 1) % KIND_TABS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      targetIndex = (currentIndex - 1 + KIND_TABS.length) % KIND_TABS.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = KIND_TABS.length - 1;
    }

    if (targetIndex >= 0) {
      event.preventDefault();
      const nextTab = KIND_TABS[targetIndex];
      if (nextTab) {
        switchKind(nextTab.kind);
        const parent = event.currentTarget.parentElement;
        if (parent) {
          const buttons = parent.querySelectorAll<HTMLButtonElement>('[role="tab"]');
          buttons[targetIndex]?.focus();
        }
      }
    }
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5" role="tablist" aria-label="Jenis transaksi">
      {KIND_TABS.map((tab, idx) => {
        const isSelected = form.kind === tab.kind;
        return (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => switchKind(tab.kind)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`flex flex-col items-start gap-1.5 rounded-md border px-2.5 py-2 text-left text-[11px] font-medium transition-colors ${
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            <tab.icon className="size-4" />
            {QUICK_ENTRY_KIND_LABELS[tab.kind]}
          </button>
        );
      })}
    </div>
  );
}
