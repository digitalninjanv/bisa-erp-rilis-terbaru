import type { ReceiptData } from "@/lib/escpos/types";
import type { QuoteResultPublic } from "@/server/pos";
import { formatDate, todayISO } from "@/lib/format";
import type { CartItem, Method, ProductOption, ReceiptProfile } from "@/components/pos/terminal-types";

export interface CheckoutReceiptPayment {
  methodId: string;
  amount: number;
  tendered?: number;
  reference?: string;
}

/**
 * Susun cuplikan ReceiptData langsung dari state checkout terminal agar cetak
 * pertama (ESC/POS maupun Electron) berjalan instan tanpa query DB ulang.
 */
export function buildTerminalReceiptData(params: {
  saleNumber: string;
  cart: CartItem[];
  quote: QuoteResultPublic | null;
  cache: Record<string, ProductOption>;
  payments: CheckoutReceiptPayment[];
  methodById: Map<string, Method>;
  receiptProfile: ReceiptProfile;
  customerName: string | null;
  dueDate: string | null;
  total: number;
  change?: number;
  outstanding: number;
  date?: string;
  sessionId?: string | null;
  branchName?: string | null;
}): ReceiptData {
  const {
    saleNumber,
    cart,
    quote,
    cache,
    payments,
    methodById,
    receiptProfile,
    customerName,
    dueDate,
    total,
    outstanding,
  } = params;

  const tenderedTotal = payments.reduce(
    (sum, payment) => sum + Number(payment.tendered ?? payment.amount),
    0,
  );
  const computedChange = params.change ?? Math.max(0, tenderedTotal - total);

  return {
    companyName: receiptProfile.companyName,
    taxId: receiptProfile.taxId ?? null,
    address: receiptProfile.address,
    phone: receiptProfile.phone,
    branchName: params.branchName ?? receiptProfile.branchName ?? null,
    headerText: receiptProfile.headerText,
    footerText: receiptProfile.footerText,
    saleNumber,
    date: params.date ?? formatDate(todayISO()),
    dueDate: outstanding > 0 ? dueDate : null,
    sessionId: params.sessionId ?? null,
    cashierName: receiptProfile.cashierName,
    customerName,
    lines: cart.map((line) => {
      const quoted = quote?.lines.find(
        (row) =>
          row.productId === line.productId &&
          (row.packagingId ?? null) === (line.packagingId ?? null),
      );
      const pack = line.packagingId
        ? cache[line.productId]?.packagings?.find((row) => row.id === line.packagingId)
        : undefined;
      const name = cache[line.productId]?.name ?? "Produk";
      const price = pack
        ? quoted
          ? quoted.unitPrice * Number(quoted.isiSnapshot)
          : Number(pack.salePrice ?? 0)
        : (quoted?.unitPrice ?? Number(cache[line.productId]?.salePrice ?? 0));
      return {
        name: pack ? `${name} (${pack.name})` : name,
        qty: line.qty,
        unit: pack?.name ?? null,
        price,
        subtotal: quoted ? quoted.lineTotal : price * line.qty,
        discount: quoted?.discountAmount ?? 0,
        qtyBase: line.qty,
      };
    }),
    subtotal: quote?.subtotal ?? total,
    taxTotal: quote?.taxTotal ?? 0,
    discountTotal: quote?.discountTotal ?? 0,
    roundingAdjustment: quote?.roundingAdjustment ?? 0,
    total,
    outstanding,
    payments: payments.map((payment) => ({
      methodName: methodById.get(payment.methodId)?.name ?? "Pembayaran",
      methodType: methodById.get(payment.methodId)?.type,
      amount: payment.amount,
      tendered: payment.tendered,
      reference: payment.reference ?? null,
    })),
    change: computedChange,
    paperWidth: receiptProfile.paperWidth,
    showTax: receiptProfile.showTax,
    showCashier: receiptProfile.showCashier,
    showCustomer: receiptProfile.showCustomer,
    showSession: receiptProfile.showSession,
    showQr: receiptProfile.showQr,
    openCashDrawer: receiptProfile.openCashDrawer,
    cutPaper: receiptProfile.cutPaper,
  };
}
