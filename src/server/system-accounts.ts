import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { accountMappings, accounts } from "@/db/schema";
import { defaultPsak118Tags } from "@/lib/akuntansi/psak118";

/**
 * R3 K-2 (Program Rekayasa): SATU-SATUNYA implementasi algoritma
 * "pastikan akun sistem dari daftar spec" — sebelumnya hidup sebagai
 * tiga salinan (payment-deductions, payroll-indonesia, fixed-assets)
 * sehingga satu perbaikan (tagging PSAK 118, A-27 B5) harus diterapkan
 * tiga kali. Daftar spec tetap milik berkas domain masing-masing;
 * yang disatukan algoritmanya.
 *
 * Mekanik (warisan fixed-assets, yang terkuat): pemetaan & akun
 * perusahaan dimuat SEKALI ke peta memori; per spec yang belum
 * terpetakan: cocokkan akun yang ada berdasarkan KODE (dengan tipe
 * sama) dulu, lalu NAMA+tipe; tak ada → sisipkan akun baru (kode
 * spec, atau fallbackCode bila kode terpakai akun lain) dengan tag
 * bawaan PSAK 118; tulis baris pemetaan. Peta di memori diperbarui
 * pada setiap sisipan agar spec berikutnya dalam panggilan yang sama
 * melihatnya. Pemetaan yang sudah ada tidak pernah ditimpa.
 *
 * Catatan urutan pencocokan: salinan payment/payroll lama memeriksa
 * nama+tipe DULU. Pada skenario tabrakan (akun pembawa nama-standar
 * dan akun pembawa kode-standar hidup bersamaan) hasilnya berbeda —
 * penyatuan ke kode→nama adalah perubahan perilaku disengaja yang
 * dibuktikan & didokumentasikan lewat
 * tests/integration/system-accounts-parity.test.ts skenario (c).
 */
export type SystemAccountSpec = {
  key: string;
  code: string;
  fallbackCode: string;
  name: string;
  type: string;
  normalBalance: string;
  section: string;
  cashFlowGroup: string;
};

export async function ensureSystemAccounts(
  tx: Tx,
  companyId: string,
  specs: readonly SystemAccountSpec[],
): Promise<Record<string, string>> {
  const mappingRows = await tx
    .select()
    .from(accountMappings)
    .where(eq(accountMappings.companyId, companyId));
  const map = new Map(mappingRows.map((row) => [row.key, row.accountId]));
  const accountRows = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  const byCode = new Map(accountRows.map((row) => [row.code, row]));
  const byName = new Map(accountRows.map((row) => [`${row.name}|${row.type}`, row]));

  for (const spec of specs) {
    if (map.has(spec.key)) continue;
    const existing =
      byCode.get(spec.code)?.type === spec.type
        ? byCode.get(spec.code)
        : (byName.get(`${spec.name}|${spec.type}`) ??
          accountRows.find((row) => row.name === spec.name && row.type === spec.type));
    let accountId = existing?.id;
    if (!accountId) {
      const codeTaken = byCode.has(spec.code);
      const [created] = await tx
        .insert(accounts)
        .values({
          companyId,
          code: codeTaken ? spec.fallbackCode : spec.code,
          name: spec.name,
          type: spec.type,
          normalBalance: spec.normalBalance,
          section: spec.section,
          cashFlowGroup: spec.cashFlowGroup,
          // A-27 B5: akun sistem yang lahir dari spec ikut tertag
          // bawaan PSAK 118 dari tipe/section-nya.
          ...defaultPsak118Tags(spec.type, spec.section),
        })
        .returning();
      accountId = created.id;
      byCode.set(created.code, created);
      byName.set(`${created.name}|${created.type}`, created);
    }
    await tx.insert(accountMappings).values({ companyId, key: spec.key, accountId });
    map.set(spec.key, accountId);
  }
  return Object.fromEntries(map);
}
