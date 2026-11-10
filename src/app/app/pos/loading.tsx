// FIX-POS Tahap 4 (POS2-18 sebagian): skeleton berbentuk terminal —
// kisi produk + panel keranjang/pembayaran — bukan skeleton statistik
// generik, agar tata letak tidak melompat saat terminal tampil.
export default function Loading() {
  return (
    <div aria-busy="true" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_396px]">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-[92px] animate-pulse rounded-lg bg-muted/70" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-[300px] animate-pulse rounded-lg border border-border bg-muted/50" />
        <div className="h-[220px] animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    </div>
  );
}
