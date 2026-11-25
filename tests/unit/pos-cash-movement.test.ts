import { describe, expect, it } from "vitest";
import {
  CASH_MOVEMENT_TYPE_BY_INTENT,
  cashMovementToast,
} from "@/lib/pos/cash-movement";

describe("pemetaan mutasi kas POS", () => {
  it("Kas Keluar (uang keluar laci) memakai deposit: domain mengurangi laci", () => {
    expect(CASH_MOVEMENT_TYPE_BY_INTENT.out).toBe("deposit");
    expect(cashMovementToast(CASH_MOVEMENT_TYPE_BY_INTENT.out)).toBe("Kas keluar");
  });

  it("Kas Masuk (uang masuk laci) memakai withdrawal: domain menambah laci", () => {
    expect(CASH_MOVEMENT_TYPE_BY_INTENT.in).toBe("withdrawal");
    expect(cashMovementToast(CASH_MOVEMENT_TYPE_BY_INTENT.in)).toBe("Kas masuk");
  });
});
