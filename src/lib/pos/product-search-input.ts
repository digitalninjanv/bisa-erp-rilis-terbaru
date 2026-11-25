import { z } from "zod";
import { parseInput } from "@/lib/action-validation";

/** Preserve the existing 100k-product benchmark while rejecting unbounded scans. */
export const POS_PRODUCT_SEARCH_MAX_OFFSET = 100_000;
export const POS_PRODUCT_SEARCH_MAX_QUERY_LENGTH = 80;

const posProductSearchInputSchema = z.object({
  query: z.string().max(POS_PRODUCT_SEARCH_MAX_QUERY_LENGTH).trim(),
  offset: z.number().int().min(0).max(POS_PRODUCT_SEARCH_MAX_OFFSET),
});

export function parsePosProductSearchInput(query: unknown, offset: unknown) {
  return parseInput(posProductSearchInputSchema, {
    query,
    offset: offset ?? 0,
  });
}
