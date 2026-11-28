"use client";

import { toast } from "sonner";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";

export function UserMenu({
  name,
  email,
  role,
  showSettings,
}: {
  name: string;
  email: string;
  role: string;
  showSettings?: boolean;
}) {
  async function signOut() {
    const result = await authClient.signOut();
    if (result.error) {
      toast.error("Gagal keluar. Periksa koneksi dan coba lagi.");
      return;
    }
    if ("caches" in window) {
      await window.caches.keys().then((keys) => Promise.allSettled(
        keys.filter((key) => key.startsWith("bisa-pos-shell-")).map((key) => window.caches.delete(key)),
      )).catch(() => undefined);
    }
    // ID ini hanya partition cache (bukan kredensial); cookie hash sesi
    // tetap HttpOnly dan dihapus oleh proxy saat navigasi ke /login.
    document.cookie = "pos_shell_cache_id=; Max-Age=0; path=/app/pos";
    window.location.replace("/login");
  }

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted [&::-webkit-details-marker]:hidden">
        <span className="grid size-7 place-items-center rounded-full bg-[#714b67] text-[11px] font-semibold text-white">
          {initials(name)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[140px] truncate text-xs font-medium">{name}</span>
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            {role}
          </span>
        </span>
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-xs font-medium">{name}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{email}</p>
          <p className="mt-2 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="size-3" /> {role}
          </p>
        </div>
        <div className="p-1">
          <a
            href="/app/keamanan"
            className="flex min-h-11 items-center gap-2 rounded px-2 text-xs hover:bg-muted"
          >
            <ShieldCheck className="size-3.5" /> Keamanan akun
          </a>
          {showSettings ? (
            <a
              href="/app/pengaturan"
              className="flex min-h-11 items-center gap-2 rounded px-2 text-xs hover:bg-muted"
            >
              <Settings className="size-3.5" /> Pengaturan
            </a>
          ) : null}
          <button
            type="button"
            onClick={signOut}
            className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-xs text-destructive hover:bg-destructive/10"
          >
            <LogOut className="size-3.5" /> Keluar
          </button>
        </div>
      </div>
    </details>
  );
}
