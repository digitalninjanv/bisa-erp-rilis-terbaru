import { and, eq, inArray } from "drizzle-orm";
import { withCompany } from "@/db/tenant";
import { customerGroupPrices } from "@/db/schema";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { PosServiceWorker } from "@/components/pwa/pos-service-worker";
import {
  getSettings,
  listCategories,
  listCustomerGroups,
  listPaymentMethods,
  listWarehouses,
  searchProducts,
} from "@/server/catalog";
import { countHeldSales, getOpenCashSession, listActivePosPromotions } from "@/server/pos";
import { listReservations } from "@/server/reservations";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { ForbiddenBanner } from "@/components/blocks/forbidden-banner";
import { toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Kasir" };
export const dynamic = "force-dynamic";

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string; forbidden?: string; credit?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("pos.sell");

  const data = await withCompany(ctx.company.id, async (tx) => {
    // Pembacaan referensi terminal tidak saling bergantung; jalankan
    // paralel agar TTFB terminal tidak menjadi jumlah latensi sembilan
    // query berurutan.
    const [settings, warehouses, categories, methods, groups] = await Promise.all([
      getSettings(tx, ctx.company.id),
      listWarehouses(tx, ctx.company.id),
      listCategories(tx, ctx.company.id),
      listPaymentMethods(tx, ctx.company.id),
      // POS-GRP-01: kasir hanya ditawari kelompok aktif — kelompok nonaktif
      // ditolak quoteCart sehingga menampilkannya hanya membuat error.
      listCustomerGroups(tx, ctx.company.id, { activeOnly: true }),
    ]);
    const warehouseId =
      warehouses.find((w) => w.id === settings?.defaultWarehouseId)?.id ??
      warehouses.find((w) => w.isDefault)?.id ??
      warehouses[0]?.id ??
      "";

    const groupIds = groups.map((group) => group.id);
    const groupPriceRows =
      groupIds.length > 0
        ? await tx
            .select({
              groupId: customerGroupPrices.groupId,
              productId: customerGroupPrices.productId,
              ruleType: customerGroupPrices.ruleType,
              value: customerGroupPrices.value,
            })
            .from(customerGroupPrices)
            .where(
              and(
                eq(customerGroupPrices.companyId, ctx.company.id),
                inArray(customerGroupPrices.groupId, groupIds),
              ),
            )
        : [];
    const priceRulesByGroup = new Map<
      string,
      Record<string, { type: "percent" | "fixed"; value: string }>
    >();
    for (const row of groupPriceRows) {
      const current = priceRulesByGroup.get(row.groupId) ?? {};
      current[row.productId] = {
        type: row.ruleType === "fixed" ? "fixed" : "percent",
        value: row.value,
      };
      priceRulesByGroup.set(row.groupId, current);
    }
    const groupsWithPrices = groups.map((group) => ({
      ...group,
      priceRules: priceRulesByGroup.get(group.id) ?? {},
    }));

    const [initialProducts, session, heldCount, reservationRows, promotions] = await Promise.all([
      searchProducts(tx, {
        companyId: ctx.company.id,
        warehouseId,
        q: "",
        limit: 24,
        // POS3-10: konsisten dengan searchProductsAction — harga pokok
        // hanya dimuat untuk pemegang inventory.cost.
        includeCost: can(ctx, "inventory.cost"),
      }),
      getOpenCashSession(tx, ctx.company.id, ctx.user.id),
      countHeldSales(tx, ctx.company.id),
      // FIX-GDG Tahap 4 (butir b): reservasi AKTIF untuk pemilih di
      // terminal — hanya yang masih berlaku yang ditawarkan ke kasir.
      listReservations(tx, ctx.company.id, true),
      listActivePosPromotions(tx, ctx.company.id),
    ]);
    const activeReservations = reservationRows.map((row) => ({
      id: row.id,
      number: row.number,
      warehouseId: row.warehouseId,
      productId: row.productId,
      productName: row.productName,
      productSku: row.productSku,
      qty: row.qty,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      reason: row.reason,
    }));

    return {
      settings,
      warehouses,
      categories,
      // D-12: metode customer_credit juga disembunyikan dari daftar
      // metode biasa — ia dipakai lewat alur "Pakai Kredit Retur" dan
      // diteruskan terpisah sebagai creditMethod.
      methods: methods.filter((method) => method.type !== "credit" && method.type !== "customer_credit"),
      creditMethod: methods.find((method) => method.type === "customer_credit") ?? null,
      // POS-1 (D-19): metode bertipe credit tidak lagi disembunyikan —
      // ia tampil KHUSUS sebagai pilihan "Utang" di panel pembayaran
      // (diteruskan terpisah sebagai debtMethod agar tidak tercampur
      // dengan metode lunas biasa). listPaymentMethods sudah hanya
      // mengembalikan metode aktif terurut sortOrder, jadi metode
      // kredit pertama itulah yang dipakai terminal.
      debtMethod: methods.find((method) => method.type === "credit") ?? null,
      groups: groupsWithPrices,
      warehouseId,
      initialProducts,
      session,
      heldCount,
      activeReservations,
      promotions,
    };
  });

  if (!data.warehouseId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm">
        <h1 className="sr-only">Kasir</h1>
        Belum ada gudang aktif. Tambahkan gudang terlebih dahulu di Pengaturan.
      </div>
    );
  }

  const printSettings = toPrintSettings(data.settings, "nota");
  const receiptProfile = {
    companyName: data.settings?.legalName ?? ctx.company.name,
    taxId: data.settings?.taxId ?? null,
    branchName: data.session?.branchName ?? null,
    address: data.settings?.address ?? null,
    phone: data.settings?.phone ?? null,
    headerText: printSettings.headerText,
    footerText: printSettings.footerText,
    paperWidth: printSettings.receiptPaper === "thermal58" ? ("58mm" as const) : ("80mm" as const),
    showTax: printSettings.showTax,
    showCashier: printSettings.showCashier,
    showCustomer: printSettings.showCustomer,
    showSession: printSettings.showSession,
    showQr: printSettings.showQr,
    cashierName: ctx.user.name,
    openCashDrawer: true,
    cutPaper: true,
  };

  return (
    <>
      <h1 className="sr-only">Kasir</h1>
      {/* Ctrl+P di terminal bukan jalur cetak nota: tanpa ini browser
          mencetak grid produk POS. Nota dicetak dari dialog transaksi. */}
      <div className="pos-print-hint hidden">
        <h2 className="text-lg font-semibold">Cetak nota</h2>
        <p className="mt-1 text-sm">
          Gunakan tombol <strong>Cetak nota</strong> pada dialog transaksi berhasil,
          atau buka nota dari <strong>Riwayat transaksi</strong>.
        </p>
      </div>
      {params.forbidden ? (
        <div className="px-4 pt-3">
          <ForbiddenBanner permission={params.forbidden} />
        </div>
      ) : null}
      {/* A-24 T6B: pendaftaran service worker shell terminal
          (pengerasan PWA terbatas) — tak terlihat, tergating saklar
          offline perusahaan yang sama dengan antrean offline. */}
      <PosServiceWorker enabled={data.settings?.posOfflineEnabled ?? false} />
      <PosTerminal
      companyId={ctx.company.id}
      userId={ctx.user.id}
      canReprint={can(ctx, "pos.receipt.reprint")}
      companyName={data.settings?.legalName ?? ctx.company.name}
      warehouseId={data.warehouseId}
      warehouses={data.warehouses}
      categories={data.categories.map((row) => ({ id: row.id, name: row.name }))}
      methods={data.methods.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        type: m.type,
        instructions: m.instructions,
        // A-21 Tahap R3-A (R3-01): konfigurasi fee metode untuk nilai
        // awal fee di panel pembayaran.
        feeEnabled: m.feeEnabled,
        feeType: m.feeType,
        feeValue: m.feeValue,
      }))}
      creditMethod={
        data.creditMethod ? { id: data.creditMethod.id, name: data.creditMethod.name } : null
      }
      debtMethod={
        data.debtMethod ? { id: data.debtMethod.id, name: data.debtMethod.name } : null
      }
      groups={data.groups.map((g) => ({
        id: g.id,
        name: g.name,
        roundingStep: g.roundingStep,
        roundingDirection: g.roundingDirection,
        roundCashTotal: g.roundCashTotal,
        priceRules: g.priceRules,
      }))}
      initialProducts={data.initialProducts.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        salePrice: p.salePrice,
        stock: "stock" in p ? Number((p as { stock?: string }).stock ?? 0) : 0,
        trackStock: (p as { trackStock?: boolean }).trackStock ?? true,
        trackSerial: (p as { trackSerial?: boolean }).trackSerial ?? false,
        isTaxExempt: (p as { isTaxExempt?: boolean }).isTaxExempt ?? false,
        unitCode: (p as { unitCode?: string | null }).unitCode ?? "PCS",
        // S4: kemasan aktif produk untuk pemilih satuan & quote lokal.
        packagings: (p.packagings ?? []).map((pack) => ({
          id: pack.id,
          name: pack.name,
          isi: pack.isi,
          salePrice: pack.salePrice,
          barcode: pack.barcode,
          isDefaultSale: pack.isDefaultSale,
        })),
        matchedPackagingId: p.matchedPackagingId ?? null,
      }))}
      qrisImage={data.settings?.qrisImage ?? null}
      sessionOpen={Boolean(data.session)}
      sessionId={data.session?.id ?? null}
      heldCount={data.heldCount}
      reservations={data.activeReservations}
      promotions={data.promotions}
      resumeId={params.resume ?? null}
      prefillCreditNumber={params.credit ?? null}
      posOfflineEnabled={data.settings?.posOfflineEnabled ?? false}
      offlineTaxRate={data.settings?.taxEnabled ? Number(data.settings?.taxRate ?? 0) : 0}
      offlineRoundingMode={data.settings?.roundingMode ?? "none"}
      receivableDefaultTermDays={data.settings?.receivableDefaultTermDays ?? 7}
      allowNegativeStock={data.settings?.allowNegativeStock ?? false}
      receiptProfile={receiptProfile}
      />
    </>
  );
}
