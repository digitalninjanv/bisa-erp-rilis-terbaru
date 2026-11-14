import { redirect } from "next/navigation";

export const metadata = { title: "Pengaturan" };

/** URL lama tetap aman bagi bookmark, tetapi seksi payroll kompleks sudah dipensiunkan. */
export default function LegacyPayrollIndonesiaSettingsPage() {
  redirect("/app/pengaturan");
}
