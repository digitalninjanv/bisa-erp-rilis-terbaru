import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { TwoFactorForm } from "@/components/auth/two-factor-form";

export const metadata = { title: "Verifikasi 2FA" };

export default async function TwoFactorPage() {
  const session = await getSession();
  if (session?.user) redirect("/app");

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-[#2c1e28] text-base font-bold text-white">
            b
          </span>
          <div>
            <p className="text-sm font-semibold">Bisa ERP</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Verifikasi dua langkah
            </p>
          </div>
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight">Satu langkah lagi</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Akun ini dilindungi verifikasi dua langkah. Selesaikan verifikasi untuk membuka workspace.
        </p>
        <TwoFactorForm />
      </div>
    </main>
  );
}
