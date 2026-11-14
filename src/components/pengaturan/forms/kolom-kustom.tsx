/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — kolom kustom per entitas.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { saveCustomFieldsAction } from "@/server/actions/settings/kolom-kustom";
import { fieldClass } from "@/components/blocks/field-classes";
import { useSettingsSection } from "@/components/blocks/settings-layout";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  normalizeCustomFieldKey,
  type CustomFieldDefinition,
  type CustomFieldDefinitions,
  type CustomFieldEntity,
  type CustomFieldType,
} from "@/lib/custom-fields";

/* ------------------------------------------------------------------ */
/* Custom fields (T5-2, D-16)                                          */
/* ------------------------------------------------------------------ */

type CustomFieldRowState = {
  key: string;
  label: string;
  type: CustomFieldType;
  optionsText: string;
  required: boolean;
};

function toRowState(definition: CustomFieldDefinition): CustomFieldRowState {
  return {
    key: definition.key,
    label: definition.label,
    type: definition.type,
    optionsText: definition.options?.join(", ") ?? "",
    required: definition.required ?? false,
  };
}

/**
 * Editor for company-defined custom fields on products, suppliers, and
 * customers. Definitions are validated strictly on the server; deleting
 * a definition here does not delete values already stored on rows —
 * they become invisible orphans, kept in case the field returns.
 */
export function CustomFieldsForm({ initial }: { initial: CustomFieldDefinitions | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<CustomFieldEntity, CustomFieldRowState[]>>(() => ({
    product: (initial?.product ?? []).map(toRowState),
    supplier: (initial?.supplier ?? []).map(toRowState),
    customer: (initial?.customer ?? []).map(toRowState),
  }));
  // A-25 U6 (POLA-05): saver seksi SettingsLayout — penurunan
  // definisi & aksi (saveCustomFieldsAction) persis seperti
  // submit lama.
  const baselineRef = useRef(rows);

  function setEntityRows(entity: CustomFieldEntity, next: CustomFieldRowState[]) {
    setRows((current) => ({ ...current, [entity]: next }));
  }

  function patchRow(entity: CustomFieldEntity, index: number, patch: Partial<CustomFieldRowState>) {
    setEntityRows(
      entity,
      rows[entity].map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow(entity: CustomFieldEntity) {
    if (rows[entity].length >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
      toast.error(`Maksimal ${MAX_CUSTOM_FIELDS_PER_ENTITY} kolom kustom per entitas.`);
      return;
    }
    setEntityRows(entity, [
      ...rows[entity],
      { key: "", label: "", type: "text", optionsText: "", required: false },
    ]);
  }

  async function saveAll() {
    const definitions: CustomFieldDefinitions = {};
    for (const entity of CUSTOM_FIELD_ENTITIES) {
      const list = rows[entity.key]
        .filter((row) => row.label.trim() !== "" || row.key.trim() !== "")
        .map((row) => ({
          // Kunci kosong diturunkan dari label; server tetap memvalidasi
          // hasil akhirnya secara ketat.
          key: normalizeCustomFieldKey(row.key) ?? normalizeCustomFieldKey(row.label) ?? row.key,
          label: row.label,
          type: row.type,
          ...(row.type === "select"
            ? {
                options: row.optionsText
                  .split(",")
                  .map((option) => option.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(row.required ? { required: true } : {}),
        }));
      if (list.length > 0) definitions[entity.key] = list;
    }
    const result = await saveCustomFieldsAction({ definitions });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    baselineRef.current = rows;
    router.refresh();
  }

  const { setDirty } = useSettingsSection("kolom", saveAll);

  useEffect(() => {
    setDirty(JSON.stringify(rows) !== JSON.stringify(baselineRef.current));
  }, [rows, setDirty]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <h2 className="text-[13px] font-semibold">Kolom kustom</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Tambahkan kolom sendiri pada formulir produk, pemasok, dan pelanggan — misalnya Merek,
          NPWP, atau Kode rak. Kunci menjadi pengenal teknis (huruf kecil, angka, strip/garis
          bawah) dan harus unik per entitas. Menghapus definisi tidak menghapus nilai yang sudah
          tersimpan pada data; nilai itu hanya berhenti ditampilkan.
        </p>
      </div>

      {CUSTOM_FIELD_ENTITIES.map((entity) => (
        <section key={entity.key} className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h3 className="text-[13px] font-semibold">{entity.label}</h3>
            <button
              type="button"
              onClick={() => addRow(entity.key)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted"
            >
              <Plus className="size-3.5" /> Tambah kolom
            </button>
          </div>
          {rows[entity.key].length === 0 ? (
            <p className="px-4 py-5 text-[11px] text-muted-foreground">
              Belum ada kolom kustom untuk {entity.label.toLowerCase()}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Kunci</th>
                    <th>Tipe</th>
                    <th>Pilihan (untuk tipe Pilihan, pisahkan koma)</th>
                    <th>Wajib</th>
                    <th className="text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows[entity.key].map((row, index) => (
                    <tr key={index}>
                      <td>
                        <input
                          value={row.label}
                          onChange={(event) => patchRow(entity.key, index, { label: event.target.value })}
                          className={fieldClass}
                          placeholder="cth. Merek"
                          aria-label={`Label kolom ${entity.label} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          value={row.key}
                          onChange={(event) =>
                            patchRow(entity.key, index, { key: event.target.value })
                          }
                          onBlur={(event) =>
                            patchRow(entity.key, index, {
                              key: normalizeCustomFieldKey(event.target.value) ?? event.target.value,
                            })
                          }
                          className={`${fieldClass} num`}
                          placeholder={normalizeCustomFieldKey(row.label) ?? "cth. merek"}
                          aria-label={`Kunci kolom ${entity.label} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <select
                          value={row.type}
                          onChange={(event) =>
                            patchRow(entity.key, index, { type: event.target.value as CustomFieldType })
                          }
                          className={fieldClass}
                          aria-label={`Tipe kolom ${entity.label} ${index + 1}`}
                        >
                          {CUSTOM_FIELD_TYPES.map((type) => (
                            <option key={type.key} value={type.key}>{type.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={row.optionsText}
                          onChange={(event) => patchRow(entity.key, index, { optionsText: event.target.value })}
                          className={fieldClass}
                          placeholder={row.type === "select" ? "Lokal, Impor" : "—"}
                          disabled={row.type !== "select"}
                          aria-label={`Pilihan kolom ${entity.label} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.required}
                          onChange={(event) => patchRow(entity.key, index, { required: event.target.checked })}
                          aria-label={`Wajib kolom ${entity.label} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              if (row.key && baselineRef.current[entity.key]?.some((b) => b.key === row.key)) {
                                if (
                                  !window.confirm(
                                    `Menghapus definisi kolom "${row.label || row.key}" tidak akan menghapus nilai yang sudah tersimpan pada database entitas, tetapi nilai tersebut tidak akan ditampilkan lagi. Tetap hapus?`,
                                  )
                                ) {
                                  return;
                                }
                              }
                              setEntityRows(
                                entity.key,
                                rows[entity.key].filter((_, i) => i !== index),
                              );
                            }}
                            className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

    </div>
  );
}
