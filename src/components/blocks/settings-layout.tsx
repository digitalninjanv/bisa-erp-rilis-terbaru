"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Check, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type SettingsNavItem = {
  id: string;
  label: string;
  /** Bila diisi, item adalah tautan rute; selain itu jangkar seksi
   * `#id` pada halaman yang sama (pola satu halaman per topik). */
  href?: string;
  icon?: ReactNode;
};

type Saver = () => Promise<void>;

type SettingsRegistry = {
  reportDirty: (id: string, dirty: boolean) => void;
  registerSaver: (id: string, saver: Saver | null) => void;
};

const SettingsRegistryContext = createContext<SettingsRegistry | null>(null);

/**
 * A-25 U2 — SettingsLayout: pola Pengaturan resmi (ARAH-DESAIN-A25
 * §3.8; menutup AUDIT-UI-A25 POLA-05 simpan-per-baris ±25 tombol).
 * Kontraknya:
 *
 * - Navigasi kiri TUNGGAL (vertikal; di layar kecil menjadi baris
 *   gulir di atas konten) — tidak ada lagi sidebar + pill tab ganda.
 * - SATU bilah Simpan terpaku di dasar area konten untuk seluruh
 *   halaman. Tombolnya hanya aktif bila ada perubahan; indikator
 *   "Ada perubahan belum disimpan" selalu terbaca dari bilah.
 * - Seksi anak mendaftar lewat `useSettingsSection(id, saver)`:
 *   melaporkan kotor saat field berubah dan menyediakan fungsi
 *   simpannya. Menekan Simpan menjalankan semua saver seksi kotor
 *   berurutan; yang berhasil dibersihkan tandanya, yang gagal tetap
 *   kotor dan kesalahannya ditampilkan saver sendiri (toast aksi).
 *
 * Pemasangan massal ke halaman Pengaturan adalah pekerjaan U6 —
 * tahap ini komponen + kontraknya.
 */
export function SettingsLayout({
  nav,
  activeId,
  children,
  saveLabel = "Simpan perubahan",
  className,
}: {
  /** Daftar seksi jangkar di dalam halaman. Validasi 2 (V-02):
   * halaman Pengaturan TIDAK lagi meneruskannya — navigasi
   * pengaturan tunggal hidup di sidebar cangkang (daftar yang sama
   * sempat dirender dua kali). Pemakai lain (hub HR) yang menavigasi
   * seksi di dalam halamannya sendiri tetap memakainya. Tanpa nav,
   * konten mengambil lebar penuh. */
  nav?: SettingsNavItem[];
  /** Seksi aktif (untuk item jangkar; item rute memakai href-nya). */
  activeId?: string;
  children: ReactNode;
  saveLabel?: string;
  className?: string;
}) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const saversRef = useRef(new Map<string, Saver>());

  const reportDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const registerSaver = useCallback((id: string, saver: Saver | null) => {
    if (saver) saversRef.current.set(id, saver);
    else saversRef.current.delete(id);
  }, []);

  const registry = useMemo<SettingsRegistry>(
    () => ({ reportDirty, registerSaver }),
    [reportDirty, registerSaver],
  );

  const dirtyCount = dirtyIds.size;

  async function saveAll() {
    const ids = [...dirtyIds];
    if (ids.length === 0 || saving) return;
    setSaving(true);
    const failed: string[] = [];
    for (const id of ids) {
      const saver = saversRef.current.get(id);
      if (!saver) {
        // Seksi kotor tanpa saver terdaftar: jangan diam-diam
        // dibersihkan — itu perubahan yang tidak tersimpan.
        failed.push(id);
        continue;
      }
      try {
        await saver();
        reportDirty(id, false);
      } catch {
        failed.push(id);
      }
    }
    setSaving(false);
    if (failed.length === 0) {
      toast.success("Semua perubahan disimpan.");
    } else {
      toast.error(`Sebagian perubahan gagal disimpan (${failed.length} seksi). Periksa lalu coba lagi.`);
    }
  }

  const hasNav = nav !== undefined && nav.length > 0;

  return (
    <SettingsRegistryContext.Provider value={registry}>
      <div
        className={cn(
          "grid items-start gap-4",
          hasNav && "lg:grid-cols-[220px_minmax(0,1fr)]",
          className,
        )}
      >
        {hasNav ? (
        <nav
          aria-label="Seksi pengaturan"
          className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-4 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {nav.map((item) => {
            // A-25 U6: item tautan rute juga bisa disorot aktif
            // lewat activeId (sebelumnya hanya item jangkar seksi).
            // Validasi 2 (V-02): Pengaturan tidak lagi memakai nav
            // ini — pemakai tersisa adalah hub HR (jangkar seksi).
            const active = activeId === item.id;
            const classes = cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors",
              active
                ? "bg-primary-soft font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            );
            return item.href ? (
              <Link key={item.id} href={item.href} className={classes}>
                {item.icon}
                {item.label}
              </Link>
            ) : (
              <a key={item.id} href={`#${item.id}`} className={classes}>
                {item.icon}
                {item.label}
              </a>
            );
          })}
        </nav>
        ) : null}

        <div className="min-w-0">
          {children}
          <div className="sticky bottom-0 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur">
            {dirtyCount > 0 ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                  <span aria-hidden className="size-2 rounded-full bg-tone-amber" />
                  Ada perubahan belum disimpan
                  <span className="text-muted-foreground">
                    ({dirtyCount} seksi)
                  </span>
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => void saveAll()}
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Save className="size-4" />
                  {saving ? "Menyimpan…" : saveLabel}
                </button>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Check className="size-4 text-tone-green" />
                  Semua perubahan tersimpan
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground opacity-50"
                >
                  <Save className="size-4" />
                  {saveLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </SettingsRegistryContext.Provider>
  );
}

/**
 * Kait seksi pengaturan: daftarkan fungsi simpan seksi dan laporkan
 * keadaan kotor. Pemakaian:
 *
 *   const { setDirty } = useSettingsSection("umum", saveUmum);
 *   <input onChange={() => setDirty(true)} ... />
 *
 * Saver yang berhasil menyelesaikan penyimpanan dianggap
 * membersihkan kekotorannya sendiri lewat layout (layout memanggil
 * reportDirty(false) sesudah saver resolve); saver yang melempar
 * membuat seksi tetap kotor.
 */
export function useSettingsSection(id: string, saver: Saver) {
  const registry = useContext(SettingsRegistryContext);
  const saverRef = useRef(saver);
  useEffect(() => {
    saverRef.current = saver;
  });

  useEffect(() => {
    if (!registry) return;
    registry.registerSaver(id, () => saverRef.current());
    return () => registry.registerSaver(id, null);
  }, [registry, id]);

  const setDirty = useCallback(
    (dirty: boolean) => registry?.reportDirty(id, dirty),
    [registry, id],
  );
  return { setDirty };
}

/** Bungkus satu seksi konten pengaturan: kartu ber-id jangkar +
 * judul seksi (14px sentence case per arah desain §2.2). */
export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("mb-3 scroll-mt-4 rounded-lg border border-border bg-card px-5 py-4", className)}>
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}
