"use server";

import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import { deleteAttachment } from "@/server/attachments";

export async function deleteAttachmentAction(input: { id: string }) {
  return guard(async () => {
    const ctx = await requirePermission("accounting.post");
    const data = parseInput(z.object({ id: z.string().uuid() }), input);
    await withCompany(ctx.company.id, (tx) =>
      deleteAttachment(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        id: data.id,
        canManage: can(ctx, "accounting.manage"),
      }),
    );
    return { id: data.id };
  });
}
