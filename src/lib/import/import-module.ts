import type { ImportEntity } from "./import-entities";
import type { ModuleKey } from "@/lib/modules";

/**
 * Company module that owns an import entity. The import wizard lives under
 * Gudang, but accounting masters/assets/opening balances and employees are
 * cross-module imports and must respect their own module switch.
 */
export function importEntityModule(entity: string): ModuleKey {
  switch (entity as ImportEntity) {
    case "accounts":
    case "account_mappings":
    case "fixed_assets":
    case "opening_payables":
    case "opening_receivables":
      return "akuntansi";
    case "employees":
      return "hr";
    default:
      return "gudang";
  }
}
