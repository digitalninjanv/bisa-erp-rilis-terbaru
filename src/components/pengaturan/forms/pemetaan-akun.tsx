/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — pemetaan akun otomatis.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { saveMappingAction } from "@/server/actions/accounting/akun-pemetaan";
import { useSettingsSection } from "@/components/blocks/settings-layout";
import { MAPPING_DESCRIPTIONS, MAPPING_GROUPS, MAPPING_LABELS } from "@/lib/account-mappings";
import type { Account } from "./shared";

/**
 * A-24 T4: label & grup pemetaan akun kini hidup di
 * `src/lib/account-mappings.ts` (satu sumber bersama pengujian
 * sinkronisasi); di-re-export di sini demi kompatibilitas pemanggil
 * lama.
 */
export { MAPPING_GROUPS, MAPPING_LABELS };

export function MappingEditor({
  mappings,
  accounts,
}: {
  mappings: { key: string; accountId: string }[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(mappings.map((row) => [row.key, row.accountId])),
  );
  // A-25 U6 (POLA-05): tombol Simpan per baris (satu per kunci
  // pemetaan) dibuang — seksi ini mendaftar satu saver yang
  // menyimpan SEMUA kunci yang berubah lewat aksi yang sama persis
  // (saveMappingAction per kunci, berurutan). Pilihan kosong tidak
  // pernah disimpan, sama seperti tombol lama yang nonaktif saat
  // pilihan kosong.
  const baselineRef = useRef<Record<string, string>>(
    Object.fromEntries(mappings.map((row) => [row.key, row.accountId])),
  );

  async function saveAll() {
    const changed = Object.keys(values).filter(
      (key) => values[key] && values[key] !== baselineRef.current[key],
    );
    const failures: string[] = [];
    for (const key of changed) {
      const result = await saveMappingAction({ key, accountId: values[key] });
      if (!result.ok) {
        toast.error(result.message);
        failures.push(key);
      } else {
        baselineRef.current = { ...baselineRef.current, [key]: values[key] };
      }
    }
    if (failures.length > 0) {
      throw new Error(`Pemetaan gagal disimpan: ${failures.join(", ")}`);
    }
    if (changed.length > 0) router.refresh();
  }

  const { setDirty } = useSettingsSection("akun", saveAll);

  useEffect(() => {
    setDirty(
      Object.keys(values).some(
        (key) => values[key] && values[key] !== baselineRef.current[key],
      ),
    );
  }, [values, setDirty]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><Settings2 className="size-3.5 text-muted-foreground" /> Pemetaan akun otomatis</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Menentukan akun yang dipakai jurnal otomatis dari POS, gudang, beban, retur, karyawan, payroll, dan aset tetap.
        </p>
      </div>
      <div className="divide-y divide-border/70">
        {MAPPING_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="bg-muted/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </p>
            <div className="divide-y divide-border/50">
              {group.keys.map((key) => (
                <div key={key} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <span className="min-w-[200px] flex-1 text-[12px]">
                    {MAPPING_LABELS[key]}
                    {/* A-24 T4: penjelasan berbahasa transaksi per
                        kunci (pola Accurate) — kapan akun ini bergerak. */}
                    {MAPPING_DESCRIPTIONS[key] ? (
                      <span className="block text-[11px] leading-snug text-muted-foreground">
                        {MAPPING_DESCRIPTIONS[key]}
                      </span>
                    ) : null}
                  </span>
                  <select
                    value={values[key] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    className="field-control h-9 min-w-[220px] rounded border border-input bg-background px-1.5 text-[11px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    <option value="">— belum dipetakan —</option>
                    {accounts.map((row) => (
                      <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
