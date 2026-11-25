import { describe, expect, it } from "vitest";
import { mergeProductCache } from "@/lib/pos/product-cache";
import {
  parsePosProductSearchInput,
  POS_PRODUCT_SEARCH_MAX_OFFSET,
  POS_PRODUCT_SEARCH_MAX_QUERY_LENGTH,
} from "@/lib/pos/product-search-input";

describe("POS product search bounds", () => {
  it("accepts a blank search and the historical 100k-product boundary", () => {
    expect(parsePosProductSearchInput("   ", POS_PRODUCT_SEARCH_MAX_OFFSET)).toEqual({
      query: "",
      offset: POS_PRODUCT_SEARCH_MAX_OFFSET,
    });
  });

  it("rejects oversized queries and invalid or unbounded offsets", () => {
    expect(() =>
      parsePosProductSearchInput("x".repeat(POS_PRODUCT_SEARCH_MAX_QUERY_LENGTH + 1), 0),
    ).toThrow();
    expect(() =>
      parsePosProductSearchInput(" ".repeat(POS_PRODUCT_SEARCH_MAX_QUERY_LENGTH + 1), 0),
    ).toThrow();
    expect(() => parsePosProductSearchInput("kopi", -1)).toThrow();
    expect(() => parsePosProductSearchInput("kopi", POS_PRODUCT_SEARCH_MAX_OFFSET + 1)).toThrow();
    expect(() => parsePosProductSearchInput("kopi", Number.POSITIVE_INFINITY)).toThrow();
    expect(() => parsePosProductSearchInput("kopi", 1.5)).toThrow();
  });
});

describe("bounded POS product cache", () => {
  it("evicts least-recent unpinned products and retains cart products", () => {
    const initial = Object.fromEntries(
      Array.from({ length: 5 }, (_, id) => [`product-${id}`, { id: `product-${id}` }]),
    );

    const cache = mergeProductCache(
      initial,
      [{ id: "product-5" }],
      ["product-0"],
      4,
    );

    expect(Object.keys(cache)).toEqual(["product-3", "product-4", "product-5", "product-0"]);
    expect(cache["product-0"]).toBeDefined();
  });

  it("does not evict the products returned by the active page", () => {
    const cache = mergeProductCache(
      { old: { id: "old" } },
      [{ id: "one" }, { id: "two" }],
      [],
      2,
    );

    expect(Object.keys(cache)).toEqual(["one", "two"]);
  });
});
