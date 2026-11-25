import { and, asc, eq } from "drizzle-orm";
import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { products, units } from "@/db/schema";
import { requirePermissionInModule } from "@/lib/session";
import { listWarehouses, pickDefaultWarehouseId, getSettings } from "@/server/catalog";
import { todayISO } from "@/lib/format";
import { xlsxResponse } from "@/lib/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(request: Request) {
  const ctx = await requirePermissionInModule("inventory.view", "gudang");
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

    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        unitName: units.name,
      })
      .from(products)
      .leftJoin(units, eq(products.unitId, units.id))
      .where(
        and(
          eq(products.companyId, ctx.company.id),
          eq(products.isActive, true),
          eq(products.trackStock, true),
        ),
      )
      .orderBy(asc(products.name));
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

export const GET = withApiError(GETHandler);
