import { requireAuth } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { TwoFactorSettings } from "@/components/auth/two-factor-settings";

export const metadata = { title: "Keamanan akun" };
export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const ctx = await requireAuth();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Keamanan akun"
        description={`Verifikasi dua langkah untuk ${ctx.user.email}. Aktifkan sebelum akun dipakai di perangkat bersama.`}
      />
      <TwoFactorSettings />
    </div>
  );
}
