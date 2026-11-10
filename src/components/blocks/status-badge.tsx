import { cn } from "@/lib/utils";

/* FIX-R2 Tahap 2 (RD2U-02/06): StatusBadge adalah SATU-SATUNYA cara
   merender status di seluruh aplikasi — warna dari token --tone-*,
   label Bahasa Indonesia. Halaman tidak lagi menggambar pill status
   sendiri. Gaya void resmi: merah lembut (sama seperti cancelled);
   perlakuan baris (pudar/corot) tetap urusan tabel pemanggil. */
const styles: Record<string, string> = {
  completed: "bg-tone-green-soft text-tone-green",
  paid: "bg-tone-green-soft text-tone-green",
  settled: "bg-tone-green-soft text-tone-green",
  posted: "bg-tone-green-soft text-tone-green",
  open: "bg-tone-teal-soft text-tone-teal",
  held: "bg-tone-amber-soft text-tone-amber",
  partial: "bg-tone-amber-soft text-tone-amber",
  partially_resolved: "bg-tone-amber-soft text-tone-amber",
  resolved: "bg-tone-green-soft text-tone-green",
  pending: "bg-tone-amber-soft text-tone-amber",
  rejected: "bg-tone-red-soft text-tone-red",
  sent: "bg-tone-teal-soft text-tone-teal",
  in_transit: "bg-tone-teal-soft text-tone-teal",
  received: "bg-tone-green-soft text-tone-green",
  cancelled: "bg-tone-red-soft text-tone-red",
  draft: "bg-muted text-muted-foreground",
  unpaid: "bg-tone-red-soft text-tone-red",
  void: "bg-tone-red-soft text-tone-red",
  returned: "bg-tone-plum-soft text-tone-plum",
  closed: "bg-muted text-muted-foreground",
  locked: "bg-tone-plum-soft text-tone-plum",
  active: "bg-tone-green-soft text-tone-green",
  inactive: "bg-muted text-muted-foreground",
  /* A-25 U4 (sisa U3): status Permintaan Pembelian & Reservasi stok —
     sebelumnya jatuh ke gaya bawaan abu-abu tanpa label Indonesia di
     peta pusat (halaman Gudang menambalnya dengan label lokal).
     Nada mengikuti ARAH-DESAIN-A25 §3.10: menunggu = amber,
     disetujui/selesai = hijau, berakhir netral = redup, kedaluwarsa
     = merah lembut, terkonversi = teal informasional. */
  submitted: "bg-tone-amber-soft text-tone-amber",
  approved: "bg-tone-green-soft text-tone-green",
  converted: "bg-tone-teal-soft text-tone-teal",
  released: "bg-muted text-muted-foreground",
  expired: "bg-tone-red-soft text-tone-red",
  fulfilled: "bg-tone-green-soft text-tone-green",
};

const labels: Record<string, string> = {
  completed: "Selesai",
  paid: "Lunas",
  settled: "Lunas",
  posted: "Terposting",
  open: "Berjalan",
  held: "Ditahan",
  partial: "Sebagian",
  partially_resolved: "Sebagian selesai",
  resolved: "Selesai",
  pending: "Menunggu persetujuan",
  rejected: "Ditolak",
  sent: "Terkirim",
  in_transit: "Dalam perjalanan",
  received: "Diterima",
  cancelled: "Dibatalkan",
  draft: "Draf",
  unpaid: "Belum dibayar",
  void: "Batal",
  returned: "Retur",
  closed: "Tutup",
  locked: "Dikunci",
  active: "Aktif",
  inactive: "Nonaktif",
  /* A-25 U4: label diselaraskan kata-per-kata dengan peta label
     domain pemiliknya (PR_STATUS_LABELS di server/purchase-requests
     & RESERVATION_STATUS_LABELS di server/reservations) agar lencana
     dan teks domain tidak pernah berbeda bahasa. */
  submitted: "Diajukan",
  approved: "Disahkan",
  converted: "Terkonversi ke PO",
  released: "Dirilis",
  expired: "Kedaluwarsa",
  fulfilled: "Terpenuhi",
};

/**
 * A-22 K4 (UX-12): pemetaan label bersama di belakang StatusBadge —
 * permukaan non-lencana (mis. cetak jurnal, yang dulu mencetak status
 * mentah basis data "posted") memakai fungsi ini agar bahasanya
 * persis sama dengan daftar & detail.
 */
export function statusLabel(status: string): string {
  return labels[status] ?? status;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        /* G1 (UX4-02): lantai teks ARAH-DESAIN-A25 §2.2 — tidak ada
           teks di bawah 11px termasuk badge; sebelumnya 10px dan
           menjadi sumber pelanggaran terbesar di seluruh daftar. */
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        styles[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {label ?? statusLabel(status)}
    </span>
  );
}
