/**
 * Canonical URLs for the receipt and A4 invoice surfaces.
 *
 * The first print after checkout is authorized by a short-lived
 * `printToken`. Every immediate link (success modal, router fallback,
 * popup, invoice cross-link) must carry it; otherwise the receipt page
 * treats the sale as a historical reprint and either denies a cashier or
 * marks the original as "Salinan". `salinan=1` remains the explicit copy
 * marker for historical reprints.
 */
export type ReceiptLinkOptions = {
  /** Explicit historical copy marker (`salinan=1`). */
  copy?: boolean;
  /** Short-lived first-print token issued by checkout. */
  printToken?: string | null;
  /** Open the browser print dialog automatically. */
  autoprint?: boolean;
  /** Popup print window used by the checkout success modal. */
  popup?: boolean;
};

function buildDocumentHref(
  path: string,
  options: ReceiptLinkOptions,
): string {
  const params = new URLSearchParams();
  if (options.autoprint) params.set("autoprint", "1");
  if (options.popup) params.set("popup", "1");
  if (options.copy) params.set("salinan", "1");
  if (options.printToken) params.set("printToken", options.printToken);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function receiptHref(
  saleId: string,
  options: ReceiptLinkOptions = {},
): string {
  return buildDocumentHref(
    `/app/pos/nota/${encodeURIComponent(saleId)}`,
    options,
  );
}

export function invoiceHref(
  saleId: string,
  options: ReceiptLinkOptions = {},
): string {
  return buildDocumentHref(
    `/app/pos/nota/${encodeURIComponent(saleId)}/faktur`,
    options,
  );
}
