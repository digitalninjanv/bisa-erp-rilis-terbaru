import {
  validateCustomFieldValues,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from "@/lib/custom-fields";
import { normalizeHeader, type ImportFieldDef } from "./import-cells";

const CUSTOM_FIELD_MAPPING_PREFIX = "customField:";

export function customFieldImportMappingKey(key: string): string {
  return `${CUSTOM_FIELD_MAPPING_PREFIX}${key}`;
}

export function customFieldImportHeader(field: CustomFieldDefinition): string {
  return `Kolom kustom — ${field.label}`;
}

/** A custom field is optional for the import file; required values may be completed later. */
export function customFieldImportField(field: CustomFieldDefinition): ImportFieldDef {
  const header = customFieldImportHeader(field);
  return {
    key: customFieldImportMappingKey(field.key),
    label: field.required ? `${header} (wajib pada data)` : header,
    aliases: [normalizeHeader(header), normalizeHeader(field.label)],
  };
}

export function importCustomFieldValues(input: {
  entity: CustomFieldEntity;
  definitions: CustomFieldDefinition[];
  row: Record<string, unknown>;
  mapping: Partial<Record<string, string>>;
}): {
  attributes: Record<string, string> | null;
  missingRequiredLabels: string[];
  error: string | null;
} {
  const { entity, definitions, row, mapping } = input;
  const validationDefinitions: CustomFieldDefinition[] = [];
  const values: Record<string, unknown> = {};
  const missingRequiredLabels: string[] = [];

  for (const field of definitions) {
    const header = mapping[customFieldImportMappingKey(field.key)];
    if (!header || !Object.prototype.hasOwnProperty.call(row, header)) {
      if (field.required) missingRequiredLabels.push(field.label);
      continue;
    }

    const raw = row[header];
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    if (field.required && text === "") {
      missingRequiredLabels.push(field.label);
      continue;
    }

    validationDefinitions.push(field);
    values[field.key] = raw;
  }

  try {
    const patch =
      validationDefinitions.length > 0
        ? validateCustomFieldValues({ [entity]: validationDefinitions }, entity, values)
        : {};
    const attributes = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== null),
    ) as Record<string, string>;
    return {
      attributes: Object.keys(attributes).length > 0 ? attributes : null,
      missingRequiredLabels,
      error: null,
    };
  } catch (error) {
    return {
      attributes: null,
      missingRequiredLabels,
      error: error instanceof Error ? error.message : "Nilai kolom kustom tidak valid.",
    };
  }
}
