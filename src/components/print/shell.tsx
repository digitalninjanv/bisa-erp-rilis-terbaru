import type { CSSProperties, ReactNode } from "react";
import { paperSpec, printFontFamily, type PrintPaper, type PrintSettings } from "./types";
import { templateClasses } from "./template-parts";

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
  // CT-25 (D-18): sheet papers carry "Halaman x dari y" in the @page
  // bottom margin box. Thermal rolls are continuous.
  const pageRule = spec.paged
    ? `@page { size: ${spec.pageSize}; margin: ${spec.pageMargin}; @bottom-center { content: "Halaman " counter(page) " dari " counter(pages); font-size: 9px; color: rgba(0,0,0,0.55); } }`
    : `@page { size: ${spec.pageSize}; margin: ${spec.pageMargin}; }`;
  return (
    <div
      className={`print-doc print-doc--${settings.template} ${templateClasses(settings)}${spec.paged ? " paged-print" : ""}`}
      data-template={settings.template}
      data-paper={paper}
      style={style}
    >
      {pageStyle ? <style>{pageRule}</style> : null}
      {children}
    </div>
  );
}
