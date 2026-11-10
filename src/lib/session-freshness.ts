import { AppError } from "@/lib/errors";

/**
 * R3 K-5 (Program Rekayasa): umur maksimum sesi (detik) yang masih
 * dianggap "segar" untuk operasi sensitif (eskalasi hak, finalitas
 * keuangan, ekspor gaji). Satu nilai dipakai konfigurasi Better Auth
 * (`session.freshAge` di lib/auth.ts) dan pemeriksa DAL
 * `requireFreshSession` di bawah.
 *
 * Modul daun terpisah dengan sengaja: helper ini murni (hanya
 * membaca cap waktu sesi dari ctx) dan diimpor langsung oleh aksi —
 * menaruhnya di lib/session.ts akan memaksa setiap mock pabrik
 * "@/lib/session" di suite ikut mengekspornya, padahal perilaku
 * produksinya identik. lib/session.ts me-re-export keduanya agar
 * permukaan DAL tetap satu pintu.
 */
export const SESSION_FRESH_AGE_SECONDS = 60 * 60;

/**
 * Penilai kesegaran sesi MURNI — cermin persis semantik
 * freshSessionMiddleware Better Auth 1.7.15 (terverifikasi dari
 * sumber terpasang): sesi tidak segar bila now - createdAt >=
 * freshAge. Batasnya inklusif di sisi tolak: umur 3.599 detik
 * lolos, 3.600 detik ditolak. Refresh updateAge TIDAK menggeser
 * createdAt, jadi umur selalu diukur dari masuk terakhir.
 */
export function assertSessionFresh(createdAt: Date, now: Date = new Date()): void {
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  if (ageMs >= SESSION_FRESH_AGE_SECONDS * 1000) {
    throw new AppError(
      "FORBIDDEN",
      "Sesi Anda sudah lebih dari 1 jam. Demi keamanan, masuk ulang untuk melanjutkan tindakan ini.",
    );
  }
}

/** Bentuk minimal konteks yang dinilai kesegarannya (struktural —
 * CompanyContext lib/session.ts memenuhinya). */
export type FreshnessContext = {
  session?: { createdAt?: Date | string | null } | null;
};

/**
 * Gerbang kesegaran untuk operasi sensitif bernama (manajemen
 * pengguna & peran, tutup/kunci periode & tutup tahun, ekspor
 * payroll) — dipanggil SESUDAH requirePermission dengan ctx yang
 * sama. Operasi POS sengaja TIDAK memakai gerbang ini (frekuensi
 * operasional tinggi; sudah bergerbang izin + alasan wajib).
 *
 * Konteks produksi selalu dibangun requireAuth dari baris sesi
 * Better Auth yang createdAt-nya selalu terisi. Konteks tanpa
 * createdAt yang sah hanya dapat lahir dari rakitan tangan (test);
 * konteks semacam itu dinilai segar karena umurnya memang tidak
 * dapat dinilai — jalur produksi tidak pernah mencapainya.
 */
export function requireFreshSession(ctx: FreshnessContext): void {
  const createdAt = ctx.session?.createdAt;
  if (!createdAt) return;
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return;
  assertSessionFresh(new Date(time));
}
