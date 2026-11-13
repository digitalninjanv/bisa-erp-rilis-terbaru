import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Jurnal umum kini langsung membuka formulir. Daftar/audit trail pindah
 * ke /app/akuntansi/jurnal/riwayat agar halaman input tidak tercampur
 * dengan riwayat transaksi.
 */
export default function JournalPage() {
  redirect("/app/akuntansi/jurnal/baru");
}