import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import {
  accounts,
  paymentMethods,
  salePayments,
  sales,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { listPaymentMethods } from "@/server/catalog";
import { getSaleDetail } from "@/server/reports";
import { deletePaymentMethodAction, savePaymentMethodAction, setPaymentMethodActiveAction, updatePaymentMethodAction } from "@/server/actions/settings/pembayaran";

// A-8 batch 2: metode pembayaran CRUD penuh di Pengaturan.
// - update mengubah nama/jenis/akun/instruksi/urutan, tetapi TIDAK kode
//   (kode terkunci karena dipakai riwayat) dan TIDAK status aktif
//   (status hanya berubah lewat aksi aktif/nonaktif).
// - savePaymentMethodAction menjadi create-only agar jalur lama tidak
//   bisa dipakai mengubah kode dari belakang.
// - nonaktif → hilang dari listPaymentMethods (yang dibaca POS) tetapi
//   riwayat penjualan lama tetap menampilkan nama metodenya.
// - hapus ditolak CONFLICT bila sudah dipakai sale_payments, dengan
//   jumlah transaksi pada pesan; metode segar terhapus bersih.
// - gerbang peran sama dengan aksi tetangga: settings.manage
//   (owner/admin saja) — mock sesi di bawah menegakkan daftar izin
//   peran ASLI dari @/lib/permissions, bukan daftar karangan.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const GHOST_ID = "01900000-0000-7000-8000-00000000dead";
const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const CODE_CLEAN = `PMCU${suffix}A`;
const CODE_USED = `PMCU${suffix}B`;
const CODE_GONE = `PMCU${suffix}C`;

const session = vi.hoisted(() => ({ role: "owner" }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async () => {
  const { AppError } = await import("@/lib/errors");
  const { permissionsFor } = await import("@/lib/permissions");
  const requirePermission = async (permission: string) => {
    if (!permissionsFor(session.role).includes(permission as never)) {
      throw new AppError("FORBIDDEN", "Peran ini tidak memiliki izin untuk mengubah pengaturan.");
    }
    return {
      company: { id: ORG_ID },
      user: { id: USER_ID },
      role: session.role,
    };
  };
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

let kasAccountId = "";
let qrisAccountId = "";
let warehouseId = "";
let cleanMethodId = "";
let usedMethodId = "";
let usedSaleId = "";

async function readMethod(id: string) {
  return withCompanyReadOnly(ORG_ID, async (tx) => {
    const [row] = await tx
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.id, id)))
      .limit(1);
    return row ?? null;
  });
}

async function createMethod(code: string, name: string) {
  const result = await savePaymentMethodAction({
    code,
    name,
    type: "cash",
    accountId: kasAccountId,
    instructions: "Instruksi awal",
    sortOrder: 5,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.data.id;
}

beforeAll(async () => {
  session.role = "owner";
  await withCompanyReadOnly(ORG_ID, async (tx) => {
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(eq(accounts.companyId, ORG_ID));
    kasAccountId = rows.find((row) => row.code === "110107")!.id;
    qrisAccountId = rows.find((row) => row.code === "110108")!.id;
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
      .limit(1);
    warehouseId = warehouse!.id;
  });

  // Bersihkan sisa run sebelumnya (kode fixture unik per run, jadi ini
  // hanya jaring pengaman bila run terdahulu terputus).
  await withCompany(ORG_ID, async (tx) => {
    const stale = await tx
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), like(paymentMethods.code, "PMCU%")));
    for (const row of stale) {
      await tx.delete(salePayments).where(eq(salePayments.methodId, row.id));
    }
    await tx
      .delete(sales)
      .where(and(eq(sales.companyId, ORG_ID), like(sales.number, "INV-PMCU%")));
    await tx
      .delete(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), like(paymentMethods.code, "PMCU%")));
  });

  cleanMethodId = await createMethod(CODE_CLEAN, "Metode Uji Bersih");
  usedMethodId = await createMethod(CODE_USED, "Metode Uji Terpakai");

  // Satu penjualan + pembayaran fixture agar usedMethodId "terpakai".
  await withCompany(ORG_ID, async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        companyId: ORG_ID,
        warehouseId,
        number: `INV-PMCU-${suffix}`,
        date: "2026-11-04",
        cashierId: USER_ID,
        status: "completed",
        total: "10000",
        paidTotal: "10000",
        paymentStatus: "paid",
      })
      .returning({ id: sales.id });
    usedSaleId = sale!.id;
    await tx.insert(salePayments).values({
      companyId: ORG_ID,
      saleId: usedSaleId,
      methodId: usedMethodId,
      amount: "10000",
      tendered: "10000",
    });
  });
});

afterAll(async () => {
  session.role = "owner";
  await withCompany(ORG_ID, async (tx) => {
    await tx.delete(salePayments).where(eq(salePayments.saleId, usedSaleId));
    await tx.delete(sales).where(eq(sales.id, usedSaleId));
    await tx
      .delete(paymentMethods)
      .where(and(eq(paymentMethods.companyId, ORG_ID), like(paymentMethods.code, "PMCU%")));
  });
});

describe("metode pembayaran CRUD (A-8)", () => {
  it("update mengubah nama/jenis/akun/instruksi/urutan; kode & status aktif tidak berubah", async () => {
    // Nonaktifkan dulu: update tidak boleh mengaktifkan kembali secara
    // diam-diam (jebakan isActive ?? true pada jalur save lama).
    const off = await setPaymentMethodActiveAction({ id: cleanMethodId, isActive: false });
    expect(off.ok).toBe(true);

    const result = await updatePaymentMethodAction({
      id: cleanMethodId,
      // Klien nakal mengirim kode lain — server wajib mengabaikannya.
      ...({ code: "DIGANTI" } as Record<string, unknown>),
      name: "Metode Uji Diubah",
      type: "qris",
      accountId: qrisAccountId,
      instructions: "Instruksi baru",
      sortOrder: 42,
    } as Parameters<typeof updatePaymentMethodAction>[0]);
    expect(result.ok).toBe(true);

    const row = await readMethod(cleanMethodId);
    expect(row).not.toBeNull();
    expect(row!.name).toBe("Metode Uji Diubah");
    expect(row!.type).toBe("qris");
    expect(row!.accountId).toBe(qrisAccountId);
    expect(row!.instructions).toBe("Instruksi baru");
    expect(row!.sortOrder).toBe(42);
    expect(row!.code).toBe(CODE_CLEAN);
    expect(row!.isActive).toBe(false);
  });

  it("update untuk id yang tidak ada → NOT_FOUND", async () => {
    const result = await updatePaymentMethodAction({
      id: GHOST_ID,
      name: "Hantu",
      type: "cash",
      accountId: kasAccountId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("savePaymentMethodAction dengan id ditolak — jalur ubah hanya lewat aksi update", async () => {
    const result = await savePaymentMethodAction({
      id: cleanMethodId,
      code: "BOCOR",
      name: "Bocor",
      type: "cash",
      accountId: kasAccountId,
    });
    expect(result.ok).toBe(false);
    const row = await readMethod(cleanMethodId);
    expect(row!.code).toBe(CODE_CLEAN);
    expect(row!.name).toBe("Metode Uji Diubah");
  });

  it("nonaktif hilang dari daftar aktif POS; riwayat lama tetap menampilkan namanya", async () => {
    const listed = await withCompanyReadOnly(ORG_ID, (tx) => listPaymentMethods(tx, ORG_ID));
    expect(listed.some((row) => row.id === cleanMethodId)).toBe(false);
    expect(listed.some((row) => row.id === usedMethodId)).toBe(true);

    const off = await setPaymentMethodActiveAction({ id: usedMethodId, isActive: false });
    expect(off.ok).toBe(true);
    const listedAfter = await withCompanyReadOnly(ORG_ID, (tx) => listPaymentMethods(tx, ORG_ID));
    expect(listedAfter.some((row) => row.id === usedMethodId)).toBe(false);

    // Riwayat penjualan lama tetap terbaca lewat jalur laporan nyata.
    const detail = await withCompanyReadOnly(ORG_ID, (tx) => getSaleDetail(tx, ORG_ID, usedSaleId));
    expect(detail).not.toBeNull();
    expect(detail!.payments).toHaveLength(1);
    expect(detail!.payments[0]!.methodName).toBe("Metode Uji Terpakai");

    const on = await setPaymentMethodActiveAction({ id: usedMethodId, isActive: true });
    expect(on.ok).toBe(true);
    const listedFinal = await withCompanyReadOnly(ORG_ID, (tx) => listPaymentMethods(tx, ORG_ID));
    expect(listedFinal.some((row) => row.id === usedMethodId)).toBe(true);
  });

  it("toggle untuk id yang tidak ada → NOT_FOUND", async () => {
    const result = await setPaymentMethodActiveAction({ id: GHOST_ID, isActive: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("hapus metode yang sudah dipakai transaksi → CONFLICT dengan jumlah, baris tetap ada", async () => {
    const result = await deletePaymentMethodAction(usedMethodId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFLICT");
      expect(result.message).toContain("1 transaksi");
      expect(result.message).toMatch(/nonaktifkan/i);
    }
    expect(await readMethod(usedMethodId)).not.toBeNull();
  });

  it("hapus metode segar → berhasil dan baris hilang; hapus ulang → NOT_FOUND", async () => {
    const goneId = await createMethod(CODE_GONE, "Metode Uji Hapus");
    const result = await deletePaymentMethodAction(goneId);
    expect(result.ok).toBe(true);
    expect(await readMethod(goneId)).toBeNull();

    const again = await deletePaymentMethodAction(goneId);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("NOT_FOUND");
  });

  it("peran tanpa settings.manage (kasir) ditolak di semua aksi dan tidak menulis apa pun", async () => {
    session.role = "cashier";
    try {
      const created = await savePaymentMethodAction({
        code: `PMCU${suffix}X`,
        name: "Selundupan",
        type: "cash",
        accountId: kasAccountId,
      });
      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.code).toBe("FORBIDDEN");

      const updated = await updatePaymentMethodAction({
        id: cleanMethodId,
        name: "Selundupan",
        type: "cash",
        accountId: kasAccountId,
      });
      expect(updated.ok).toBe(false);
      if (!updated.ok) expect(updated.code).toBe("FORBIDDEN");

      const toggled = await setPaymentMethodActiveAction({ id: cleanMethodId, isActive: true });
      expect(toggled.ok).toBe(false);
      if (!toggled.ok) expect(toggled.code).toBe("FORBIDDEN");

      const removed = await deletePaymentMethodAction(cleanMethodId);
      expect(removed.ok).toBe(false);
      if (!removed.ok) expect(removed.code).toBe("FORBIDDEN");
    } finally {
      session.role = "owner";
    }

    const row = await readMethod(cleanMethodId);
    expect(row).not.toBeNull();
    expect(row!.name).toBe("Metode Uji Diubah");
    expect(row!.isActive).toBe(false);
    const smuggled = await withCompanyReadOnly(ORG_ID, async (tx) => {
      const [found] = await tx
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.code, `PMCU${suffix}X`)))
        .limit(1);
      return found ?? null;
    });
    expect(smuggled).toBeNull();
  });
});
