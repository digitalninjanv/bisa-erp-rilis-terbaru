import { ChevronRight } from "lucide-react";
import { requirePermissionPage } from "@/lib/session";
import { getBackupStatus, type BackupStatus } from "@/server/backup-status";
import { formatDateTime } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { SettingsPageFrame } from "@/components/pengaturan/settings-page-frame";

export const metadata = { title: "Status sistem" };
export const dynamic = "force-dynamic";

/**
 * A-28 Tahap 6 (H-X-01) — kesehatan operasional yang terbaca dari
 * artefak nyata: manifest yang ditulis skrip backup & latihan
 * restore. Halaman ini tidak memicu apa pun dan tidak mengarang
 * status: tanpa manifest, yang tampil adalah "belum ada catatan".
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAge(ageHours: number | null, ageDays: number | null): string {
  if (ageDays !== null && ageDays >= 1) return `${ageDays.toFixed(1)} hari lalu`;
  if (ageHours !== null) {
    if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))} menit lalu`;
    return `${ageHours.toFixed(1)} jam lalu`;
  }
  return "—";
}

function Badge({ tone, children }: { tone: "teal" | "amber" | "red"; children: React.ReactNode }) {
  const classes =
    tone === "teal"
      ? "bg-tone-teal-soft text-tone-teal"
      : tone === "amber"
        ? "bg-tone-amber-soft text-tone-amber"
        : "bg-tone-red-soft text-tone-red";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${classes}`}>{children}</span>
  );
}

/**
 * A-28 UI-5 (UX-A04): detail teknis (nama variabel env, path absolut,
 * nama berkas/skrip operasional) tidak lagi menjadi teks utama —
 * permukaan membaca label ramah, dan rujukan persisnya untuk petugas
 * teknis hidup di area "Detail teknis" yang terlipat bawaan (pola
 * progressive disclosure yang sama seperti "Penjelasan halaman").
 */
function TechDetails({ children }: { children: React.ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        Detail teknis
      </summary>
      <div className="mt-1.5 space-y-1 text-[11px] leading-5 text-muted-foreground">{children}</div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="text-[12px]">{children}</span>
    </div>
  );
}

function backupBadge(status: BackupStatus) {
  switch (status.backup.state) {
    case "fresh":
      return <Badge tone="teal">Tercatat & segar</Badge>;
    case "stale":
      return <Badge tone="red">Melewati ambang umur</Badge>;
    default:
      return <Badge tone="amber">Belum ada catatan</Badge>;
  }
}

function drillBadge(status: BackupStatus) {
  switch (status.drill.state) {
    case "fresh":
      return <Badge tone="teal">Terbukti & segar</Badge>;
    case "stale":
      return <Badge tone="red">Sudah lama tidak dilatih</Badge>;
    case "failed":
      return <Badge tone="red">Latihan terakhir GAGAL verifikasi</Badge>;
    default:
      return <Badge tone="amber">Belum pernah dilatih</Badge>;
  }
}

export default async function SystemStatusPage() {
  const ctx = await requirePermissionPage("settings.manage");
  const status = await getBackupStatus();
  const { backup, drill } = status;
  const needsAttention =
    backup.state !== "fresh" || drill.state !== "fresh";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Status sistem"
        description="Kesehatan backup database & latihan restore, dibaca dari catatan backup terakhir di server."
      />
      <SettingsPageFrame>
        <div className="space-y-4">
          {needsAttention ? (
            <div className="rounded-lg border border-tone-amber/40 bg-tone-amber-soft px-4 py-3 text-[12px] text-tone-amber">
              <span className="font-semibold">Perlu perhatian: </span>
              {backup.state === "missing"
                ? "belum ada catatan backup di server. "
                : backup.state === "stale"
                  ? `backup terakhir berumur ${formatAge(backup.ageHours, null)} — melewati ambang ${status.maxAgeHours} jam. `
                  : ""}
              {drill.state === "missing"
                ? "restore belum pernah dilatih & diverifikasi."
                : drill.state === "failed"
                  ? "latihan restore terakhir gagal verifikasi."
                  : drill.state === "stale"
                    ? `latihan restore terakhir ${formatAge(null, drill.ageDays)} — melewati ambang ${status.drillMaxAgeDays} hari.`
                    : ""}
            </div>
          ) : null}

          <section className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <h2 className="text-[13px] font-semibold">Backup database</h2>
              {backupBadge(status)}
            </div>
            {backup.manifest ? (
              <div className="divide-y divide-border/60">
                <Row label="Berkas terakhir">{backup.manifest.file}</Row>
                <Row label="Selesai">
                  {formatDateTime(backup.manifest.finishedAt)} ({formatAge(backup.ageHours, null)})
                </Row>
                <Row label="Ukuran">{formatBytes(backup.manifest.sizeBytes)}</Row>
                <Row label="SHA-256">
                  <span className="font-mono text-[11px]">{backup.manifest.sha256.slice(0, 16)}…</span>
                </Row>
                <Row label="Enkripsi">{backup.manifest.encrypted ? "Terenkripsi (AES-256)" : "Tidak terenkripsi"}</Row>
              </div>
            ) : (
              <div className="py-3">
                <p className="text-[12px] text-muted-foreground">
                  Belum ada catatan backup. Backup berjalan otomatis lewat jadwal harian di server produksi, dan
                  setiap keberhasilannya meninggalkan catatan yang dibaca halaman ini. Selama catatan itu belum ada,
                  halaman ini memang belum bisa membuktikan backup apa pun — jalankan backup pertama lewat perintah
                  operasional di server (lihat Detail teknis).
                </p>
                <TechDetails>
                  <p>
                    Perintah backup: <span className="font-mono">pnpm db:backup</span> (atau timer harian server).
                    Catatan ditulis sebagai <span className="font-mono">backup-manifest.json</span> di direktori
                    backup — atur lewat variabel env <span className="font-mono">BISA_BACKUP_DIR</span>.
                  </p>
                </TechDetails>
              </div>
            )}
            <p className="pt-2 text-[11px] text-muted-foreground">
              Ambang kesegaran: {status.maxAgeHours} jam.
            </p>
            <TechDetails>
              <p>
                Ambang diatur lewat variabel env <span className="font-mono">BISA_BACKUP_MAX_AGE_HOURS</span>.
                Direktori catatan backup: <span className="font-mono">{status.manifestDir}</span>
              </p>
            </TechDetails>
          </section>

          <section className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <h2 className="text-[13px] font-semibold">Latihan restore</h2>
              {drillBadge(status)}
            </div>
            {drill.manifest ? (
              <div>
                <div className="divide-y divide-border/60">
                  <Row label="Terakhir dilatih">
                    {formatDateTime(drill.manifest.at)} ({formatAge(null, drill.ageDays)})
                  </Row>
                  <Row label="Dari berkas">{drill.manifest.sourceFile}</Row>
                  <Row label="Database uji">
                    Database sementara
                    <span className="text-muted-foreground"> (dihapus sesudah latihan)</span>
                  </Row>
                  <Row label="Hasil verifikasi">{drill.manifest.ok ? "Semua angka cocok" : "ADA ANGKA TIDAK COCOK"}</Row>
                </div>
                <table className="mt-2 w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                      <th className="py-1 font-medium">Pemeriksaan</th>
                      <th className="py-1 font-medium">Sumber</th>
                      <th className="py-1 font-medium">Hasil restore</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/60">
                      <td className="py-1">Jumlah akun</td>
                      <td className="num py-1">{formatNumber(drill.manifest.checks.accounts.source)}</td>
                      <td className="num py-1">{formatNumber(drill.manifest.checks.accounts.restored)}</td>
                    </tr>
                    <tr className="border-b border-border/60">
                      <td className="py-1">Jumlah produk</td>
                      <td className="num py-1">{formatNumber(drill.manifest.checks.products.source)}</td>
                      <td className="num py-1">{formatNumber(drill.manifest.checks.products.restored)}</td>
                    </tr>
                    <tr className="border-b border-border/60">
                      <td className="py-1">Nilai persediaan</td>
                      <td className="num py-1">{drill.manifest.checks.inventoryValue.source}</td>
                      <td className="num py-1">{drill.manifest.checks.inventoryValue.restored}</td>
                    </tr>
                    <tr>
                      <td className="py-1">Selisih neraca saldo</td>
                      <td className="num py-1">{drill.manifest.checks.trialBalanceDifference.source}</td>
                      <td className="num py-1">{drill.manifest.checks.trialBalanceDifference.restored}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-3">
                <p className="text-[12px] text-muted-foreground">
                  Restore belum pernah dilatih. Backup yang belum pernah dipulihkan &amp; diverifikasi adalah asumsi,
                  bukan perlindungan — jalankan latihan pertama mengikuti panduan operasional backup &amp; restore
                  (lihat Detail teknis).
                </p>
                <TechDetails>
                  <p>
                    Skrip latihan: <span className="font-mono">scripts/restore-drill.sh</span>. Panduan:{" "}
                    <span className="font-mono">docs/RUNBOOK-BACKUP-RESTORE.md</span>.
                  </p>
                </TechDetails>
              </div>
            )}
            <p className="pt-2 text-[11px] text-muted-foreground">
              Ambang kesegaran latihan: {status.drillMaxAgeDays} hari.
            </p>
            <TechDetails>
              <p>
                Ambang diatur lewat variabel env{" "}
                <span className="font-mono">BISA_RESTORE_DRILL_MAX_AGE_DAYS</span>.
                {drill.manifest ? (
                  <>
                    {" "}Nama database uji terakhir:{" "}
                    <span className="font-mono">{drill.manifest.targetDatabase}</span>.
                  </>
                ) : null}
              </p>
            </TechDetails>
          </section>
        </div>
      </SettingsPageFrame>
    </div>
  );
}
