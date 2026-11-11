import type { CSSProperties, ReactNode } from "react";
import {
  paperSpec,
  printFontFamily,
  type PrintPaper,
  type PrintSettings,
} from "./types";

/**
 * Print Engine (T4-4, D-13) — shared document frame.
 *
 * One structure for every printed document (POS receipt, GRN, PO):
 * PrintShell enforces the paper size via `@page` + content width and
 * carries the template/font; PrintHeader is always the document head
 * (SET-RCPT-01: the header used to be rendered at the bottom of the
 * receipt); PrintFooter carries the footer text, the signature block,
 * and the document-number QR.
 *
 * These components are presentational only — they never compute or
 * alter document figures.
 */

function TemplateDivider({ settings, dashed }: { settings: PrintSettings; dashed?: boolean }) {
  if (settings.template === "classic") {
    // Classic double rule: a heavy line over a hairline.
    return (
      <div className="my-3" aria-hidden>
        <div style={{ borderTop: "2.5px solid #000" }} />
        <div className="mt-[2px]" style={{ borderTop: "0.75px solid #000" }} />
      </div>
    );
  }
  if (settings.template === "minimal") {
    return <div className="my-3" style={{ borderTop: "1px solid rgba(0,0,0,0.25)" }} aria-hidden />;
  }
  if (dashed) {
    return (
      <div
        className="my-2"
        style={{ borderTop: `1px dashed ${settings.accentColor}` }}
        aria-hidden
      />
    );
  }
  return (
    <div className="my-3" style={{ borderTop: `2px solid ${settings.accentColor}` }} aria-hidden />
  );
}

function headingFont(settings: PrintSettings): string | undefined {
  // Classic headings are serif even when the body font differs; other
  // templates follow the configured print font.
  return settings.template === "classic" ? printFontFamily("serif") : undefined;
}

export function PrintShell({
  settings,
  paper,
  children,
  pageStyle = true,
}: {
  settings: PrintSettings;
  paper: PrintPaper;
  children: ReactNode;
  /** Set false for on-screen previews so the host page keeps its own @page rule. */
  pageStyle?: boolean;
}) {
  const spec = paperSpec(paper);
  const style = {
    width: `${spec.widthMm}mm`,
    maxWidth: "100%",
    marginInline: "auto",
    fontFamily: printFontFamily(settings.font),
    "--print-accent": settings.accentColor,
  } as CSSProperties;
  // CT-25 (D-18): sheet papers (A4/A5) carry "Halaman x dari y" in the
  // @page bottom margin box. The `paged-print` class marks shells that
  // do this so other print surfaces (report pages) can opt into the
  // same convention. Thermal rolls are continuous — no page numbers.
  const pageRule = spec.paged
    ? `@page { size: ${spec.pageSize}; margin: ${spec.pageMargin}; @bottom-center { content: "Halaman " counter(page) " dari " counter(pages); font-size: 9px; color: rgba(0,0,0,0.55); } }`
    : `@page { size: ${spec.pageSize}; margin: ${spec.pageMargin}; }`;
  return (
    <div
      className={`print-doc print-doc--${settings.template}${spec.paged ? " paged-print" : ""}`}
      data-template={settings.template}
      style={style}
    >
      {pageStyle ? <style>{pageRule}</style> : null}
      {children}
    </div>
  );
}

export function PrintHeader({
  settings,
  companyName,
  address,
  phone,
  taxId,
  variant,
  title,
  number,
  dateLabel,
}: {
  settings: PrintSettings;
  companyName: string;
  address?: string | null;
  phone?: string | null;
  /** FIX-R2 (RD2-02): NPWP pada kop dokumen resmi — laporan keuangan
   * yang diserahkan ke bank/auditor menyatakan identitas pajak
   * penerbitnya. Hanya varian dokumen; nota thermal tidak berubah. */
  taxId?: string | null;
  variant: "receipt" | "document";
  /** Document variant: document title shown on the right of the head. */
  title?: string;
  number?: string;
  dateLabel?: string;
}) {
  const modern = settings.template === "modern";
  const nameStyle: CSSProperties = {
    fontFamily: headingFont(settings),
    ...(modern ? { color: settings.accentColor } : {}),
    ...(settings.template === "minimal" ? { fontWeight: 600 } : {}),
  };

  const identity = (
    <>
      {settings.logoUrl ? (
        // Logo replaces the company name as the visual head (D-13).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={settings.logoUrl}
          alt={companyName}
          style={{ maxHeight: variant === "receipt" ? "12mm" : "14mm", maxWidth: "60mm" }}
          className={variant === "receipt" ? "mx-auto object-contain" : "object-contain"}
        />
      ) : (
        <p
          className={`font-bold uppercase ${variant === "receipt" ? "text-[13px] tracking-wide" : "text-[15px] tracking-wide"}`}
          style={nameStyle}
        >
          {companyName}
        </p>
      )}
      {settings.template === "minimal" ? (
        // CT-20 (D-18): the minimal template keeps the head compact —
        // company name plus a single combined address/phone line.
        address || phone || (variant === "document" && taxId) ? (
          <p className={`mt-0.5 ${variant === "receipt" ? "text-[10px]" : "text-[11px]"}`}>
            {[
              address?.replace(/\s*\n\s*/g, ", "),
              phone ? `Telp. ${phone}` : null,
              variant === "document" && taxId ? `NPWP ${taxId}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null
      ) : (
        <>
          {address ? (
            <p className={`mt-0.5 whitespace-pre-line ${variant === "receipt" ? "" : "text-[11px]"}`}>{address}</p>
          ) : null}
          {phone ? <p className={variant === "receipt" ? "" : "text-[11px]"}>Telp. {phone}</p> : null}
          {variant === "document" && taxId ? <p className="text-[11px]">NPWP {taxId}</p> : null}
        </>
      )}
      {settings.headerText ? (
        <p className="mt-1 whitespace-pre-line text-[11px] opacity-80">{settings.headerText}</p>
      ) : null}
    </>
  );

  if (variant === "receipt") {
    return (
      <header>
        <div className="text-center">{identity}</div>
        <TemplateDivider settings={settings} dashed />
      </header>
    );
  }

  return (
    <header>
      <div className="flex items-start justify-between gap-4">
        <div>{identity}</div>
        <div className="text-right">
          {title ? (
            <p
              className="text-[13px] font-bold uppercase"
              style={{
                fontFamily: headingFont(settings),
                ...(modern ? { color: settings.accentColor } : {}),
              }}
            >
              {title}
            </p>
          ) : null}
          {number ? <p className="num text-[12px]">{number}</p> : null}
          {dateLabel ? <p className="text-[11px]">{dateLabel}</p> : null}
        </div>
      </div>
      <TemplateDivider settings={settings} />
    </header>
  );
}

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
  /** Document variant only; defaults to Dibuat oleh / Diterima oleh. */
  signatures?: PrintSignature[];
  /** Server-rendered QR data URL (see documentQrDataUrl). When showQr is
   * on but no data URL is given (settings preview), a placeholder box is
   * drawn instead so the layout stays identical. */
  qrDataUrl?: string | null;
  /** Overrides settings.footerText (e.g. the legacy receipt footer). */
  footerText?: string | null;
  /** QR size in mm — pass `paperSpec(paper).qrMm` (CT-19: ±14mm on 58mm
   * rolls, 20mm elsewhere). */
  qrSizeMm?: number;
}) {
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
    <footer className="break-inside-avoid print:break-inside-avoid">
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
      {/* A-28 UI-2 (UX-D03): baris merek dapat dimatikan pemilik dari
          Pengaturan → Cetak — dokumen untuk pelanggan bisnis tidak
          lagi wajib membawa jejak perangkat lunak. Bawaan menyala. */}
      {settings.showBranding ? (
        <p className="mt-2 text-center text-[9px] opacity-50">Dicetak dari Bisa ERP · {documentNumber}</p>
      ) : null}
    </footer>
  );
}
