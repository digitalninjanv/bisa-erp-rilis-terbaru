import ExcelJS from "exceljs";
import { PassThrough, Readable } from "node:stream";
import type { XlsxCell } from "@/lib/xlsx";

export type ProductXlsxPage<TCursor> = {
  rows: XlsxCell[][];
  nextCursor: TCursor | null;
};

/**
 * Stream a product workbook to the client while committing each row and
 * releasing each keyset page before loading the next one.
 */
export function productXlsxStreamResponse<TCursor>(input: {
  filename: string;
  headers: string[];
  widths: number[];
  firstPage: ProductXlsxPage<TCursor>;
  loadPage: (cursor: TCursor) => Promise<ProductXlsxPage<TCursor>>;
}): Response {
  const output = new PassThrough({ highWaterMark: 64 * 1024 });
  const abortController = new AbortController();
  const reader = Readable.toWeb(output).getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      abortController.abort(reason);
      output.destroy();
      await reader.cancel(reason).catch(() => undefined);
    },
  });

  void writeWorkbook().catch((error: unknown) => {
    if (!abortController.signal.aborted) {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${input.filename}"`,
      "Cache-Control": "no-store",
    },
  });

  async function writeWorkbook() {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useSharedStrings: false,
      useStyles: false,
    });
    const worksheet = workbook.addWorksheet("Produk");
    worksheet.columns = input.widths.map((width) => ({ width }));
    worksheet.addRow(input.headers).commit();

    let page = input.firstPage;
    let rowCount = 0;
    while (!abortController.signal.aborted && !output.destroyed) {
      for (const row of page.rows) {
        if (abortController.signal.aborted || output.destroyed) return;
        worksheet.addRow(row).commit();
        rowCount += 1;
      }

      await waitForDrain(output, abortController.signal);
      if (abortController.signal.aborted || output.destroyed) return;
      if (!page.nextCursor) break;

      // Let response cancellation and downstream stream events run between
      // database pages even when the writable high-water mark is not reached.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (abortController.signal.aborted || output.destroyed) return;
      page = await input.loadPage(page.nextCursor);
    }

    if (abortController.signal.aborted || output.destroyed) return;
    if (rowCount > 0) {
      worksheet.autoFilter = {
        from: "A1",
        to: { row: rowCount + 1, column: input.headers.length },
      };
    }
    worksheet.commit();
    await workbook.commit();
  }
}

function waitForDrain(output: PassThrough, signal: AbortSignal): Promise<void> {
  if (signal.aborted || output.destroyed || !output.writableNeedDrain) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      output.off("drain", onDrain);
      output.off("error", onError);
      output.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };

    output.once("drain", onDrain);
    output.once("error", onError);
    output.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
