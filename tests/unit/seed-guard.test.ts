import { describe, expect, it } from "vitest";
import {
  DEMO_OWNER_PASSWORD,
  MIN_PRODUCTION_SEED_PASSWORD_LENGTH,
  PRODUCTION_SEED_FLAG,
  resolveSeedOwnerPassword,
  seedOwnerLoginMessage,
} from "@/db/seed-guard";

describe("demo seed production guard", () => {
  it("keeps the local/CI demo credential outside production", () => {
    expect(
      resolveSeedOwnerPassword({ isProduction: false, argv: [] }),
    ).toEqual({ password: DEMO_OWNER_PASSWORD, demo: true });
  });

  it("refuses a production seed without the explicit flag", () => {
    expect(() =>
      resolveSeedOwnerPassword({
        isProduction: true,
        argv: [],
        ownerPassword: "a-unique-production-password",
      }),
    ).toThrow(/allow-production-seed/i);
  });

  it("refuses the published demo password even with the flag", () => {
    expect(() =>
      resolveSeedOwnerPassword({
        isProduction: true,
        argv: [PRODUCTION_SEED_FLAG],
        ownerPassword: DEMO_OWNER_PASSWORD,
      }),
    ).toThrow(/tidak boleh memakai kredensial demo/i);
  });

  it("requires a unique password of at least the minimum length", () => {
    expect(() =>
      resolveSeedOwnerPassword({
        isProduction: true,
        argv: [PRODUCTION_SEED_FLAG],
        ownerPassword: "x".repeat(MIN_PRODUCTION_SEED_PASSWORD_LENGTH - 1),
      }),
    ).toThrow(/minimal 16/i);

    const password = "x".repeat(MIN_PRODUCTION_SEED_PASSWORD_LENGTH);
    expect(
      resolveSeedOwnerPassword({
        isProduction: true,
        argv: [PRODUCTION_SEED_FLAG],
        ownerPassword: password,
      }),
    ).toEqual({ password, demo: false });
  });

  it("never prints the production password", () => {
    const password = "x".repeat(MIN_PRODUCTION_SEED_PASSWORD_LENGTH);
    const message = seedOwnerLoginMessage({ password, demo: false });
    expect(message).toContain("BISA_SEED_OWNER_PASSWORD");
    expect(message).not.toContain(password);
    expect(seedOwnerLoginMessage({ password: DEMO_OWNER_PASSWORD, demo: true })).toContain(
      DEMO_OWNER_PASSWORD,
    );
  });
});
