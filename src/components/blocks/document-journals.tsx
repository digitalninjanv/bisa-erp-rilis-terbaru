import Link from "next/link";
import { formatDate, journalSourceLabel } from "@/lib/format";
import type { LinkedJournal } from "@/server/catalog";

/**
 * FIX-GDG Tahap 4 (GDG2-02) — seksi "Jurnal terkait" pada halaman
 * detail dokumen: jurnal posting dokumen ini beserta jurnal
 * pembaliknya, tertaut ke detail jurnal akuntansi (drill-through yang
 * sama seperti FIX-P1 Tahap 5 dari sisi laporan).
 *
 * A-24 T4: dipindah dari components/gudang ke components/blocks agar
 * menjadi SATU komponen pola "Rincian Jurnal" Accurate untuk semua
 * modul (gudang, akuntansi, HR) — bukan salinan per modul. Teks
 * keadaan kosong dapat disesuaikan per dokumen lewat `emptyNote`.
 */
export function DocumentJournals({
  journals,
  emptyNote = "Dokumen ini tidak memiliki jurnal (mis. transfer antar gudang tidak menjurnal, atau selisih opname neto nol).",
}: {
  journals: LinkedJournal[];
  emptyNote?: string;
}) {
  if (journals.length === 0) {
    return (
      <section className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
        <h2 className="text-[13px] font-semibold">Jurnal terkait</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">{emptyNote}</p>
      </section>
    );
  }
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Jurnal terkait</h2>
      </div>
      <div className="overflow-x-auto contain-paint">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nomor jurnal</th>
              <th>Tanggal</th>
              <th>Keterangan</th>
              <th>Sumber</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {journals.map((journal) => (
              <tr key={journal.id}>
                <td>
                  <Link
                    href={`/app/akuntansi/jurnal/${journal.id}`}
                    className="num font-medium text-primary hover:underline"
                  >
                    {journal.number}
                  </Link>
                  {journal.reversalOfId ? (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">(jurnal pembalik)</span>
                  ) : null}
                </td>
                <td className="num text-[12px] text-muted-foreground">{formatDate(journal.date)}</td>
                <td className="max-w-[320px] truncate text-[12px]">{journal.description}</td>
                <td className="text-[12px]">{journalSourceLabel(journal.sourceType)}</td>
                <td className="text-[12px]">{journal.status === "posted" ? "Terposting" : journal.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
