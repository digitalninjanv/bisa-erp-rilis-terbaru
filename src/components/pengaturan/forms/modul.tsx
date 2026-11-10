/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — saklar modul aktif per perusahaan.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveEnabledModulesAction } from "@/server/actions/settings/modul";
import { MODULE_LIST, sanitizeEnabledModules, type ModuleKey } from "@/lib/modules";
import { useSettingsSection } from "@/components/blocks/settings-layout";

/* ------------------------------------------------------------------ */
/* Module switch (T5-2, D-16)                                          */
/* ------------------------------------------------------------------ */

const MODULE_SWITCH_DESCRIPTIONS: Record<ModuleKey, string> = {
  pos: "Kasir, riwayat transaksi, retur penjualan, dan sesi kas.",
  gudang: "Produk, penerimaan, pembelian, penyesuaian, transfer, dan opname.",
  akuntansi: "Jurnal, buku besar, laporan keuangan, bank, dan piutang/utang.",
  hr: "Karyawan, absensi, cuti, lembur, kasbon, pinjaman, reimbursement, dan payroll.",
  analisa: "Indikator kesehatan bisnis, ABC-FSN, perputaran stok, dan risiko persediaan.",
};

/**
 * Per-company module switch. Disabling a module hides it from the
 * shell and redirects its pages to Beranda; no data is deleted and
 * Pengaturan stays reachable so it can be switched back on.
 */
export function ModuleSettingsForm({ initial }: { initial: unknown }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<Record<ModuleKey, boolean>>(() => {
    const active = sanitizeEnabledModules(initial);
    return {
      pos: active.includes("pos"),
      gudang: active.includes("gudang"),
      akuntansi: active.includes("akuntansi"),
      hr: active.includes("hr"),
      analisa: active.includes("analisa"),
    };
  });
  // A-25 U6 (POLA-05): saver seksi SettingsLayout — payload &
  // aksi (saveEnabledModulesAction) persis seperti submit lama.
  const baselineRef = useRef(enabled);

  async function saveAll() {
    const result = await saveEnabledModulesAction(enabled);
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    baselineRef.current = enabled;
    router.refresh();
  }

  const { setDirty } = useSettingsSection("modul", saveAll);

  useEffect(() => {
    setDirty(JSON.stringify(enabled) !== JSON.stringify(baselineRef.current));
  }, [enabled, setDirty]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Modul aktif</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Matikan modul yang tidak dipakai perusahaan ini — misalnya POS untuk usaha yang hanya
          menjual lewat faktur. Modul yang mati hilang dari navigasi dan halamannya dialihkan ke
          Beranda; data di dalamnya tidak dihapus. Beranda dan Pengaturan selalu aktif.
        </p>
      </div>
      <div className="divide-y divide-border">
        {MODULE_LIST.map((module) => (
          <label key={module.key} className="flex cursor-pointer items-start gap-3 px-4 py-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enabled[module.key]}
              onChange={(event) =>
                setEnabled((current) => ({ ...current, [module.key]: event.target.checked }))
              }
            />
            <span>
              <span className="block text-[12px] font-medium">
                {module.name}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {enabled[module.key] ? "Aktif" : "Nonaktif"}
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {MODULE_SWITCH_DESCRIPTIONS[module.key]}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
