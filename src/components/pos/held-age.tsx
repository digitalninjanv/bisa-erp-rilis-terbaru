export const HELD_SALE_TTL_HOURS = 24;

export function HeldAge({ createdAt }: { createdAt: string | Date }) {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  // Usia hold memang bergantung pada waktu render; halaman ini force-dynamic.
  // eslint-disable-next-line react-hooks/purity
  const ageMs = Date.now() - created.getTime();
  const ttlMs = HELD_SALE_TTL_HOURS * 60 * 60 * 1000;
  const expired = ageMs > ttlMs;
  const remainingHours = Math.max(0, Math.ceil((ttlMs - ageMs) / (60 * 60 * 1000)));
  return (
    <span
      className={
        expired
          ? "ml-1.5 inline-flex rounded-full bg-tone-red-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-red"
          : "ml-1.5 inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
      }
    >
      {expired ? "Kedaluwarsa" : `${remainingHours} jam lagi`}
    </span>
  );
}
