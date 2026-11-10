import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_SIZE,
  normalizePage,
  normalizePageParams,
  pageOffset,
  pageResult,
  parsePageParam,
  totalPages,
} from "@/lib/pagination";

/**
 * A-26 Q5 (P-06/D-05) — mekanik paginasi bersama. Nilai harap dihitung
 * dari idiom mayoritas yang sudah berjalan di server sebelum
 * sentralisasi: page = Math.max(1, page ?? 1); pageSize = Math.min(200,
 * Math.max(1, pageSize ?? bawaan)).
 */
describe("normalizePage", () => {
  it("bawaan 1 dan jepit bawah di 1", () => {
    expect(normalizePage(undefined)).toBe(1);
    expect(normalizePage(1)).toBe(1);
    expect(normalizePage(0)).toBe(1);
    expect(normalizePage(-7)).toBe(1);
    expect(normalizePage(12)).toBe(12);
  });
});

describe("normalizePageParams", () => {
  it("memakai nilai bawaan pageSize per situs", () => {
    expect(normalizePageParams({}, 25)).toEqual({ page: 1, pageSize: 25 });
    expect(normalizePageParams({}, 40)).toEqual({ page: 1, pageSize: 40 });
    expect(normalizePageParams({}, 50)).toEqual({ page: 1, pageSize: 50 });
  });

  it("menjepit pageSize ke 1..200", () => {
    expect(normalizePageParams({ pageSize: 0 }, 25).pageSize).toBe(1);
    expect(normalizePageParams({ pageSize: -3 }, 25).pageSize).toBe(1);
    expect(normalizePageParams({ pageSize: 30 }, 25).pageSize).toBe(30);
    expect(normalizePageParams({ pageSize: 500 }, 25).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizePageParams({ pageSize: 200 }, 25).pageSize).toBe(200);
  });

  it("menjepit page lewat normalizePage", () => {
    expect(normalizePageParams({ page: 0, pageSize: 10 }, 25)).toEqual({ page: 1, pageSize: 10 });
    expect(normalizePageParams({ page: 4, pageSize: 10 }, 25)).toEqual({ page: 4, pageSize: 10 });
  });
});

describe("pageOffset & totalPages", () => {
  it("offset = (page - 1) * pageSize", () => {
    expect(pageOffset(1, 25)).toBe(0);
    expect(pageOffset(2, 25)).toBe(25);
    expect(pageOffset(3, 40)).toBe(80);
  });

  it("totalPages membulatkan ke atas; total 0 = 0 halaman", () => {
    expect(totalPages(0, 25)).toBe(0);
    expect(totalPages(1, 25)).toBe(1);
    expect(totalPages(50, 25)).toBe(2);
    expect(totalPages(65, 25)).toBe(3);
    expect(totalPages(10, 0)).toBe(0);
  });
});

describe("pageResult", () => {
  it("merakit bentuk kanonis termasuk totalPages terderivasi", () => {
    expect(pageResult(["a", "b"], 65, 2, 25)).toEqual({
      rows: ["a", "b"],
      total: 65,
      page: 2,
      pageSize: 25,
      totalPages: 3,
    });
  });
});

describe("parsePageParam", () => {
  it("ekstraksi persis idiom inline lama Number(params.page ?? 1)", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("7")).toBe(7);
    expect(parsePageParam("0")).toBe(0); // jepit otoritatif ada di server
    expect(parsePageParam(["3"])).toBe(3);
    // Nilai tak absah tetap NaN seperti idiom lama — helper tidak
    // mengarang semantik baru; normalizePageParams di server yang
    // menjepit hasil parse halaman yang sah.
    expect(Number.isNaN(parsePageParam("abc"))).toBe(true);
  });
});
