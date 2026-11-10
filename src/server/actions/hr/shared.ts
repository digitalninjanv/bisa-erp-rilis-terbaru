// A-26 Q4 (K-03): helper bersama antar berkas aksi HR (bukan berkas "use server").

import { revalidatePath } from "next/cache";

/**
 * SIM-2 S7B-1 — HR lanjutan (§6A–6G). Seluruh aksi tulis HR bergate
 * `payroll.manage` di modul akuntansi — gerbang yang sama dengan data
 * gaji (pola S6: data HR sensitif mengikuti izin payroll, bukan
 * accounting.view). Halaman baca memakai `payroll.view`.
 */

export function revalidateHrPaths() {
  revalidatePath("/app/akuntansi/payroll");
  revalidatePath("/app/akuntansi/hr");
  revalidatePath("/app/akuntansi/hr/pengaturan");
  revalidatePath("/app/akuntansi");
}
