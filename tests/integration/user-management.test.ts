import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { db } from "@/db";
import { adminSql } from "@/db/admin";
import { account, member, organization, user } from "@/db/schema";
import { wipeCompanyFixture } from "../helpers/wipe-company";
import {
  createCompanyUserAction,
  deleteCompanyRoleAction,
  removeCompanyUserAction,
  resetUserPasswordAction,
  saveCompanyRoleAction,
  updateUserRoleAction,
  updateUserRolesBatchAction,
} from "@/server/actions/users";

// A-13: halaman Pengaturan → Pengguna dilaporkan "eror" saat menambah
// pengguna baru. Akar masalah yang terbukti lewat reproduksi UI: seluruh
// aksi di src/server/actions/users.ts memakai schema.parse() mentah,
// sehingga SETIAP kegagalan validasi Zod (sandi < 8 karakter, email tak
// berformat, nama < 2 karakter) lolos ke guard() sebagai ZodError dan
// ditampilkan ke pengguna sebagai INTERNAL "Terjadi kesalahan pada
// server" — tak bisa dibedakan dari kerusakan server sungguhan. Aksi
// lain di repo memakai parseInput() yang mengubahnya menjadi VALIDATION
// berpesan Bahasa Indonesia. Test validasi di berkas ini RED sebelum
// perbaikan (code INTERNAL) dan hijau sesudahnya.
//
// Perusahaan uji tersendiri (organisasi + owner dibuat langsung), sesi
// dimock mengikuti pola payment-method-crud.test.ts dengan daftar izin
// peran ASLI dari @/lib/permissions.

const ORG_ID = "01900000-0000-7000-8000-00000000aa13";
const OWNER_ID = "01900000-0000-7000-8000-00000000aa14";
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const email = (name: string) => `${name}.${suffix}@uji.local`;

const session = vi.hoisted(() => ({
  role: "owner",
  userId: "",
  permissions: null as string[] | null,
}));
session.userId = OWNER_ID;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const { AppError } = await import("@/lib/errors");
  const { permissionsFor } = await import("@/lib/permissions");
  const requirePermission = async (permission: string) => {
    const held = session.permissions ?? permissionsFor(session.role);
    if (!held.includes(permission as never)) {
      throw new AppError("FORBIDDEN", "Peran ini tidak memiliki izin untuk mengelola pengguna.");
    }
    return {
      company: { id: ORG_ID },
      user: { id: session.userId },
      role: session.role,
      permissions: held,
    };
  };
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

const createdUserIds: string[] = [];
let adminUserId = "";
let cashierUserId = "";
let secondOwnerId = "";

async function memberRole(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, ORG_ID), eq(member.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

async function credentialHash(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  return row?.password ?? null;
}

beforeAll(async () => {
  // Bersihkan sisa run sebelumnya yang gagal di tengah — tuntas satu
  // transaksi lewat helper bersama (AUD-001; termasuk baris audit_log
  // perusahaan uji yang dulu terpaksa dibiarkan).
  await wipeCompanyFixture(adminSql, ORG_ID);
  await db.insert(organization).values({
    id: ORG_ID,
    name: "PT Uji Pengguna",
    slug: `uji-pengguna-${suffix}`,
  });
  await db.insert(user).values({
    id: OWNER_ID,
    name: "Owner Uji",
    email: email("owner"),
    emailVerified: true,
    role: "user",
  });
  await db.insert(account).values({
    id: crypto.randomUUID(),
    accountId: OWNER_ID,
    providerId: "credential",
    userId: OWNER_ID,
    password: await hashPassword("Owner12345!"),
  });
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: ORG_ID,
    userId: OWNER_ID,
    role: "owner",
  });
  createdUserIds.push(OWNER_ID);
});

afterAll(async () => {
  // AUD-001: helper bersama menghapus seluruh data perusahaan uji
  // (termasuk audit_log — dulu dibiarkan karena trigger append-only
  // menghalangi delete peran aplikasi, dan menjadi residu) beserta
  // akun & user fixture, dalam satu transaksi.
  await wipeCompanyFixture(adminSql, ORG_ID, createdUserIds);
});

describe("buat pengguna (jalur yang dilaporkan eror)", () => {
  it("owner membuat kasir: berhasil, peran benar, sandi bisa diverifikasi untuk login", async () => {
    const result = await createCompanyUserAction({
      name: "Kasir Uji",
      email: email("kasir"),
      password: "Kasir12345!",
      role: "cashier",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    cashierUserId = result.data.id;
    createdUserIds.push(cashierUserId);
    expect(result.data.role).toBe("cashier");
    expect(await memberRole(cashierUserId)).toBe("cashier");
    const hash = await credentialHash(cashierUserId);
    expect(hash).toBeTruthy();
    // Verifikasi scrypt yang sama seperti yang dijalankan login credential.
    expect(await verifyPassword({ hash: hash!, password: "Kasir12345!" })).toBe(true);
    expect(await verifyPassword({ hash: hash!, password: "BukanSandi123!" })).toBe(false);
  });

  it("owner membuat admin: berhasil", async () => {
    const result = await createCompanyUserAction({
      name: "Admin Uji",
      email: email("admin"),
      password: "Admin12345!",
      role: "admin",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    adminUserId = result.data.id;
    createdUserIds.push(adminUserId);
    expect(await memberRole(adminUserId)).toBe("admin");
  });

  it("owner membuat owner kedua: berhasil (formulir mengizinkan untuk owner)", async () => {
    const result = await createCompanyUserAction({
      name: "Owner Kedua",
      email: email("owner2"),
      password: "Owner12345!",
      role: "owner",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    secondOwnerId = result.data.id;
    createdUserIds.push(secondOwnerId);
    expect(await memberRole(secondOwnerId)).toBe("owner");
  });

  it("email duplikat (beda huruf besar/kecil) ditolak bersih sebagai CONFLICT", async () => {
    const result = await createCompanyUserAction({
      name: "Kasir Lain",
      email: email("KASIR").toUpperCase().replace("@UJI.LOCAL", "@uji.local"),
      password: "Kasir12345!",
      role: "cashier",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CONFLICT");
    expect(result.message).toContain("Email sudah terdaftar");
  });
});

describe("validasi input menghasilkan VALIDATION berpesan jelas, bukan INTERNAL generik", () => {
  it("kata sandi 7 karakter ditolak dengan pesan minimal 8 karakter", async () => {
    const result = await createCompanyUserAction({
      name: "Sandi Pendek",
      email: email("pendek"),
      password: "abc1234",
      role: "cashier",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
    expect(result.message).toContain("Kata sandi minimal 8 karakter");
  });

  it("email tanpa format yang benar ditolak dengan pesan format email", async () => {
    for (const bad of ["bukan-email", "kasir@toko"]) {
      const result = await createCompanyUserAction({
        name: "Email Rusak",
        email: bad,
        password: "Kasir12345!",
        role: "cashier",
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toContain("Format email tidak valid");
    }
  });

  it("nama 1 karakter ditolak dengan pesan minimal 2 karakter", async () => {
    const result = await createCompanyUserAction({
      name: "A",
      email: email("nama1"),
      password: "Kasir12345!",
      role: "cashier",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
    expect(result.message).toContain("Nama minimal 2 karakter");
  });

  it("reset kata sandi terlalu pendek juga VALIDATION, bukan INTERNAL", async () => {
    const result = await resetUserPasswordAction({ userId: cashierUserId, password: "abc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
    expect(result.message).toContain("Kata sandi minimal 8 karakter");
  });

  it("simpan peran dengan nama 1 karakter menghasilkan VALIDATION, bukan INTERNAL", async () => {
    const result = await saveCompanyRoleAction({ name: "X", modules: ["pos"], permissions: ["pos.sell"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
  });

  it("hapus peran dengan id bukan uuid menghasilkan VALIDATION, bukan INTERNAL", async () => {
    const result = await deleteCompanyRoleAction("bukan-uuid");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
  });
});

describe("gerbang peran & penjaga owner", () => {
  it("admin membuat kasir: berhasil (admin memegang users.manage)", async () => {
    session.role = "admin";
    session.userId = adminUserId;
    try {
      const result = await createCompanyUserAction({
        name: "Kasir Dua",
        email: email("kasir2"),
        password: "Kasir12345!",
        role: "cashier",
      });
      expect(result.ok).toBe(true);
      if (result.ok) createdUserIds.push(result.data.id);
    } finally {
      session.role = "owner";
      session.userId = OWNER_ID;
    }
  });

  it("non-owner tidak bisa membuat owner: FORBIDDEN berpesan jelas", async () => {
    session.role = "admin";
    session.userId = adminUserId;
    try {
      const result = await createCompanyUserAction({
        name: "Calon Owner",
        email: email("calonowner"),
        password: "Owner12345!",
        role: "owner",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("FORBIDDEN");
      expect(result.message).toContain("Hanya owner");
    } finally {
      session.role = "owner";
      session.userId = OWNER_ID;
    }
  });

  it("non-owner tidak bisa mengubah peran owner yang ada", async () => {
    session.role = "admin";
    session.userId = adminUserId;
    try {
      const result = await updateUserRoleAction({ userId: secondOwnerId, role: "manager" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("FORBIDDEN");
    } finally {
      session.role = "owner";
      session.userId = OWNER_ID;
    }
    expect(await memberRole(secondOwnerId)).toBe("owner");
  });

  it("mengubah peran pengguna lain bekerja; mengubah peran sendiri ditolak", async () => {
    const changed = await updateUserRoleAction({ userId: cashierUserId, role: "manager" });
    expect(changed.ok).toBe(true);
    expect(await memberRole(cashierUserId)).toBe("manager");

    const self = await updateUserRoleAction({ userId: OWNER_ID, role: "admin" });
    expect(self.ok).toBe(false);
    if (!self.ok) {
      expect(self.code).toBe("VALIDATION");
      expect(self.message).toContain("akun sendiri");
    }
    expect(await memberRole(OWNER_ID)).toBe("owner");
  });

  it("MD-03: updateUserRolesBatchAction mengubah banyak peran secara atomik dalam satu transaksi", async () => {
    const batchResult = await updateUserRolesBatchAction({
      updates: [
        { userId: cashierUserId, role: "warehouse" },
        { userId: secondOwnerId, role: "admin" },
      ],
    });
    expect(batchResult.ok).toBe(true);
    expect(await memberRole(cashierUserId)).toBe("warehouse");
    expect(await memberRole(secondOwnerId)).toBe("admin");

    // Kembalikan secondOwnerId menjadi owner
    await updateUserRoleAction({ userId: secondOwnerId, role: "owner" });
    expect(await memberRole(secondOwnerId)).toBe("owner");
  });

  it("demote dua owner serentak tetap menyisakan satu owner", async () => {
    session.userId = OWNER_ID;
    const demoteSecond = updateUserRoleAction({ userId: secondOwnerId, role: "manager" });
    session.userId = secondOwnerId;
    const demoteFirst = updateUserRoleAction({ userId: OWNER_ID, role: "manager" });
    const results = await Promise.all([demoteSecond, demoteFirst]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const roles = [await memberRole(OWNER_ID), await memberRole(secondOwnerId)];
    expect(roles.filter((role) => role === "owner")).toHaveLength(1);

    // Restore the fixture for following role and removal cases.
    const currentOwner = roles[0] === "owner" ? OWNER_ID : secondOwnerId;
    const demotedOwner = currentOwner === OWNER_ID ? secondOwnerId : OWNER_ID;
    session.userId = currentOwner;
    await updateUserRoleAction({ userId: demotedOwner, role: "owner" });
    session.userId = OWNER_ID;
  });

  it("MD-03: updateUserRolesBatchAction menolak bila salah satu akun adalah diri sendiri atau menghapus owner terakhir", async () => {
    const selfBatch = await updateUserRolesBatchAction({
      updates: [
        { userId: cashierUserId, role: "cashier" },
        { userId: OWNER_ID, role: "admin" },
      ],
    });
    expect(selfBatch.ok).toBe(false);
    if (!selfBatch.ok) {
      expect(selfBatch.code).toBe("VALIDATION");
      expect(selfBatch.message).toContain("akun sendiri");
    }

    // Role cashierUserId tidak berubah karena transaksi dibatalkan (atomik)
    expect(await memberRole(cashierUserId)).toBe("warehouse");
  });

  it("reset sandi mengganti kredensial: sandi baru terverifikasi, sandi lama tidak", async () => {
    const result = await resetUserPasswordAction({ userId: cashierUserId, password: "ManagerBaru123!" });
    expect(result.ok).toBe(true);
    const hash = await credentialHash(cashierUserId);
    expect(await verifyPassword({ hash: hash!, password: "ManagerBaru123!" })).toBe(true);
    expect(await verifyPassword({ hash: hash!, password: "Kasir12345!" })).toBe(false);
  });

  it("CORE-01: user-admin kustom tidak bisa memberi peran atau mereset akun yang lebih tinggi", async () => {
    session.role = "custom-user-admin";
    session.permissions = ["users.manage"];
    try {
      const createManager = await createCompanyUserAction({
        name: "Manager Liar",
        email: email("managerliar"),
        password: "Manager12345!",
        role: "manager",
      });
      expect(createManager.ok).toBe(false);
      if (!createManager.ok) expect(createManager.code).toBe("FORBIDDEN");

      const resetWarehouse = await resetUserPasswordAction({
        userId: cashierUserId,
        password: "AmbilAlih123!",
      });
      expect(resetWarehouse.ok).toBe(false);
      if (!resetWarehouse.ok) expect(resetWarehouse.code).toBe("FORBIDDEN");
    } finally {
      session.role = "owner";
      session.permissions = null;
      session.userId = OWNER_ID;
    }
  });

  it("mencabut owner ditolak; mencabut pengguna biasa bekerja; mencabut diri sendiri ditolak", async () => {
    const ownerRemoval = await removeCompanyUserAction(secondOwnerId);
    expect(ownerRemoval.ok).toBe(false);
    if (!ownerRemoval.ok) expect(ownerRemoval.message).toContain("owner tidak bisa dihapus");
    expect(await memberRole(secondOwnerId)).toBe("owner");

    const selfRemoval = await removeCompanyUserAction(OWNER_ID);
    expect(selfRemoval.ok).toBe(false);

    const removed = await removeCompanyUserAction(cashierUserId);
    expect(removed.ok).toBe(true);
    expect(await memberRole(cashierUserId)).toBeNull();
  });
});
