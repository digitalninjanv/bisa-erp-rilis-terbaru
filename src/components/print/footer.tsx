import type { PrintSettings } from "./types";
import { PRINT_TEMPLATE_STYLES } from "./template-styles";
import { TemplateDivider } from "./template-parts";

export interface PrintSignature {
  label: string;
  name?: string | null;
}

export function PrintFooter({
  settings,
  documentNumber,
  variant,
  printedByName,
  signatures,
  qrDataUrl,
  footerText,
  qrSizeMm = 20,
}: {
  settings: PrintSettings;
  documentNumber: string;
  variant: "receipt" | "document";
  printedByName?: string | null;
  signatures?: PrintSignature[];
  qrDataUrl?: string | null;
  footerText?: string | null;
  qrSizeMm?: number;
}) {
  const style = PRINT_TEMPLATE_STYLES[settings.template];
  const text = footerText !== undefined ? footerText : settings.footerText;
  const signatureRows: PrintSignature[] =
    signatures ??
    (variant === "document"
      ? [
          { label: "Dibuat oleh", name: printedByName ?? undefined },
          { label: "Diterima oleh" },
        ]
      : []);

  return (
    <footer className={`break-inside-avoid print:break-inside-avoid ${style.dense ? "text-[10px]" : ""}`}>
      <TemplateDivider settings={settings} dashed={variant === "receipt"} />
      {variant === "document" && settings.showSignature && signatureRows.length > 0 ? (
        <div
          className="mt-2 grid gap-4 text-center text-[11px]"
          style={{ gridTemplateColumns: `repeat(${signatureRows.length}, minmax(0, 1fr))` }}
        >
          {signatureRows.map((row) => (
            <div key={row.label}>
              <p className="opacity-60">{row.label}</p>
              <div className="mt-12 border-t border-black/50 pt-1">{row.name ?? ""}</div>
            </div>
          ))}
        </div>
      ) : null}
      {text ? (
        <p className="mt-3 whitespace-pre-line text-center text-[11px]">{text}</p>
      ) : null}
      {settings.showQr ? (
        <div className="mt-3 flex flex-col items-center gap-1">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt={`QR ${documentNumber}`} style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }} />
          ) : (
            <div
              className="flex items-center justify-center border border-dashed border-black/40 text-[8px] uppercase tracking-wide opacity-60"
              style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }}
            >
              QR
            </div>
          )}
          <p className="num text-[9px] opacity-70">{documentNumber}</p>
        </div>
      ) : null}
      {settings.showBranding ? (
        <p className="mt-2 text-center text-[9px] opacity-50">Dicetak dari Bisa ERP · {documentNumber}</p>
      ) : null}
    </footer>
  );
}
