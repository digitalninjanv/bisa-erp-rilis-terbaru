/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — pengunggah gambar QRIS.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp } from "lucide-react";
import { toast } from "sonner";
import { uploadQrisAction } from "@/server/actions/settings/pembayaran";

export function QrisUploader({ current }: { current: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    if (file.size > 600 * 1024) {
      toast.error("Ukuran gambar maksimum 600KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl.startsWith("data:image/")) {
        toast.error("File harus berupa gambar.");
        return;
      }
      setPreview(dataUrl);
      setBusy(true);
      const result = await uploadQrisAction({ dataUrl });
      setBusy(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Gambar QRIS diperbarui.");
      router.refresh();
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-[13px] font-semibold">QRIS pembayaran</h2>
      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
        Unggah gambar QRIS statis toko. Gambar ditampilkan di layar kasir saat pelanggan memilih QRIS.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div className="grid size-24 place-items-center overflow-hidden rounded-md border border-border bg-muted">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="QRIS toko" className="size-full object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground">Belum ada</span>
          )}
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
          >
            <ImageUp className="size-3.5" /> {busy ? "Mengunggah…" : "Pilih gambar"}
          </button>
          <p className="mt-1.5 text-[10px] text-muted-foreground">PNG/JPG/WebP, maks. 600KB.</p>
        </div>
      </div>
    </div>
  );
}
