/**
 * A-26 Q7 (K-07): pecahan `hr-panel.tsx` per fitur — parameter HR perusahaan.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `hr-panel.tsx` kini barrel re-export.
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSettingsSection } from "@/components/blocks/settings-layout";
import { updateHrParameterAction } from "@/server/actions/hr/organisasi";

export type HrParameterRow = { key: string; label: string; value: string; kind: "number" | "switch" };

/** Formulir parameter HR per perusahaan — semua angka aturan hidup di sini (D-25). */
export function HrParametersForm({ rows }: { rows: HrParameterRow[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.key, row.value])),
  );

  // A-25 U6 (POLA-05): tombol Simpan per baris (5 tombol) dibuang —
  // form ini saver seksi SettingsLayout di hub HR yang menyimpan
  // semua parameter berubah lewat updateHrParameterAction yang sama.
  async function saveAll() {
    const changed = rows.filter((row) => (values[row.key] ?? row.value) !== row.value);
    let failed = false;
    for (const row of changed) {
      const result = await updateHrParameterAction({ key: row.key, value: values[row.key] ?? row.value });
      if (!result.ok) {
        toast.error(result.message);
        failed = true;
      }
    }
    if (failed) throw new Error("Sebagian parameter HR gagal disimpan.");
    if (changed.length > 0) router.refresh();
  }

  const { setDirty } = useSettingsSection("parameter-hr", saveAll);
  const anyChanged = rows.some((row) => (values[row.key] ?? row.value) !== row.value);

  useEffect(() => {
    setDirty(anyChanged);
  }, [anyChanged, setDirty]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Pengaturan HR</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Semua nilai adalah konfigurasi perusahaan dan berlaku sejak disimpan — tidak ada angka aturan di dalam kode.
        </p>
      </div>
      <ul className="divide-y divide-border/70">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className="text-[12px]">{row.label}</span>
            <span className="flex items-center gap-2">
              {row.kind === "switch" ? (
                <label className="flex items-center gap-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    checked={(values[row.key] ?? row.value) === "true"}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [row.key]: event.target.checked ? "true" : "false" }))
                    }
                  />
                  Aktif
                </label>
              ) : (
                <input
                  value={values[row.key] ?? row.value}
                  onChange={(event) => setValues((current) => ({ ...current, [row.key]: event.target.value }))}
                  inputMode="numeric"
                  className="h-9 w-24 rounded-md border border-input bg-background px-2 text-right text-[12px]"
                />
              )}
              {(values[row.key] ?? row.value) !== row.value ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
                  <span aria-hidden className="size-1.5 rounded-full bg-tone-amber" />
                  Berubah
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
