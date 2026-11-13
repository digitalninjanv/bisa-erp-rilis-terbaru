import { printFontFamily, type PrintSettings } from "./types";
import { PRINT_TEMPLATE_STYLES } from "./template-styles";

export function TemplateDivider({
  settings,
  dashed,
}: {
  settings: PrintSettings;
  dashed?: boolean;
}) {
  const style = PRINT_TEMPLATE_STYLES[settings.template];
  if (style.divider === "none") return null;
  if (style.divider === "double") {
    return (
      <div className="my-3" aria-hidden>
        <div style={{ borderTop: "2.5px solid #000" }} />
        <div className="mt-[2px]" style={{ borderTop: "0.75px solid #000" }} />
      </div>
    );
  }
  if (style.divider === "bar") {
    return (
      <div className="my-3 flex items-center gap-2" aria-hidden>
        <span className="h-[3px] w-10 shrink-0" style={{ backgroundColor: settings.accentColor }} />
        <span className="h-px flex-1 bg-black/30" />
      </div>
    );
  }
  if (style.divider === "hairline") {
    return <div className="my-3" style={{ borderTop: "1px solid rgba(0,0,0,0.25)" }} aria-hidden />;
  }
  if (style.divider === "dashed" || dashed) {
    return (
      <div
        className={style.dense ? "my-1.5" : "my-2"}
        style={{ borderTop: `1px dashed ${settings.accentColor}` }}
        aria-hidden
      />
    );
  }
  return (
    <div className="my-3" style={{ borderTop: `2px solid ${settings.accentColor}` }} aria-hidden />
  );
}

export function headingFont(settings: PrintSettings): string | undefined {
  return PRINT_TEMPLATE_STYLES[settings.template].serifHeading
    ? printFontFamily("serif")
    : undefined;
}

export function templateClasses(settings: PrintSettings): string {
  return PRINT_TEMPLATE_STYLES[settings.template].shellClass;
}
