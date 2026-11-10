import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import { SESSION_FRESH_AGE_SECONDS } from "@/lib/session-freshness";

/**
 * SIM-2 S6 (SEC-02): plugin `admin()` dan `organization()` DICABUT.
 * Keduanya terpasang tetapi tidak pernah dipakai: satu-satunya
 * pemakaian auth di aplikasi adalah signIn/signOut (klien) dan
 * getSession (server) — terbukti dari pemindaian seluruh `src/`.
 * Endpoint plugin organization melewati penjaga aplikasi (aturan owner
 * terakhir dsb.) dan plugin admin memberi kuasa lintas-tenant
 * (impersonasi) kepada `user.role = 'admin'`; membiarkannya terpasang
 * berarti satu perubahan data di masa depan mengaktifkan model
 * otorisasi kedua tanpa tinjauan. Perusahaan & keanggotaan dikelola
 * aplikasi lewat tabel `organization`/`member` secara langsung
 * (Drizzle), bukan lewat API plugin — pencabutan tidak mengubah
 * perilaku login/sesi (terkunci oleh tests/sim2/auth-hardening).
 *
 * SEC-08: pendaftaran publik dimatikan (`disableSignUp`). Tidak ada
 * halaman daftar; akun hanya dibuat admin lewat manajemen pengguna
 * (createCompanyUserAction menulis baris user/account secara
 * langsung, bukan lewat endpoint sign-up).
 */


export const auth = betterAuth({
  // FIX-ARS Tahap 1 (ARS4-03): appName/baseURL/secret come from the
  // validated env module. The secret can no longer be silently
  // undefined, and in production BETTER_AUTH_URL is required and
  // non-localhost. Outside production an unset BETTER_AUTH_URL leaves
  // baseURL undefined so Better Auth infers the origin from the
  // incoming request (equivalent to the old localhost default in dev).
  appName: env.appName,
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  // Dev-only: browser bisa membuka aplikasi lewat localhost, 127.0.0.1,
  // atau IP LAN (mis. dari perangkat lain). Better Auth menolak sign-in
  // dari origin yang tidak dikenal dengan 403 "Invalid origin", sehingga
  // di UI tampak seperti terlempar ke /login terus. Di produksi origin
  // sudah dikunci oleh BETTER_AUTH_URL, jadi daftar longgar ini tidak
  // dipakai.
  trustedOrigins: env.isProduction
    ? []
    : [
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://[::1]:*",
        "http://192.168.*.*:*",
        "http://10.*.*.*:*",
        "http://172.16.*.*:*",
      ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    disableSignUp: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // R3 K-5 (Program Rekayasa): jendela "sesi segar" untuk operasi
    // sensitif — dipakai endpoint sensitif bawaan Better Auth
    // (freshSessionMiddleware menilai now - session.createdAt >=
    // freshAge; refresh updateAge TIDAK menggeser createdAt) dan
    // pemeriksa DAL requireFreshSession di lib/session.ts; nilainya
    // satu sumber di lib/session-freshness.ts.
    freshAge: SESSION_FRESH_AGE_SECONDS,
  },
  // SIM-2 S6 (SEC-04, sebagian): rate limit kini EKSPLISIT, bukan
  // sekadar bawaan pustaka yang hanya aktif di production. Penyimpanan
  // tetap in-memory per instance (batasan yang disadari — untuk
  // multi-instance perlu storage database/sekunder; lihat laporan S6).
  rateLimit: {
    enabled: true,
    window: 10,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
  },
  plugins: [twoFactor(), nextCookies()],
});

export type Auth = typeof auth;
