/**
 * S6 (Program Satuan Kemasan) — parser kolom kemasan opsional impor
 * produk. Pecahan lib/import/import-parse.ts demi plafon ukuran
 * berkas; diekspor ulang dari sana.
 */

import { validatePackagingInput, type PackagingInput } from "@/lib/packaging";
import { normalizeBarcode, parseNumber, type ImportField } from "./import-cells";

/** Daftar paralel satu kolom kemasan: nilai berpisah titik koma. */
function splitPackagingList(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const text = String(raw).trim();
  if (!text) return [];
  return text.split(";").map((part) => part.trim());
}

/** Sel harga kemasan: kosong = null (belum diatur); terisi wajib terbaca & ≥ 0. */
function packagingPriceCell(
  raw: string | undefined,
  label: string,
  packagingName: string,
): { value: string | null } | { error: string } {
  if (raw === undefined || raw === "") return { value: null };
  const parsed = parseNumber(raw);
  if (parsed === null) {
    return { error: `${label} kemasan "${packagingName}" tidak terbaca: "${raw.slice(0, 40)}"` };
  }
  if (parsed < 0) return { error: `${label} kemasan "${packagingName}" tidak boleh negatif` };
  return { value: String(parsed) };
}

/**
 * S6 — mem-parse tujuh kolom kemasan opsional satu baris produk.
 *
 * Format: **daftar paralel berpisah titik koma** — posisi ke-i di
 * setiap kolom menggambarkan kemasan yang sama:
 * `Kemasan = "Dus;Pak"`, `Isi Kemasan = "40;10"`, dst. Kolom selain
 * nama boleh lebih pendek dari daftar nama (posisi hilang = kosong),
 * tetapi tidak boleh lebih panjang. Status per posisi: "Aktif"
 * (bawaan) / "Nonaktif". Bawaan per posisi: "Beli", "Jual",
 * "Beli+Jual", atau kosong. Aturan isi/harga/barcode divalidasi oleh
 * SATU sumber domain (`validatePackagingInput` di lib/packaging) —
 * parser ini tidak menciptakan aturan kemasan kedua.
 */
export function parsePackagingCells(
  get: (field: ImportField) => unknown,
): { value: PackagingInput[] } | { error: string } {
  const names = splitPackagingList(get("packagingNames"));
  const isiList = splitPackagingList(get("packagingIsi"));
  const buyList = splitPackagingList(get("packagingBuyPrices"));
  const saleList = splitPackagingList(get("packagingSalePrices"));
  const barcodeList = splitPackagingList(get("packagingBarcodes"));
  const statusList = splitPackagingList(get("packagingStatuses"));
  const defaultsList = splitPackagingList(get("packagingDefaults"));

  const anyData =
    names.length > 0 ||
    isiList.length > 0 ||
    buyList.length > 0 ||
    saleList.length > 0 ||
    barcodeList.length > 0 ||
    statusList.length > 0 ||
    defaultsList.length > 0;
  if (!anyData) return { value: [] };
  if (names.length === 0) {
    return {
      error: "Kolom kemasan lain terisi tetapi nama kemasan (kolom Kemasan) kosong",
    };
  }
  for (const [label, list] of [
    ["Isi Kemasan", isiList],
    ["Harga Beli Kemasan", buyList],
    ["Harga Jual Kemasan", saleList],
    ["Barcode Kemasan", barcodeList],
    ["Status Kemasan", statusList],
    ["Kemasan Bawaan", defaultsList],
  ] as const) {
    if (list.length > names.length) {
      return {
        error: `Jumlah nilai kolom ${label} (${list.length}) melebihi jumlah kemasan (${names.length}) — daftar kemasan adalah daftar paralel berpisah titik koma`,
      };
    }
  }

  const result: PackagingInput[] = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (!name) return { error: `Nama kemasan ke-${i + 1} kosong di dalam daftar Kemasan` };

    const isiRaw = isiList[i] ?? "";
    if (!isiRaw) return { error: `Isi kemasan "${name}" wajib diisi (kolom Isi Kemasan)` };
    const isi = parseNumber(isiRaw);
    if (isi === null) {
      return { error: `Isi kemasan "${name}" tidak terbaca: "${isiRaw.slice(0, 40)}"` };
    }

    const buy = packagingPriceCell(buyList[i], "Harga beli", name);
    if ("error" in buy) return { error: buy.error };
    const sale = packagingPriceCell(saleList[i], "Harga jual", name);
    if ("error" in sale) return { error: sale.error };

    const statusRaw = (statusList[i] ?? "").toLowerCase();
    let isActive = true;
    if (statusRaw === "" || statusRaw === "aktif") isActive = true;
    else if (statusRaw === "nonaktif" || statusRaw === "tidak aktif" || statusRaw === "non aktif") isActive = false;
    else {
      return {
        error: `Status kemasan "${name}" tidak dikenal: "${statusList[i]}" (pakai Aktif/Nonaktif)`,
      };
    }

    const defaultsRaw = (defaultsList[i] ?? "").toLowerCase();
    const isDefaultPurchase = defaultsRaw.includes("beli");
    const isDefaultSale = defaultsRaw.includes("jual");
    if (defaultsRaw !== "" && !isDefaultPurchase && !isDefaultSale) {
      return {
        error: `Kemasan bawaan "${name}" tidak dikenal: "${defaultsList[i]}" (pakai Beli, Jual, atau Beli+Jual)`,
      };
    }

    const input: PackagingInput = {
      name,
      isi: String(isi),
      buyPrice: buy.value,
      salePrice: sale.value,
      barcode: normalizeBarcode(barcodeList[i] ?? null),
      isDefaultPurchase,
      isDefaultSale,
      isActive,
    };
    const validation = validatePackagingInput(input);
    if (validation.length > 0) return { error: validation.join(" ") };
    result.push(input);
  }
  return { value: result };
}
