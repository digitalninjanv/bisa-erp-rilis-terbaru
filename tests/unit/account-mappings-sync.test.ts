import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MAPPING_KEYS,
  MAPPING_DESCRIPTIONS,
  MAPPING_GROUPS,
  MAPPING_LABELS,
} from "@/lib/account-mappings";

/**
 * A-24 T4 — pemetaan akun berbahasa transaksi (pola Accurate).
 * Kunci yang bisa disimpan (ACCOUNT_MAPPING_KEYS, dipakai
 * saveMappingAction) harus persis kunci yang ditampilkan
 * (MAPPING_LABELS), setiap kunci punya penjelasan satu baris, dan
 * pengelompokan form membagi seluruh kunci tepat satu kali — agar
 * tidak ada kunci pemetaan yang tak terlihat/tak terjelaskan di
 * Pengaturan.
 */
describe("A-24 T4: katalog pemetaan akun selaras", () => {
  it("label mencakup persis kunci resmi yang bisa disimpan", () => {
    expect(new Set(Object.keys(MAPPING_LABELS))).toEqual(new Set(ACCOUNT_MAPPING_KEYS));
  });

  it("setiap kunci resmi punya label & penjelasan satu baris non-kosong", () => {
    for (const key of ACCOUNT_MAPPING_KEYS) {
      expect(MAPPING_LABELS[key], `label ${key}`).toBeTruthy();
      const description = MAPPING_DESCRIPTIONS[key];
      expect(description, `deskripsi ${key}`).toBeTruthy();
      expect(description!.length, `deskripsi ${key} cukup menjelaskan`).toBeGreaterThan(20);
    }
    expect(new Set(Object.keys(MAPPING_DESCRIPTIONS))).toEqual(new Set(ACCOUNT_MAPPING_KEYS));
  });

  it("grup form membagi seluruh kunci tepat satu kali", () => {
    const grouped = MAPPING_GROUPS.flatMap((group) => group.keys);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(ACCOUNT_MAPPING_KEYS));
    for (const group of MAPPING_GROUPS) {
      expect(group.title).toBeTruthy();
      expect(group.keys.length).toBeGreaterThan(0);
    }
  });
});
