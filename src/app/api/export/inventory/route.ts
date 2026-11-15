import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { listPackagingsForProducts, productXlsxStreamResponse } from "@/server/catalog";
import {
  listInventoryValuationExportPage,
  type InventoryValuationExportCursor,
} from "@/server/reports";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { csvRow, csvStreamResponse, moneyCsv } from "@/lib/csv";
import { packagingBreakdownLabel, type PackagingSnapshot } from "@/lib/packaging";
import { d } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_PAGE_SIZE = 500;
const NUMERIC_HEADERS = new Set(["Stok", "HPP", "Nilai Persediaan", "Potensi Jual", "Stok Minimum"]);

async function GETHandler(request: Request) {
  const ctx = await requirePermission("inventory.view");
  // AUD-013: HPP dan Nilai Persediaan adalah data biaya level-field
  // `inventory.cost`; tanpa izin itu kedua kolom tidak disertakan.
  const includeCost = can(ctx, "inventory.cost");
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const warehouseId = url.searchParams.get("warehouse") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const withBreakdown = url.searchParams.get("rincian") === "1";
  const headers = [
    "SKU",
    "Produk",
    "Kategori",
    "Satuan",
    "Stok",
    ...(includeCost ? ["HPP", "Nilai Persediaan"] : []),
    "Potensi Jual",
    "Stok Minimum",
    ...(withBreakdown ? ["Rincian Kemasan"] : []),
  ];
  const filename = `nilai-persediaan-${todayISO()}`;

  // Fetch a keyset page at a time. Each tenant transaction is short-lived;
  // an export can observe inventory changes between pages, as product export does.
  const loadPage = async (cursor: InventoryValuationExportCursor | null) =>
    withCompanyReadOnly(ctx.company.id, async (tx) => {
      const page = await listInventoryValuationExportPage(
        tx,
        ctx.company.id,
        warehouseId,
        cursor,
        EXPORT_PAGE_SIZE,
        q,
      );
      const packagings = withBreakdown
        ? await listPackagingsForProducts(
            tx,
            ctx.company.id,
            page.rows.map((row) => row.productId),
          )
        : new Map<string, PackagingSnapshot[]>();

      const rows = page.rows.map((row) => {
        const cells = [
          row.sku,
          row.name,
          row.category,
          row.unit,
          d(row.qty).toString(),
          ...(includeCost ? [moneyCsv(row.cost), moneyCsv(row.value)] : []),
          moneyCsv(row.potential),
          d(row.minStock).toString(),
        ];
        if (withBreakdown) {
          cells.push(
            packagingBreakdownLabel(
              row.qty,
              (packagings.get(row.productId) ?? []).filter((pack) => pack.isActive),
              row.unit ?? "Pcs",
            ) ?? "",
          );
        }
        return cells;
      });
      return { rows, nextCursor: page.nextCursor };
    });

  const toXlsxRows = (rows: string[][]) =>
    rows.map((row) =>
      row.map((value, index) => {
        if (value === "") return null;
        if (NUMERIC_HEADERS.has(headers[index])) {
          const number = Number(value);
          return Number.isFinite(number) ? number : value;
        }
        return value;
      }),
    );

  if (format === "xlsx") {
    const firstPage = await loadPage(null);
    return productXlsxStreamResponse({
      filename: `${filename}.xlsx`,
      worksheetName: "Nilai Persediaan",
      headers,
      widths: [14, 34, 18, 10, 12, 14, 18, 16, 14, 28],
      firstPage: {
        rows: toXlsxRows(firstPage.rows),
        nextCursor: firstPage.nextCursor,
      },
      loadPage: async (cursor) => {
        const page = await loadPage(cursor);
        return { rows: toXlsxRows(page.rows), nextCursor: page.nextCursor };
      },
    });
  }

  const encoder = new TextEncoder();
  let headerSent = false;
  let cursor: InventoryValuationExportCursor | null = null;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      if (!headerSent) {
        controller.enqueue(encoder.encode(`\uFEFF${csvRow(headers)}`));
        headerSent = true;
        return;
      }

      const page = await loadPage(cursor);
      if (cancelled) return;
      if (page.rows.length > 0) {
        controller.enqueue(encoder.encode(`\r\n${page.rows.map(csvRow).join("\r\n")}`));
      }
      cursor = page.nextCursor;
      if (!cursor) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return csvStreamResponse(`${filename}.csv`, body);
}

export const GET = withApiError(GETHandler);
