/** Permission scope for the cross-module dashboard read model. */
export type HomeDashboardScope = {
  sales: boolean;
  inventoryValue: boolean;
  lowStock: boolean;
  openSession: boolean;
  cashBank: boolean;
};

export function resolveHomeDashboardScope(input: {
  canSeePosSales: boolean;
  canSeeInventory: boolean;
  canSeeInventoryCost: boolean;
  canSeeAccounting: boolean;
  canSeePosSession: boolean;
}): HomeDashboardScope {
  return {
    // Akuntansi's module summary includes monthly sales; operational sales
    // details remain limited to the POS permission.
    sales: input.canSeePosSales || input.canSeeAccounting,
    inventoryValue: input.canSeeInventory && input.canSeeInventoryCost,
    lowStock: input.canSeeInventory,
    openSession: input.canSeePosSession,
    cashBank: input.canSeeAccounting,
  };
}
