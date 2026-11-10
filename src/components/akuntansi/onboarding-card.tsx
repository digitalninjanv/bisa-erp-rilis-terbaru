"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Landmark, ListTree, PenLine, Sparkles, Users, X } from "lucide-react";

/**
 * A-22 Tahap K5 (pola onboarding Odoo, versi ringkas): kartu langkah
 * awal untuk perusahaan yang belum punya jurnal posted dan belum
 * punya akun bank terpeta — kriteria diputuskan di server
 * (getAccountingOnboardingState); komponen ini hanya menggambar.
 *
 * Keadaan tutup disimpan di localStorage per pengguna + perusahaan.
 * Aplikasi belum punya mekanisme preferensi pengguna sisi server, dan
 * pola penyimpanan lokal per konteks sudah dipakai di tempat lain
 * (draf opname per perusahaan+gudang, tampilan kasir POS) — kunci di
 * sini mengikuti pola yang sama.
 */
const STEPS = [
  {
    href: "/app/akuntansi/bank",
    icon: Landmark,
    title: "Hubungkan rekening bank",
    description: "Petakan akun kas & bank agar setiap transaksi tercatat ke akun yang benar.",
  },
  {
    href: "/app/akuntansi/akun",
    icon: ListTree,
    title: "Periksa bagan akun",
    description: "Bagan akun bawaan sudah terisi — sesuaikan nama & nomor akun dengan usaha Anda.",
  },
  {
    href: "/app/akuntansi/jurnal/baru",
    icon: PenLine,
    title: "Catat transaksi pertama",
    description: "Buat jurnal pertama, atau catat penjualan & beban dari panel input cepat.",
  },
  {
    href: "/app/pengaturan/pengguna",
    icon: Users,
    title: "Undang tim Anda",
    description: "Tambahkan kasir, staf gudang, dan akuntan dengan peran masing-masing.",
  },
] as const;

export function OnboardingCard({ companyId, userId }: { companyId: string; userId: string }) {
  const storageKey = `bisa:akuntansi-langkah-awal:${companyId}:${userId}`;
  // Keadaan tutup dibaca sebagai external store: snapshot server
  // "tertutup" (kartu tidak dirender di server & tidak berkedip bagi
  // pengguna yang sudah menutupnya), snapshot klien membaca
  // localStorage apa adanya.
  const storedDismissed = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      return () => window.removeEventListener("storage", onChange);
    },
    () => {
      try {
        return window.localStorage.getItem(storageKey) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  if (storedDismissed || dismissedNow) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Penyimpanan tidak tersedia — kartu cukup hilang untuk sesi ini.
    }
    setDismissedNow(true);
  };

  return (
    <section className="rounded-lg border border-primary/25 bg-primary/5 p-4 shadow-2xs sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Sparkles className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Mulai memakai Akuntansi</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Perusahaan ini belum memiliki data akuntansi. Selesaikan langkah berikut untuk mulai
              mencatat — kartu ini hilang sendiri begitu jurnal pertama tercatat.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup kartu langkah awal"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.href}>
              <Link
                href={step.href}
                className="group flex h-full items-start gap-3 rounded-md border bg-card p-3 transition-colors hover:border-primary/40"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {step.description}
                  </span>
                </span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
      >
        Lewati panduan ini
      </button>
    </section>
  );
}
