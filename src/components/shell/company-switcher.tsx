"use client";

import { useState } from "react";
import { Building2, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { switchCompanyAction } from "@/server/actions/company";

/**
 * Active-company indicator in the app shell. With a single membership
 * it is the static badge it always was; with several memberships it
 * becomes a select that writes the choice via switchCompanyAction
 * (LINTAS-01) and reloads the page so every server-rendered module
 * re-resolves under the newly selected company.
 */
export function CompanySwitcher({
  companies,
  activeId,
}: {
  companies: { id: string; name: string }[];
  activeId: string;
}) {
  const [busy, setBusy] = useState(false);
  const active = companies.find((row) => row.id === activeId);

  if (companies.length < 2) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
        <Building2 className="size-3.5 text-muted-foreground" />
        <span className="max-w-[120px] truncate text-[11px] font-medium sm:max-w-[180px]">
          {active?.name ?? "—"}
        </span>
      </div>
    );
  }

  async function onChange(companyId: string) {
    if (companyId === activeId || busy) return;
    setBusy(true);
    const result = await switchCompanyAction(companyId);
    if (!result.ok) {
      setBusy(false);
      toast.error(result.message);
      return;
    }
    // Full reload: module access, role, and every cached server
    // component belong to the previous company and must be re-resolved.
    window.location.reload();
  }

  return (
    <div className="relative flex min-w-0 items-center">
      <Building2 className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <select
        aria-label="Ganti perusahaan"
        value={activeId}
        disabled={busy}
        onChange={(event) => void onChange(event.target.value)}
        className="max-w-[120px] appearance-none truncate rounded-md border border-border bg-background py-1 pl-7 pr-6 text-[11px] font-medium outline-none focus:border-ring disabled:opacity-50 sm:max-w-[200px]"
      >
        {companies.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground" />
    </div>
  );
}
