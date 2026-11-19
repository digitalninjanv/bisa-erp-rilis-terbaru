import { withCompany } from "@/db/tenant";
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
import { countHeldSales, getOpenCashSession } from "@/server/pos";
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
  searchParams: Promise<{ resume?: string; forbidden?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("pos.sell");

  const data = await withCompany(ctx.company.id, async (tx) => {
    const settings = await getSettings(tx, ctx.company.id);
    const warehouses = await listWarehouses(tx, ctx.company.id);
    const categories = await listCategories(tx, ctx.company.id);
    const methods = await listPaymentMethods(tx, ctx.company.id);
    // POS-GRP-01: kasir hanya ditawari kelompok aktif — kelompok nonaktif
    // ditolak quoteCart sehingga menampilkannya hanya membuat error.
    const groups = await listCustomerGroups(tx, ctx.company.id, { activeOnly: true });
    const warehouseId =
      warehouses.find((w) => w.id === settings?.defaultWarehouseId)?.id ??
      warehouses.find((w) => w.isDefault)?.id ??
      warehouses[0]?.id ??
      "";
    const initialProducts = await searchProducts(tx, {
      companyId: ctx.company.id,
      warehouseId,
      q: "",
      limit: 24,
      // POS3-10: konsisten dengan searchProductsAction — harga pokok
      // hanya dimuat untuk pemegang inventory.cost.
      includeCost: can(ctx, "inventory.cost"),
    });
    const session = await getOpenCashSession(tx, ctx.company.id, ctx.user.id);

    const heldCount = await countHeldSales(tx, ctx.company.id);

    // FIX-GDG Tahap 4 (butir b): reservasi AKTIF untuk pemilih di
    // terminal — hanya yang masih berlaku yang ditawarkan ke kasir.
    const activeReservations = (await listReservations(tx, ctx.company.id))
      .filter((row) => row.effectiveStatus === "active")
      .map((row) => ({
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
      groups,
      warehouseId,
      initialProducts,
      session,
      heldCount,
      activeReservations,
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
    address: data.settings?.address ?? null,
    phone: data.settings?.phone ?? null,
    headerText: printSettings.headerText,
    footerText: printSettings.footerText,
    paperWidth: printSettings.receiptPaper === "thermal58" ? ("58mm" as const) : ("80mm" as const),
    showTax: printSettings.showTax,
    showCashier: printSettings.showCashier,
    showCustomer: printSettings.showCustomer,
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
      resumeId={params.resume ?? null}
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
