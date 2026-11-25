import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  customers,
  customerGroupPrices,
  customerGroups,
  member,
  organization,
  posPromotions,
  saleLines,
  sales,
  stockReservations,
  user,
} from "@/db/schema";
import { toPrintSettings } from "@/components/print/types";
import {
  getSettings,
  listPaymentMethods,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import { DEFAULT_POINTS_PER_RUPIAH } from "@/lib/pos/loyalty";
import {
  buildKitchenTickets,
  type KitchenTicket,
  type KitchenTicketSource,
} from "@/lib/pos/kitchen-display";
import { resolveOriginEntitlement } from "@/server/member-permissions";
import type { PosDeviceIdentity } from "./device-contract";

export type PosSnapshotReceipt = {
  companyName: string;
  address: string | null;
  phone: string | null;
  taxId: string | null;
  headerText: string | null;
  footerText: string | null;
  showCashier: boolean;
  showTax: boolean;
  showCustomer: boolean;
  showSession: boolean;
  showBranding: boolean;
  receiptPaper: string;
  taxEnabled: boolean;
  taxRate: string;
  roundingMode: string;
  qrisImage: string | null;
};

export type PosSnapshotTerminal = {
  id: string;
  name: string;
  companyName: string;
  warehouse: { id: string; code: string; name: string } | null;
};

export type PosSnapshotNames = {
  cashiers: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; name: string; groupId: string | null }>;
};

export type PosSnapshotCustomerGroup = {
  id: string;
  name: string;
  roundingStep: number;
  roundingDirection: string;
  roundCashTotal: boolean;
};

export type PosSnapshotGroupPrice = {
  groupId: string;
  productId: string;
  ruleType: string;
  value: string;
};

export type PosSnapshotLoyaltyBalance = { customerId: string; points: number };

export type PosSnapshotPromotion = {
  id: string;
  name: string;
  type: "percent" | "nominal";
  value: number;
  minSubtotal: number;
  productId: string | null;
};

export type PosSnapshotReservation = {
  id: string;
  number: string;
  productId: string;
  qty: string;
  expiresAt: string | null;
  reason: string | null;
};

export type SnapshotRefs = {
  warehouse: { id: string; code: string; name: string } | null;
  warehouseId: string;
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
  reservations: PosSnapshotReservation[];
  kitchenTickets: KitchenTicket[];
  promotions: PosSnapshotPromotion[];
  loyaltyBalances: PosSnapshotLoyaltyBalance[];
  paymentMethods: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    feeEnabled: boolean;
    feeType: string;
    feeValue: string;
  }>;
  customerGroups: PosSnapshotCustomerGroup[];
  receipt: PosSnapshotReceipt;
  terminal: PosSnapshotTerminal;
  names: PosSnapshotNames;
  canDiscount: boolean;
  posOfflineEnabled: boolean;
};

const SNAPSHOT_CUSTOMER_LIMIT = 5000;

export async function readSnapshotRefs(
  tx: Tx,
  companyId: string,
  device: PosDeviceIdentity,
): Promise<SnapshotRefs> {
  const [settings, warehouses, methods, org, cashierRows, customerRows, groupRows, entitlement] =
    await Promise.all([
      getSettings(tx, companyId),
      listWarehouses(tx, companyId),
      listPaymentMethods(tx, companyId),
      tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, companyId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select({ id: member.userId, name: user.name })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, companyId)),
      tx
        .select({ id: customers.id, name: customers.name, groupId: customers.groupId })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), eq(customers.isActive, true)))
        .orderBy(customers.name)
        .limit(SNAPSHOT_CUSTOMER_LIMIT),
      tx
        .select({
          id: customerGroups.id,
          name: customerGroups.name,
          roundingStep: customerGroups.roundingStep,
          roundingDirection: customerGroups.roundingDirection,
          roundCashTotal: customerGroups.roundCashTotal,
        })
        .from(customerGroups)
        .where(and(eq(customerGroups.companyId, companyId), eq(customerGroups.isActive, true)))
        .orderBy(customerGroups.name),
      resolveOriginEntitlement(companyId, device.userId),
    ]);
  const warehouseId =
    device.warehouseId && warehouses.some((w) => w.id === device.warehouseId)
      ? device.warehouseId
      : pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId);
  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null;
  const now = new Date();
  const sinceKitchen = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sinceLoyalty = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const [reservationRows, kitchenSales, promotionRows, loyaltyRows] = await Promise.all([
    warehouseId
      ? tx
          .select({
            id: stockReservations.id,
            number: stockReservations.number,
            productId: stockReservations.productId,
            qty: stockReservations.qty,
            expiresAt: stockReservations.expiresAt,
            reason: stockReservations.reason,
          })
          .from(stockReservations)
          .where(
            and(
              eq(stockReservations.companyId, companyId),
              eq(stockReservations.warehouseId, warehouseId),
              eq(stockReservations.status, "active"),
              or(isNull(stockReservations.expiresAt), gt(stockReservations.expiresAt, now)),
            ),
          )
          .orderBy(stockReservations.number)
          .limit(500)
      : Promise.resolve([]),
    tx
      .select({
        id: sales.id,
        number: sales.number,
        createdAt: sales.createdAt,
        productName: saleLines.productName,
        qty: saleLines.qty,
      })
      .from(sales)
      .innerJoin(saleLines, and(eq(saleLines.companyId, companyId), eq(saleLines.saleId, sales.id)))
      .where(
        and(
          eq(sales.companyId, companyId),
          eq(sales.status, "completed"),
          gte(sales.createdAt, sinceKitchen),
        ),
      )
      .orderBy(desc(sales.createdAt))
      .limit(200),
    tx
      .select({
        id: posPromotions.id,
        name: posPromotions.name,
        type: posPromotions.type,
        value: posPromotions.value,
        minSubtotal: posPromotions.minSubtotal,
        productId: posPromotions.productId,
      })
      .from(posPromotions)
      .where(and(eq(posPromotions.companyId, companyId), eq(posPromotions.active, true)))
      .orderBy(posPromotions.name)
      .limit(200),
    tx
      .select({
        customerId: sales.customerId,
        points: sql<number>`coalesce(sum(floor(${sales.total} / ${DEFAULT_POINTS_PER_RUPIAH})), 0)::int`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.companyId, companyId),
          eq(sales.status, "completed"),
          sql`${sales.customerId} is not null`,
          gte(sales.total, String(DEFAULT_POINTS_PER_RUPIAH)),
          gte(sales.createdAt, sinceLoyalty),
        ),
      )
      .groupBy(sales.customerId),
  ]);

  const reservations: PosSnapshotReservation[] = reservationRows.map((row) => ({
    id: row.id,
    number: row.number,
    productId: row.productId,
    qty: String(row.qty),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    reason: row.reason,
  }));

  const kitchenBySale = new Map<string, KitchenTicketSource>();
  for (const row of kitchenSales) {
    const source = kitchenBySale.get(row.id) ?? {
      id: row.id,
      number: row.number,
      createdAt: row.createdAt,
      lines: [],
    };
    source.lines.push({ productName: row.productName, qty: row.qty });
    kitchenBySale.set(row.id, source);
  }
  const kitchenTickets = buildKitchenTickets([...kitchenBySale.values()]).slice(0, 50);

  const promotions: PosSnapshotPromotion[] = promotionRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type === "nominal" ? "nominal" : "percent",
    value: Number(row.value),
    minSubtotal: Number(row.minSubtotal),
    productId: row.productId,
  }));

  const loyaltyBalances: PosSnapshotLoyaltyBalance[] = loyaltyRows
    .filter((row): row is { customerId: string; points: number } => Boolean(row.customerId) && row.points > 0)
    .map((row) => ({ customerId: row.customerId, points: row.points }));

  const print = toPrintSettings(settings, "nota");
  return {
    warehouse: warehouse
      ? { id: warehouse.id, code: warehouse.code, name: warehouse.name }
      : null,
    warehouseId,
    warehouses: warehouses.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      isDefault: w.isDefault,
    })),
    reservations,
    kitchenTickets,
    promotions,
    loyaltyBalances,
    paymentMethods: methods.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      type: m.type,
      feeEnabled: m.feeEnabled,
      feeType: m.feeType,
      feeValue: String(m.feeValue),
    })),
    customerGroups: groupRows,
    receipt: {
      companyName: settings?.legalName || "Bisa Minimarket",
      address: settings?.address ?? null,
      phone: settings?.phone ?? null,
      taxId: settings?.taxId ?? null,
      headerText: print.headerText,
      footerText: print.footerText,
      showCashier: print.showCashier,
      showTax: print.showTax,
      showCustomer: print.showCustomer,
      showSession: print.showSession,
      showBranding: print.showBranding,
      receiptPaper: print.receiptPaper,
      taxEnabled: settings?.taxEnabled ?? true,
      taxRate: String(settings?.taxRate ?? "0"),
      roundingMode: settings?.roundingMode ?? "none",
      qrisImage: settings?.qrisImage ?? null,
    },
    terminal: {
      id: device.terminalId,
      name: device.terminalName,
      companyName: settings?.legalName || org?.name || "Bisa Minimarket",
      warehouse: warehouse
        ? { id: warehouse.id, code: warehouse.code, name: warehouse.name }
        : null,
    },
    names: {
      cashiers: cashierRows.map((row) => ({ id: row.id, name: row.name })),
      customers: customerRows.map((row) => ({ id: row.id, name: row.name, groupId: row.groupId })),
    },
    canDiscount: entitlement?.canDiscount ?? false,
    posOfflineEnabled: settings?.posOfflineEnabled ?? false,
  };
}

export async function readGroupPrices(
  tx: Tx,
  companyId: string,
  groupIds: string[],
): Promise<PosSnapshotGroupPrice[]> {
  if (groupIds.length === 0) return [];
  const rows = await tx
    .select({
      groupId: customerGroupPrices.groupId,
      productId: customerGroupPrices.productId,
      ruleType: customerGroupPrices.ruleType,
      value: customerGroupPrices.value,
    })
    .from(customerGroupPrices)
    .where(and(eq(customerGroupPrices.companyId, companyId), inArray(customerGroupPrices.groupId, groupIds)));
  return rows.map((row) => ({ ...row, value: String(row.value) }));
}
