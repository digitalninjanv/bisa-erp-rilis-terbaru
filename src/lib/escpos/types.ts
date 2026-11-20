/**
 * Tipe dan kontrak data untuk ESC/POS Thermal Printing.
 */

export type PaperWidth = "58mm" | "80mm";

export type PrintAlignment = "left" | "center" | "right";

export type PrinterConnectionType = "bluetooth" | "usb" | "serial" | "kiosk" | "none";

export interface ThermalPrinterDevice {
  name: string;
  type: PrinterConnectionType;
  connected: boolean;
}

export interface ReceiptLineItem {
  name: string;
  qty: number;
  unit?: string | null;
  price: number;
  subtotal: number;
  discount?: number;
}

export interface ReceiptPaymentItem {
  methodName: string;
  methodType?: string;
  amount: number;
  tendered?: number | null;
  reference?: string | null;
}

export interface ReceiptData {
  companyName: string;
  legalName?: string | null;
  address?: string | null;
  phone?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  saleNumber: string;
  date: string;
  cashierName?: string | null;
  customerName?: string | null;
  lines: ReceiptLineItem[];
  subtotal: number;
  taxTotal?: number;
  discountTotal?: number;
  total: number;
  outstanding?: number;
  payments: ReceiptPaymentItem[];
  change: number;
  paperWidth?: PaperWidth;
  /** Salinan nota yang dicetak ulang (0/kosong = cetakan biasa). */
  copyIndex?: number;
  showTax?: boolean;
  showCashier?: boolean;
  showCustomer?: boolean;
  showQr?: boolean;
  openCashDrawer?: boolean;
  cutPaper?: boolean;
}

export interface SessionReportData {
  companyName: string;
  address?: string | null;
  phone?: string | null;
  isX?: boolean;
  sessionId: string;
  cashierName?: string | null;
  branchName?: string | null;
  openedAt: string;
  closedAt?: string | null;
  openingCash: number;
  closingCash?: number | null;
  expectedCash: number;
  cashDifference?: number | null;
  differenceReason?: string | null;
  totals: {
    salesCount: number;
    cashSales: number;
    nonCashSales: number;
    totalSales: number;
    cashIn: number;
    cashOut: number;
  };
  paymentBreakdown: Array<{
    methodName: string;
    methodType?: string;
    amount: number;
  }>;
  paperWidth?: PaperWidth;
}

export interface PrinterPreferences {
  type: PrinterConnectionType;
  name: string;
  /** Opaque browser permission identifier used for BLE auto-reconnect. */
  bluetoothDeviceId?: string | null;
  paperWidth: PaperWidth;
  openCashDrawer: boolean;
  cutPaper: boolean;
  usbSerialNumber?: string | null;
}

export const DEFAULT_PRINTER_PREFERENCES: PrinterPreferences = {
  type: "none",
  name: "Belum terhubung",
  bluetoothDeviceId: null,
  paperWidth: "58mm",
  openCashDrawer: true,
  cutPaper: true,
  usbSerialNumber: null,
};
