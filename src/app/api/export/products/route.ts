import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getSettings,
  listProductExportPage,
  listWarehouses,
  pickDefaultWarehouseId,
  productXlsxStreamResponse,
  productExportHeaders,
  toProductExportRow,
} from "@/server/catalog";
import { can } from "@/lib/permissions";
import { requirePermissionInModule } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvRow, csvStreamResponse } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ekspor master produk (S3 §18H) — menghormati filter yang sama dengan
 * halaman daftar produk (`q`, `category`, `lowStock`), tanpa paginasi.
 * Kolom diselaraskan dengan pemetaan impor produk agar berkas hasil
 * ekspor dapat diimpor kembali (round-trip).
 */
async function GETHandler(request?: Request) {
  const ctx = await requirePermissionInModule("inventory.view", "gudang");
  // AUD-013: harga beli (produk & kemasan) adalah data level-field
  // `inventory.cost`; tanpa izin itu kolom biaya tidak disertakan.
  const includeCost = can(ctx, "inventory.cost");
  const url = new URL(request?.url ?? "http://localhost");
  const q = url.searchParams.get("q") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const lowStock = url.searchParams.get("lowStock") === "1";
  const warehouse = url.searchParams.get("warehouse") ?? undefined;
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const headers = productExportHeaders(includeCost);
  const numericHeaders = new Set(["Harga Beli", "Harga Jual", "Stok Minimum"]);
  const toXlsxRows = (rows: Awaited<ReturnType<typeof listProductExportPage>>["rows"]) =>
    rows.map((row) =>
      toProductExportRow(row, { includeCost }).map((value, index) => {
        if (value === null || value === "") return null;
        if (numericHeaders.has(headers[index])) {
          const number = Number(value);
          return Number.isFinite(number) ? number : value;
        }
        return value;
      }),
    );
  const filters = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [settings, warehouses] = await Promise.all([
      getSettings(tx, ctx.company.id),
      listWarehouses(tx, ctx.company.id),
    ]);
    const requestedWarehouse = warehouses.some((row) => row.id === warehouse)
      ? warehouse
      : null;
    return {
      companyId: ctx.company.id,
      warehouseId:
        requestedWarehouse ?? pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId),
      q,
      categoryId: category,
      lowStock,
      activeOnly: false,
    };
  });

  if (format === "xlsx") {
    const firstPage = await withCompanyReadOnly(ctx.company.id, (tx) =>
      listProductExportPage(tx, { ...filters, cursor: null, limit: 500 }),
    );
    return productXlsxStreamResponse({
      filename: `produk-${todayISO()}.xlsx`,
      headers,
      widths: [14, 36, 18, 18, 10, 24, 14, 14, 14, 12, 12, 12, 28, 20, 16, 18, 18, 18, 14, 16],
      firstPage: {
        rows: toXlsxRows(firstPage.rows),
        nextCursor: firstPage.nextCursor,
      },
      loadPage: async (cursor) => {
        const page = await withCompanyReadOnly(ctx.company.id, (tx) =>
          listProductExportPage(tx, { ...filters, cursor, limit: 500 }),
        );
        return { rows: toXlsxRows(page.rows), nextCursor: page.nextCursor };
      },
    });
  }

  // Halaman keyset membatasi hasil DB dan memori proses. Setiap halaman
  // memakai transaksi tenant read-only sendiri agar koneksi tidak ditahan
  // sepanjang waktu unduh; perubahan katalog saat ekspor berjalan dapat
  // terlihat antarhalaman.
  const encoder = new TextEncoder();
  let headerSent = false;
  let cursor: { name: string; id: string } | null = null;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      if (!headerSent) {
        controller.enqueue(encoder.encode(`\uFEFF${csvRow(headers)}`));
        headerSent = true;
        return;
      }

      const page = await withCompanyReadOnly(ctx.company.id, (tx) =>
        listProductExportPage(tx, { ...filters, cursor, limit: 500 }),
      );
      if (cancelled) return;
      if (page.rows.length > 0) {
        const lines = page.rows.map((row) =>
          csvRow(toProductExportRow(row, { includeCost })),
        );
        controller.enqueue(encoder.encode(`\r\n${lines.join("\r\n")}`));
      }
      cursor = page.nextCursor;
      if (!cursor) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return csvStreamResponse(`produk-${todayISO()}.csv`, body);
}

export const GET = withApiError(GETHandler);
