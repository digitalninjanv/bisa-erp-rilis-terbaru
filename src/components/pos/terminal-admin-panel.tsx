"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { KeyRound, Save, Ban, Download } from "lucide-react";
import { toast } from "sonner";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import {
  createPosTerminalAction,
  issuePairingCodeAction,
  revokePosTerminalAction,
  setDesktopReleaseAction,
} from "@/server/actions/pos-terminals";

/**
 * Panel administrasi terminal POS desktop (POS Native Langkah 6).
 * Hanya dirender untuk supervisor (`pos.void`): buat terminal,
 * terbitkan kode pasangan sekali pakai, cabut terminal. Kode
 * pasangan hanya tampil SATU KALI di sini (teks + QR) — server
 * menyimpan digest-nya saja; menerbitkan kode baru membakar kode
 * lama yang belum terpakai.
 */

type WarehouseOption = { id: string; name: string };
type ActorOption = { userId: string; name: string; role: string };

const primaryButtonClass =
  "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
/* G4 (UX4-03): varian outline segeometri tombol primer form — untuk form
   sekunder satu halaman (Tetapkan rilis) agar primer halaman tunggal. */
const outlineButtonClass =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-[12px] font-medium hover:bg-muted disabled:opacity-50";
const secondaryButtonClass =
  "inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-muted disabled:opacity-40";
const dangerButtonClass =
  "inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40";

export function TerminalCreateForm({
  warehouses,
  actors,
}: {
  warehouses: WarehouseOption[];
  actors: ActorOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [userId, setUserId] = useState(actors[0]?.userId ?? "");

  async function submit() {
    setBusy(true);
    try {
      const result = await createPosTerminalAction({
        name,
        warehouseId: warehouseId || null,
        userId,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Terminal dibuat. Terbitkan kode pasangan untuk memasangnya.");
      setName("");
      router.refresh();
    } catch {
      toast.error("Terminal belum dapat dibuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rounded-lg border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="mb-3 text-[13px] font-semibold">Terminal baru</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Nama terminal</span>
          <input
            className={fieldClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Kasir 1 — Toko Pusat"
            required
          />
        </label>
        <label className="block">
          <span className={labelClass}>Gudang / cabang</span>
          <select
            className={fieldClass}
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            <option value="">Gudang bawaan perusahaan</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Kasir / aktor penyinkron</span>
          <select
            className={fieldClass}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            required
          >
            {actors.map((actor) => (
              <option key={actor.userId} value={actor.userId}>
                {actor.name} ({actor.role})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={busy || !name.trim() || !userId}
        >
          <Save className="size-3.5" /> {busy ? "Menyimpan…" : "Buat terminal"}
        </button>
      </div>
    </form>
  );
}

export type DesktopReleaseSettings = {
  version: string;
  rolloutPercent: number;
  minVersion: string | null;
  notes: string | null;
  publishedAt: string;
};

/**
 * Pengaturan rilis aplikasi desktop (Langkah 7, D4) — hanya
 * dirender untuk supervisor (`pos.void`). Mengatur PENAWARAN
 * pembaruan ke terminal perusahaan ini: versi terkini, persen
 * rollout bertahap (deterministik per terminal), versi minimum
 * (di bawahnya pembaruan wajib, rollout diabaikan). Artefak biner
 * & tanda tangannya diunggah lewat skrip rilis ke direktori rilis
 * server — versi yang artefaknya belum ada TIDAK ditawarkan
 * endpoint, jadi menaikkan versi di sini sebelum artefak terbit
 * tidak menjanjikan apa pun ke terminal.
 */
export function DesktopReleaseForm({
  current,
}: {
  current: DesktopReleaseSettings | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(current?.version ?? "");
  const [rolloutPercent, setRolloutPercent] = useState(
    current ? String(current.rolloutPercent) : "100",
  );
  const [minVersion, setMinVersion] = useState(current?.minVersion ?? "");
  const [notes, setNotes] = useState(current?.notes ?? "");

  async function submit() {
    const percent = Number(rolloutPercent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      toast.error("Persen rollout harus bilangan bulat 0–100.");
      return;
    }
    setBusy(true);
    try {
      const result = await setDesktopReleaseAction({
        version,
        rolloutPercent: percent,
        minVersion: minVersion.trim() ? minVersion.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        `Rilis desktop ${result.data.version} ditetapkan — rollout ${result.data.rolloutPercent}%.`,
      );
      router.refresh();
    } catch {
      toast.error("Rilis belum dapat ditetapkan. Periksa koneksi lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rounded-lg border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="mb-1 text-[13px] font-semibold">Rilis aplikasi desktop</h3>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {current
          ? `Penawaran aktif: versi ${current.version} (ditetapkan ${new Date(current.publishedAt).toLocaleDateString("id-ID")}), rollout ${current.rolloutPercent}%${current.minVersion ? `, wajib di bawah ${current.minVersion}` : ""}.`
          : "Belum ada rilis yang ditetapkan — terminal tidak menerima tawaran pembaruan."}{" "}
        Terminal mengunduh di latar dan memasang saat sesi kas tertutup; artefak harus
        sudah diterbitkan skrip rilis ke direktori rilis server.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block">
          <span className={labelClass}>Versi ditawarkan</span>
          <input
            className={fieldClass}
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="1.2.0"
            required
          />
        </label>
        <label className="block">
          <span className={labelClass}>Rollout (%)</span>
          <input
            className={fieldClass}
            value={rolloutPercent}
            onChange={(event) => setRolloutPercent(event.target.value)}
            inputMode="numeric"
            placeholder="100"
            required
          />
        </label>
        <label className="block">
          <span className={labelClass}>Versi minimum (wajib di bawahnya)</span>
          <input
            className={fieldClass}
            value={minVersion}
            onChange={(event) => setMinVersion(event.target.value)}
            placeholder="— opsional —"
          />
        </label>
        <label className="block">
          <span className={labelClass}>Catatan rilis</span>
          <input
            className={fieldClass}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Perbaikan & fitur versi ini"
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          className={outlineButtonClass}
          disabled={busy || !version.trim()}
        >
          <Save className="size-3.5" /> {busy ? "Menyimpan…" : "Tetapkan rilis"}
        </button>
      </div>
    </form>
  );
}

export function TerminalRowActions({
  terminalId,
  terminalName,
  status,
}: {
  terminalId: string;
  terminalName: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; qr: string } | null>(
    null,
  );
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  async function issue() {
    setBusy(true);
    const result = await issuePairingCodeAction({ terminalId });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const qr = await QRCode.toDataURL(result.data.code, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: "M",
    }).catch(() => "");
    setIssued({ code: result.data.code, expiresAt: result.data.expiresAt, qr });
    toast.success("Kode pasangan diterbitkan — berlaku 15 menit, sekali pakai.");
  }

  async function revoke() {
    setBusy(true);
    const result = await revokePosTerminalAction({ terminalId });
    setBusy(false);
    setConfirmingRevoke(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Terminal dicabut.");
    router.refresh();
  }

  if (status !== "active") return null;

  return (
    <div className="space-y-2">
      <span className="inline-flex gap-1">
        <button type="button" className={secondaryButtonClass} onClick={() => void issue()} disabled={busy}>
          <KeyRound className="size-3.5" /> Kode pasangan
        </button>
        <button type="button" className={dangerButtonClass} onClick={() => setConfirmingRevoke(true)} disabled={busy}>
          <Ban className="size-3.5" /> Cabut
        </button>
      </span>
      <ConfirmDialog
        open={confirmingRevoke}
        title={`Cabut terminal "${terminalName}"?`}
        description="Token perangkatnya berhenti bekerja pada panggilan berikutnya dan terminal harus dipasangkan ulang."
        confirmLabel="Cabut terminal"
        danger
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setConfirmingRevoke(false)}
      />
      {issued ? (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="text-[11px] text-muted-foreground">
            Ketik kode ini di aplikasi Bisa POS desktop (atau pindai QR-nya). Berlaku sampai{" "}
            {new Date(issued.expiresAt).toLocaleTimeString("id-ID")} — sesudah dipakai atau
            kedaluwarsa, kode hangus.
          </p>
          <p className="num my-2 text-lg font-bold tracking-[0.3em]">{issued.code}</p>
          {issued.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={issued.qr}
              alt={`Kode QR pasangan untuk ${terminalName}`}
              width={160}
              height={160}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DesktopDownloadSection() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Download className="size-4 text-primary" /> Unduh Aplikasi Bisa POS Desktop
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Aplikasi desktop resmi (Electron) membuka terminal POS ini dengan printer thermal
            terintegrasi, mode kios, serta dukungan LAN/HTTPS. Paket Tauri/SQLite lama sudah tidak
            didukung.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col justify-between rounded-md border bg-muted/20 p-3">
          <div>
            <div className="flex items-center gap-1 text-xs font-semibold">
              <span>Linux x86-64</span>
              <span className="rounded bg-green-100 px-1.5 py-0.5 font-mono text-[10px] text-green-800 dark:bg-green-950 dark:text-green-300">
                .AppImage
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Paket portabel resmi untuk komputer kasir Linux.
            </p>
          </div>
          <a
            href="/api/pos/download/appimage"
            download
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Download className="size-3.5" /> Unduh AppImage
          </a>
        </div>

        <div className="flex flex-col justify-between rounded-md border bg-muted/20 p-3">
          <div>
            <div className="flex items-center gap-1 text-xs font-semibold">
              <span>Windows x86-64</span>
              <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                .exe
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Installer NSIS resmi untuk komputer kasir Windows.
            </p>
          </div>
          <a
            href="/api/pos/download/exe"
            download
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Download className="size-3.5" /> Unduh Installer EXE
          </a>
        </div>
      </div>

      <div className="mt-3 space-y-1 rounded bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
        <p className="font-medium text-foreground">Catatan pemasangan:</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>Installer hanya tersedia bila administrator menerbitkannya ke <code className="font-mono font-semibold text-foreground">BISA_POS_RELEASE_DIR</code>.</li>
          <li>Untuk build dari source, gunakan panduan resmi <code className="font-mono font-semibold text-foreground">pos-electron/README.md</code>.</li>
          <li>Jalankan aplikasi dengan <code className="font-mono font-semibold text-foreground">--erp-url=https://alamat-erp-toko</code>, lalu pasangkan terminal dengan kode dari tabel di bawah.</li>
          <li>Printer USB/LAN dipilih lewat menu <strong>Atur printer</strong> di aplikasi desktop.</li>
        </ul>
      </div>
    </div>
  );
}
