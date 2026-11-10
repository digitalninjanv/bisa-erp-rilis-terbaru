import { redirect } from "next/navigation";

/**
 * Overhaul UX 2026-11-09: form Beban yang berdiri sendiri dihapus.
 * Semua pencatatan manual — termasuk beban — lewat Jurnal Umum
 * (satu pintu). Rute lama dipertahankan sebagai pengalihan agar
 * tautan/dokumen lama tidak berakhir 404.
 */
export const dynamic = "force-dynamic";

export default function LegacyExpensePage() {
  redirect("/app/akuntansi/jurnal/baru");
}
