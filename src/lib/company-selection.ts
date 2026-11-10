/**
 * Company selection for multi-company users (LINTAS-01).
 *
 * The user's choice lives in an httpOnly cookie that only ever carries a
 * company id — never a role or permissions. Resolution is deliberately
 * conservative: the cookie may only *choose among* the memberships the
 * user actually has; a foreign or stale value falls back to the earliest
 * membership, which is exactly the behaviour before company switching
 * existed.
 */
export const COMPANY_COOKIE_NAME = "bisa_company";

export function resolveMembership<T extends { companyId: string }>(
  memberships: readonly T[],
  selectedCompanyId?: string | null,
): T | undefined {
  if (memberships.length === 0) return undefined;
  if (selectedCompanyId) {
    const chosen = memberships.find((row) => row.companyId === selectedCompanyId);
    if (chosen) return chosen;
  }
  return memberships[0];
}
