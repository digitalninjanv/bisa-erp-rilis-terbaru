import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "./schema";

// FIX-ARS Tahap 1 (ARS4-03): the connection string comes from the
// single validated env module — importing it fails fast at startup
// when DATABASE_URL (or any other critical variable) is invalid,
// instead of this file's old one-off presence check.
const connectionString = env.databaseUrl;

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

export const sqlClient =
  globalForDb.sql ??
  postgres(connectionString, {
    max: 12,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sqlClient;

export const db = drizzle(sqlClient, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Db = typeof db;
