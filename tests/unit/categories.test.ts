import { describe, expect, it } from "vitest";
import { descendantIds, sortCategoryTree, type CategoryNode } from "@/lib/categories";

// T5-3 (D-17): kategori bertingkat — helper murni pohon kategori.
// Urutan tampilan: induk selalu di atas anaknya, bersaudara alfabetis;
// path menyimpan jalur penuh "Induk / Anak / Cucu" untuk label pemilih.

const rows: CategoryNode[] = [
  { id: "c", name: "Cemilan", parentId: "b" },
  { id: "a", name: "Makanan", parentId: null },
  { id: "b", name: "Makanan Ringan", parentId: "a" },
  { id: "z", name: "Minuman", parentId: null },
  { id: "d", name: "Biskuit", parentId: "b" },
  { id: "e", name: "Air Mineral", parentId: "z" },
];

describe("sortCategoryTree", () => {
  it("orders parents before children, siblings alphabetically, with depth and full path", () => {
    const sorted = sortCategoryTree(rows);
    expect(sorted.map((row) => row.id)).toEqual(["a", "b", "d", "c", "z", "e"]);
    expect(sorted.map((row) => row.depth)).toEqual([0, 1, 2, 2, 0, 1]);
    expect(sorted.find((row) => row.id === "c")?.path).toBe("Makanan / Makanan Ringan / Cemilan");
    expect(sorted.find((row) => row.id === "e")?.path).toBe("Minuman / Air Mineral");
  });

  it("treats a row whose parent is missing from the set as a root instead of dropping it", () => {
    const sorted = sortCategoryTree([{ id: "x", name: "Yatim", parentId: "ghost" }]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].depth).toBe(0);
    expect(sorted[0].path).toBe("Yatim");
  });

  it("never loops forever on cyclic data; cyclic rows are appended as roots", () => {
    const cyclic: CategoryNode[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    const sorted = sortCategoryTree(cyclic);
    expect(sorted.map((row) => row.id).sort()).toEqual(["a", "b"]);
  });
});

describe("descendantIds", () => {
  it("includes the root itself plus every descendant level", () => {
    expect([...descendantIds(rows, "a")].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...descendantIds(rows, "b")].sort()).toEqual(["b", "c", "d"]);
    expect([...descendantIds(rows, "c")]).toEqual(["c"]);
  });

  it("returns just the id for an unknown category", () => {
    expect([...descendantIds(rows, "nope")]).toEqual(["nope"]);
  });
});
