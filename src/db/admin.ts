import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "./schema";

// FIX-ARS Tahap 1 (ARS4-03): DIRECT_URL is validated (and required) by
// the shared env module; the old silent fallback to DATABASE_URL is
// gone so migrations/seeds can never quietly run against the app role.
const connectionString = env.directUrl;

/** Owner connection. Used only by migrations and seed scripts. */
export const adminSql = postgres(connectionString, { max: 2 });
export const adminDb = drizzle(adminSql, { schema });
