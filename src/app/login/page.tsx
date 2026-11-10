import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/session";

export const metadata = { title: "Masuk" };

export default async function LoginPage() {
  const session = await getSession();
  if (session?.user) redirect("/app");

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
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#c7b3c1]">Minimarket suite</p>
            </div>
          </div>

          <div className="mt-20 max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c7b3c1]">
              Satu alur kerja
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight">
              Operasional toko, stok, dan pembukuan yang saling terhubung.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[#d8cbd4]">
              Setiap transaksi kasir langsung membentuk pergerakan stok dan jurnal. Tanpa
              rekonsiliasi manual di akhir bulan.
            </p>
          </div>

          <div className="mt-12 grid max-w-md gap-3">
            {[
              ["POS", "Kasir cepat, diskon pelanggan, pembulatan, sesi kas."],
              ["Gudang", "Penerimaan, transfer, opname, dan kartu stok."],
              ["Akuntansi", "Jurnal otomatis, laporan, payroll, bank."],
            ].map(([name, copy], index) => (
              <div key={name} className="flex gap-4 border-t border-white/10 pt-3">
                <span className="num text-xs text-[#a8839c]">0{index + 1}</span>
                <div>
                  <p className="text-sm font-medium">{name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-[#bfaeb9]">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-[#9f8b98]">
          Bisa ERP · Dibangun untuk operasional minimarket Indonesia
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-[#2c1e28] text-base font-bold text-white">
              b
            </span>
            <div>
              <p className="text-sm font-semibold">Bisa ERP</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Minimarket suite
              </p>
            </div>
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Masuk ke workspace
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Selamat datang kembali</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Gunakan akun staf toko. Hak akses mengikuti peran yang diberikan pemilik.
          </p>

          <LoginForm />

          {process.env.NODE_ENV === "development" ? (
            <div className="mt-8 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">Akun demo (Hanya Lingkungan Pengembangan)</p>
              <p className="mt-1">
                <span className="num">owner@bisa.id</span> · <span className="num">Bisa12345!</span>
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
