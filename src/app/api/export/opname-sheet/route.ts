import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { listProducts, listWarehouses, pickDefaultWarehouseId, getSettings } from "@/server/catalog";
import { todayISO } from "@/lib/format";
import { xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 1000;

export async function GET(request: Request) {
  const ctx = await requirePermission("inventory.view");
  const url = new URL(request.url);
  const warehouseParam = url.searchParams.get("warehouse") || undefined;

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouses, settings] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
    ]);
    const warehouseId =
      warehouses.find((row) => row.id === warehouseParam)?.id ??
      pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId);
    const warehouse = warehouses.find((row) => row.id === warehouseId);
    if (!warehouse) return null;

    const rows: { id: string; name: string; sku: string; unitName: string | null }[] = [];
    let page = 1;
    for (;;) {
      const result = await listProducts(tx, {
        companyId: ctx.company.id,
        warehouseId,
        page,
        pageSize: 200,
      });
      for (const row of result.rows) {
        if (!row.trackStock) continue;
        rows.push({ id: row.id, name: row.name, sku: row.sku, unitName: row.unitName ?? null });
        if (rows.length >= MAX_ROWS) break;
      }
      if (rows.length >= MAX_ROWS || page * result.pageSize >= result.total) break;
      page += 1;
    }
    return { warehouse, rows };
  });

  if (!data) {
    return new Response("Gudang tidak ditemukan.", { status: 404 });
  }

  const titleRows = [
    ["LEMBAR HITUNG STOK OPNAME"],
    ["Gudang", data.warehouse.name],
    ["Tanggal ekspor", todayISO()],
    [],
    ["Isi kolom Fisik. Jangan mengubah SKU/Nama Produk. Baris kosong diabaikan saat impor."],
  ];
  const headers = ["SKU", "Nama Produk", "Satuan", "Fisik", "Catatan"];
  const rows = data.rows.map((row) => [row.sku, row.name, row.unitName ?? "", "", ""]);

  return xlsxResponse(`opname-${data.warehouse.code}-${todayISO()}.xlsx`, [
    {
      name: "Hitung",
      titleRows,
      headers,
      rows,
      widths: [18, 44, 12, 12, 30],
      autoFilter: false,
    },
    {
      name: "Petunjuk",
      headers: ["Bagian", "Keterangan"],
      rows: [
        ["Tujuan", "Lembar hitung fisik stok opname."],
        ["Cara pakai", "Isi kolom Fisik dengan jumlah fisik (satuan dasar). Kosongkan bila belum dihitung."],
        ["Impor", "Kembali ke halaman Stok opname → Impor hasil hitung, pilih file ini."],
        ["Jangan ubah", "Kolom SKU dan Nama Produk dipakai untuk mencocokkan baris."],
        ["Catatan", "Angka stok sistem sengaja tidak ditampilkan agar hitungan tetap buta."],
      ],
      widths: [18, 78],
      autoFilter: false,
    },
  ]);
}