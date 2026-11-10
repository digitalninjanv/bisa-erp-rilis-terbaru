/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — penomoran dokumen.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveDocumentNumberingAction } from "@/server/actions/settings/penomoran";
import {
  DEFAULT_NUMBER_PADDING,
  DOCUMENT_NUMBER_TYPES,
  MAX_NUMBER_PADDING,
  MIN_NUMBER_PADDING,
  type DocumentNumbering,
} from "@/lib/document-numbering";
import { fieldClass } from "@/components/blocks/field-classes";
import { useSettingsSection } from "@/components/blocks/settings-layout";

type NumberingRowState = { prefix: string; padding: string };

/**
 * Per-document-type number format overrides (AK-P3-07). Empty fields
 * mean "use the built-in default" — the row's example column shows the
 * live format so the cashier-facing result is never a surprise. Saving
 * with every field empty removes all overrides.
 */
export function DocumentNumberingForm({ initial }: { initial: DocumentNumbering | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, NumberingRowState>>(() =>
    Object.fromEntries(
      DOCUMENT_NUMBER_TYPES.map((type) => [
        type.key,
        {
          prefix: initial?.[type.key]?.prefix ?? "",
          padding: initial?.[type.key]?.padding ? String(initial[type.key]!.padding) : "",
        },
      ]),
    ),
  );
  // A-25 U6 (POLA-05): saver seksi SettingsLayout — payload &
  // aksi (saveDocumentNumberingAction) persis seperti submit lama.
  // "Reset ke bawaan" kini hanya mengubah keadaan lokal (dan
  // menandai kotor); penyimpanan tetap satu pintu lewat bilah.
  const baselineRef = useRef(rows);

  function setRow(key: string, patch: Partial<NumberingRowState>) {
    setRows((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function resetAll() {
    setRows(
      Object.fromEntries(DOCUMENT_NUMBER_TYPES.map((type) => [type.key, { prefix: "", padding: "" }])),
    );
  }

  async function saveAll() {
    const result = await saveDocumentNumberingAction({
      entries: DOCUMENT_NUMBER_TYPES.map((type) => ({
        docType: type.key,
        prefix: rows[type.key]?.prefix ?? "",
        padding: rows[type.key]?.padding ? Number(rows[type.key]!.padding) : null,
      })),
    });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    baselineRef.current = rows;
    router.refresh();
  }

  const { setDirty } = useSettingsSection("nomor", saveAll);

  useEffect(() => {
    setDirty(JSON.stringify(rows) !== JSON.stringify(baselineRef.current));
  }, [rows, setDirty]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Penomoran dokumen</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Sesuaikan awalan dan lebar nomor urut per jenis dokumen. Format selalu{" "}
          <span className="num">AWALAN-TAHUN-NOMOR</span>; kolom yang dikosongkan memakai bawaan.
          Nomor yang sudah terbit tidak berubah — pengaturan berlaku untuk dokumen berikutnya,
          dan nomor urut tidak pernah dipakai ulang.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Jenis dokumen</th>
              <th>Contoh format</th>
              <th>Awalan kustom</th>
              <th>Lebar nomor (digit)</th>
            </tr>
          </thead>
          <tbody>
            {DOCUMENT_NUMBER_TYPES.map((type) => {
              const row = rows[type.key] ?? { prefix: "", padding: "" };
              const prefix = row.prefix.trim().toUpperCase() || type.defaultPrefix;
              const padding = row.padding ? Number(row.padding) : DEFAULT_NUMBER_PADDING;
              const sample = `${prefix}-2026-${"1".padStart(Number.isFinite(padding) ? padding : DEFAULT_NUMBER_PADDING, "0")}`;
              return (
                <tr key={type.key}>
                  <td className="text-[12px] font-medium">{type.label}</td>
                  <td className="num text-[11px] text-muted-foreground">{sample}</td>
                  <td>
                    <input
                      value={row.prefix}
                      onChange={(event) => setRow(type.key, { prefix: event.target.value })}
                      className={`${fieldClass} num uppercase`}
                      placeholder={type.defaultPrefix}
                      maxLength={10}
                      aria-label={`Awalan kustom ${type.label}`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={MIN_NUMBER_PADDING}
                      max={MAX_NUMBER_PADDING}
                      value={row.padding}
                      onChange={(event) => setRow(type.key, { padding: event.target.value })}
                      className={`${fieldClass} num`}
                      placeholder={String(DEFAULT_NUMBER_PADDING)}
                      aria-label={`Lebar nomor ${type.label}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={resetAll}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted"
        >
          Reset ke bawaan
        </button>
      </div>
    </div>
  );
}
