import path from "node:path";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const OPTIONS_WITH_VALUES = new Set([
  "--config", "-c", "--root", "--dir", "--project", "-p", "--testNamePattern", "-t",
  "--reporter", "-r", "--environment", "-e", "--pool", "--poolOptions",
]);

function testTargets(args, root) {
  const targets = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (OPTIONS_WITH_VALUES.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-") || !/(?:^|[\\/])tests(?:[\\/]|$)/i.test(arg)) continue;
    targets.push(path.relative(root, path.resolve(root, arg)).replaceAll(path.sep, "/"));
  }
  return targets;
}

export function isUnitOnlyRun(args, root) {
  const targets = testTargets(args, root);
  return targets.length > 0 && targets.every(
    (target) => target === "tests/unit" || target.startsWith("tests/unit/"),
  );
}

function parseTestDatabaseUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} bukan URL PostgreSQL yang valid.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${label} harus memakai protokol PostgreSQL.`);
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name || !/(?:^|[_-])(?:test|testing)(?:$|[_-])/i.test(name)) {
    throw new Error(`${label} harus menunjuk database khusus dengan token nama "test".`);
  }

  return { name, host: url.hostname.toLowerCase() };
}

/**
 * Integration/simulation suites may delete fixture companies through the
 * owner connection. They must never inherit a database URL from .env.local.
 */
export function configureVitestDatabase(
  args,
  env,
  root,
) {
  if (isUnitOnlyRun(args, root)) return;

  const databaseUrl = env.BISA_TEST_DATABASE_URL?.trim();
  const directUrl = env.BISA_TEST_DIRECT_URL?.trim();
  if (!databaseUrl || !directUrl) {
    throw new Error(
      "Suite Vitest selain tests/unit dapat mengubah fixture database. " +
        "Tetapkan BISA_TEST_DATABASE_URL dan BISA_TEST_DIRECT_URL ke database khusus bernama *_test sebelum menjalankan suite.",
    );
  }

  const database = parseTestDatabaseUrl(databaseUrl, "BISA_TEST_DATABASE_URL");
  const direct = parseTestDatabaseUrl(directUrl, "BISA_TEST_DIRECT_URL");
  if (database.name !== direct.name) {
    throw new Error("BISA_TEST_DATABASE_URL dan BISA_TEST_DIRECT_URL harus menunjuk database yang sama.");
  }

  const allowRemote = env.BISA_ALLOW_REMOTE_TEST_DATABASE === "1";
  if ((!LOOPBACK_HOSTS.has(database.host) || !LOOPBACK_HOSTS.has(direct.host)) && !allowRemote) {
    throw new Error(
      "Database test harus berada di loopback. Untuk CI dengan service database terisolasi, set BISA_ALLOW_REMOTE_TEST_DATABASE=1 secara eksplisit.",
    );
  }

  // Force both application and fixture-owner connections away from .env.local.
  env.DATABASE_URL = databaseUrl;
  env.DIRECT_URL = directUrl;
}
