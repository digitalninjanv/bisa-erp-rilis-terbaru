type DesktopPrintResult = {
  ok: boolean;
  message?: string;
  uncertain?: boolean;
};

type DesktopPrintBridge = {
  printReceipt: (saleId: string, copy: boolean, rawHtml?: string) => Promise<DesktopPrintResult>;
  openPrinterSettings: () => Promise<void>;
};

export function getDesktopPrintBridge(): DesktopPrintBridge | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { bisaPosDesktop?: DesktopPrintBridge }).bisaPosDesktop;
}
