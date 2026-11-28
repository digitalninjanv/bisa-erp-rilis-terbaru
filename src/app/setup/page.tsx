import { redirect } from "next/navigation";
import { adminDb } from "@/db/admin";
import { organization } from "@/db/schema";
import { SetupForm } from "@/components/auth/setup-form";

export const metadata = { title: "Setup awal" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const [existing] = await adminDb.select({ id: organization.id }).from(organization).limit(1);
  if (existing) redirect("/login");

  const tokenConfigured = Boolean(process.env.BISA_SETUP_TOKEN?.trim());

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-[#2c1e28] px-10 py-12 text-[#f3ede8] lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-[#f3ede8] text-base font-bold text-[#2c1e28]">
              b
            </span>
            <div>
              <p className="text-[15px] font-semibold tracking-tight">Bisa ERP</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#c7b3c1]">Setup awal</p>
            </div>
          </div>
          <div className="mt-20 max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c7b3c1]">
              Instalasi baru
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight">
              Satu langkah untuk membuat perusahaan pertama.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[#d8cbd4]">
              Setup membuat owner, cabang, gudang, bagan akun, pemetaan, periode fiskal, dan
              metode pembayaran dasar. Jalankan hanya sekali pada database kosong.
            </p>
          </div>
        </div>
        <p className="relative text-[11px] text-[#9f8b98]">
          Bisa ERP · Setup produksi
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-lg">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Setup perusahaan
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Buat owner & perusahaan</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Database ini masih kosong. Isi data inti toko; setelah selesai Anda akan diarahkan
            ke halaman masuk.
          </p>

          {tokenConfigured ? (
            <SetupForm />
          ) : (
            <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
              Setup web dinonaktifkan karena <code className="num">BISA_SETUP_TOKEN</code> belum
              diisi di env server. Gunakan CLI <code className="num">pnpm bootstrap</code> atau
              isi token lalu muat ulang halaman ini.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
