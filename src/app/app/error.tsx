"use client";

import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";

export default function AppError({ error }: { error: Error & { digest?: string } }) {
  const denied = error.message.includes("Tidak punya akses");
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-[#fbe9e7] text-[#a3362a]">
          <ShieldAlert className="size-5" />
        </span>
        <h1 className="mt-3 text-[16px] font-semibold">{denied ? "Akses ditolak" : "Terjadi kesalahan"}</h1>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
          {denied
            ? error.message
            : "Halaman gagal dimuat. Coba lagi atau hubungi admin jika masalah berlanjut."}
        </p>
        <Link
          href="/app"
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ArrowLeft className="size-3.5" /> Kembali ke beranda
        </Link>
      </div>
    </div>
  );
}
