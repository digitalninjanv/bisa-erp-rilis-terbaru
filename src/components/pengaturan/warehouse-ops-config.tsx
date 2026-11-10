"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveAdjustmentReasonsAction, saveOpnameCycleAction } from "@/server/actions/settings/operasi-gudang";
import {
  DEFAULT_ADJUSTMENT_REASONS,
  MAX_ADJUSTMENT_REASONS,
} from "@/lib/adjustment-reasons";
import type { OpnameCycleConfig } from "@/lib/opname-cycle";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { useSettingsSection } from "@/components/blocks/settings-layout";

/**
 * A-24 T3: editor konfigurasi operasional gudang (tab Gudang &
 * cabang) — daftar alasan penyesuaian (G4) dan frekuensi hitung
 * opname untuk pengingat jatuh tempo (G3). Keduanya konfigurasi per
 * perusahaan yang tersimpan di company_settings; tidak ada nilai
 * bisnis yang tertanam di kode selain bawaan lib bersama.
 */

export function AdjustmentReasonsEditor({
  initialReasons,
  isCustom,
}: {
  /** Daftar efektif saat ini (konfigurasi perusahaan atau bawaan). */
  initialReasons: string[];
  /** True bila perusahaan sudah menyimpan daftarnya sendiri. */
  isCustom: boolean;
}) {
  const router = useRouter();
  const [reasons, setReasons] = useState<string[]>(initialReasons);
  // A-25 U6 (POLA-05): tombol "Simpan daftar" sendiri dibuang —
  // editor ini saver seksi SettingsLayout. Validasi & aksi
  // (saveAdjustmentReasonsAction atas daftar terbersihkan) persis
  // seperti sebelumnya; "Kembalikan ke bawaan" kini hanya mengubah
  // keadaan lokal dan ikut tersimpan lewat bilah yang sama.
  const baselineRef = useRef<string[]>(initialReasons);

  async function saveAll() {
    const cleaned = reasons.map((row) => row.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      toast.error("Daftar alasan harus berisi minimal satu label.");
      throw new Error("Daftar alasan kosong.");
    }
    const result = await saveAdjustmentReasonsAction({ reasons: cleaned });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    baselineRef.current = cleaned;
    setReasons(cleaned);
    router.refresh();
  }

  const { setDirty } = useSettingsSection("lokasi-alasan", saveAll);

  useEffect(() => {
    setDirty(JSON.stringify(reasons) !== JSON.stringify(baselineRef.current));
  }, [reasons, setDirty]);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Alasan penyesuaian stok</h2>
        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
          Pilihan alasan pada form Penyesuaian stok (modul Gudang).{" "}
          {isCustom
            ? "Perusahaan ini memakai daftarnya sendiri."
            : "Perusahaan ini masih memakai daftar bawaan."}{" "}
          Kategori <span className="font-medium text-foreground">Lainnya</span> selalu meminta
          rincian bebas dari petugas.
        </p>
      </div>
      <div className="space-y-2 p-4">
        {reasons.map((reason, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={reason}
              onChange={(event) =>
                setReasons((current) =>
                  current.map((row, i) => (i === index ? event.target.value : row)),
                )
              }
              className={fieldClass}
              aria-label={`Alasan ${index + 1}`}
              maxLength={60}
            />
            <button
              type="button"
              onClick={() => setReasons((current) => current.filter((_, i) => i !== index))}
              disabled={reasons.length <= 1}
              className="grid size-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              aria-label={`Hapus alasan ${reason}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => setReasons((current) => [...current, ""])}
            disabled={reasons.length >= MAX_ADJUSTMENT_REASONS}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Tambah alasan
          </button>
          <button
            type="button"
            onClick={() => setReasons([...DEFAULT_ADJUSTMENT_REASONS])}
            className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium text-muted-foreground hover:bg-muted"
          >
            Kembalikan ke bawaan
          </button>
        </div>
      </div>
    </section>
  );
}

export function OpnameCycleEditor({
  warehouses,
  categories,
  initialConfig,
}: {
  warehouses: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  initialConfig: OpnameCycleConfig;
}) {
  const router = useRouter();
  const [warehouseDays, setWarehouseDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialConfig.warehouseDays).map(([id, days]) => [id, String(days)]),
    ),
  );
  const [categoryDays, setCategoryDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialConfig.categoryDays).map(([id, days]) => [id, String(days)]),
    ),
  );
  // A-25 U6 (POLA-05): saver seksi SettingsLayout — konversi &
  // aksi (saveOpnameCycleAction) persis seperti tombol lama.
  const baselineRef = useRef({ warehouseDays, categoryDays });

  function toDayMap(values: Record<string, string>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, raw] of Object.entries(values)) {
      const days = Number(raw);
      if (raw.trim() && Number.isFinite(days) && days >= 1) result[id] = Math.floor(days);
    }
    return result;
  }

  async function saveAll() {
    const result = await saveOpnameCycleAction({
      config: {
        warehouseDays: toDayMap(warehouseDays),
        categoryDays: toDayMap(categoryDays),
      },
    });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    baselineRef.current = { warehouseDays, categoryDays };
    router.refresh();
  }

  const { setDirty } = useSettingsSection("lokasi-siklus", saveAll);

  useEffect(() => {
    setDirty(
      JSON.stringify(warehouseDays) !== JSON.stringify(baselineRef.current.warehouseDays) ||
        JSON.stringify(categoryDays) !== JSON.stringify(baselineRef.current.categoryDays),
    );
  }, [warehouseDays, categoryDays, setDirty]);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Frekuensi hitung opname</h2>
        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
          Pengingat di dashboard Gudang saat gudang/kategori melewati jadwal hitungnya.
          Kosongkan untuk mematikan pengingat cakupan itu. Ini pengingat saja — tidak ada
          opname yang dibuat otomatis.
        </p>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className={labelClass}>Per gudang (hari)</p>
          <div className="mt-1.5 space-y-1.5">
            {warehouses.map((warehouse) => (
              <label key={warehouse.id} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate">{warehouse.name}</span>
                <input
                  value={warehouseDays[warehouse.id] ?? ""}
                  onChange={(event) =>
                    setWarehouseDays((current) => ({
                      ...current,
                      [warehouse.id]: event.target.value,
                    }))
                  }
                  inputMode="numeric"
                  placeholder="—"
                  aria-label={`Frekuensi hitung ${warehouse.name} (hari)`}
                  className="num h-9 w-20 rounded-md border border-input bg-background px-2 text-right text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
                <span className="text-muted-foreground">hari</span>
              </label>
            ))}
          </div>
        </div>
        {categories.length > 0 ? (
          <div>
            <p className={labelClass}>Per kategori produk (hari)</p>
            <div className="mt-1.5 space-y-1.5">
              {categories.map((category) => (
                <label key={category.id} className="flex items-center gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <input
                    value={categoryDays[category.id] ?? ""}
                    onChange={(event) =>
                      setCategoryDays((current) => ({
                        ...current,
                        [category.id]: event.target.value,
                      }))
                    }
                    inputMode="numeric"
                    placeholder="—"
                    aria-label={`Frekuensi hitung kategori ${category.name} (hari)`}
                    className="num h-9 w-20 rounded-md border border-input bg-background px-2 text-right text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                  <span className="text-muted-foreground">hari</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
