type DesktopPrintResult = {
  ok: boolean;
  message?: string;
  uncertain?: boolean;
};

export type DesktopPrinterConfig = {
  printer: string;
  width: 58 | 80;
  autoPrint: boolean;
};

type DesktopPrintBridge = {
  printReceipt: (
    saleId: string,
    copy: boolean,
    rawHtml?: string,
    retryConfirmed?: boolean,
    printToken?: string,
  ) => Promise<DesktopPrintResult>;
  openPrinterSettings: () => Promise<void>;
  getPrinterConfig?: () => Promise<DesktopPrinterConfig | null>;
  onPrinterConfigChanged?: (listener: (config: DesktopPrinterConfig) => void) => () => void;
};

export function getDesktopPrintBridge(): DesktopPrintBridge | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { bisaPosDesktop?: DesktopPrintBridge }).bisaPosDesktop;
}
