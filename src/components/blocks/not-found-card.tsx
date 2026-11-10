import Link from "next/link";
import { ArrowLeft, MapPinOff } from "lucide-react";

/**
 * A-25 U0 (POLA-11) — kartu 404 bersama berbahasa Indonesia, dipakai
 * not-found segmen /app dan not-found akar. Sebelumnya tidak ada
 * not-found.tsx sama sekali: rute yang tidak ketemu (mis. halaman
 * cetak dibuka tanpa parameter persis) jatuh ke 404 bawaan Next.js
 * berbahasa Inggris tanpa merek dan tanpa jalan pulang. Bentuk kartu
 * meniru error.tsx agar bahasa visual galat konsisten.
 */
export function NotFoundCard({ homeHref = "/app" }: { homeHref?: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-tone-plum-soft text-tone-plum">
          <MapPinOff className="size-5" />
        </span>
        <h1 className="mt-3 text-[16px] font-semibold">Halaman tidak ditemukan</h1>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
          Alamat yang dituju tidak ada atau sudah dipindahkan. Periksa kembali alamatnya, atau kembali ke
          beranda untuk melanjutkan dari modul yang tersedia.
        </p>
        <Link
          href={homeHref}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ArrowLeft className="size-3.5" /> Kembali ke beranda
        </Link>
      </div>
    </div>
  );
}
