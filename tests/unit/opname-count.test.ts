import { describe, expect, it } from "vitest";
import {
  buildOpnamePostingLines,
  parseOpnameDraft,
  serializeOpnameDraft,
  summarizeOpnameCount,
  type OpnameCountRow,
  type OpnameDraft,
} from "@/lib/opname-count";

const rows: OpnameCountRow[] = [
  { productId: "p1", name: "Indomie Goreng", sku: "SKU-1", system: 10, counted: "8", unitCost: "2500" },
  { productId: "p2", name: "Aqua 600ml", sku: "SKU-2", system: 5, counted: "5", unitCost: "3000" },
  { productId: "p3", name: "Kopi Sachet", sku: "SKU-3", system: 0, counted: "3", unitCost: "1500" },
  { productId: "p4", name: "Gula 1kg", sku: "SKU-4", system: 7, counted: "", unitCost: "14000" },
  { productId: "p5", name: "Teh Celup", sku: "SKU-5", system: 4, counted: "0", unitCost: "5000" },
];

describe("summarizeOpnameCount (GDG2-01 tinjau selisih)", () => {
  it("memisahkan baris terhitung, belum dihitung, dan berselisih", () => {
    const summary = summarizeOpnameCount(rows);
    expect(summary.countedCount).toBe(4);
    expect(summary.uncountedCount).toBe(1);
    expect(summary.diffCount).toBe(3); // p1 (-2), p3 (+3), p5 (-4)
    expect(summary.matchCount).toBe(1); // p2 cocok
  });

  it("menghitung selisih qty dan nilai per baris dengan Decimal", () => {
    const summary = summarizeOpnameCount(rows);
    const byId = new Map(summary.reviewRows.map((row) => [row.productId, row]));
    expect(byId.get("p1")?.diff).toBe(-2);
    expect(byId.get("p1")?.diffValue).toBe("-5000");
    expect(byId.get("p3")?.diff).toBe(3);
    expect(byId.get("p3")?.diffValue).toBe("4500");
    expect(byId.get("p5")?.diff).toBe(-4);
    expect(byId.get("p5")?.diffValue).toBe("-20000");
    // Baris belum dihitung tidak punya selisih — bukan nol.
    expect(byId.get("p4")?.countedQty).toBeNull();
    expect(byId.get("p4")?.diff).toBeNull();
  });

  it("total dampak adalah jumlah nilai absolut selisih; neto bertanda", () => {
    const summary = summarizeOpnameCount(rows);
    expect(summary.totalAbsValue).toBe("29500"); // 5000 + 4500 + 20000
    expect(summary.netValue).toBe("-20500"); // -5000 + 4500 - 20000
  });

  it("hitungan '0' adalah hitungan sah (stok habis), bukan belum dihitung", () => {
    const summary = summarizeOpnameCount([
      { productId: "x", name: "X", sku: "X", system: 2, counted: "0", unitCost: "100" },
    ]);
    expect(summary.countedCount).toBe(1);
    expect(summary.uncountedCount).toBe(0);
    expect(summary.diffCount).toBe(1);
  });

  it("isian tidak valid diperlakukan sebagai belum dihitung, bukan nol", () => {
    const summary = summarizeOpnameCount([
      { productId: "x", name: "X", sku: "X", system: 2, counted: "abc", unitCost: "100" },
      { productId: "y", name: "Y", sku: "Y", system: 2, counted: "-1", unitCost: "100" },
    ]);
    expect(summary.uncountedCount).toBe(2);
    expect(summary.countedCount).toBe(0);
  });
});

describe("buildOpnamePostingLines", () => {
  it("hanya baris terhitung yang dikirim ke domain — baris kosong tidak menjadi nol", () => {
    const lines = buildOpnamePostingLines(rows);
    expect(lines).toEqual([
      { productId: "p1", countedQty: "8" },
      { productId: "p2", countedQty: "5" },
      { productId: "p3", countedQty: "3" },
      { productId: "p5", countedQty: "0" },
    ]);
  });
});

describe("draf opname (GDG2-01)", () => {
  const draft: OpnameDraft = {
    warehouseId: "w1",
    date: "2026-11-04",
    notes: "Opname bulanan",
    step: "tinjau",
    rows: [
      { productId: "p1", name: "Indomie Goreng", sku: "SKU-1", counted: "8" },
      { productId: "p4", name: "Gula 1kg", sku: "SKU-4", counted: "" },
    ],
  };

  it("round-trip serialize/parse utuh", () => {
    expect(parseOpnameDraft(serializeOpnameDraft(draft))).toEqual({ ...draft, scope: "full", fullLoaded: false });
  });

  it("mempertahankan scope dan kelengkapan draf baru", () => {
    const current = { ...draft, scope: "cycle" as const, fullLoaded: true };
    expect(parseOpnameDraft(serializeOpnameDraft(current))).toEqual(current);
  });

  it("draf rusak atau asing ditolak menjadi null (form mulai bersih)", () => {
    expect(parseOpnameDraft(null)).toBeNull();
    expect(parseOpnameDraft("bukan json")).toBeNull();
    expect(parseOpnameDraft("{}")).toBeNull();
    expect(parseOpnameDraft(JSON.stringify({ warehouseId: 42 }))).toBeNull();
    expect(
      parseOpnameDraft(JSON.stringify({ ...draft, rows: [{ productId: "p1" }] })),
    ).toBeNull();
  });

  it("langkah yang tidak dikenal jatuh ke langkah hitung", () => {
    const parsed = parseOpnameDraft(JSON.stringify({ ...draft, step: "aneh" }));
    expect(parsed?.step).toBe("hitung");
  });
});

describe("S3 — hitungan campuran kemasan (dus + pak + pcs lepas)", () => {
  const sampoerna: OpnameCountRow = {
    productId: "sampoerna",
    name: "Sampoerna Mild 16",
    sku: "SKU-SM",
    system: 345,
    counted: "5",
    unitCost: "2500",
    unitName: "Pcs",
    packagings: [
      { id: "dus", name: "Dus", isi: "100" },
      { id: "slop", name: "Slop", isi: "10" },
    ],
    components: { dus: "3", slop: "4" },
  };

  it("3 Dus + 4 Slop + 5 Pcs = 345 — cocok persis dengan sistem, selisih 0", () => {
    const summary = summarizeOpnameCount([sampoerna]);
    expect(summary.countedCount).toBe(1);
    expect(summary.matchCount).toBe(1);
    expect(summary.diffCount).toBe(0);
    expect(summary.reviewRows[0].countedQty).toBe(345);
    expect(summary.reviewRows[0].diff).toBe(0);
    expect(summary.reviewRows[0].breakdown).toBe("3 Dus + 4 Slop + 5 Pcs");
  });

  it("payload posting membawa komponen campuran + total dasar; domain menghitung ulang", () => {
    const lines = buildOpnamePostingLines([sampoerna]);
    expect(lines).toEqual([
      {
        productId: "sampoerna",
        countedQty: "345",
        countComponents: [
          { packagingId: null, qty: "5" },
          { packagingId: "dus", qty: "3" },
          { packagingId: "slop", qty: "4" },
        ],
      },
    ]);
  });

  it("tanpa komponen kemasan terisi, payload & perilaku persis lama (tanpa countComponents)", () => {
    const plain: OpnameCountRow = { ...sampoerna, counted: "340", components: {} };
    expect(buildOpnamePostingLines([plain])).toEqual([
      { productId: "sampoerna", countedQty: "340" },
    ]);
    const summary = summarizeOpnameCount([plain]);
    expect(summary.reviewRows[0].breakdown).toBeNull();
    expect(summary.reviewRows[0].diff).toBe(-5);
  });

  it("isian komponen tak valid membuat baris belum terhitung, bukan nol", () => {
    const bad: OpnameCountRow = { ...sampoerna, components: { dus: "abc" } };
    const summary = summarizeOpnameCount([bad]);
    expect(summary.countedCount).toBe(0);
    expect(summary.reviewRows[0].countedQty).toBeNull();
  });

  it("draf dengan komponen kemasan pulang-pergi utuh; draf lama tetap terbaca", () => {
    const draft: OpnameDraft = {
      warehouseId: "w1",
      date: "2026-11-08",
      notes: "",
      step: "hitung",
      rows: [
        {
          productId: "sampoerna",
          name: "Sampoerna Mild 16",
          sku: "SKU-SM",
          counted: "5",
          unitCost: "2500",
          unitName: "Pcs",
          packagings: sampoerna.packagings,
          components: { dus: "3", slop: "4" },
        },
      ],
    };
    const parsed = parseOpnameDraft(serializeOpnameDraft(draft));
    expect(parsed?.rows[0].components).toEqual({ dus: "3", slop: "4" });
    expect(parsed?.rows[0].packagings).toEqual(sampoerna.packagings);

    const legacy = parseOpnameDraft(
      JSON.stringify({
        warehouseId: "w1",
        date: "2026-11-08",
        notes: "",
        step: "hitung",
        rows: [{ productId: "x", name: "X", sku: "X", counted: "3" }],
      }),
    );
    expect(legacy?.rows[0].counted).toBe("3");
  });
});
