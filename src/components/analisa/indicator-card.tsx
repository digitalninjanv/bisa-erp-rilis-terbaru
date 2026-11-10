import { cn } from "@/lib/utils";

const TONES = {
  green: "border-tone-green/30 bg-tone-green-soft/40",
  amber: "border-tone-amber/30 bg-tone-amber-soft/40",
  red: "border-tone-red/30 bg-tone-red-soft/40",
  blue: "border-tone-blue/25 bg-tone-blue-soft/40",
  neutral: "border-border bg-card",
} as const;

export function IndicatorCard({
  number,
  title,
  question,
  value,
  hint,
  tone = "neutral",
  valueClassName,
}: {
  number: number;
  title: string;
  question: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONES;
  valueClassName?: string;
}) {
  return (
    <article className={cn("rounded-lg border px-3.5 py-3", TONES[tone])}>
      <div className="flex items-start gap-2">
        <span className="num mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-card/80 text-[10px] font-semibold text-muted-foreground">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[12px] font-semibold leading-tight">{title}</h3>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{question}</p>
        </div>
      </div>
      <p className={cn("num mt-2 text-[20px] font-semibold leading-none tracking-tight", valueClassName)}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{hint}</p> : null}
    </article>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div id={id} className="scroll-mt-20">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-0.5 text-[15px] font-semibold">{title}</h2>
      <p className="mt-0.5 max-w-3xl text-[11px] leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
