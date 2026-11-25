import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/db";
import { pruneResolvedPosOutbox } from "@/server/pos/outbox-retention";

describe("POS outbox retention", () => {
  it("deletes only terminal pos_offline_sale rows inside the cutoff", async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: "row-1" }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const deleteMock = vi.fn().mockReturnValue({ where: whereMock });
    const mockTx = { delete: deleteMock } as unknown as Tx;

    const count = await pruneResolvedPosOutbox(mockTx, {
      companyId: "company-1",
      retentionDays: 30,
    });

    expect(count).toBe(1);
    expect(deleteMock).toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalled();
  });

  it("clamps invalid retention to a safe positive window", async () => {
    const returningMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const deleteMock = vi.fn().mockReturnValue({ where: whereMock });
    const mockTx = { delete: deleteMock } as unknown as Tx;

    await expect(
      pruneResolvedPosOutbox(mockTx, { companyId: "company-1", retentionDays: 0 }),
    ).resolves.toBe(0);
    await expect(
      pruneResolvedPosOutbox(mockTx, { companyId: "company-1", retentionDays: 99999 }),
    ).resolves.toBe(0);
  });
});
