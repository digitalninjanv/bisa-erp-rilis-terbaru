"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Zap } from "lucide-react";
import { openQuickEntry } from "./quick-entry-trigger";
import {
  QUICK_INPUT_ITEMS,
  resolveQuickInputItem,
  type QuickInputVisibility,
} from "@/lib/quick-input";

export type { QuickInputVisibility } from "@/lib/quick-input";

/**
 * A-8.4 + A-12 + A-22 K4 (UX-06): satu tempat untuk semua pencatatan
 * harian akuntansi. Lima jenis transaksi harian membuka modal Catat
 * Transaksi (D-23); empat tugas halaman menavigasi ke halamannya dan
 * kini JUJUR soal itu — kartu tautan membawa penanda panah keluar +
 * teks "Membuka halaman {tujuan}", kartu modal tanpa penanda.
 * Definisi & keputusan render per peran hidup di lib/quick-input
 * (teruji unit); panel ini tidak menduplikasi formulir/domain apa pun.
 * Pengguna tanpa accounting.post (mis. kasir pos.sell) tetap mendapat
 * tautan halaman pembayaran seperti sebelumnya — ikut berpenanda.
 */
const itemClass =
  "flex items-start gap-2 rounded-md border border-border px-2.5 py-2 text-left hover:bg-muted";

export function QuickInputPanel(visibility: QuickInputVisibility) {
  // A-28 UI-5 (UX-A03): panel TERLIPAT bawaan — beranda Akuntansi
  // adalah permukaan terpadat sistem (audit U0 §3): antrean kerja &
  // KPI kini menjadi hierarki pertama, dan sembilan jalan pintas ini
  // tinggal satu baris kepala sampai pemilik membukanya. Tidak ada
  // jalan pintas yang dihapus; kartu di dalamnya juga dipadatkan.
  const [expanded, setExpanded] = useState(false);
  const rendered = QUICK_INPUT_ITEMS.map((item) => ({
    item,
    resolved: resolveQuickInputItem(item, visibility),
  })).filter((row) => row.resolved !== null);
  if (rendered.length === 0) return null;

  return (
    <section className="mb-3 rounded-lg border border-border bg-card">
      {/* A-25 U4 (AKT-03): kepala panel dirampingkan — judul satu
          baris; penjelasan perilaku kartu (berpanah = membuka halaman)
          cukup dibawa penanda "Halaman" pada kartunya sendiri, bukan
          paragraf permanen di kepala panel. A-28 UI-5: kepala kini
          tombol buka/tutup panel (aria-expanded), badan terlipat
          bawaan. */}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <Zap className="size-4 text-primary" />
        <h2 className="text-[13px] font-semibold">Input Cepat</h2>
        <span className="text-[11px] text-muted-foreground">
          Pencatatan harian tanpa berburu menu · {rendered.length} jalan pintas
        </span>
        <ChevronDown
          className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        <div className="grid grid-cols-1 gap-2 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
        {rendered.map(({ item, resolved }) => {
          const isModal = resolved?.mode === "modal";
          const content = (
            <>
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                <item.icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold">{item.label}</span>
                  {!isModal ? (
                    <span
                      className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      title={`Membuka halaman ${item.pageName ?? ""}`}
                    >
                      Halaman
                      <ArrowUpRight className="size-3" aria-hidden />
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{item.hint}</span>
                {!isModal && item.pageName ? (
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    Membuka halaman {item.pageName}
                  </span>
                ) : null}
              </span>
            </>
          );
          if (resolved?.mode === "modal") {
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => openQuickEntry({ kind: resolved.quickKind })}
                className={itemClass}
              >
                {content}
              </button>
            );
          }
          if (resolved?.mode === "link") {
            return (
              <Link key={item.label} href={resolved.href} className={itemClass}>
                {content}
              </Link>
            );
          }
          return null;
        })}
        </div>
      ) : null}
    </section>
  );
}
