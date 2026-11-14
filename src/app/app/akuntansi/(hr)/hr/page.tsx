import { redirect } from "next/navigation";

export const metadata = { title: "Karyawan" };

export default function HrOverviewPage() {
  redirect("/app/akuntansi/payroll");
}
