import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G2 (FRM-03/FRM-05, Program Perbaikan Gabungan) — primitif form
 * satu pintu.
 *
 * Penjaga permanen: permukaan yang sudah dimigrasi TIDAK BOLEH
 * kembali ke pola racikan —
 *  1. Titik kuantitas terdaftar memakai QtyInput bersama
 *     (src/components/qty-input.tsx); parse/jepit tangan per form
 *     adalah temuan FRM-03 yang ditutup tahap ini.
 *  2. Form terdaftar menjalankan aksi lewat helper submit bersama
 *     (src/components/use-action-runner.ts: useActionRunner /
 *     runActionResult / requireFilled) — bukan duplikasi pola
 *     busy + periksa-result.ok + toast yang sama (FRM-05).
 *
 * Daftar ini SENGAJA hanya memuat titik yang benar-benar
 * dimigrasi di G2; adopsi lanjutan dicatat di
 * docs/form-crud/HASIL-G2.md dan ditambahkan ke daftar ini
 * ketika dimigrasi, bukan sebelumnya.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const QTY_INPUT_SURFACES = [
  "components/gudang/line-editor.tsx",
  "components/gudang/opname-count-table.tsx",
  "components/gudang/opname-packaging-popover.tsx",
  "components/gudang/supplier-return-form.tsx",
  "components/gudang/supplier-return-resolutions.tsx",
  "components/gudang/transfer-receive-form.tsx",
  "components/gudang/product-form.tsx",
  "components/gudang/reservation-panel.tsx",
  "components/gudang/purchase-request-panel.tsx",
  "components/akuntansi/hr/overtime.tsx",
  "components/akuntansi/hr/leave.tsx",
  "components/pos/return-form.tsx",
  "components/pos/cart-panel.tsx",
  "components/pengaturan/payroll-indonesia-form.tsx",
];

const ACTION_RUNNER_SURFACES = [
  "components/pengaturan/payroll-indonesia-form.tsx",
  "components/pengaturan/group-pricing.tsx",
  "components/akuntansi/capital-form.tsx",
  "components/gudang/product-form.tsx",
  "components/gudang/adjustment-form.tsx",
  "components/gudang/partner-forms.tsx",
  "components/gudang/taxonomy-manager.tsx",
  "components/gudang/receipt-form.tsx",
  "components/pengaturan/forms/gudang-cabang.tsx",
  "components/akuntansi/hr/overtime.tsx",
  "components/akuntansi/hr/leave.tsx",
  "components/akuntansi/hr/attendance.tsx",
  "components/pos/return-form.tsx",
  "components/pos/use-held-sales.ts",
];

function read(rel: string): string {
  const full = path.join(SRC_DIR, rel);
  expect(existsSync(full), `${rel} harus ada`).toBe(true);
  return readFileSync(full, "utf8");
}

describe("G2 primitif form satu pintu", () => {
  it("permukaan kuantitas terdaftar memakai QtyInput bersama", () => {
    for (const rel of QTY_INPUT_SURFACES) {
      expect(read(rel), `${rel} harus mengimpor QtyInput bersama`).toContain(
        'from "@/components/qty-input"',
      );
    }
  });

  it("form terdaftar memakai helper submit bersama", () => {
    for (const rel of ACTION_RUNNER_SURFACES) {
      expect(read(rel), `${rel} harus mengimpor helper submit bersama`).toContain(
        'from "@/components/use-action-runner"',
      );
    }
  });
});
