import Link from "next/link";
import { CheckCircle2, CircleAlert, MinusCircle } from "lucide-react";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import type { MonthEndChecklistStep } from "@/server/reports";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * A-24 T4 (pola Accurate "Proses Akhir Bulan") — daftar periksa tutup
 * periode terpandu di atas data keadaan nyata dari
 * getMonthEndChecklist: tiap langkah berstatus Selesai/Belum/Tidak
 * diperlukan, berpenjelasan satu baris, dan tertaut ke halaman
 * pemilik langkahnya. Bukan simulasi dan bukan tombol ajaib: menutup
 * periode tetap dilakukan pemiliknya lewat PeriodManager di bawah.
 */
export function MonthEndChecklist({
  year,
  month,
  pageYear,
  steps,
}: {
  year: number;
  month: number;
  pageYear: number;
  steps: MonthEndChecklistStep[];
}) {
  const monthValue = `${year}-${String(month).padStart(2, "0")}`;
  const pendingCount = steps.filter((step) => step.status === "pending").length;
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">
            Proses akhir bulan — {MONTHS[month - 1]} {year}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {pendingCount === 0
              ? "Semua langkah yang diperlukan sudah selesai untuk bulan ini."
              : `${pendingCount} langkah belum selesai. Kerjakan dari atas ke bawah, lalu tutup periode di daftar periode di bawah.`}
          </p>
        </div>
        <AutoFilterForm action="/app/akuntansi/periode" className="flex items-end gap-2">
          <input type="hidden" name="year" value={pageYear} />
          <label className="space-y-1">
            <span className={labelClass}>Bulan periksa</span>
            <input type="month" name="bulan" defaultValue={monthValue} className={fieldClass} />
          </label>
          <button
            type="submit"
            className="h-8 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
          >
            Periksa
          </button>
        </AutoFilterForm>
      </div>
      <ol className="divide-y divide-border/60">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 shrink-0">
              {step.status === "done" ? (
                <CheckCircle2 className="size-4 text-emerald-600" aria-label="Selesai" />
              ) : step.status === "pending" ? (
                <CircleAlert className="size-4 text-amber-600" aria-label="Belum selesai" />
              ) : (
                <MinusCircle className="size-4 text-muted-foreground" aria-label="Tidak diperlukan" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium">
                {index + 1}. {step.title}
                <span
                  className={`ml-2 inline-block rounded-full px-1.5 py-px align-middle text-[11px] font-semibold ${
                    step.status === "done"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : step.status === "pending"
                        ? "bg-amber-500/10 text-amber-700"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step.status === "done" ? "Selesai" : step.status === "pending" ? "Belum" : "Tidak diperlukan"}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{step.detail}</p>
            </div>
            <Link
              href={step.href}
              className="shrink-0 text-[11px] font-medium text-primary transition-colors hover:underline"
            >
              Buka
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
