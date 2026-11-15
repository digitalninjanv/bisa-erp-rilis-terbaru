import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { warehouses } from "@/db/schema";
import {
  createPosTerminal,
  issuePairingCode,
  listPosTerminals,
  listTerminalActorOptions,
  listTerminalSessionReviews,
  recordTerminalSessionClose,
  revokePosTerminal,
} from "@/server/pos/terminals";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG = "01900000-0000-7000-8000-000000000001";
const OWNER = "01900000-0000-7000-8000-000000000010";
const rollback = makeRollbackTransaction(ORG);

describe("terminal POS — cabang administrasi", () => {
  it("buat, daftar, terbitkan kode, cabut, dan catat tutup sesi", async () => {
    await rollback(async (tx) => {
      const [wh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      const suffix = crypto.randomUUID().slice(0, 8);

      await expect(
        createPosTerminal(tx, {
          companyId: ORG,
          name: `Terminal Salah ${suffix}`,
          warehouseId: crypto.randomUUID(),
          userId: OWNER,
          createdBy: OWNER,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      const noWarehouse = await createPosTerminal(tx, {
        companyId: ORG,
        name: `Terminal Tanpa Gudang ${suffix}`,
        warehouseId: null,
        userId: OWNER,
        createdBy: OWNER,
      });
      const withWarehouse = await createPosTerminal(tx, {
        companyId: ORG,
        name: `Terminal Gudang ${suffix}`,
        warehouseId: wh?.id ?? null,
        userId: OWNER,
        createdBy: OWNER,
      });
      const listed = await listPosTerminals(tx, ORG);
      const plain = listed.find((row) => row.id === noWarehouse.id);
      expect(plain).toMatchObject({ paired: false, warehouseName: null });
      expect(listed.find((row) => row.id === withWarehouse.id)?.warehouseName).toBeTruthy();
      expect(Array.isArray(await listTerminalActorOptions(tx, ORG))).toBe(true);

      await expect(
        issuePairingCode(tx, {
          companyId: ORG,
          terminalId: crypto.randomUUID(),
          createdBy: OWNER,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const first = await issuePairingCode(tx, {
        companyId: ORG,
        terminalId: withWarehouse.id,
        createdBy: OWNER,
      });
      const second = await issuePairingCode(tx, {
        companyId: ORG,
        terminalId: withWarehouse.id,
        createdBy: OWNER,
      });
      expect(first.code).not.toBe(second.code);
      expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());

      await expect(
        revokePosTerminal(tx, { companyId: ORG, terminalId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await revokePosTerminal(tx, { companyId: ORG, terminalId: withWarehouse.id });
      await expect(
        issuePairingCode(tx, {
          companyId: ORG,
          terminalId: withWarehouse.id,
          createdBy: OWNER,
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });

      const intent = {
        clientKey: `close-${suffix}`,
        warehouseId: wh?.id ?? null,
        cashierId: OWNER,
        localSessionId: `local-${suffix}`,
        openedAt: "2026-11-15T01:00:00Z",
        closedAt: "2026-11-15T09:00:00Z",
        openingCash: 100000,
        expectedCash: 250000,
        countedCash: 240000,
        difference: -10000,
        denominations: [{ denomination: "100000", count: 2 }],
        differenceReason: "Kurang uji",
      };
      expect(
        await recordTerminalSessionClose(tx, {
          companyId: ORG,
          terminalId: withWarehouse.id,
          intent,
        }),
      ).toBe("recorded");
      expect(
        await recordTerminalSessionClose(tx, {
          companyId: ORG,
          terminalId: withWarehouse.id,
          intent,
        }),
      ).toBe("duplicate");
      const reviews = await listTerminalSessionReviews(tx, ORG);
      expect(reviews.some((row) => row.terminalName.includes("Terminal Gudang"))).toBe(true);
    });
  });
});
