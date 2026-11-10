"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A-25 U5 — AttendanceTools: wadah tab untuk perkakas kelola
 * Absensi & Shift (AUDIT-UI-A25 POLA-01 / halaman terburuk #4:
 * lima fungsi form terbuka sekaligus tenggelamkan rekap).
 * Halaman menaruh rekap & catatan harian sebagai isi utama; empat
 * form kelola (catat manual, penugasan shift, master shift, impor
 * CSV) hidup di sini — satu tampil pada satu waktu, berpindah
 * lewat tab yang jelas di atas kartunya. Isi tiap tab adalah
 * komponen form yang SUDAH ada, diteruskan sebagai children dari
 * server (komposisi server→client standar).
 */
export function AttendanceTools({
  tabs,
}: {
  tabs: Array<{ key: string; label: string; content: React.ReactNode }>;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];
  if (!current) return null;
  return (
    <section className="mt-4">
      <div className="mb-3 flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Kelola absensi & shift">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === current.key}
            onClick={() => setActive(tab.key)}
            className={cn(
              "px-3 py-2 text-[12px] transition-colors",
              tab.key === current.key
                ? "border-b-2 border-primary font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current.content}</div>
    </section>
  );
}
