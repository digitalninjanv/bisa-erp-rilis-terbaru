import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ambang deskripsi yang masih tampil sebagai satu baris konteks.
 * Deskripsi lebih panjang dari ini dianggap teks tutorial
 * (AUDIT-UI-A25 POLA-02) dan dipindah ke bantuan terlipat.
 */
const SHORT_DESCRIPTION_MAX = 100;

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  /**
   * @deprecated A-25 U1 (ARAH-DESAIN-A25 §2.2/§3.2): eyebrow halaman
   * dihapus dari bahasa desain — konteks modul diberikan sidebar &
   * breadcrumb. Prop dipertahankan agar pemanggil lama tidak rusak;
   * nilainya tidak lagi dirender.
   */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  void eyebrow;
  // CT-06: the page header is screen chrome (title + action buttons) —
  // it never belongs on a printed document, on any page.
  const text = description?.trim();
  const shortText = text && text.length <= SHORT_DESCRIPTION_MAX ? text : null;
  const longText = text && text.length > SHORT_DESCRIPTION_MAX ? text : null;
  return (
    <div className={cn("page-header no-print mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {shortText ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">{shortText}</p>
        ) : null}
        {longText ? (
          // A-25 U1 (POLA-02): penjelasan konsep tidak lagi menjadi
          // paragraf permanen yang memajaki setiap halaman — ia hidup
          // di balik "Penjelasan halaman" yang terlipat bawaan
          // (progressive disclosure, ARAH-DESAIN-A25 §4.1 butir 5).
          <details className="group mt-1 max-w-2xl">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground lg:min-h-0 [&::-webkit-details-marker]:hidden">
              <Info className="size-3.5" />
              Penjelasan halaman
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{longText}</p>
          </details>
        ) : null}
      </div>
      {/* Slot aksi: satu aksi utama halaman + aksi sekunder
          (outline/ghost/menu) — ARAH-DESAIN-A25 §4.2. */}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  actions,
  bare = false,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /**
   * A-25 U1 — mekanisme penutup judul ganda (POLA-02): kartu pertama
   * di bawah PageHeader yang judulnya sama dengan judul halaman
   * memakai `bare` agar konten langsung mulai — pita judul kartu
   * tidak dirender (baris aksi tetap tampil bila ada). Penerapan
   * per halaman adalah pekerjaan tahap modul (U3–U6).
   */
  bare?: boolean;
}) {
  if (bare) {
    if (!actions) return null;
    return <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2">{actions}</div>;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
