import Link from "next/link";
import { Search } from "lucide-react";
import { SectionTitle } from "@/components/blocks/page-header";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";
import { fieldWidths } from "@/components/blocks/field-classes";
import { cn } from "@/lib/utils";

/**
 * A-25 U2 — DataList: pola daftar TUNGGAL semua modul (ARAH-DESAIN-A25
 * §3.1; menutup AUDIT-UI-A25 POLA-01 pada permukaan daftar, POLA-06
 * bar filter ≥4 varian, POLA-09 KPI nol). Kontraknya:
 *
 * - `kpis` OPSIONAL — slot di atas kartu hanya dirender bila pemanggil
 *   mengisinya; daftar tidak lagi wajib membuka dengan kartu angka.
 * - `toolbar` — satu bar gaya dari `DataListToolbar` (pencarian +
 *   filter + tombol "Cari"); halaman tidak lagi meracik bar sendiri.
 * - `headerActions` — baris aksi kepala kartu lewat `SectionTitle
 *   bare`: judul kartu yang sama dengan judul halaman tidak pernah
 *   digambar dua kali (POLA-02), baris aksinya tetap tampil.
 * - Tabel di dalamnya memakai `.data-table` (13px, py-2.5 — baris
 *   nyaman 40px untuk konten satu baris; token tunggal Validasi 3
 *   T-03). Mode kartu <lg disediakan pemanggil sebagai bagian
 *   `children` (pola kartu yang sudah hidup di repo: tabel
 *   `hidden lg:block` + kartu `lg:hidden`).
 * - `density="compact"` (G3, UX4-09) — varian kepadatan OPT-IN:
 *   padding vertikal sel menjadi py-1.5 (skala kompak 32px
 *   ARAH-DESAIN-A25 §2.4) lewat kelas terlingkup `.data-list--compact`
 *   di globals.css, tipografi tidak berubah. Opt-in sadar per daftar
 *   utama yang terukur terlalu tinggi — BUKAN override menyeluruh
 *   seperti yang dihapus Validasi 3.
 * - `isEmpty` + `empty` — keadaan kosong dirender di dalam bingkai
 *   yang sama menggantikan isi, bukan kartu terpisah di luar.
 */
export function DataList({
  kpis,
  headerActions,
  toolbar,
  children,
  pagination,
  isEmpty = false,
  empty,
  footerNote,
  className,
  density = "comfortable",
}: {
  kpis?: React.ReactNode;
  headerActions?: React.ReactNode;
  toolbar?: React.ReactNode;
  children?: React.ReactNode;
  pagination?: React.ReactNode;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  footerNote?: React.ReactNode;
  className?: string;
  /** G3 (UX4-09): "compact" = baris kompak py-1.5 untuk daftar utama. */
  density?: "comfortable" | "compact";
}) {
  return (
    <>
      {kpis ? <div className="mb-3">{kpis}</div> : null}
      <section
        className={cn(
          "data-list overflow-hidden rounded-lg border border-border bg-card",
          density === "compact" && "data-list--compact",
          className,
        )}
      >
        {headerActions ? (
          <div className="border-b border-border">
            <SectionTitle bare title="" actions={headerActions} />
          </div>
        ) : null}
        {toolbar ? <div className="border-b border-border px-3 py-2.5">{toolbar}</div> : null}
        {isEmpty ? empty : children}
        {pagination}
      </section>
      {footerNote ? <div className="mt-3 text-[11px] text-muted-foreground">{footerNote}</div> : null}
    </>
  );
}

/**
 * Bar pencarian + filter satu gaya untuk DataList. Bentuk form GET
 * seperti SearchForm bersama (satu sumber kebenaran per parameter:
 * filter adalah kontrol anak bernama, JANGAN diteruskan juga sebagai
 * hidden — lihat catatan A-22 K1 di halaman jurnal/produk). Sejak
 * filter otomatis, perubahan select/date/checkbox langsung diterapkan
 * dan ketikan pencarian memakai debounce; tombol "Cari" tetap ada
 * sebagai fallback keyboard/no-JS. Tautan "Atur ulang" hanya tampil
 * bila `resetHref` diberikan pemanggil.
 */
export function DataListToolbar({
  action,
  q,
  placeholder = "Cari...",
  hidden = {},
  resetHref,
  children,
}: {
  action: string;
  q?: string;
  placeholder?: string;
  hidden?: Record<string, string | undefined>;
  resetHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <AutoFilterForm action={action} className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <div className="relative min-w-[190px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label="Kata kunci pencarian"
          className="field-control h-9 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-[13px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </div>
      {children}
      <button
        type="submit"
        className="h-9 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
      >
        Cari
      </button>
      {resetHref ? (
        <Link
          href={resetHref}
          className="inline-flex h-9 items-center px-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Atur ulang
        </Link>
      ) : null}
    </AutoFilterForm>
  );
}

/** Kelas kontrol filter (select/input) di dalam DataListToolbar.
 * Validasi 3 (F-01): tinggi h-9 adalah token tunggal field (bukan
 * lagi penaikan tema). Validasi 3 (F-03): lebar baku dari skala
 * fieldWidths — select filter tidak lagi menyusut mengikuti isi
 * (penyebab lebar liar 118–227px antar bar filter terukur audit). */
const dataListFilterBase =
  "field-control h-9 rounded-md border border-input bg-background px-2 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";
export const dataListFilterClass = `${dataListFilterBase} ${fieldWidths.filter}`;
/** Varian lebar untuk select berlabel panjang (mis. daftar akun). */
export const dataListFilterWideClass = `${dataListFilterBase} ${fieldWidths.filterWide}`;
