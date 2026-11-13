import type { CSSProperties } from "react";
import type { PrintSettings } from "./types";
import { PRINT_TEMPLATE_STYLES } from "./template-styles";
import { TemplateDivider, headingFont } from "./template-parts";

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
  taxId?: string | null;
  variant: "receipt" | "document";
  title?: string;
  number?: string;
  dateLabel?: string;
}) {
  const style = PRINT_TEMPLATE_STYLES[settings.template];
  const nameStyle: CSSProperties = {
    fontFamily: headingFont(settings),
    ...(style.accentHeading ? { color: settings.accentColor } : {}),
    ...(settings.template === "minimal" ? { fontWeight: 600 } : {}),
  };

  const identity = (
    <>
      {settings.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={settings.logoUrl}
          alt={companyName}
          style={{
            maxHeight: variant === "receipt" ? "12mm" : style.dense ? "10mm" : "14mm",
            maxWidth: style.centeredHeader ? "70mm" : "60mm",
          }}
          className={variant === "receipt" ? "mx-auto object-contain" : "object-contain"}
        />
      ) : (
        <p
          className={`font-bold uppercase ${
            variant === "receipt"
              ? style.dense
                ? "text-[12px] tracking-wide"
                : "text-[13px] tracking-wide"
              : style.dense
                ? "text-[13px] tracking-wide"
                : "text-[15px] tracking-wide"
          }`}
          style={nameStyle}
        >
          {companyName}
        </p>
      )}
      {settings.template === "minimal" || style.dense ? (
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

  const centered = variant === "receipt" || style.centeredHeader;
  if (centered) {
    return (
      <header>
        <div className="text-center">{identity}</div>
        {variant === "document" ? (
          <div className="mt-2 text-center">
            {title ? (
              <p
                className="text-[13px] font-bold uppercase tracking-wide"
                style={{
                  fontFamily: headingFont(settings),
                  ...(style.accentHeading ? { color: settings.accentColor } : {}),
                }}
              >
                {title}
              </p>
            ) : null}
            {number ? <p className="num text-[12px]">{number}</p> : null}
            {dateLabel ? <p className="text-[11px]">{dateLabel}</p> : null}
          </div>
        ) : null}
        <TemplateDivider settings={settings} dashed={variant === "receipt"} />
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
              className={`font-bold uppercase ${style.dense ? "text-[12px]" : "text-[13px]"}`}
              style={{
                fontFamily: headingFont(settings),
                ...(style.accentHeading ? { color: settings.accentColor } : {}),
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
