import { AppError } from "@/lib/errors";
import { d, sum, type MoneyInput } from "@/lib/money";

/** Allocate sub-4dp residuals on the largest leg of each side, once.
 * Detail, cash guards and monthly summaries must consume these same amounts. */
export function canonicalJournalAmounts<T extends { debit?: MoneyInput; credit?: MoneyInput }>(input: T[]) {
  const lines = input.map((line) => ({ ...line, debitValue: d(line.debit), creditValue: d(line.credit) }));
  for (const line of lines) {
    if (!line.debitValue.isFinite() || !line.creditValue.isFinite() || line.debitValue.lt(0) || line.creditValue.lt(0)) {
      throw new AppError("VALIDATION", "Nilai jurnal harus berupa angka non-negatif yang terbatas.");
    }
    if (line.debitValue.gt(0) && line.creditValue.gt(0)) {
      throw new AppError("VALIDATION", "Setiap baris jurnal hanya boleh terisi di satu sisi (debit atau kredit), tidak boleh keduanya sekaligus.");
    }
  }
  const debit = sum(lines.map((line) => line.debitValue));
  const credit = sum(lines.map((line) => line.creditValue));
  if (!debit.eq(credit)) throw new AppError("VALIDATION", `Jurnal tidak seimbang. Debit ${debit.toFixed(4)} vs kredit ${credit.toFixed(4)}.`);
  for (const side of ["debitValue", "creditValue"] as const) {
    const ordered = lines.filter((line) => line[side].gt(0)).sort((a, b) => b[side].cmp(a[side]));
    for (const line of ordered) line[side] = line[side].toDecimalPlaces(4);
    let residual = debit.toDecimalPlaces(4).minus(sum(ordered.map((line) => line[side])));
    for (const line of ordered) {
      // A large negative residual may exceed the largest rounded tiny leg.
      const adjustment = residual.lt(0) ? (residual.abs().gt(line[side]) ? line[side].negated() : residual) : residual;
      line[side] = line[side].plus(adjustment);
      residual = residual.minus(adjustment);
      if (residual.isZero()) break;
    }
  }
  return lines.filter((line) => line.debitValue.gt(0) || line.creditValue.gt(0));
}
