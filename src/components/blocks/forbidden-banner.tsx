import { PERMISSIONS, isPermission } from "@/lib/permissions";

/**
 * A-23 SIS-04: penjelasan penolakan izin yang dirender permukaan
 * pendaratan (Beranda & beranda modul) sesudah `requirePermissionPage`
 * memantulkan pengguna dengan `?forbidden=<izin>`. Satu bentuk untuk
 * semua rute — pola yang sama dengan banner penolakan modul di
 * Beranda. Parameter yang tidak dikenal tidak merender apa pun.
 */
export function ForbiddenBanner({ permission }: { permission?: string }) {
  if (!permission || !isPermission(permission)) return null;
  return (
    <div className="rounded-lg border border-[#f0d5d1] bg-[#fbe9e7] px-4 py-2.5 text-[12px] text-[#a3362a]">
      Akun ini tidak punya akses: {PERMISSIONS[permission]}. Hubungi admin untuk mengubah peran.
    </div>
  );
}
