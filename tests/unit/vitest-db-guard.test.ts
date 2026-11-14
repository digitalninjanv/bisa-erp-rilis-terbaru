import { describe, expect, it } from "vitest";
import { configureVitestDatabase, isUnitOnlyRun } from "../vitest-db-guard.mjs";

const ROOT = "/repo";
const TEST_ENV = {
  BISA_TEST_DATABASE_URL: "postgresql://app:secret@127.0.0.1:5432/bisa_erp_test",
  BISA_TEST_DIRECT_URL: "postgresql://owner:secret@localhost:5432/bisa_erp_test",
};

describe("Vitest database safety guard", () => {
  it("identifies an explicitly unit-only run", () => {
    expect(isUnitOnlyRun(["run", "tests/unit/nav.test.ts"], ROOT)).toBe(true);
    expect(isUnitOnlyRun(["run", "tests/unit"], ROOT)).toBe(true);
    expect(isUnitOnlyRun(["run", "tests/unit", "tests/integration/foo.test.ts"], ROOT)).toBe(false);
    expect(isUnitOnlyRun(["run", "--config", "tests/unit/vitest.config.ts"], ROOT)).toBe(false);
    expect(isUnitOnlyRun(["run", "-t", "tests/unit"], ROOT)).toBe(false);
    expect(isUnitOnlyRun(["run"], ROOT)).toBe(false);
  });

  it("rejects full/integration runs when explicit test URLs are absent", () => {
    expect(() => configureVitestDatabase(["run"], {}, ROOT)).toThrow(/BISA_TEST_DATABASE_URL/);
    expect(() => configureVitestDatabase(["run", "tests/integration"], {}, ROOT)).toThrow(
      /BISA_TEST_DATABASE_URL/,
    );
  });

  it("does not allow an ordinary company database name", () => {
    expect(() => configureVitestDatabase(
      ["run", "tests/integration"],
      {
        BISA_TEST_DATABASE_URL: "postgresql://app:secret@127.0.0.1:5432/bisa_erp",
        BISA_TEST_DIRECT_URL: "postgresql://owner:secret@127.0.0.1:5432/bisa_erp",
      },
      ROOT,
    )).toThrow(/database khusus/);
  });

  it("requires both connections to target the same test database", () => {
    expect(() => configureVitestDatabase(
      ["run", "tests/integration"],
      {
        ...TEST_ENV,
        BISA_TEST_DIRECT_URL: "postgresql://owner:secret@127.0.0.1:5432/other_test",
      },
      ROOT,
    )).toThrow(/database yang sama/);
  });

  it("requires explicit opt-in for non-loopback CI databases", () => {
    const env: Record<string, string | undefined> = {
      BISA_TEST_DATABASE_URL: "postgresql://app:secret@postgres:5432/bisa_erp_test",
      BISA_TEST_DIRECT_URL: "postgresql://owner:secret@postgres:5432/bisa_erp_test",
    };
    expect(() => configureVitestDatabase(["run", "tests/integration"], env, ROOT)).toThrow(
      /loopback/,
    );
    env.BISA_ALLOW_REMOTE_TEST_DATABASE = "1";
    configureVitestDatabase(["run", "tests/integration"], env, ROOT);
    expect(env.DATABASE_URL).toBe(env.BISA_TEST_DATABASE_URL);
    expect(env.DIRECT_URL).toBe(env.BISA_TEST_DIRECT_URL);
  });

  it("overrides any inherited application database URLs before dotenv can load", () => {
    const env: Record<string, string | undefined> = {
      ...TEST_ENV,
      DATABASE_URL: "postgresql://app:secret@localhost:5433/live_company_db",
      DIRECT_URL: "postgresql://owner:secret@localhost:5433/live_company_db",
    };
    configureVitestDatabase(["run", "tests/integration"], env, ROOT);
    expect(env.DATABASE_URL).toBe(TEST_ENV.BISA_TEST_DATABASE_URL);
    expect(env.DIRECT_URL).toBe(TEST_ENV.BISA_TEST_DIRECT_URL);
  });
});
